"""
CogeTwin — LSTM Autoencoder Anomaly Detector
=============================================
Architecture:
  - Encoder LSTM compresses the sensor sequence into a latent vector
  - Decoder LSTM reconstructs the original sequence
  - Anomaly score = mean reconstruction error (MSE per timestep)
  - Threshold set at 95th percentile of training error distribution
  - Outputs: anomaly_flag, anomaly_score, anomaly_type (estimated)
"""

from __future__ import annotations

import json
import logging
import pickle
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

_torch = None
_nn    = None

def _lazy_torch():
    global _torch, _nn
    if _torch is None:
        import torch
        import torch.nn as nn
        _torch = torch
        _nn    = nn


# ---------------------------------------------------------------------------
# Model Architecture
# ---------------------------------------------------------------------------

def _build_autoencoder(n_features: int, hidden_dim: int = 64, latent_dim: int = 32):
    """Build LSTM autoencoder. Called inside functions to defer torch import."""
    _lazy_torch()

    class LSTMEncoder(_torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = _torch.nn.LSTM(n_features, hidden_dim, num_layers=2,
                                        batch_first=True, dropout=0.1)
            self.proj = _torch.nn.Linear(hidden_dim, latent_dim)

        def forward(self, x):
            _, (h, _) = self.lstm(x)
            return self.proj(h[-1])   # (B, latent_dim)

    class LSTMDecoder(_torch.nn.Module):
        def __init__(self, seq_len: int):
            super().__init__()
            self.seq_len = seq_len
            self.proj    = _torch.nn.Linear(latent_dim, hidden_dim)
            self.lstm    = _torch.nn.LSTM(hidden_dim, hidden_dim, num_layers=2,
                                           batch_first=True, dropout=0.1)
            self.out     = _torch.nn.Linear(hidden_dim, n_features)

        def forward(self, z):
            h = self.proj(z).unsqueeze(1).repeat(1, self.seq_len, 1)
            out, _ = self.lstm(h)
            return self.out(out)   # (B, seq_len, n_features)

    class LSTMAutoencoder(_torch.nn.Module):
        def __init__(self, seq_len: int):
            super().__init__()
            self.encoder = LSTMEncoder()
            self.decoder = LSTMDecoder(seq_len)

        def forward(self, x):
            z = self.encoder(x)
            return self.decoder(z)

    return LSTMAutoencoder


# ---------------------------------------------------------------------------
# Anomaly Detector
# ---------------------------------------------------------------------------

class AnomalyDetector:
    """
    Trains and runs the LSTM autoencoder anomaly detector.
    """

    ANOMALY_CATEGORIES = {
        "boiler_temp_C":           "thermal_anomaly",
        "boiler_pressure_MPa":     "pressure_anomaly",
        "vibration_turbine_mm_s":  "mechanical_anomaly",
        "lube_oil_temp_C":         "lubrication_anomaly",
        "condenser_pressure_MPa":  "condenser_anomaly",
        "steam_waste_kgs":         "steam_loss_anomaly",
        "exhaust_temp_C":          "combustion_anomaly",
    }

    def __init__(
        self,
        seq_len: int = 60,
        hidden_dim: int = 64,
        latent_dim: int = 32,
        threshold_percentile: float = 95.0,
    ) -> None:
        _lazy_torch()
        self.seq_len  = seq_len
        self.hidden_dim = hidden_dim
        self.latent_dim = latent_dim
        self.threshold_pct = threshold_percentile
        self._model    = None
        self._threshold: float = 0.0
        self._feature_cols: list[str] = []
        self._scaler   = None
        self._loaded   = False

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------

    def train(
        self,
        processed_dir: str | Path,
        model_dir: str | Path,
        epochs: int = 30,
        batch_size: int = 128,
        lr: float = 1e-3,
    ) -> None:
        """Train the autoencoder on NORMAL (fault_active=='none') training data."""
        processed_dir = Path(processed_dir)
        model_dir     = Path(model_dir)
        model_dir.mkdir(parents=True, exist_ok=True)

        df_train = pd.read_parquet(processed_dir / "train.parquet")
        with open(processed_dir / "preprocessor_meta.pkl", "rb") as f:
            meta = pickle.load(f)

        self._feature_cols = [
            c for c in meta.get("feature_columns", meta.get("feature_cols", []))
            if c in df_train.columns
        ]

        # Use only NORMAL samples for autoencoder training
        normal_mask = df_train.get("fault_active", pd.Series(["none"] * len(df_train))) == "none"
        df_normal   = df_train[normal_mask].reset_index(drop=True)
        logger.info("Autoencoder training on %d normal samples", len(df_normal))

        X = _torch.tensor(df_normal[self._feature_cols].values, dtype=_torch.float32)

        # Build sliding windows
        windows = []
        for i in range(0, len(X) - self.seq_len, 5):
            windows.append(X[i:i + self.seq_len])
        X_windows = _torch.stack(windows)   # (N, seq_len, F)

        n_features = X_windows.shape[-1]
        AutoencoderClass = _build_autoencoder(n_features, self.hidden_dim, self.latent_dim)
        self._model = AutoencoderClass(seq_len=self.seq_len)
        self._model.train()

        optimizer = _torch.optim.Adam(self._model.parameters(), lr=lr)
        criterion = _torch.nn.MSELoss()

        loader = _torch.utils.data.DataLoader(
            _torch.utils.data.TensorDataset(X_windows),
            batch_size=batch_size, shuffle=True
        )

        for epoch in range(1, epochs + 1):
            epoch_loss = 0.0
            for (batch,) in loader:
                recon = self._model(batch)
                loss  = criterion(recon, batch)
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                epoch_loss += loss.item()
            if epoch % 10 == 0:
                logger.info("AE Epoch %d/%d | loss=%.6f", epoch, epochs, epoch_loss / len(loader))

        # Compute threshold on training reconstruction errors
        self._model.eval()
        self._threshold = self._compute_threshold(X_windows)
        logger.info("Anomaly threshold (%.0f-pct): %.6f", self.threshold_pct, self._threshold)

        # Save
        self._save(model_dir)

    def _compute_threshold(self, X: "_torch.Tensor") -> float:
        errors = []
        with _torch.no_grad():
            for i in range(0, len(X), 256):
                batch = X[i:i+256]
                recon = self._model(batch)
                mse   = ((recon - batch) ** 2).mean(dim=(1, 2))
                errors.extend(mse.numpy().tolist())
        return float(np.percentile(errors, self.threshold_pct))

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def predict(self, window: np.ndarray) -> dict:
        """
        Args:
            window: (seq_len, n_features) numpy array — normalized sensor window
        Returns:
            {anomaly_flag, anomaly_score, anomaly_type, severity, sensor_contributions}
        """
        if not self._loaded and self._model is None:
            return {"anomaly_flag": 0, "anomaly_score": 0.0,
                    "anomaly_type": "unknown", "severity": "none",
                    "sensor_contributions": {}}

        _lazy_torch()
        x     = _torch.tensor(window, dtype=_torch.float32).unsqueeze(0)
        self._model.eval()
        with _torch.no_grad():
            recon = self._model(x)

        mse = float(((recon - x) ** 2).mean().item())
        per_feature_error = ((recon[0] - x[0]) ** 2).mean(dim=0).numpy()

        is_anomaly    = mse > self._threshold
        anomaly_score = float(np.clip(mse / (self._threshold + 1e-9), 0, 10))

        severity = "none"
        if is_anomaly:
            if anomaly_score > 5: severity = "critical"
            elif anomaly_score > 2: severity = "moderate"
            else: severity = "minor"

        # Find most anomalous sensor
        anomaly_type = "unknown"
        if is_anomaly and len(self._feature_cols) == len(per_feature_error):
            top_idx   = int(np.argmax(per_feature_error))
            top_col   = self._feature_cols[top_idx] if top_idx < len(self._feature_cols) else "unknown"
            anomaly_type = self.ANOMALY_CATEGORIES.get(top_col, f"{top_col}_anomaly")

        contributions = {}
        for i, col in enumerate(self._feature_cols[:len(per_feature_error)]):
            contributions[col] = round(float(per_feature_error[i]), 6)

        return {
            "anomaly_flag":          int(is_anomaly),
            "anomaly_score":         round(anomaly_score, 4),
            "reconstruction_error":  round(mse, 6),
            "threshold":             round(self._threshold, 6),
            "anomaly_type":          anomaly_type,
            "severity":              severity,
            "sensor_contributions":  dict(sorted(contributions.items(),
                                                  key=lambda x: x[1], reverse=True)[:5]),
        }

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _save(self, model_dir: Path) -> None:
        _torch.save(self._model.state_dict(), model_dir / "anomaly_detector.pt")
        with open(model_dir / "anomaly_detector_meta.json", "w") as f:
            json.dump({
                "seq_len":       self.seq_len,
                "hidden_dim":    self.hidden_dim,
                "latent_dim":    self.latent_dim,
                "threshold":     self._threshold,
                "feature_cols":  self._feature_cols,
                "n_features":    len(self._feature_cols),
            }, f, indent=2)
        logger.info("Anomaly detector saved to %s", model_dir)

    @classmethod
    def load(cls, model_dir: str | Path) -> "AnomalyDetector":
        _lazy_torch()
        model_dir = Path(model_dir)
        with open(model_dir / "anomaly_detector_meta.json") as f:
            meta = json.load(f)

        det = cls(
            seq_len   = meta["seq_len"],
            hidden_dim= meta["hidden_dim"],
            latent_dim= meta["latent_dim"],
        )
        det._feature_cols = meta["feature_cols"]
        det._threshold    = meta["threshold"]

        n_features       = meta["n_features"]
        AutoencoderClass = _build_autoencoder(n_features, meta["hidden_dim"], meta["latent_dim"])
        det._model = AutoencoderClass(seq_len=meta["seq_len"])
        det._model.load_state_dict(
            _torch.load(model_dir / "anomaly_detector.pt", map_location="cpu", weights_only=True)
        )
        det._model.eval()
        det._loaded = True
        logger.info("Anomaly detector loaded from %s (threshold=%.6f)", model_dir, det._threshold)
        return det
