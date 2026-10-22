"""
CogeTwin — FastAPI Main Application
=====================================
Wires together all modules and starts the API server.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from src.config import get_settings
from src.digital_twin.state_estimator import PlantStateEstimator
from src.digital_twin.anomaly_detector import AnomalyDetector
from src.llm_agent.llm_router import get_llm_router, LLMRouter
from src.llm_agent.rag_pipeline import PlantRAGPipeline
from src.llm_agent.agent import CogeTwinAgent
from src.llm_agent.explainer import AnomalyExplainer
from src.optimizer.engine import PlantOptimizer
from src.api.routes import plant, optimizer, chat, anomalies

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

settings = get_settings()

# ---------------------------------------------------------------------------
# Application State (shared across requests)
# ---------------------------------------------------------------------------

class AppState:
    state_estimator: PlantStateEstimator = None
    anomaly_detector: AnomalyDetector    = None
    optimizer: PlantOptimizer            = None
    rag_pipeline: PlantRAGPipeline       = None
    agent: CogeTwinAgent                 = None
    explainer: AnomalyExplainer          = None
    llm_router                           = None
    ws_clients: list[WebSocket]          = []
    sim_task: asyncio.Task               = None

app_state = AppState()


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize all components on startup, clean up on shutdown."""
    logger.info("=== CogeTwin API starting up ===")

    # State estimator
    app_state.state_estimator = PlantStateEstimator(
        model_path       = "models/best_model.pt",
        preprocessor_dir = "data/processed",
    ).load()

    # Anomaly detector
    try:
        app_state.anomaly_detector = AnomalyDetector.load("models")
    except Exception:
        logger.warning("Anomaly detector model not found — running without anomaly detection")
        app_state.anomaly_detector = AnomalyDetector()

    # Optimizer
    app_state.optimizer = PlantOptimizer()

    # RAG pipeline
    app_state.rag_pipeline = PlantRAGPipeline().initialize()

    # LLM router
    app_state.llm_router = get_llm_router()
    app_state.background_router = LLMRouter(is_background=True)

    # LLM agent
    app_state.agent = CogeTwinAgent(
        llm_router        = app_state.llm_router,
        state_estimator   = app_state.state_estimator,
        optimizer         = app_state.optimizer,
        rag_pipeline      = app_state.rag_pipeline,
        anomaly_log_getter= lambda limit=5: app_state.explainer.get_log(limit) if app_state.explainer else [],
    ).build()

    # Explainer
    app_state.explainer = AnomalyExplainer(
        llm_router   = app_state.background_router,
        rag_pipeline = app_state.rag_pipeline,
    )

    # Inject app_state into routes
    plant.app_state     = app_state
    optimizer.app_state = app_state
    chat.app_state      = app_state
    anomalies.app_state = app_state

    # Start synthetic live data simulation
    app_state.sim_task = asyncio.create_task(_live_sensor_simulator())

    logger.info("=== CogeTwin API ready ===")
    yield

    # Cleanup
    if app_state.sim_task:
        app_state.sim_task.cancel()
    logger.info("=== CogeTwin API shutting down ===")


# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------

