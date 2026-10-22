"""
Train the LSTM Autoencoder Anomaly Detector.
Run after the main digital twin model is trained.
"""
import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

from src.digital_twin.anomaly_detector import AnomalyDetector

detector = AnomalyDetector(seq_len=60, hidden_dim=64, latent_dim=32, threshold_percentile=95.0)
detector.train(
    processed_dir="data/processed",
    model_dir="models",
    epochs=25,
    batch_size=256,
    lr=1e-3,
)
print("\nAnomaly detector training complete!")
print(f"  Threshold (95th pct): {detector._threshold:.6f}")
print(f"  Feature count:        {len(detector._feature_cols)}")
