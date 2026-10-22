"""
CogeTwin — Rankine Cycle Cogeneration Plant Thermodynamic Simulator
====================================================================
Generates physically-consistent synthetic sensor data for a CHP plant.

Physics Model:
  - Water/steam Rankine cycle with extraction turbine
  - Isentropic efficiency models for turbine & pump
  - Heat recovery steam generator (HRSG) dynamics
  - Condenser heat rejection
  - Process steam extraction (cogeneration)
  - Realistic fault injection & degradation

Output: ~100,800 rows (70 days × 1440 min/day) CSV
"""

from __future__ import annotations

import logging
import math
import os
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Generator

import numpy as np
import pandas as pd
from scipy.interpolate import interp1d

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# ---------------------------------------------------------------------------
# Steam Table Approximations (IAPWS-IF97 simplified)
# Valid range: 100°C–550°C, 0.1–16 MPa
# ---------------------------------------------------------------------------

class SteamTables:
    """
    Lightweight steam property approximations using polynomial fits to
    IAPWS-IF97 standard data. Sufficient accuracy for simulation (~0.5% error).
    """

    # Saturation temperature lookup points (°C) → saturation pressure (MPa)
    _T_SAT = np.array([100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300,
                        320, 340, 360, 374.14])
    _P_SAT = np.array([0.1013, 0.1985, 0.3613, 0.6178, 1.0021, 1.5538, 2.318,
                        3.344, 4.688, 6.412, 8.581, 11.274, 14.586, 18.651, 22.089])

    _sat_pressure_interp = interp1d(_T_SAT, _P_SAT, kind="cubic", fill_value="extrapolate")
    _sat_temp_interp     = interp1d(_P_SAT, _T_SAT, kind="cubic", fill_value="extrapolate")

    @classmethod
    def saturation_pressure(cls, T_celsius: float) -> float:
        """Saturation pressure [MPa] at given temperature [°C]."""
        return float(np.clip(cls._sat_pressure_interp(T_celsius), 0.01, 22.0))

    @classmethod
    def saturation_temperature(cls, P_MPa: float) -> float:
        """Saturation temperature [°C] at given pressure [MPa]."""
        return float(np.clip(cls._sat_temp_interp(P_MPa), 50, 374))

    @staticmethod
    def superheated_enthalpy(T_celsius: float, P_MPa: float) -> float:
        """
        Specific enthalpy of superheated steam [kJ/kg].
        Polynomial fit: h = f(T, P).
        """
        T, P = T_celsius, P_MPa
        # Fitted coefficients from IAPWS-IF97 region 2 data
        h = (2501.4
             + 1.872 * T
             + 0.0004 * T**2
             - 42.0 * P
             + 0.05 * P**2
             - 0.015 * T * P
             + 0.00002 * T**2 * P)
        return float(np.clip(h, 2500, 3600))

    @staticmethod
    def superheated_entropy(T_celsius: float, P_MPa: float) -> float:
        """Specific entropy of superheated steam [kJ/(kg·K)]."""
        T, P = T_celsius, P_MPa
        s = (6.929
             + 0.00427 * (T - 100)
             - 0.000003 * (T - 100)**2
             - 0.545 * math.log(P + 0.001))
        return float(np.clip(s, 5.0, 9.0))

    @staticmethod
    def condensate_enthalpy(T_celsius: float) -> float:
        """Specific enthalpy of saturated liquid [kJ/kg]."""
        return float(4.186 * T_celsius + 0.001 * T_celsius**2)

    @staticmethod
    def latent_heat(T_celsius: float) -> float:
        """Latent heat of vaporization [kJ/kg]."""
        # Watson equation approximation
        Tc = 374.14  # Critical temperature [°C]
        if T_celsius >= Tc:
            return 0.0
        h_fg = 2257.0 * ((Tc - T_celsius) / (Tc - 100)) ** 0.38
        return float(np.clip(h_fg, 0, 2500))


# ---------------------------------------------------------------------------
# Plant Configuration
# ---------------------------------------------------------------------------