app = FastAPI(
    title       = "CogeTwin API",
    description = "LLM-Powered Digital Twin for Cogeneration Plant Optimization",
    version     = "1.0.0",
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = settings.cors_origins,
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# Register routers
app.include_router(plant.router,     prefix="/plant",     tags=["Plant State"])
app.include_router(optimizer.router, prefix="/optimizer", tags=["Optimizer"])
app.include_router(chat.router,      prefix="/chat",      tags=["AI Chat"])
app.include_router(anomalies.router, prefix="/anomalies", tags=["Anomalies"])


@app.get("/", tags=["Health"])
async def root():
    return {
        "service":    "CogeTwin API",
        "version":    "1.0.0",
        "status":     "operational",
        "llm_backend": app_state.llm_router.active_backend if app_state.llm_router else "unknown",
    }

@app.get("/health", tags=["Health"])
async def health():
    return {
        "status":          "ok",
        "model_loaded":    app_state.state_estimator._loaded if app_state.state_estimator else False,
        "rag_ready":       app_state.rag_pipeline._vectorstore is not None if app_state.rag_pipeline else False,
        "llm_backend":     app_state.llm_router.active_backend if app_state.llm_router else "unknown",
        "active_ws_conns": len(app_state.ws_clients),
    }


# ---------------------------------------------------------------------------
# WebSocket — Real-time Plant Data Stream
# ---------------------------------------------------------------------------

@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    """
    WebSocket endpoint that streams live plant state at 1-second intervals.
    Dashboard connects here for real-time chart updates.
    """
    await ws.accept()
    app_state.ws_clients.append(ws)
    logger.info("WebSocket client connected. Total: %d", len(app_state.ws_clients))
    try:
        while True:
            await ws.receive_text()   # Keep alive (client sends pings)
    except WebSocketDisconnect:
        app_state.ws_clients.remove(ws)
        logger.info("WebSocket client disconnected. Total: %d", len(app_state.ws_clients))


# ---------------------------------------------------------------------------
# Background: Live Sensor Simulator
# Streams synthetic plant readings to all connected WebSocket clients
# ---------------------------------------------------------------------------

async def _live_sensor_simulator():
    """
    Generates and broadcasts synthetic real-time sensor readings.
    In production: replace with actual SCADA/OPC-UA data source.
    """
    # Base operating state
    base_state = {
        "boiler_temp_C":          478.0,
        "boiler_pressure_MPa":    10.0,
        "steam_flow_kgs":         10.5,
        "fuel_flow_kgs":          0.45,
        "turbine_power_kW":       9800.0,
        "process_steam_flow_kgs": 3.8,
        "condenser_duty_kW":      8500.0,
        "thermal_efficiency":     0.68,
        "electrical_efficiency":  0.31,
        "steam_waste_kgs":        0.05,
        "boiler_efficiency":      0.86,
        "exhaust_temp_C":         185.0,
        "vibration_turbine_mm_s": 1.2,
        "lube_oil_temp_C":        52.0,
        "condenser_pressure_MPa": 0.008,
        "ambient_temp_C":         30.0,
        "load_factor":            0.82,
        "fault_active":           "none",
        "anomaly_flag":           0,
    }

    rng = np.random.default_rng(99)
    t = 0

    while True:
        t += 1
        # Gentle drift over time
        base_state["boiler_temp_C"]       += float(rng.normal(0, 0.3))
        base_state["boiler_pressure_MPa"] += float(rng.normal(0, 0.01))
        base_state["turbine_power_kW"]    += float(rng.normal(0, 20))
        base_state["steam_waste_kgs"]      = max(0, base_state["steam_waste_kgs"] + float(rng.normal(0, 0.005)))
        base_state["vibration_turbine_mm_s"] = max(0.1, base_state["vibration_turbine_mm_s"] + float(rng.normal(0, 0.02)))

        # Clamp to physical bounds
        base_state["boiler_temp_C"]       = float(np.clip(base_state["boiler_temp_C"], 450, 510))
        base_state["boiler_pressure_MPa"] = float(np.clip(base_state["boiler_pressure_MPa"], 8.5, 11.0))
        base_state["turbine_power_kW"]    = float(np.clip(base_state["turbine_power_kW"], 5000, 11000))

        # Update state estimator
        updated = app_state.state_estimator.update(dict(base_state))

        # Check anomalies (every 10 seconds)
        if t % 10 == 0 and app_state.anomaly_detector._model is not None:
            window = app_state.state_estimator._window
            if len(window) >= app_state.anomaly_detector.seq_len:
                win_arr = np.array(list(window))
                anomaly = app_state.anomaly_detector.predict(win_arr)
                updated["live_anomaly"] = anomaly

                # Only explain once per minute to avoid LLM rate limits
                if anomaly["anomaly_flag"] and anomaly["severity"] in ("moderate", "critical") and (t - getattr(app_state, "last_explain_t", -60) >= 60):
                    app_state.last_explain_t = t
                    asyncio.create_task(
                        app_state.explainer.explain(anomaly, updated)
                    )

        # Broadcast to all WebSocket clients
        if app_state.ws_clients:
            payload = json.dumps({
                k: round(v, 4) if isinstance(v, float) else v
                for k, v in updated.items()
                if k != "timestamp"
            }, default=str)
            dead = []
            for ws in app_state.ws_clients:
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                app_state.ws_clients.remove(ws)

        await asyncio.sleep(1.0)   # 1-second broadcast interval

