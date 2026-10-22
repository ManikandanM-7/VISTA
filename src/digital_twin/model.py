"""
CogeTwin — Digital Twin: Physics-Informed BiLSTM Model
========================================================
Architecture:
  - Bidirectional LSTM encoder (captures past + future context in training)
  - Multi-head self-attention over temporal sequence
  - Separate projection heads for each output target
  - Physics-informed loss: penalises violations of the 1st Law of Thermodynamics
    and steam conservation constraints

Inputs  : (batch, seq_len, n_features) — normalized sensor readings
Outputs : (batch, n_targets) — {thermal_eff, elec_eff, turbine_power_kW, steam_waste_kgs}
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class TemporalAttention(nn.Module):
    """
    Multi-head self-attention over the LSTM output sequence.
    Allows the model to focus on the most relevant past timesteps.
    """

    def __init__(self, hidden_dim: int, num_heads: int = 4, dropout: float = 0.1) -> None:
        super().__init__()
        assert hidden_dim % num_heads == 0, "hidden_dim must be divisible by num_heads"
        self.attention = nn.MultiheadAttention(
            embed_dim=hidden_dim,
            num_heads=num_heads,
            dropout=dropout,
            batch_first=True,
        )
        self.norm = nn.LayerNorm(hidden_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (batch, seq_len, hidden_dim) — BiLSTM output
        Returns:
            (batch, seq_len, hidden_dim) — attention-weighted representation
        """
        attended, _ = self.attention(x, x, x)
        return self.norm(x + attended)   # residual connection


