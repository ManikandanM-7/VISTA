"""API routes — Plant State"""
from __future__ import annotations
from fastapi import APIRouter
from pydantic import BaseModel

router   = APIRouter()
app_state = None   # injected by main.py


class ForecastRequest(BaseModel):
    horizon_steps: int = 15


@router.get("/state")
async def get_plant_state():
    """Current digital twin state."""
    state = app_state.state_estimator.get_current_state()
    return state or {"error": "No state yet — initializing"}


@router.post("/forecast")
async def get_forecast(req: ForecastRequest):
    """Multi-step ahead predictions."""
    forecasts = app_state.state_estimator.get_forecast(req.horizon_steps)
    return {"horizon_steps": req.horizon_steps, "forecasts": forecasts}


@router.get("/sensors/history")
async def get_sensor_history():
    """Return last N rows from the raw dataset for charts."""
    import pandas as pd
    from pathlib import Path
    csv = Path("data/raw/plant_sensors.csv")
    if not csv.exists():
        return {"error": "Dataset not found"}
    df = pd.read_csv(csv, parse_dates=["timestamp"])
    # Return last 1440 rows (1 day of 1-min data) for charts
    tail = df.tail(1440)[
        ["timestamp", "boiler_temp_C", "turbine_power_kW",
         "thermal_efficiency", "steam_waste_kgs",
         "vibration_turbine_mm_s", "load_factor", "fault_active"]
    ]
    return tail.to_dict(orient="records")


@router.get("/kpis")
async def get_kpis():
    """Summary KPIs for dashboard header cards."""
    import pandas as pd
    from pathlib import Path
    csv = Path("data/raw/plant_sensors.csv")
    if not csv.exists():
        return {}
    df = pd.read_csv(csv)
    last_24h = df.tail(1440)
    return {
        "avg_thermal_efficiency_pct": round(last_24h["thermal_efficiency"].mean() * 100, 2),
        "total_steam_waste_kg":       round(last_24h["steam_waste_kgs"].sum(), 2),
        "avg_turbine_power_kW":       round(last_24h["turbine_power_kW"].mean(), 1),
        "anomaly_count_24h":          int((last_24h["anomaly_flag"] == 1).sum()),
        "avg_boiler_efficiency_pct":  round(last_24h["boiler_efficiency"].mean() * 100, 2),
    }
