"""
CogeTwin — Data Preprocessor
==============================
Transforms raw simulator CSV into ML-ready features.

Pipeline:
  1. Load & validate raw sensor data
  2. Impute missing values (forward-fill + interpolation)
  3. Clip physical outliers using domain bounds
  4. Engineer time-domain features (rolling stats, lag features)
  5. Derive physics-based features (enthalpy difference, COP, ΔT)
  6. Encode temporal cyclical features (hour, day-of-week)
  7. Normalize all numeric features (StandardScaler — fit on train only)
  8. Split train / val / test (70 / 15 / 15) — NO data leakage
  9. Save processed splits + scaler artifact
"""

from __future__ import annotations

import logging
import pickle
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Physical domain bounds — values outside these are sensor errors
# ---------------------------------------------------------------------------
PHYSICAL_BOUNDS: dict[str, tuple[float, float]] = {
    "boiler_temp_C":           (300, 560),
    "boiler_pressure_MPa":     (4.0, 13.0),
    "steam_flow_kgs":          (0.0, 14.0),
    "fuel_flow_kgs":           (0.02, 0.85),
    "turbine_power_kW":        (0.0, 11_500),
    "process_steam_flow_kgs":  (0.0, 8.0),
    "condenser_duty_kW":       (0.0, 15_000),
    "thermal_efficiency":      (0.20, 0.92),
    "electrical_efficiency":   (0.08, 0.50),
    "steam_waste_kgs":         (0.0, 6.0),
    "boiler_efficiency":       (0.55, 0.95),
    "exhaust_temp_C":          (120, 350),
    "vibration_turbine_mm_s":  (0.1, 15.0),
    "lube_oil_temp_C":         (30, 105),
    "condenser_pressure_MPa":  (0.004, 0.030),
    "ambient_temp_C":          (10, 50),
    "load_factor":             (0.0, 1.0),
}

# Sensors used as model features (excludes labels and metadata)
FEATURE_COLUMNS = [
    "boiler_temp_C", "boiler_pressure_MPa", "steam_flow_kgs",
    "fuel_flow_kgs", "turbine_power_kW", "process_steam_flow_kgs",
    "condenser_duty_kW", "boiler_efficiency", "exhaust_temp_C",
    "vibration_turbine_mm_s", "lube_oil_temp_C", "condenser_pressure_MPa",
    "ambient_temp_C", "load_factor",
    # Derived KPIs from simulator
    "heat_rate_BTU_kWh", "steam_fuel_ratio", "power_to_heat_ratio",
]

# Prediction targets
TARGET_COLUMNS = [
    "thermal_efficiency",
    "electrical_efficiency",
    "turbine_power_kW",
    "steam_waste_kgs",
]

WINDOW_SIZES = [5, 15, 60]   # Rolling window sizes in minutes