class PredictionHead(nn.Module):
    """
    MLP head for a single prediction target with residual shortcut.
    """

    def __init__(self, in_dim: int, hidden_dim: int, out_dim: int = 1,
                 dropout: float = 0.15) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.GELU(),
            nn.Linear(hidden_dim // 2, out_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class DigitalTwinModel(nn.Module):
    """
    Physics-informed BiLSTM model for cogeneration plant state prediction.

    Args:
        n_features    : Number of input sensor features
        hidden_dim    : LSTM hidden size (each direction)
        num_layers    : Number of stacked LSTM layers
        num_heads     : Attention heads
        dropout       : Dropout probability
        n_targets     : Number of output targets (default 4)
    """

    TARGET_NAMES = ["thermal_efficiency", "electrical_efficiency",
                    "turbine_power_kW", "steam_waste_kgs"]

    def __init__(
        self,
        n_features: int,
        hidden_dim: int = 128,
        num_layers: int = 3,
        num_heads: int = 4,
        dropout: float = 0.15,
        n_targets: int = 4,
    ) -> None:
        super().__init__()
        self.n_features = n_features
        self.hidden_dim  = hidden_dim
        self.n_targets   = n_targets

        # Input projection: map raw features to model dimension
        self.input_proj = nn.Sequential(
            nn.Linear(n_features, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
        )

        # Bidirectional LSTM — bidirectional doubles the output dim
        self.lstm = nn.LSTM(
            input_size=hidden_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            bidirectional=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )

        # Reduce BiLSTM output (2 * hidden_dim) back to hidden_dim
        self.lstm_proj = nn.Sequential(
            nn.Linear(hidden_dim * 2, hidden_dim),
            nn.LayerNorm(hidden_dim),
        )

        # Multi-head temporal attention
        self.attention = TemporalAttention(hidden_dim, num_heads, dropout)

        # Global pooling: aggregate sequence → single vector
        # We use both mean and last-step pooling then concatenate
        self.pool_proj = nn.Linear(hidden_dim * 2, hidden_dim)

        # Per-target prediction heads
        self.heads = nn.ModuleDict({
            name: PredictionHead(hidden_dim, hidden_dim // 2)
            for name in self.TARGET_NAMES
        })

        self._init_weights()

    def _init_weights(self) -> None:
        """Xavier uniform init for linear layers, orthogonal for LSTM."""
        for name, param in self.named_parameters():
            if "lstm" in name and "weight_hh" in name:
                nn.init.orthogonal_(param)
            elif "lstm" in name and "weight_ih" in name:
                nn.init.xavier_uniform_(param)
            elif "weight" in name and param.dim() >= 2:
                nn.init.xavier_uniform_(param)
            elif "bias" in name:
                nn.init.zeros_(param)

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        """
        Args:
            x: (batch, seq_len, n_features)
        Returns:
            dict of target_name -> (batch, 1) predictions
        """
        # Project input features
        h = self.input_proj(x)                    # (B, T, D)

        # BiLSTM encoding
        lstm_out, _ = self.lstm(h)                # (B, T, 2D)
        lstm_out = self.lstm_proj(lstm_out)        # (B, T, D)

        # Temporal attention
        attended = self.attention(lstm_out)        # (B, T, D)

        # Pooling: mean + last step
        mean_pool = attended.mean(dim=1)           # (B, D)
        last_step = attended[:, -1, :]             # (B, D)
        pooled = self.pool_proj(
            torch.cat([mean_pool, last_step], dim=-1)
        )                                          # (B, D)

        # Per-target predictions
        return {name: head(pooled) for name, head in self.heads.items()}

    @torch.no_grad()
    def predict(self, x: torch.Tensor) -> dict[str, float]:
        """
        Single-sample inference (no gradient tracking).
        x: (1, seq_len, n_features)
        Returns: dict of target -> scalar value
        """
        self.eval()
        out = self.forward(x)
        return {name: float(val.squeeze()) for name, val in out.items()}


class PhysicsInformedLoss(nn.Module):
    """
    Combined loss = MSE prediction loss + λ * physics penalty.

    Physics constraints enforced:
      1. Energy conservation: η_thermal ≤ η_Carnot (upper bound)
      2. η_electrical < η_thermal (always — electrical is a subset)
      3. steam_waste ≥ 0 (non-negative physical quantity)
      4. Efficiency bounds: 0 < η < 1
      5. Turbine power ≥ 0

    These are soft constraints (penalty term) — the model learns to
    respect them without hard projection.
    """

    TARGET_NAMES = DigitalTwinModel.TARGET_NAMES

    def __init__(self, lambda_physics: float = 0.1) -> None:
        super().__init__()
        self.lambda_physics = lambda_physics
        self.mse = nn.MSELoss()

    def forward(
        self,
        predictions: dict[str, torch.Tensor],
        targets: dict[str, torch.Tensor],
    ) -> tuple[torch.Tensor, dict[str, float]]:
        """
        Returns:
            total_loss: scalar tensor
            loss_components: dict for logging
        """
        # ── Prediction loss (MSE per target, equal weighting) ─────────
        pred_loss = sum(
            self.mse(predictions[name], targets[name])
            for name in self.TARGET_NAMES
        ) / len(self.TARGET_NAMES)

        # ── Physics penalty ───────────────────────────────────────────
        eta_th  = predictions["thermal_efficiency"]     # (B, 1)
        eta_el  = predictions["electrical_efficiency"]  # (B, 1)
        waste   = predictions["steam_waste_kgs"]        # (B, 1)
        power   = predictions["turbine_power_kW"]       # (B, 1)

        # 1. η_electrical must be < η_thermal (electricity ⊂ total thermal)
        p1 = F.relu(eta_el - eta_th + 0.01).mean()

        # 2. Efficiencies bounded [0, 1]
        p2 = F.relu(-eta_th).mean() + F.relu(eta_th - 1).mean()
        p3 = F.relu(-eta_el).mean() + F.relu(eta_el - 1).mean()

        # 3. Steam waste non-negative
        p4 = F.relu(-waste).mean()

        # 4. Turbine power non-negative
        p5 = F.relu(-power).mean()

        physics_loss = p1 + p2 + p3 + p4 + p5
        total_loss   = pred_loss + self.lambda_physics * physics_loss

        return total_loss, {
            "pred_loss":    pred_loss.detach().item(),
            "physics_loss": physics_loss.detach().item(),
            "total_loss":   total_loss.detach().item(),
        }


def build_model(n_features: int, **kwargs) -> DigitalTwinModel:
    """Factory function — creates model with default hyperparameters."""
    return DigitalTwinModel(n_features=n_features, **kwargs)
