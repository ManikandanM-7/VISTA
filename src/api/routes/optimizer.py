"""API routes — Optimizer"""
from __future__ import annotations
from fastapi import APIRouter
from pydantic import BaseModel

router    = APIRouter()
app_state = None


class OptimizeRequest(BaseModel):
    power_demand_kW: float = 8000.0
    scenario: str | None   = None


class WhatIfRequest(BaseModel):
    parameter:    str
    change_value: float


@router.post("/run")
async def run_optimizer(req: OptimizeRequest):
    """Run the optimization engine and return optimal setpoints."""
    from src.optimizer.engine import OptimizationConfig
    from src.optimizer.scenarios import get_scenario, list_scenarios

    if req.scenario:
        try:
            scenario = get_scenario(req.scenario)
            app_state.optimizer.cfg = scenario.config
            current = scenario.default_setpoints
        except ValueError as e:
            return {"error": str(e)}
    else:
        app_state.optimizer.cfg = OptimizationConfig(power_demand_kW=req.power_demand_kW)
        state   = app_state.state_estimator.get_current_state()
        current = {
            "boiler_temp_C":       state.get("boiler_temp_C", 480),
            "boiler_pressure_MPa": state.get("boiler_pressure_MPa", 10.0),
            "fuel_flow_kgs":       state.get("fuel_flow_kgs", 0.45),
            "steam_valve_pct":     state.get("load_factor", 0.8),
        }

    result = app_state.optimizer.optimize(current)
    return {
        "success":           result.success,
        "optimal_setpoints": result.optimal_setpoints,
        "predicted_kpis":    result.predicted_kpis,
        "estimated_savings": result.estimated_savings,
        "solve_time_s":      result.solve_time_s,
        "message":           result.message,
    }


@router.post("/what-if")
async def what_if(req: WhatIfRequest):
    """Simulate parameter change effects."""
    state = app_state.state_estimator.get_current_state()
    base  = {
        "boiler_temp_C":       state.get("boiler_temp_C", 480),
        "boiler_pressure_MPa": state.get("boiler_pressure_MPa", 10.0),
        "fuel_flow_kgs":       state.get("fuel_flow_kgs", 0.45),
        "steam_valve_pct":     state.get("load_factor", 0.8),
    }
    result = app_state.optimizer.what_if(base, {req.parameter: req.change_value})
    return {"parameter": req.parameter, "delta": req.change_value, "predicted_kpis": result}


@router.get("/scenarios")
async def list_scenarios():
    """List available optimization scenarios."""
    from src.optimizer.scenarios import list_scenarios as _list
    return {"scenarios": _list()}
