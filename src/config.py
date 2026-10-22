"""
CogeTwin — Central Configuration
=================================
Single source of truth for all app settings.
Reads from environment variables (with .env support).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Project root — two levels up from this file (src/config.py → project root)
PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── LLM ──────────────────────────────────────────────────────────
    gemini_api_key: str            = Field(default="", alias="GEMINI_API_KEY")
    gemini_background_api_key: str = Field(default="", alias="GEMINI_BACKGROUND_API_KEY")
    gemini_model: str              = Field(default="gemini-1.5-flash")
    ollama_base_url: str           = Field(default="http://localhost:11434")
    ollama_model: str              = Field(default="llama3.2:7b")
    llm_ping_host: str             = Field(default="8.8.8.8")
    llm_ping_timeout: int          = Field(default=2)

    # ── Databases ─────────────────────────────────────────────────────
    influxdb_url: str              = Field(default="http://localhost:8086")
    influxdb_token: str            = Field(default="cogetwin_influx_token_dev")
    influxdb_org: str              = Field(default="cogetwin")
    influxdb_bucket: str           = Field(default="plant_sensors")

    database_url: str              = Field(
        default="postgresql://postgres:password@localhost:5432/cogetwin"
    )
    redis_url: str                 = Field(default="redis://localhost:6379/0")

    # ── Vector DB ─────────────────────────────────────────────────────
    chroma_persist_dir: Path       = Field(default=PROJECT_ROOT / "data" / "chroma_db")
    chroma_collection: str         = Field(default="plant_knowledge")

    # ── MLflow ────────────────────────────────────────────────────────
    mlflow_tracking_uri: str       = Field(default="http://localhost:5000")
    mlflow_experiment_name: str    = Field(default="cogetwin_digital_twin")

    # ── API ───────────────────────────────────────────────────────────
    api_host: str                  = Field(default="0.0.0.0")
    api_port: int                  = Field(default=8000)
    api_secret_key: str            = Field(default="dev_secret_change_in_production")
    cors_origins: list[str]        = Field(
        default=["http://localhost:5173", "http://localhost:3000"]
    )

    # ── Simulation ────────────────────────────────────────────────────
    simulation_seed: int           = Field(default=42)
    simulation_days: int           = Field(default=70)
    simulation_interval_min: int   = Field(default=1)

    # ── Paths ─────────────────────────────────────────────────────────
    data_raw_dir: Path             = PROJECT_ROOT / "data" / "raw"
    data_processed_dir: Path       = PROJECT_ROOT / "data" / "processed"
    data_synthetic_dir: Path       = PROJECT_ROOT / "data" / "synthetic"
    models_dir: Path               = PROJECT_ROOT / "models"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors(cls, v: str | list) -> list[str]:
        if isinstance(v, str):
            import json
            return json.loads(v)
        return v

    def ensure_dirs(self) -> None:
        """Create all required directories if they don't exist."""
        for d in [self.data_raw_dir, self.data_processed_dir,
                  self.data_synthetic_dir, self.chroma_persist_dir,
                  PROJECT_ROOT / "models", PROJECT_ROOT / "mlruns"]:
            Path(d).mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton — import and call this everywhere."""
    s = Settings()
    s.ensure_dirs()
    return s
