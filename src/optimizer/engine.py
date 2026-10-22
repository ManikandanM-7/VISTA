"""
CogeTwin — Optimization Engine
================================
Multi-objective plant operating setpoint optimizer.

Objective : minimize(steam_waste_rate + α·fuel_cost)
Subject to: power_output >= demand
            safety temperature bounds
            pressure bounds
            ramp-rate limits

Solver    : scipy.optimize.minimize with SLSQP (Sequential Least Squares
            Programming) — handles nonlinear constraints, no license needed.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from scipy.optimize import minimize, OptimizeResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Plant Parameter Bounds (physical safety limits)
# ---------------------------------------------------------------------------

SETPOINT_BOUNDS = {
    # variable            (min,   max,   unit,        description)
    "boiler_temp_C":      (380.0, 520.0, "°C",        "Boiler outlet steam temperature"),
    "boiler_pressure_MPa":(6.0,  11.5,  "MPa",       "Boiler operating pressure"),
    "fuel_flow_kgs":      (0.15,  0.75,  "kg/s",      "Fuel mass flow rate"),
    "steam_valve_pct":    (0.30,  1.00,  "%",         "Main steam valve opening"),
}

# Ordered list for array indexing
SETPOINT_KEYS = list(SETPOINT_BOUNDS.keys())


@dataclass
class OptimizationConfig:
    """Tunable optimizer parameters."""
    power_demand_kW:   float = 8_000.0   # Electrical demand to satisfy
    alpha_fuel:        float = 0.3        # Fuel cost weight (vs. steam waste)
    fuel_price_per_kg: float = 0.05       # USD/kg of natural gas
    max_iter:          int   = 200
    tol:               float = 1e-6
    ramp_rate_limit:   float = 0.10       # Max fractional change per optimization step


@dataclass
class OptimizationResult:
    """Structured result returned to the API and LLM agent."""
    success:            bool
    message:            str
    optimal_setpoints:  dict[str, float]
    predicted_kpis:     dict[str, float]
    estimated_savings:  dict[str, float]   # vs. current operating point
    solver_iterations:  int
    solve_time_s:       float
    constraints_active: list[str]          # which constraints are binding


class PlantOptimizer:
    """
    Wraps scipy SLSQP with:
      - Plant-specific objective function (steam waste + fuel cost)
      - Physics-based constraints
      - Warm-start from current operating point
      - Ramp-rate guard to prevent unrealistic step changes
    """

    def __init__(
        self,
        config: OptimizationConfig | None = None,
        plant_model_fn: Callable[[dict[str, float]], dict[str, float]] | None = None,
    ) -> None:
        """
        Args:
            config        : Optimizer parameters
            plant_model_fn: Optional callable that simulates KPIs given setpoints.
                            If None, uses the built-in surrogate model.
                            Signature: fn(setpoints: dict) -> kpis: dict
        """
        self.cfg   = config or OptimizationConfig()
        self._model_fn = plant_model_fn or self._surrogate_model

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def optimize(
        self,
        current_setpoints: dict[str, float],
        current_kpis: dict[str, float] | None = None,
    ) -> OptimizationResult:
        """
        Find optimal setpoints minimizing steam waste + fuel cost.

        Args:
            current_setpoints : dict of current operating setpoints
            current_kpis      : current KPI values (for savings calculation)
        Returns:
            OptimizationResult
        """
        t0 = time.perf_counter()

        # Build initial guess from current setpoints (warm start)
        x0     = self._dict_to_array(current_setpoints)
        bounds = [SETPOINT_BOUNDS[k][:2] for k in SETPOINT_KEYS]

        # Constraints
        constraints = self._build_constraints(x0)

        result: OptimizeResult = minimize(
            fun=self._objective,
            x0=x0,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": self.cfg.max_iter, "ftol": self.cfg.tol, "disp": False},
        )

        solve_time = time.perf_counter() - t0
        optimal    = self._array_to_dict(result.x)
        pred_kpis  = self._model_fn(optimal)
        savings    = self._compute_savings(current_kpis or {}, pred_kpis, optimal, current_setpoints)

        active = [f"power_demand>={self.cfg.power_demand_kW:.0f}kW"]
        if not result.success:
            logger.warning("Optimizer did not converge: %s", result.message)

        logger.info(
            "Optimization complete in %.3fs | %d iters | success=%s | "
            "steam_waste %.3f -> %.3f kg/s",
            solve_time, result.nit, result.success,
            current_kpis.get("steam_waste_kgs", 0) if current_kpis else 0,
            pred_kpis.get("steam_waste_kgs", 0),
        )

        return OptimizationResult(
            success            = bool(result.success),
            message            = result.message,
            optimal_setpoints  = optimal,
            predicted_kpis     = pred_kpis,
            estimated_savings  = savings,
            solver_iterations  = result.nit,
            solve_time_s       = round(solve_time, 4),
            constraints_active = active,
        )

    def what_if(
        self,
        base_setpoints: dict[str, float],
        perturbation: dict[str, float],
    ) -> dict[str, float]:
        """
        Simulate KPIs for a manually specified perturbation.
        Used by the LLM agent for scenario analysis.

        Args:
            base_setpoints : current setpoints
            perturbation   : deltas to apply (e.g. {"boiler_temp_C": +5})
        Returns:
            predicted KPIs
        """
        perturbed = {**base_setpoints}
        for k, delta in perturbation.items():
            if k in perturbed:
                lo, hi = SETPOINT_BOUNDS[k][:2]
                perturbed[k] = float(np.clip(perturbed[k] + delta, lo, hi))
        return self._model_fn(perturbed)

    # ------------------------------------------------------------------
    # Objective Function
    # ------------------------------------------------------------------

    def _objective(self, x: np.ndarray) -> float:
        """
        Scalar objective to minimise.
        f = steam_waste_kgs + α * fuel_cost_per_minute
        """
        setpoints = self._array_to_dict(x)
        kpis      = self._model_fn(setpoints)

        steam_waste  = kpis.get("steam_waste_kgs", 0.0)
        fuel_flow    = setpoints.get("fuel_flow_kgs", 0.4)
        fuel_cost_pm = fuel_flow * 60 * self.cfg.fuel_price_per_kg   # USD/minute

        return steam_waste + self.cfg.alpha_fuel * fuel_cost_pm

    # ------------------------------------------------------------------
    # Constraints
    # ------------------------------------------------------------------

    def _build_constraints(self, x0: np.ndarray) -> list[dict]:
        """
        SLSQP constraints — all expressed as g(x) >= 0.
        """
        cfg = self.cfg

        def power_constraint(x: np.ndarray) -> float:
            """Power output must meet demand."""
            kpis = self._model_fn(self._array_to_dict(x))
            return kpis.get("turbine_power_kW", 0) - cfg.power_demand_kW

        def ramp_temp(x: np.ndarray) -> float:
            """Boiler temp cannot change more than ramp_rate_limit * nominal."""
            idx = SETPOINT_KEYS.index("boiler_temp_C")
            nominal = 480.0
            return cfg.ramp_rate_limit * nominal - abs(x[idx] - x0[idx])

        def ramp_pressure(x: np.ndarray) -> float:
            idx = SETPOINT_KEYS.index("boiler_pressure_MPa")
            nominal = 10.0
            return cfg.ramp_rate_limit * nominal - abs(x[idx] - x0[idx])

        def efficiency_constraint(x: np.ndarray) -> float:
            """Thermal efficiency must be above 40% (not operating in degraded zone)."""
            kpis = self._model_fn(self._array_to_dict(x))
            return kpis.get("thermal_efficiency", 0) - 0.40

        return [
            {"type": "ineq", "fun": power_constraint},
            {"type": "ineq", "fun": ramp_temp},
            {"type": "ineq", "fun": ramp_pressure},
            {"type": "ineq", "fun": efficiency_constraint},
        ]

    # ------------------------------------------------------------------
    # Surrogate Plant Model (physics-based approximation)
    # Used when no trained ML model is available
    # ------------------------------------------------------------------

    def _surrogate_model(self, setpoints: dict[str, float]) -> dict[str, float]:
        """
        Physics-based surrogate: maps setpoints to predicted KPIs.
        This is used during development and as fallback if the ML model
        is not loaded. The API will inject the actual trained model via
        plant_model_fn when available.
        """
        T   = setpoints.get("boiler_temp_C", 480)
        P   = setpoints.get("boiler_pressure_MPa", 10.0)
        F   = setpoints.get("fuel_flow_kgs", 0.45)
        V   = setpoints.get("steam_valve_pct", 0.85)

        # Simplified Rankine cycle relationships
        load_factor       = V * 0.9 + 0.1
        boiler_efficiency = 0.88 - 0.002 * max(0, 480 - T)   # degrades if too cool
        steam_flow        = F * boiler_efficiency * 22.0       # approximate

        # Turbine power (Willans line approximation)
        turbine_power = (load_factor * 10_500
                         * (1 - 0.005 * max(0, 10 - P))       # pressure derating
                         * (T / 480) ** 0.6)                   # temp effect

        # Efficiencies
        Q_fuel = F * 50_000   # kW
        Q_process = steam_flow * 0.35 * 2100   # process heat
        thermal_efficiency    = (turbine_power + Q_process) / (Q_fuel + 1e-6)
        electrical_efficiency = turbine_power / (Q_fuel + 1e-6)

        # Steam waste: process extraction vs demand
        process_demand = 4.0
        process_flow   = min(steam_flow * 0.4, steam_flow)
        steam_waste    = max(0.0, process_flow - process_demand)

        return {
            "turbine_power_kW":       float(np.clip(turbine_power, 0, 11_500)),
            "thermal_efficiency":     float(np.clip(thermal_efficiency, 0.25, 0.90)),
            "electrical_efficiency":  float(np.clip(electrical_efficiency, 0.15, 0.45)),
            "steam_waste_kgs":        float(np.clip(steam_waste, 0, 5.0)),
            "boiler_efficiency":      float(boiler_efficiency),
        }

    # ------------------------------------------------------------------
    # Savings Calculation
    # ------------------------------------------------------------------

    def _compute_savings(
        self,
        before: dict[str, float],
        after: dict[str, float],
        opt_setpoints: dict[str, float],
        cur_setpoints: dict[str, float],
    ) -> dict[str, float]:
        delta_waste   = before.get("steam_waste_kgs", 0) - after.get("steam_waste_kgs", 0)
        delta_eff     = after.get("thermal_efficiency", 0) - before.get("thermal_efficiency", 0)
        fuel_saved    = cur_setpoints.get("fuel_flow_kgs", 0.45) - opt_setpoints.get("fuel_flow_kgs", 0.45)
        fuel_cost_saved_hr = fuel_saved * 3600 * self.cfg.fuel_price_per_kg

        return {
            "steam_waste_reduction_kgs":   round(delta_waste, 4),
            "thermal_efficiency_gain":     round(delta_eff, 4),
            "fuel_saved_kgs_per_hour":     round(fuel_saved * 3600, 3),
            "estimated_cost_saving_usd_hr": round(fuel_cost_saved_hr, 4),
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _dict_to_array(self, d: dict[str, float]) -> np.ndarray:
        return np.array([d.get(k, (SETPOINT_BOUNDS[k][0] + SETPOINT_BOUNDS[k][1]) / 2)
                         for k in SETPOINT_KEYS], dtype=np.float64)

    def _array_to_dict(self, x: np.ndarray) -> dict[str, float]:
        return {k: float(x[i]) for i, k in enumerate(SETPOINT_KEYS)}