class PlantDataPreprocessor:
    """
    Stateful preprocessor — fit on training data, transform all splits.
    Serializable via pickle for inference-time use in the API.
    """

    def __init__(self, sequence_length: int = 60) -> None:
        """
        Args:
            sequence_length: Number of past timesteps fed to the LSTM model.
                             Default 60 = last 1 hour of 1-min data.
        """
        self.sequence_length = sequence_length
        self.scaler          = StandardScaler()
        self._is_fitted      = False
        self.feature_columns: list[str] = []
        self.target_columns: list[str]  = TARGET_COLUMNS

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def fit_transform(
        self,
        raw_csv: str | Path,
        output_dir: str | Path,
        splits: tuple[float, float, float] = (0.70, 0.15, 0.15),
    ) -> dict[str, pd.DataFrame]:
        """
        Full pipeline: load → clean → engineer → scale → split → save.

        Returns:
            dict with keys "train", "val", "test" → DataFrames
        """
        assert abs(sum(splits) - 1.0) < 1e-6, "Splits must sum to 1.0"

        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        logger.info("Loading raw data from %s", raw_csv)
        df = self._load_and_validate(raw_csv)

        logger.info("Cleaning & clipping outliers …")
        df = self._clean(df)

        logger.info("Engineering features …")
        df = self._engineer_features(df)

        # Chronological split BEFORE fitting scaler (no leakage)
        n = len(df)
        i_train = int(n * splits[0])
        i_val   = int(n * (splits[0] + splits[1]))

        df_train = df.iloc[:i_train].copy()
        df_val   = df.iloc[i_train:i_val].copy()
        df_test  = df.iloc[i_val:].copy()

        logger.info("Split sizes — train: %d | val: %d | test: %d",
                    len(df_train), len(df_val), len(df_test))

        # Fit scaler on TRAINING data only
        self.feature_columns = [c for c in df.columns
                                 if c not in ["timestamp", "fault_active", "anomaly_flag",
                                              "day", "hour", "minute", "cum_steam_waste_kg"]]
        self.scaler.fit(df_train[self.feature_columns])
        self._is_fitted = True

        # Transform all splits
        result: dict[str, pd.DataFrame] = {}
        for name, split_df in [("train", df_train), ("val", df_val), ("test", df_test)]:
            scaled = split_df.copy()
            scaled[self.feature_columns] = self.scaler.transform(split_df[self.feature_columns])
            result[name] = scaled
            out_path = output_dir / f"{name}.parquet"
            scaled.to_parquet(out_path, index=False)
            logger.info("Saved %s → %s (%d rows)", name, out_path, len(scaled))

        # Save scaler and metadata
        self._save_artifacts(output_dir)

        return result

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        """Transform new data using the fitted scaler (inference-time)."""
        assert self._is_fitted, "Call fit_transform first."
        df = self._clean(df)
        df = self._engineer_features(df)
        df[self.feature_columns] = self.scaler.transform(df[self.feature_columns])
        return df

    def inverse_transform_targets(self, arr: np.ndarray) -> np.ndarray:
        """Inverse-scale model output predictions back to physical units."""
        assert self._is_fitted
        # Build a zero-array of full feature width and slot in target columns
        dummy = np.zeros((arr.shape[0], len(self.feature_columns)))
        for i, col in enumerate(self.target_columns):
            if col in self.feature_columns:
                idx = self.feature_columns.index(col)
                dummy[:, idx] = arr[:, i]
        inv = self.scaler.inverse_transform(dummy)
        target_indices = [self.feature_columns.index(c) for c in self.target_columns
                          if c in self.feature_columns]
        return inv[:, target_indices]

    # ------------------------------------------------------------------
    # Step 1 — Load & Validate
    # ------------------------------------------------------------------

    def _load_and_validate(self, path: str | Path) -> pd.DataFrame:
        df = pd.read_csv(path, parse_dates=["timestamp"])
        df.sort_values("timestamp", inplace=True)
        df.reset_index(drop=True, inplace=True)

        missing_pct = df.isnull().mean() * 100
        bad_cols = missing_pct[missing_pct > 5].index.tolist()
        if bad_cols:
            logger.warning("Columns with >5%% missing: %s", bad_cols)

        logger.info("Loaded %d rows, %d columns. Date range: %s → %s",
                    len(df), len(df.columns), df["timestamp"].min(), df["timestamp"].max())
        return df

    # ------------------------------------------------------------------
    # Step 2 — Clean
    # ------------------------------------------------------------------

    def _clean(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()

        # 1. Forward-fill short gaps (≤ 5 steps = 5 minutes)
        df = df.ffill(limit=5)

        # 2. Interpolate remaining NaNs
        # method="time" requires DatetimeIndex — set temporarily then restore
        numeric_cols = df.select_dtypes(include=np.number).columns
        if "timestamp" in df.columns:
            df = df.set_index("timestamp")
            df[numeric_cols] = df[numeric_cols].interpolate(method="time", limit=10)
            df = df.reset_index()
        else:
            df[numeric_cols] = df[numeric_cols].interpolate(method="linear", limit=10)

        # 3. Clip to physical bounds
        for col, (lo, hi) in PHYSICAL_BOUNDS.items():
            if col in df.columns:
                df[col] = df[col].clip(lower=lo, upper=hi)

        # 4. Drop any remaining NaN rows
        before = len(df)
        df.dropna(subset=FEATURE_COLUMNS, inplace=True)
        dropped = before - len(df)
        if dropped:
            logger.warning("Dropped %d rows with unresolvable NaNs", dropped)

        return df

    # ------------------------------------------------------------------
    # Step 3 — Feature Engineering
    # ------------------------------------------------------------------

    def _engineer_features(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()

        # ── Rolling statistics ────────────────────────────────────────
        for col in ["boiler_temp_C", "turbine_power_kW", "thermal_efficiency",
                    "steam_waste_kgs", "vibration_turbine_mm_s"]:
            if col not in df.columns:
                continue
            for w in WINDOW_SIZES:
                df[f"{col}_roll{w}_mean"] = df[col].rolling(w, min_periods=1).mean()
                df[f"{col}_roll{w}_std"]  = df[col].rolling(w, min_periods=1).std().fillna(0)

        # ── Lag features ──────────────────────────────────────────────
        for col in ["boiler_temp_C", "turbine_power_kW", "steam_waste_kgs"]:
            if col not in df.columns:
                continue
            for lag in [1, 5, 15, 60]:
                df[f"{col}_lag{lag}"] = df[col].shift(lag).bfill()

        # ── Physics-derived features ──────────────────────────────────
        # Boiler temperature excess above saturation (superheat degree)
        from src.data_pipeline.simulator import SteamTables
        steam = SteamTables()

        if "boiler_pressure_MPa" in df.columns and "boiler_temp_C" in df.columns:
            df["superheat_degree_C"] = (
                df["boiler_temp_C"]
                - df["boiler_pressure_MPa"].apply(steam.saturation_temperature)
            ).clip(lower=0)

        # Turbine power deviation from expected at current load
        if "turbine_power_kW" in df.columns and "load_factor" in df.columns:
            expected_power = df["load_factor"] * 10_000  # 10 MW rated
            df["power_deviation_kW"] = df["turbine_power_kW"] - expected_power

        # Specific fuel consumption [kg fuel / kWh electrical]
        if "fuel_flow_kgs" in df.columns and "turbine_power_kW" in df.columns:
            df["specific_fuel_consumption"] = (df["fuel_flow_kgs"] * 3600) / \
                (df["turbine_power_kW"].replace(0, np.nan)).ffill()

        # Temperature difference: boiler exhaust vs ambient (fouling proxy)
        if "exhaust_temp_C" in df.columns and "ambient_temp_C" in df.columns:
            df["exhaust_ambient_delta"] = df["exhaust_temp_C"] - df["ambient_temp_C"]

        # ── Cyclical temporal encoding ────────────────────────────────
        if "hour" in df.columns:
            df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
            df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)

        if "day" in df.columns:
            df["day_sin"] = np.sin(2 * np.pi * df["day"] / 365)
            df["day_cos"] = np.cos(2 * np.pi * df["day"] / 365)

        # ── Rate-of-change (first derivative) ────────────────────────
        for col in ["boiler_pressure_MPa", "turbine_power_kW", "steam_waste_kgs"]:
            if col in df.columns:
                df[f"{col}_roc"] = df[col].diff().fillna(0)

        # Update feature column list
        self.feature_columns = [
            c for c in df.columns
            if c not in ["timestamp", "fault_active", "anomaly_flag",
                         "day", "hour", "minute", "cum_steam_waste_kg"]
            and df[c].dtype != object
        ]

        return df

    # ------------------------------------------------------------------
    # Artifacts
    # ------------------------------------------------------------------

    def _save_artifacts(self, output_dir: Path) -> None:
        """Persist scaler and metadata for inference-time use."""
        scaler_path = output_dir / "scaler.pkl"
        with open(scaler_path, "wb") as f:
            pickle.dump(self.scaler, f)

        meta_path = output_dir / "preprocessor_meta.pkl"
        meta = {
            "feature_columns": self.feature_columns,
            "target_columns":  self.target_columns,
            "sequence_length": self.sequence_length,
        }
        with open(meta_path, "wb") as f:
            pickle.dump(meta, f)

        logger.info("Saved scaler → %s", scaler_path)
        logger.info("Saved preprocessor meta → %s", meta_path)

    @classmethod
    def load(cls, artifact_dir: str | Path) -> "PlantDataPreprocessor":
        """Reconstruct a fitted preprocessor from saved artifacts."""
        artifact_dir = Path(artifact_dir)
        with open(artifact_dir / "scaler.pkl", "rb") as f:
            scaler = pickle.load(f)
        with open(artifact_dir / "preprocessor_meta.pkl", "rb") as f:
            meta = pickle.load(f)
        pp = cls(sequence_length=meta["sequence_length"])
        pp.scaler          = scaler
        pp.feature_columns = meta["feature_columns"]
        pp.target_columns  = meta["target_columns"]
        pp._is_fitted      = True
        logger.info("Loaded preprocessor from %s (%d features)", artifact_dir, len(pp.feature_columns))
        return pp


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse
    logging.basicConfig(level=logging.INFO)

    parser = argparse.ArgumentParser(description="CogeTwin Data Preprocessor")
    parser.add_argument("--input",  default="data/raw/plant_sensors.csv")
    parser.add_argument("--output", default="data/processed")
    parser.add_argument("--seq-len", type=int, default=60)
    args = parser.parse_args()

    pp = PlantDataPreprocessor(sequence_length=args.seq_len)
    splits = pp.fit_transform(
        raw_csv=args.input,
        output_dir=args.output,
    )
    for name, df in splits.items():
        print(f"\n{name.upper()} split: {df.shape} | Anomaly rows: {df['anomaly_flag'].sum()}")
    print("\nFeature columns engineered:", len(pp.feature_columns))


if __name__ == "__main__":
    main()
