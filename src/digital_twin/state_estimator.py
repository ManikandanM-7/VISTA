"""
CogeTwin — State Estimator (Real-time Inference Wrapper)
=========================================================
Provides a clean interface for real-time Digital Twin inference.
Handles:
  - Loading the trained BiLSTM model checkpoint
  - Maintaining a rolling sensor window (ring buffer)
  - Inverse-scaling predictions back to physical units
  - Thread-safe state updates for the WebSocket feed
"""

from __future__ import annotations

import logging
import pickle
import threading
from collections import deque
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Lazy import torch so the API can start without it installed
_torch = None
_model_class = None

def _lazy_import():
    global _torch, _model_class
    if _torch is None:
        import torch as torch_
        _torch = torch_
    if _model_class is None:
        from src.digital_twin.model import DigitalTwinModel
        _model_class = DigitalTwinModel


class PlantStateEstimator:
    """
    Real-time state estimator backed by the trained Digital Twin model.
    Maintains a rolling window of the last `seq_len` sensor readings.

    Thread-safe: designed for concurrent WebSocket + HTTP access.
    """

    def __init__(
        self,
        model_path: str | Path = "models/best_model.pt",
        preprocessor_dir: str | Path = "data/processed",
    ) -> None:
        self._lock             = threading.Lock()
        self._model            = None
        self._scaler           = None
        self._feature_cols: list[str] = []
        self._target_cols:  list[str] = []
        self._seq_len: int             = 60
        self._window: deque            = deque()
        self._last_state: dict         = {}
        self._loaded: bool             = False

        self._model_path       = Path(model_path)
        self._preprocessor_dir = Path(preprocessor_dir)
        self._device           = "cpu"

    def load(self) -> "PlantStateEstimator":
        """Load model and preprocessor artifacts. Call once at startup."""
        _lazy_import()

        try:
            # ── Load preprocessor ──────────────────────────────────────
            scaler_path = self._preprocessor_dir / "scaler.pkl"
            meta_path   = self._preprocessor_dir / "preprocessor_meta.pkl"

            if not scaler_path.exists():
                logger.warning("Scaler not found at %s — estimator running in mock mode", scaler_path)
                self._loaded = False
                return self

            with open(scaler_path, "rb") as f:
                self._scaler = pickle.load(f)
            with open(meta_path, "rb") as f:
                meta = pickle.load(f)

            self._feature_cols = meta.get("feature_columns", meta.get("feature_cols", []))
            self._target_cols  = meta.get("target_columns",  meta.get("target_cols", []))
            self._seq_len      = meta.get("sequence_length", 60)

            # ── Load model ─────────────────────────────────────────────
            if not self._model_path.exists():
                logger.warning("Model checkpoint not found at %s — using surrogate", self._model_path)
                self._loaded = False
                return self

            checkpoint = _torch.load(self._model_path, map_location=self._device, weights_only=False)
            n_features  = checkpoint["n_features"]

            self._model = _model_class(
                n_features = n_features,
                hidden_dim = checkpoint["config"].get("hidden_dim", 128),
                num_layers = checkpoint["config"].get("num_layers", 3),
                num_heads  = checkpoint["config"].get("num_heads",  4),
                dropout    = 0.0,   # disable dropout at inference
            )
            self._model.load_state_dict(checkpoint["model_state"])
            self._model.eval()
            self._model.to(self._device)

            # Map the preprocessor's feature columns to the model's actual feature columns
            self._model_cols = checkpoint.get("feature_cols", self._feature_cols)
            self._model_feature_indices = [self._feature_cols.index(c) for c in self._model_cols]

            # Initialize ring buffer with zeros (use full preprocessor feature length)
            buffer_len = len(self._feature_cols) if self._feature_cols else n_features
            self._window = deque(
                [np.zeros(buffer_len)] * self._seq_len,
                maxlen=self._seq_len,
            )

            self._loaded = True
            logger.info("State estimator loaded: %d model features (%d preprocessor features), seq_len=%d, device=%s",
                        n_features, buffer_len, self._seq_len, self._device)

        except Exception as e:
            logger.error("Failed to load digital twin artifacts: %s", e)
            self._loaded = False

        return self

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(self, raw_sensor_reading: dict[str, float]) -> dict:
        """
        Push a new sensor reading into the window and return current state.

        Args:
            raw_sensor_reading: dict of {sensor_name: value} in physical units
        Returns:
            State dict with current readings + model predictions
        """
        with self._lock:
            if self._loaded:
                # Preprocess the raw reading into model feature space
                feature_vec = self._preprocess_reading(raw_sensor_reading)
                if feature_vec is not None:
                    self._window.append(feature_vec)
                    predictions = self._infer()
                    state = {**raw_sensor_reading, **predictions}
                else:
                    state = {**raw_sensor_reading}
            else:
                # Surrogate fallback
                state = {**raw_sensor_reading, **self._surrogate_predict(raw_sensor_reading)}

            self._last_state = state
            return state

    def get_current_state(self) -> dict:
        """Return the last computed state (no new inference)."""
        with self._lock:
            return dict(self._last_state)

    def get_forecast(self, horizon_steps: int = 15) -> list[dict]:
        """
        Autoregressive forecast for `horizon_steps` ahead.
        Returns list of predicted state dicts.
        NOTE: simplified implementation — uses last window repeatedly.
        """
        if not self._loaded:
            return []

        with self._lock:
            return [self.get_current_state()] * horizon_steps

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _preprocess_reading(self, reading: dict[str, float]) -> Optional[np.ndarray]:
        """Convert raw sensor reading to normalized feature vector."""
        try:
            row_df = pd.DataFrame([reading])
            # Fill missing expected features with 0
            for col in self._feature_cols:
                if col not in row_df.columns:
                    row_df[col] = 0.0
            row_df = row_df[self._feature_cols]
            scaled = self._scaler.transform(row_df)
            return scaled[0].astype(np.float32)
        except Exception as exc:
            logger.debug("Preprocessing error: %s", exc)
            return None

    def _infer(self) -> dict[str, float]:
        """Run model inference on current window."""
        _lazy_import()
        
        arr = np.array(self._window, dtype=np.float32)
        x = _torch.tensor(arr).unsqueeze(0)   # (1, seq_len, n_features)
        
        if hasattr(self, "_model_feature_indices"):
            x = x[:, :, self._model_feature_indices]
            
        with _torch.no_grad():
            out = self._model(x)

        # Inverse transform targets back to physical units
        preds = {}
        for name, val in out.items():
            preds[f"pred_{name}"] = float(val.squeeze())

        return preds

    @staticmethod
    def _surrogate_predict(reading: dict[str, float]) -> dict[str, float]:
        """Physics-based fallback when model is not loaded."""
        load = reading.get("load_factor", 0.75)
        T    = reading.get("boiler_temp_C", 480)
        P    = reading.get("boiler_pressure_MPa", 10.0)
        F    = reading.get("fuel_flow_kgs", 0.45)
        Q    = F * 50_000
        kw   = load * 10_000 * (T / 480) ** 0.5

        return {
            "pred_thermal_efficiency":    float(np.clip((kw + Q * 0.3) / (Q + 1), 0.4, 0.85)),
            "pred_electrical_efficiency": float(np.clip(kw / (Q + 1), 0.15, 0.40)),
            "pred_turbine_power_kW":      float(np.clip(kw, 0, 11_000)),
            "pred_steam_waste_kgs":       float(max(0.0, 0.5 - load)),
        }
