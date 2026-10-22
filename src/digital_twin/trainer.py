"""
CogeTwin — Digital Twin Trainer
=================================
Full training loop for the BiLSTM physics-informed model.
Features:
  - PyTorch DataLoader with sequence windowing
  - MLflow experiment tracking (params, metrics, artifacts)
  - Cosine annealing LR scheduler
  - Early stopping on validation loss
  - Model checkpoint saving (best + latest)
  - Gradient clipping for LSTM stability
"""

from __future__ import annotations

import logging
import pickle
from pathlib import Path

import mlflow
import mlflow.pytorch
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR
from torch.utils.data import DataLoader, Dataset

from src.config import get_settings
from src.digital_twin.model import DigitalTwinModel, PhysicsInformedLoss, build_model

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

class PlantSequenceDataset(Dataset):
    """
    Sliding-window dataset over the processed plant time-series.
    Each sample: X=(seq_len, n_features), y=(n_targets,)
    """

    TARGET_COLS = ["thermal_efficiency", "electrical_efficiency",
                   "turbine_power_kW", "steam_waste_kgs"]

    def __init__(
        self,
        df: pd.DataFrame,
        feature_cols: list[str],
        seq_len: int = 60,
        stride: int = 1,
    ) -> None:
        self.seq_len  = seq_len
        self.stride   = stride

        # Filter to numeric feature columns present in df
        self.feature_cols = [c for c in feature_cols if c in df.columns
                             and c not in self.TARGET_COLS
                             and df[c].dtype in [np.float64, np.float32, float]]
        self.target_cols  = [c for c in self.TARGET_COLS if c in df.columns]

        self.X = torch.tensor(
            df[self.feature_cols].values, dtype=torch.float32
        )
        self.y = torch.tensor(
            df[self.target_cols].values, dtype=torch.float32
        )

        # Valid start indices (exclude last seq_len rows)
        self.indices = list(range(0, len(df) - seq_len, stride))

    def __len__(self) -> int:
        return len(self.indices)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        start = self.indices[idx]
        x = self.X[start : start + self.seq_len]          # (seq_len, n_features)
        y = self.y[start + self.seq_len]                   # (n_targets,) — next step
        return x, y


# ---------------------------------------------------------------------------
# Training Configuration
# ---------------------------------------------------------------------------

class TrainConfig:
    hidden_dim:      int   = 128
    num_layers:      int   = 3
    num_heads:       int   = 4
    dropout:         float = 0.15
    seq_len:         int   = 60
    stride:          int   = 5      # slide window every 5 steps (speeds up training)
    batch_size:      int   = 256
    epochs:          int   = 50
    lr:              float = 3e-4
    weight_decay:    float = 1e-4
    lambda_physics:  float = 0.1
    grad_clip:       float = 1.0    # gradient clipping norm
    patience:        int   = 8      # early stopping patience
    min_delta:       float = 1e-5
    num_workers:     int   = 0      # 0 = main process (safe on Windows)
    device:          str   = "cuda" if torch.cuda.is_available() else "cpu"


# ---------------------------------------------------------------------------
# Trainer
# ---------------------------------------------------------------------------