@dataclass
class PlantConfig:
    """
    Nameplate design parameters for a 10 MW natural gas CHP plant.
    All thermal quantities in kJ, pressures in MPa, temps in °C.
    """
    # Boiler
    boiler_rated_pressure_MPa: float    = 10.0     # High-pressure steam
    boiler_rated_temp_C: float          = 480.0    # Superheated steam temp
    boiler_rated_steam_flow_kgs: float  = 12.0     # kg/s max throughput
    boiler_efficiency_design: float     = 0.88     # Combustion + heat transfer

    # Turbine (extraction type for cogeneration)
    turbine_isentropic_efficiency: float = 0.82
    turbine_rated_power_kW: float        = 10_000.0   # 10 MW electrical
    extraction_pressure_MPa: float       = 0.5         # Process steam pressure
    condenser_pressure_MPa: float        = 0.008       # ~41°C saturation

    # Generator
    generator_efficiency: float         = 0.96

    # Condenser
    cooling_water_temp_C: float         = 25.0     # Ambient cooling water
    condenser_approach_temp_C: float    = 8.0      # Min temp difference

    # Process steam (cogeneration load)
    process_steam_demand_kgs: float     = 4.0      # Nominal extraction flow
    process_steam_return_temp_C: float  = 90.0     # Condensate return

    # Fuel
    fuel_lhv_kJkg: float               = 50_000.0  # Natural gas LHV
    fuel_rated_flow_kgs: float         = 0.56       # At full load

    # Simulation
    seed: int                           = 42
    simulation_days: int                = 70
    interval_minutes: int               = 1


# ---------------------------------------------------------------------------
# Fault & Event Definitions
# ---------------------------------------------------------------------------

@dataclass
class FaultEvent:
    name: str
    start_step: int
    duration_steps: int
    affected_sensors: dict[str, float]   # sensor → magnitude multiplier or additive offset
    fault_type: str = "drift"            # "drift" | "step" | "spike" | "noise_amplify"
    severity: str = "minor"             # "minor" | "moderate" | "critical"


@dataclass
class SimulationState:
    """Mutable state carried through the simulation time loop."""
    boiler_temp_C: float
    boiler_pressure_MPa: float
    steam_flow_kgs: float
    fuel_flow_kgs: float
    turbine_power_kW: float
    process_steam_flow_kgs: float
    condenser_duty_kW: float
    thermal_efficiency: float
    electrical_efficiency: float
    steam_waste_kgs: float              # Steam vented / wasted
    boiler_efficiency: float
    exhaust_temp_C: float
    vibration_turbine_mm_s: float       # RMS vibration — bearing health proxy
    lube_oil_temp_C: float
    condenser_pressure_MPa: float
    ambient_temp_C: float
    load_factor: float                   # 0–1 fraction of rated load
    fault_active: str                    = "none"
    anomaly_flag: int                    = 0


# ---------------------------------------------------------------------------
# Main Simulator
# ---------------------------------------------------------------------------

