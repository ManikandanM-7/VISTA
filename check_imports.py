"""Quick import smoke test — run before starting the API."""
import sys

print("Testing all module imports...")
errors = []

checks = [
    ("src.config",                  "get_settings"),
    ("src.digital_twin.state_estimator", "PlantStateEstimator"),
    ("src.digital_twin.anomaly_detector","AnomalyDetector"),
    ("src.digital_twin.model",      "DigitalTwinModel"),
    ("src.optimizer.engine",        "PlantOptimizer"),
    ("src.optimizer.scenarios",     "list_scenarios"),
    ("src.llm_agent.llm_router",    "get_llm_router"),
    ("src.llm_agent.rag_pipeline",  "PlantRAGPipeline"),
    ("src.llm_agent.agent",         "CogeTwinAgent"),
    ("src.llm_agent.explainer",     "AnomalyExplainer"),
    ("src.api.routes.plant",        "router"),
    ("src.api.routes.optimizer",    "router"),
    ("src.api.routes.chat",         "router"),
    ("src.api.routes.anomalies",    "router"),
]

for module, attr in checks:
    try:
        mod = __import__(module, fromlist=[attr])
        getattr(mod, attr)
        print(f"  OK  {module}.{attr}")
    except Exception as e:
        print(f"  FAIL {module}.{attr}: {e}")
        errors.append((module, str(e)))

print()
if errors:
    print(f"FAILED: {len(errors)} import(s) failed")
    sys.exit(1)
else:
    print("All imports OK — safe to start the API.")

# Bonus: verify model checkpoint exists
from pathlib import Path
ckpt = Path("models/best_model.pt")
ad   = Path("models/anomaly_detector.pt")
proc = Path("data/processed/train.parquet")
print(f"\nArtifact check:")
print(f"  best_model.pt       : {'EXISTS' if ckpt.exists() else 'MISSING'} ({ckpt.stat().st_size//1024} KB)" if ckpt.exists() else f"  best_model.pt       : MISSING")
print(f"  anomaly_detector.pt : {'EXISTS' if ad.exists() else 'MISSING'}")
print(f"  train.parquet       : {'EXISTS' if proc.exists() else 'MISSING'}")