class DigitalTwinTrainer:
    """Orchestrates training, validation, MLflow tracking, and checkpointing."""

    def __init__(self, cfg: TrainConfig | None = None) -> None:
        self.cfg      = cfg or TrainConfig()
        self.settings = get_settings()
        self.device   = torch.device(self.cfg.device)
        logger.info("Training on device: %s", self.device)

    def train(
        self,
        processed_dir: str | Path = "data/processed",
        model_dir: str | Path = "models",
    ) -> DigitalTwinModel:
        """
        Full training pipeline. Returns the best validated model.
        """
        processed_dir = Path(processed_dir)
        model_dir     = Path(model_dir)
        model_dir.mkdir(parents=True, exist_ok=True)

        # ── Load preprocessed splits ──────────────────────────────────
        logger.info("Loading processed data from %s …", processed_dir)
        df_train = pd.read_parquet(processed_dir / "train.parquet")
        df_val   = pd.read_parquet(processed_dir / "val.parquet")

        # Load feature columns from preprocessor metadata
        with open(processed_dir / "preprocessor_meta.pkl", "rb") as f:
            meta = pickle.load(f)
        feature_cols = meta["feature_cols"] if "feature_cols" in meta else meta.get("feature_columns", [])

        logger.info("Train size: %d | Val size: %d | Features: %d",
                    len(df_train), len(df_val), len(feature_cols))

        # ── Build datasets & loaders ──────────────────────────────────
        train_ds = PlantSequenceDataset(df_train, feature_cols, self.cfg.seq_len, self.cfg.stride)
        val_ds   = PlantSequenceDataset(df_val,   feature_cols, self.cfg.seq_len, stride=1)

        train_loader = DataLoader(train_ds, batch_size=self.cfg.batch_size,
                                  shuffle=True,  num_workers=self.cfg.num_workers)
        val_loader   = DataLoader(val_ds,   batch_size=self.cfg.batch_size,
                                  shuffle=False, num_workers=self.cfg.num_workers)

        n_features = len(train_ds.feature_cols)

        # ── Model, loss, optimizer, scheduler ────────────────────────
        model = build_model(
            n_features   = n_features,
            hidden_dim   = self.cfg.hidden_dim,
            num_layers   = self.cfg.num_layers,
            num_heads    = self.cfg.num_heads,
            dropout      = self.cfg.dropout,
        ).to(self.device)

        criterion = PhysicsInformedLoss(lambda_physics=self.cfg.lambda_physics)
        optimizer = AdamW(model.parameters(), lr=self.cfg.lr,
                          weight_decay=self.cfg.weight_decay)
        scheduler = CosineAnnealingLR(optimizer, T_max=self.cfg.epochs, eta_min=1e-6)

        logger.info("Model parameters: %s",
                    f"{sum(p.numel() for p in model.parameters() if p.requires_grad):,}")

        # ── MLflow experiment ─────────────────────────────────────────
        mlflow.set_tracking_uri(f"sqlite:///mlruns/mlflow.db")
        mlflow.set_experiment(self.settings.mlflow_experiment_name)

        with mlflow.start_run(run_name="bilstm_physics_informed") as run:
            mlflow.log_params({
                "n_features":     n_features,
                "hidden_dim":     self.cfg.hidden_dim,
                "num_layers":     self.cfg.num_layers,
                "num_heads":      self.cfg.num_heads,
                "dropout":        self.cfg.dropout,
                "seq_len":        self.cfg.seq_len,
                "batch_size":     self.cfg.batch_size,
                "epochs":         self.cfg.epochs,
                "lr":             self.cfg.lr,
                "lambda_physics": self.cfg.lambda_physics,
                "device":         self.cfg.device,
            })

            best_val_loss = float("inf")
            patience_count = 0
            best_model_state = None

            # ── Training Loop ─────────────────────────────────────────
            for epoch in range(1, self.cfg.epochs + 1):
                train_metrics = self._run_epoch(
                    model, train_loader, criterion, optimizer, training=True
                )
                val_metrics = self._run_epoch(
                    model, val_loader, criterion, optimizer=None, training=False
                )
                scheduler.step()

                mlflow.log_metrics(
                    {f"train/{k}": v for k, v in train_metrics.items()} |
                    {f"val/{k}":   v for k, v in val_metrics.items()},
                    step=epoch,
                )
                mlflow.log_metric("lr", scheduler.get_last_lr()[0], step=epoch)

                val_loss = val_metrics["total_loss"]
                logger.info(
                    "Epoch %3d/%d | train_loss=%.5f | val_loss=%.5f | lr=%.2e",
                    epoch, self.cfg.epochs,
                    train_metrics["total_loss"], val_loss,
                    scheduler.get_last_lr()[0],
                )

                # Early stopping
                if val_loss < best_val_loss - self.cfg.min_delta:
                    best_val_loss  = val_loss
                    patience_count = 0
                    best_model_state = {k: v.cpu().clone()
                                        for k, v in model.state_dict().items()}
                    # Save best checkpoint
                    ckpt_path = model_dir / "best_model.pt"
                    torch.save({
                        "epoch":        epoch,
                        "model_state":  best_model_state,
                        "val_loss":     best_val_loss,
                        "n_features":   n_features,
                        "feature_cols": train_ds.feature_cols,
                        "target_cols":  train_ds.target_cols,
                        "config":       vars(self.cfg),
                    }, ckpt_path)
                    logger.info("  -> New best! Saved checkpoint (val_loss=%.5f)", best_val_loss)
                else:
                    patience_count += 1
                    if patience_count >= self.cfg.patience:
                        logger.info("Early stopping triggered at epoch %d", epoch)
                        break

            # ── Final logging ─────────────────────────────────────────
            if best_model_state:
                model.load_state_dict(best_model_state)
            mlflow.log_metric("best_val_loss", best_val_loss)
            # Use cloudpickle serialization — no input_example trace required
            mlflow.pytorch.log_model(
                model, "model",
                serialization_format=mlflow.pytorch.SERIALIZATION_FORMAT_CLOUDPICKLE,
            )
            mlflow.log_artifact(str(processed_dir / "scaler.pkl"), "preprocessor")
            logger.info("Training complete. Best val_loss=%.5f", best_val_loss)

        return model

    # ------------------------------------------------------------------
    # Epoch Runner
    # ------------------------------------------------------------------

    def _run_epoch(
        self,
        model: DigitalTwinModel,
        loader: DataLoader,
        criterion: PhysicsInformedLoss,
        optimizer: AdamW | None,
        training: bool,
    ) -> dict[str, float]:
        model.train() if training else model.eval()
        target_names = model.TARGET_NAMES
        accum = {"total_loss": 0.0, "pred_loss": 0.0, "physics_loss": 0.0}
        n_batches = 0

        ctx = torch.enable_grad() if training else torch.no_grad()
        with ctx:
            for X_batch, y_batch in loader:
                X_batch = X_batch.to(self.device)       # (B, T, F)
                y_batch = y_batch.to(self.device)       # (B, n_targets)

                preds = model(X_batch)                  # dict of target -> (B,1)
                targets = {
                    name: y_batch[:, i].unsqueeze(-1)
                    for i, name in enumerate(target_names)
                }

                loss, components = criterion(preds, targets)

                if training:
                    optimizer.zero_grad()
                    loss.backward()
                    nn.utils.clip_grad_norm_(model.parameters(), self.cfg.grad_clip)
                    optimizer.step()

                for k, v in components.items():
                    accum[k] += v
                n_batches += 1

        return {k: v / max(n_batches, 1) for k, v in accum.items()}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Train the CogeTwin Digital Twin model")
    parser.add_argument("--processed-dir", default="data/processed")
    parser.add_argument("--model-dir",     default="models")
    parser.add_argument("--epochs",        type=int, default=50)
    parser.add_argument("--batch-size",    type=int, default=256)
    parser.add_argument("--hidden-dim",    type=int, default=128)
    args = parser.parse_args()

    cfg = TrainConfig()
    cfg.epochs     = args.epochs
    cfg.batch_size = args.batch_size
    cfg.hidden_dim = args.hidden_dim

    trainer = DigitalTwinTrainer(cfg)
    trainer.train(processed_dir=args.processed_dir, model_dir=args.model_dir)


if __name__ == "__main__":
    main()