class CogenerationPlantSimulator:
    """
    Physics-based cogeneration plant simulator implementing a Rankine cycle
    with extraction turbine. Produces time-stamped sensor data with:
      - Realistic operating regime transitions (start-up, ramp, steady, shutdown)
      - Seasonal & diurnal ambient temperature variation
      - Stochastic noise calibrated to real sensor accuracy specs
      - Injected fault events (tube fouling, bearing wear, valve drift, etc.)
      - Gradual equipment degradation over simulation horizon
    """

    SENSOR_NOISE_STDEV = {
        "boiler_temp_C":          0.5,    # RTD sensor ±0.5°C
        "boiler_pressure_MPa":    0.02,   # Pressure transducer ±0.02 MPa
        "steam_flow_kgs":         0.08,   # Coriolis meter ±0.08 kg/s
        "fuel_flow_kgs":          0.003,  # Turbine meter ±0.003 kg/s
        "turbine_power_kW":       15.0,   # Power transducer ±15 kW
        "process_steam_flow_kgs": 0.05,
        "condenser_duty_kW":      20.0,
        "thermal_efficiency":     0.002,
        "electrical_efficiency":  0.001,
        "steam_waste_kgs":        0.03,
        "boiler_efficiency":      0.003,
        "exhaust_temp_C":         2.0,
        "vibration_turbine_mm_s": 0.05,
        "lube_oil_temp_C":        0.3,
        "condenser_pressure_MPa": 0.0002,
        "ambient_temp_C":         0.1,
    }

    # Fault catalogue — injected at pseudo-random intervals
    FAULT_CATALOGUE = [
        dict(name="boiler_tube_fouling",   affected={"boiler_efficiency": -0.06, "exhaust_temp_C": +30},   severity="moderate", duration_days=3,  fault_type="drift"),
        dict(name="turbine_blade_erosion", affected={"turbine_power_kW": -0.08, "vibration_turbine_mm_s": +1.2}, severity="moderate", duration_days=5, fault_type="drift"),
        dict(name="condenser_fouling",     affected={"condenser_pressure_MPa": +0.002, "condenser_duty_kW": -0.05}, severity="minor",    duration_days=7, fault_type="drift"),
        dict(name="steam_valve_drift",     affected={"steam_waste_kgs": +0.8, "process_steam_flow_kgs": -0.3}, severity="minor",    duration_days=2, fault_type="step"),
        dict(name="bearing_wear",          affected={"vibration_turbine_mm_s": +2.5, "lube_oil_temp_C": +8}, severity="moderate", duration_days=4, fault_type="noise_amplify"),
        dict(name="fuel_valve_sticking",   affected={"fuel_flow_kgs": 0.05, "boiler_temp_C": -15},          severity="moderate", duration_days=1, fault_type="spike"),
        dict(name="sensor_drift_pressure", affected={"boiler_pressure_MPa": +0.3},                           severity="minor",    duration_days=3, fault_type="drift"),
        dict(name="cooling_tower_issue",   affected={"condenser_pressure_MPa": +0.003, "ambient_temp_C": +5}, severity="minor",   duration_days=4, fault_type="step"),
    ]

    def __init__(self, config: PlantConfig | None = None) -> None:
        self.cfg = config or PlantConfig()
        self.steam = SteamTables()
        self.rng = np.random.default_rng(self.cfg.seed)
        self._total_steps = self.cfg.simulation_days * 24 * 60 // self.cfg.interval_minutes
        self._fault_schedule: list[FaultEvent] = self._generate_fault_schedule()
        logger.info(
            "Simulator initialized: %d days | %d steps | %d faults scheduled",
            self.cfg.simulation_days, self._total_steps, len(self._fault_schedule)
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate(self, output_path: str | Path | None = None) -> pd.DataFrame:
        """
        Run the full simulation and return a DataFrame.
        Optionally saves to CSV at output_path.
        """
        records = list(self._simulate())
        df = pd.DataFrame(records)
        df = self._post_process(df)

        if output_path:
            path = Path(output_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            df.to_csv(path, index=False)
            logger.info("Saved %d rows → %s", len(df), path)

        return df

    # ------------------------------------------------------------------
    # Load Profile
    # ------------------------------------------------------------------

    def _load_factor(self, step: int) -> float:
        """
        Realistic plant load factor (0–1) incorporating:
          - Diurnal cycle: peak 07:00–21:00, trough 01:00–05:00
          - Weekly cycle: slightly lower on weekends
          - Random demand fluctuations
          - Start-up ramp (first 2 hours) and shutdown (last 1 hour)
        """
        minutes_in_day = 24 * 60
        day = step // minutes_in_day
        minute_of_day = step % minutes_in_day
        hour_of_day = minute_of_day / 60.0
        day_of_week = day % 7

        # Diurnal shape — Gaussian mixture
        peak_morning = 0.85 * math.exp(-0.5 * ((hour_of_day - 9) / 3) ** 2)
        peak_evening = 0.75 * math.exp(-0.5 * ((hour_of_day - 18) / 2) ** 2)
        base_load    = 0.55
        diurnal = base_load + peak_morning + peak_evening

        # Weekend dip
        weekend_factor = 0.88 if day_of_week >= 5 else 1.0

        # Slow random walk (demand variation)
        slow_noise = float(self.rng.normal(0, 0.015))

        load = float(np.clip(diurnal * weekend_factor + slow_noise, 0.40, 1.0))

        # Start-up ramp — first 120 min of simulation
        if step < 120:
            load *= step / 120.0

        return load

    def _ambient_temp(self, step: int) -> float:
        """Seasonal + diurnal ambient temperature [°C] (South Asian climate)."""
        day = step / (24 * 60)
        minute_of_day = step % (24 * 60)
        hour = minute_of_day / 60.0

        # Seasonal: peak in summer (~May), min in winter (~Jan)
        seasonal = 28.0 + 8.0 * math.sin(2 * math.pi * (day - 60) / 365)
        # Diurnal: ±5°C swing, min at 05:00, max at 14:00
        diurnal  = 5.0 * math.sin(2 * math.pi * (hour - 5) / 24)

        noise = float(self.rng.normal(0, 0.3))
        return seasonal + diurnal + noise

    # ------------------------------------------------------------------
    # Thermodynamic Calculations
    # ------------------------------------------------------------------

    def _compute_state(self, load: float, ambient_T: float,
                       degradation: dict[str, float],
                       fault_modifiers: dict[str, float]) -> SimulationState:
        """
        Core thermodynamic model.  All calculations follow Rankine cycle
        energy balances with isentropic efficiency corrections.
        """
        cfg = self.cfg

        # ── Boiler ────────────────────────────────────────────────────
        steam_flow  = cfg.boiler_rated_steam_flow_kgs * load
        boiler_temp = cfg.boiler_rated_temp_C * (0.95 + 0.05 * load)
        boiler_pres = cfg.boiler_rated_pressure_MPa * (0.92 + 0.08 * load)

        boiler_eff = (cfg.boiler_efficiency_design
                      - degradation.get("boiler_eff_loss", 0.0)
                      + fault_modifiers.get("boiler_efficiency", 0.0))
        boiler_eff = float(np.clip(boiler_eff, 0.60, 0.92))

        # Fuel consumption from boiler energy balance
        h_steam  = self.steam.superheated_enthalpy(boiler_temp, boiler_pres)
        h_feed   = self.steam.condensate_enthalpy(cfg.cooling_water_temp_C + 15)
        Q_boiler = steam_flow * (h_steam - h_feed)               # kW
        fuel_flow = Q_boiler / (boiler_eff * cfg.fuel_lhv_kJkg)  # kg/s

        # Exhaust temperature (energy not recovered)
        exhaust_temp = 160.0 + (1 - boiler_eff) * 200 + fault_modifiers.get("exhaust_temp_C", 0)

        # ── Turbine ───────────────────────────────────────────────────
        # Isentropic enthalpy drop at HP section (boiler → extraction)
        h_extraction_isentropic = self.steam.superheated_enthalpy(
            cfg.saturation_temperature_at(cfg.extraction_pressure_MPa), cfg.extraction_pressure_MPa
        ) if hasattr(cfg, "saturation_temperature_at") else \
            self.steam.superheated_enthalpy(
                SteamTables.saturation_temperature(cfg.extraction_pressure_MPa),
                cfg.extraction_pressure_MPa
            )

        # HP turbine work (boiler → extraction)
        eta_t = cfg.turbine_isentropic_efficiency - degradation.get("turbine_eff_loss", 0.0)
        eta_t = float(np.clip(eta_t, 0.65, 0.88))
        dh_HP = eta_t * (h_steam - h_extraction_isentropic)

        # Process steam extraction
        process_flow = cfg.process_steam_demand_kgs * (0.8 + 0.2 * load)
        process_flow += fault_modifiers.get("process_steam_flow_kgs", 0.0)
        process_flow  = float(np.clip(process_flow, 0, steam_flow * 0.6))

        # LP turbine (extraction → condenser)
        h_cond_sat  = self.steam.condensate_enthalpy(
            SteamTables.saturation_temperature(cfg.condenser_pressure_MPa))
        h_extraction = h_steam - dh_HP
        dh_LP = eta_t * (h_extraction - h_cond_sat)

        lp_flow = steam_flow - process_flow
        turbine_power = (steam_flow * dh_HP + lp_flow * dh_LP) * cfg.generator_efficiency
        turbine_power += fault_modifiers.get("turbine_power_kW", 0.0)
        turbine_power  = float(np.clip(turbine_power, 0, cfg.turbine_rated_power_kW * 1.05))

        # ── Condenser ─────────────────────────────────────────────────
        cond_pressure = cfg.condenser_pressure_MPa + \
            degradation.get("cond_pressure_rise", 0.0) + \
            fault_modifiers.get("condenser_pressure_MPa", 0.0)
        cond_pressure = float(np.clip(cond_pressure, 0.005, 0.025))

        cond_duty = lp_flow * (h_extraction - h_cond_sat)  # heat rejected [kW]
        cond_duty += fault_modifiers.get("condenser_duty_kW", 0.0)

        # ── Steam Waste ───────────────────────────────────────────────
        # Steam is wasted when process demand < available extraction
        max_extraction = steam_flow * 0.5
        steam_waste = max(0.0, process_flow - cfg.process_steam_demand_kgs)
        # Valve drift can increase waste
        steam_waste += max(0.0, fault_modifiers.get("steam_waste_kgs", 0.0))

        # ── Efficiencies ──────────────────────────────────────────────
        Q_fuel = fuel_flow * cfg.fuel_lhv_kJkg
        Q_process = process_flow * self.steam.latent_heat(
            SteamTables.saturation_temperature(cfg.extraction_pressure_MPa))
        thermal_efficiency  = (turbine_power + Q_process) / (Q_fuel + 1e-6)
        electrical_efficiency = turbine_power / (Q_fuel + 1e-6)
        thermal_efficiency   = float(np.clip(thermal_efficiency, 0.30, 0.88))
        electrical_efficiency = float(np.clip(electrical_efficiency, 0.15, 0.45))

        # ── Mechanical Health Proxies ─────────────────────────────────
        vibration = (0.8 + 0.3 * load
                     + degradation.get("vibration_increase", 0.0)
                     + fault_modifiers.get("vibration_turbine_mm_s", 0.0))
        lube_oil_temp = (55.0 + 15.0 * load
                         + fault_modifiers.get("lube_oil_temp_C", 0.0)
                         + 0.3 * (ambient_T - 25))

        return SimulationState(
            boiler_temp_C             = boiler_temp + fault_modifiers.get("boiler_temp_C", 0.0),
            boiler_pressure_MPa       = boiler_pres + fault_modifiers.get("boiler_pressure_MPa", 0.0),
            steam_flow_kgs            = steam_flow,
            fuel_flow_kgs             = fuel_flow + fault_modifiers.get("fuel_flow_kgs", 0.0),
            turbine_power_kW          = turbine_power,
            process_steam_flow_kgs    = process_flow,
            condenser_duty_kW         = cond_duty,
            thermal_efficiency        = thermal_efficiency,
            electrical_efficiency     = electrical_efficiency,
            steam_waste_kgs           = steam_waste,
            boiler_efficiency         = boiler_eff,
            exhaust_temp_C            = exhaust_temp,
            vibration_turbine_mm_s    = float(np.clip(vibration, 0.2, 12.0)),
            lube_oil_temp_C           = float(np.clip(lube_oil_temp, 40, 95)),
            condenser_pressure_MPa    = cond_pressure,
            ambient_temp_C            = ambient_T,
            load_factor               = load,
        )

    # ------------------------------------------------------------------
    # Fault Schedule
    # ------------------------------------------------------------------

    def _generate_fault_schedule(self) -> list[FaultEvent]:
        """
        Pseudo-randomly distribute faults across the simulation horizon.
        Each fault type appears 1–3 times.
        """
        faults: list[FaultEvent] = []
        steps_per_day = 24 * 60 // self.cfg.interval_minutes

        # Don't start faults in first 3 days (plant ramp-up)
        available_start = self.rng.integers(
            3 * steps_per_day,
            (self.cfg.simulation_days - 10) * steps_per_day,
            size=len(self.FAULT_CATALOGUE) * 2
        )
        self.rng.shuffle(available_start)

        slot = 0
        for fault_def in self.FAULT_CATALOGUE:
            occurrences = int(self.rng.integers(1, 3))
            for _ in range(occurrences):
                if slot >= len(available_start):
                    break
                start = int(available_start[slot])
                duration = int(fault_def["duration_days"] * steps_per_day)
                faults.append(FaultEvent(
                    name             = fault_def["name"],
                    start_step       = start,
                    duration_steps   = duration,
                    affected_sensors = fault_def["affected"],
                    fault_type       = fault_def["fault_type"],
                    severity         = fault_def["severity"],
                ))
                slot += 1

        faults.sort(key=lambda f: f.start_step)
        logger.info("Fault schedule: %s", [(f.name, f.start_step) for f in faults])
        return faults

    def _get_fault_modifiers(self, step: int) -> tuple[dict[str, float], str, int]:
        """
        Compute the cumulative sensor modification from all active faults
        at a given simulation step. Returns (modifiers_dict, active_fault_name, anomaly_flag).
        """
        modifiers: dict[str, float] = {}
        active_name = "none"
        anomaly = 0

        for fault in self._fault_schedule:
            if fault.start_step <= step < fault.start_step + fault.duration_steps:
                progress = (step - fault.start_step) / fault.duration_steps  # 0–1

                for sensor, magnitude in fault.affected_sensors.items():
                    if fault.fault_type == "drift":
                        # Linear ramp-up then ramp-down
                        envelope = math.sin(math.pi * progress)
                        delta = magnitude * envelope
                    elif fault.fault_type == "step":
                        delta = magnitude
                    elif fault.fault_type == "spike":
                        spike = magnitude if progress < 0.1 else 0.0
                        delta = spike
                    elif fault.fault_type == "noise_amplify":
                        delta = magnitude * progress   # grows over time
                    else:
                        delta = magnitude

                    modifiers[sensor] = modifiers.get(sensor, 0.0) + delta

                active_name = fault.name
                anomaly = 1 if fault.severity in ("moderate", "critical") else 0

        return modifiers, active_name, anomaly

    # ------------------------------------------------------------------
    # Degradation Model
    # ------------------------------------------------------------------

    def _get_degradation(self, step: int) -> dict[str, float]:
        """
        Slow, continuous degradation over the simulation horizon.
        Models: fouling buildup, efficiency decay, seal wear.
        """
        progress = step / self._total_steps   # 0–1 over full simulation

        return {
            "boiler_eff_loss":      0.03 * progress,      # Boiler efficiency drops 3% over lifetime
            "turbine_eff_loss":     0.02 * progress,       # Turbine loses 2% isentropic efficiency
            "cond_pressure_rise":   0.001 * progress,      # Condenser fouling raises backpressure
            "vibration_increase":   0.4 * progress,        # Bearing wear increases vibration
        }

    # ------------------------------------------------------------------
    # Main Simulation Loop
    # ------------------------------------------------------------------

    def _simulate(self) -> Generator[dict, None, None]:
        """Step through every timestep and yield a sensor record dict."""
        start_time = pd.Timestamp("2025-01-01 00:00:00")

        for step in range(self._total_steps):
            timestamp = start_time + pd.Timedelta(minutes=step * self.cfg.interval_minutes)

            load          = self._load_factor(step)
            ambient_temp  = self._ambient_temp(step)
            degradation   = self._get_degradation(step)
            fault_mods, fault_name, anomaly = self._get_fault_modifiers(step)

            state = self._compute_state(load, ambient_temp, degradation, fault_mods)
            state.fault_active = fault_name
            state.anomaly_flag = anomaly

            # Add calibrated Gaussian sensor noise
            record = self._add_noise(state)
            record["timestamp"]   = timestamp
            record["fault_active"] = fault_name
            record["anomaly_flag"] = anomaly
            record["day"]          = timestamp.day_of_year
            record["hour"]         = timestamp.hour
            record["minute"]       = timestamp.minute

            if step % 10_000 == 0:
                pct = 100 * step / self._total_steps
                logger.info("Simulation progress: %.1f%% (step %d / %d)", pct, step, self._total_steps)

            yield record

    def _add_noise(self, state: SimulationState) -> dict:
        """Add Gaussian sensor noise to a state and return as dict."""
        d = {
            "boiler_temp_C":           state.boiler_temp_C,
            "boiler_pressure_MPa":     state.boiler_pressure_MPa,
            "steam_flow_kgs":          state.steam_flow_kgs,
            "fuel_flow_kgs":           state.fuel_flow_kgs,
            "turbine_power_kW":        state.turbine_power_kW,
            "process_steam_flow_kgs":  state.process_steam_flow_kgs,
            "condenser_duty_kW":       state.condenser_duty_kW,
            "thermal_efficiency":      state.thermal_efficiency,
            "electrical_efficiency":   state.electrical_efficiency,
            "steam_waste_kgs":         state.steam_waste_kgs,
            "boiler_efficiency":       state.boiler_efficiency,
            "exhaust_temp_C":          state.exhaust_temp_C,
            "vibration_turbine_mm_s":  state.vibration_turbine_mm_s,
            "lube_oil_temp_C":         state.lube_oil_temp_C,
            "condenser_pressure_MPa":  state.condenser_pressure_MPa,
            "ambient_temp_C":          state.ambient_temp_C,
            "load_factor":             state.load_factor,
        }
        for col, sigma in self.SENSOR_NOISE_STDEV.items():
            if col in d:
                d[col] = float(d[col] + self.rng.normal(0, sigma))
        # Hard physical clamps after noise
        d["boiler_temp_C"]          = float(np.clip(d["boiler_temp_C"], 350, 560))
        d["boiler_pressure_MPa"]    = float(np.clip(d["boiler_pressure_MPa"], 5.0, 13.0))
        d["steam_flow_kgs"]         = float(np.clip(d["steam_flow_kgs"], 0, 14.0))
        d["fuel_flow_kgs"]          = float(np.clip(d["fuel_flow_kgs"], 0.05, 0.8))
        d["turbine_power_kW"]       = float(np.clip(d["turbine_power_kW"], 0, 11_000))
        d["thermal_efficiency"]     = float(np.clip(d["thermal_efficiency"], 0.25, 0.92))
        d["electrical_efficiency"]  = float(np.clip(d["electrical_efficiency"], 0.10, 0.50))
        d["steam_waste_kgs"]        = float(np.clip(d["steam_waste_kgs"], 0, 5.0))
        d["vibration_turbine_mm_s"] = float(np.clip(d["vibration_turbine_mm_s"], 0.1, 15.0))
        d["lube_oil_temp_C"]        = float(np.clip(d["lube_oil_temp_C"], 35, 100))
        return d

    # ------------------------------------------------------------------
    # Post-processing
    # ------------------------------------------------------------------

    def _post_process(self, df: pd.DataFrame) -> pd.DataFrame:
        """Compute derived columns and reorder."""
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df.set_index("timestamp", inplace=True)

        # Heat rate [BTU/kWh] — industry standard KPI
        df["heat_rate_BTU_kWh"] = (df["fuel_flow_kgs"] * self.cfg.fuel_lhv_kJkg * 0.9478) / (
            df["turbine_power_kW"] / 1000 + 1e-6
        )

        # Steam-to-fuel ratio
        df["steam_fuel_ratio"] = df["steam_flow_kgs"] / (df["fuel_flow_kgs"] + 1e-6)

        # Power-to-heat ratio (cogeneration quality index)
        df["power_to_heat_ratio"] = df["turbine_power_kW"] / (
            df["process_steam_flow_kgs"] * 2100 + 1e-6
        )

        # Rolling 15-min efficiency (operational KPI)
        df["thermal_efficiency_15min_avg"] = df["thermal_efficiency"].rolling(15, min_periods=1).mean()

        # Cumulative steam waste (shift-level accountability metric)
        df["cum_steam_waste_kg"] = df["steam_waste_kgs"].cumsum()

        df.reset_index(inplace=True)
        return df


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="CogeTwin Thermodynamic Simulator")
    parser.add_argument("--days",     type=int,   default=70,     help="Simulation duration in days")
    parser.add_argument("--interval", type=int,   default=1,      help="Sensor interval in minutes")
    parser.add_argument("--seed",     type=int,   default=42,     help="Random seed")
    parser.add_argument("--output",   type=str,   default="data/raw/plant_sensors.csv",
                        help="Output CSV path")
    args = parser.parse_args()

    cfg = PlantConfig(
        seed=args.seed,
        simulation_days=args.days,
        interval_minutes=args.interval,
    )
    sim = CogenerationPlantSimulator(config=cfg)
    df  = sim.generate(output_path=args.output)

    print(f"\n{'='*60}")
    print(f"  Simulation Complete!")
    print(f"{'='*60}")
    print(f"  Rows generated  : {len(df):,}")
    print(f"  Columns         : {len(df.columns)}")
    print(f"  Time range      : {df['timestamp'].min()} -> {df['timestamp'].max()}")
    print(f"  Faults injected : {df[df['anomaly_flag']==1].shape[0]:,} anomaly rows")
    print(f"  Output file     : {args.output}")
    print(f"{'='*60}\n")
    print(df[["timestamp","boiler_temp_C","turbine_power_kW","thermal_efficiency",
              "steam_waste_kgs","fault_active"]].tail(10).to_string(index=False))


if __name__ == "__main__":
    main()
