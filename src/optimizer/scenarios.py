"""
CogeTwin — Optimization Scenarios
====================================
Pre-defined optimization scenarios for common plant operating conditions.
Used by the LLM agent for quick contextual recommendations.
"""

from __future__ import annotations
from dataclasses import dataclass
from src.optimizer.engine import OptimizationConfig


@dataclass
class Scenario:
    name: str
    description: str
    config: OptimizationConfig
    default_setpoints: dict[str, float]


SCENARIOS: dict[str, Scenario] = {
    "peak_demand": Scenario(
        name="Peak Electrical Demand",
        description=(
            "Maximize electrical output during peak grid demand. "
            "Accepts higher fuel consumption to meet power obligations."
        ),
        config=OptimizationConfig(
            power_demand_kW=10_000,
            alpha_fuel=0.05,          # Low fuel weight — prioritize power
        ),
        default_setpoints={
            "boiler_temp_C":       500.0,
            "boiler_pressure_MPa": 10.5,
            "fuel_flow_kgs":       0.65,
            "steam_valve_pct":     0.95,
        },
    ),

    "efficiency": Scenario(
        name="Maximum Efficiency",
        description=(
            "Operate at the highest possible thermal efficiency. "
            "Reduces both fuel cost and steam waste simultaneously."
        ),
        config=OptimizationConfig(
            power_demand_kW=7_000,
            alpha_fuel=0.8,           # High fuel weight — minimize consumption
        ),
        default_setpoints={
            "boiler_temp_C":       470.0,
            "boiler_pressure_MPa": 9.5,
            "fuel_flow_kgs":       0.38,
            "steam_valve_pct":     0.75,
        },
    ),

    "low_demand": Scenario(
        name="Low Demand / Off-peak",
        description=(
            "Night-time or weekend operation with reduced electrical and "
            "process heat demand. Minimizes fuel burn."
        ),
        config=OptimizationConfig(
            power_demand_kW=4_000,
            alpha_fuel=0.7,
        ),
        default_setpoints={
            "boiler_temp_C":       420.0,
            "boiler_pressure_MPa": 7.5,
            "fuel_flow_kgs":       0.22,
            "steam_valve_pct":     0.50,
        },
    ),

    "maintenance_mode": Scenario(
        name="Pre-maintenance Ramp-down",
        description=(
            "Safely reduce plant load before scheduled maintenance. "
            "Conservative ramp rates, minimizes thermal stress."
        ),
        config=OptimizationConfig(
            power_demand_kW=3_000,
            alpha_fuel=0.5,
            ramp_rate_limit=0.05,     # Extra-conservative ramp
        ),
        default_setpoints={
            "boiler_temp_C":       390.0,
            "boiler_pressure_MPa": 6.5,
            "fuel_flow_kgs":       0.18,
            "steam_valve_pct":     0.40,
        },
    ),

    "steam_minimization": Scenario(
        name="Minimize Steam Waste",
        description=(
            "Aggressively minimize vented / wasted steam. "
            "Used when process heat demand is low and steam is being lost."
        ),
        config=OptimizationConfig(
            power_demand_kW=6_000,
            alpha_fuel=0.3,
        ),
        default_setpoints={
            "boiler_temp_C":       460.0,
            "boiler_pressure_MPa": 9.0,
            "fuel_flow_kgs":       0.35,
            "steam_valve_pct":     0.70,
        },
    ),
}


def get_scenario(name: str) -> Scenario:
    if name not in SCENARIOS:
        raise ValueError(f"Unknown scenario '{name}'. Available: {list(SCENARIOS.keys())}")
    return SCENARIOS[name]


def list_scenarios() -> list[dict]:
    return [{"id": k, "name": v.name, "description": v.description}
            for k, v in SCENARIOS.items()]
