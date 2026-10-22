"""API routes — Anomaly Log"""
from __future__ import annotations
from fastapi import APIRouter
from pydantic import BaseModel

router    = APIRouter()
app_state = None


@router.get("/log")
async def get_anomaly_log(limit: int = 20):
    """Get recent anomaly events with RCA reports."""
    events = app_state.explainer.get_log(limit=limit)
    return {"total": len(events), "events": events}


@router.get("/{event_id}")
async def get_anomaly_event(event_id: int):
    """Get a specific anomaly event by ID."""
    event = app_state.explainer.get_event(event_id)
    if not event:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found")
    return event


@router.get("/stats/summary")
async def anomaly_stats():
    """Anomaly statistics summary."""
    import pandas as pd
    from pathlib import Path
    csv = Path("data/raw/plant_sensors.csv")
    if not csv.exists():
        return {}
    df = pd.read_csv(csv)
    fault_counts = df[df["fault_active"] != "none"]["fault_active"].value_counts().to_dict()
    return {
        "total_anomaly_rows":     int((df["anomaly_flag"] == 1).sum()),
        "anomaly_rate_pct":       round((df["anomaly_flag"] == 1).mean() * 100, 2),
        "fault_type_counts":      fault_counts,
        "total_simulation_rows":  len(df),
    }
