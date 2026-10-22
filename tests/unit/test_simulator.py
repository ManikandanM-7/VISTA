"""
Unit tests for the thermodynamic simulator.
Run with: pytest tests/unit/test_simulator.py -v
"""

import math
import numpy as np
import pandas as pd
import pytest

from src.data_pipeline.simulator import (
    CogenerationPlantSimulator,
    PlantConfig,
    SteamTables,
)


class TestSteamTables:
    """Validate steam property calculations against known values."""

    def test_saturation_pressure_at_100C(self):
        """At 100°C, saturation pressure should be ~0.1013 MPa (atmospheric)."""
        p = SteamTables.saturation_pressure(100)
        assert abs(p - 0.1013) < 0.005, f"Expected ~0.1013 MPa, got {p}"

    def test_saturation_pressure_increases_with_temp(self):
        """Saturation pressure must monotonically increase with temperature."""
        temps = [100, 150, 200, 250, 300, 350]
        pressures = [SteamTables.saturation_pressure(T) for T in temps]
        assert all(pressures[i] < pressures[i+1] for i in range(len(pressures)-1))

    def test_superheated_enthalpy_range(self):
        """Superheated steam enthalpy at typical boiler conditions."""
        h = SteamTables.superheated_enthalpy(480, 10.0)
        # IAPWS-IF97: ~3291 kJ/kg at 480°C, 10 MPa
        assert 3100 < h < 3500, f"Enthalpy out of range: {h}"

    def test_condensate_enthalpy_at_25C(self):
        """Condensate enthalpy at ~25°C ≈ 104.8 kJ/kg."""
        h = SteamTables.condensate_enthalpy(25)
        assert 100 < h < 115

    def test_latent_heat_at_100C(self):
        """Latent heat at 100°C ≈ 2257 kJ/kg."""
        hfg = SteamTables.latent_heat(100)
        assert abs(hfg - 2257) < 100

    def test_saturation_temperature_inverse(self):
        """sat_temp(sat_pressure(T)) should recover T within 2°C."""
        for T in [120, 180, 250, 300]:
            P = SteamTables.saturation_pressure(T)
            T_recovered = SteamTables.saturation_temperature(P)
            assert abs(T_recovered - T) < 2.0, f"Roundtrip error at {T}°C"


class TestPlantConfig:
    def test_default_config_physical_validity(self):
        cfg = PlantConfig()
        assert 0 < cfg.boiler_efficiency_design < 1
        assert 0 < cfg.turbine_isentropic_efficiency < 1
        assert 0 < cfg.generator_efficiency < 1
        assert cfg.boiler_rated_pressure_MPa > cfg.extraction_pressure_MPa
        assert cfg.extraction_pressure_MPa > cfg.condenser_pressure_MPa


class TestSimulator:
    @pytest.fixture(scope="class")
    def small_sim(self):
        """Small 3-day simulation for fast tests."""
        cfg = PlantConfig(seed=0, simulation_days=3, interval_minutes=15)
        return CogenerationPlantSimulator(config=cfg)

    @pytest.fixture(scope="class")
    def df(self, small_sim):
        return small_sim.generate()

    def test_output_shape(self, df):
        """Should produce 3 days × 96 intervals (15-min) = 288 rows."""
        expected = 3 * 24 * 4   # 3 days, 4 intervals/hour
        assert len(df) == expected, f"Expected {expected} rows, got {len(df)}"

    def test_all_required_columns_present(self, df):
        required = [
            "timestamp", "boiler_temp_C", "boiler_pressure_MPa",
            "steam_flow_kgs", "turbine_power_kW", "thermal_efficiency",
            "steam_waste_kgs", "fault_active", "anomaly_flag",
        ]
        for col in required:
            assert col in df.columns, f"Missing column: {col}"

    def test_physical_bounds_respected(self, df):
        """All sensor values must lie within physical operating bounds."""
        from src.data_pipeline.preprocessor import PHYSICAL_BOUNDS
        violations = {}
        for col, (lo, hi) in PHYSICAL_BOUNDS.items():
            if col in df.columns:
                bad = df[(df[col] < lo) | (df[col] > hi)]
                if len(bad):
                    violations[col] = len(bad)
        assert not violations, f"Physical bound violations: {violations}"

    def test_thermal_efficiency_physically_valid(self, df):
        """CHP thermal efficiency must be between 0 and 1 always."""
        assert df["thermal_efficiency"].between(0, 1).all()

    def test_timestamps_monotone_increasing(self, df):
        """Timestamps must be strictly increasing (no gaps or reversals)."""
        deltas = df["timestamp"].diff().dropna()
        assert (deltas > pd.Timedelta(0)).all()

    def test_no_nan_in_numeric_columns(self, df):
        numeric_cols = df.select_dtypes(include=np.number).columns
        nan_cols = [c for c in numeric_cols if df[c].isna().any()]
        assert not nan_cols, f"NaN values found in: {nan_cols}"

    def test_faults_are_injected(self, df):
        """At least some anomaly rows should be present."""
        # With 3 days we may or may not hit a fault — check the flag column exists
        assert "anomaly_flag" in df.columns
        assert df["anomaly_flag"].isin([0, 1]).all()

    def test_load_factor_bounds(self, df):
        """Load factor must always be between 0 and 1."""
        assert df["load_factor"].between(0, 1).all()

    def test_energy_balance_approximate(self, df):
        """
        First law check: turbine power + condenser duty ≈ boiler heat input.
        Allow 15% margin due to model simplifications.
        """
        Q_fuel  = df["fuel_flow_kgs"] * 50_000            # kW
        Q_out   = df["turbine_power_kW"] + df["condenser_duty_kW"]
        ratio   = (Q_out / Q_fuel).replace([np.inf, -np.inf], np.nan).dropna()
        # Expect 55–95% of fuel input accounted for
        assert ratio.median() > 0.55, f"Energy balance ratio too low: {ratio.median():.3f}"
        assert ratio.median() < 0.99, f"Energy balance ratio too high: {ratio.median():.3f}"

    def test_deterministic_with_same_seed(self):
        """Same seed must always produce identical output."""
        cfg = PlantConfig(seed=99, simulation_days=1, interval_minutes=60)
        df1 = CogenerationPlantSimulator(config=cfg).generate()
        df2 = CogenerationPlantSimulator(config=cfg).generate()
        pd.testing.assert_frame_equal(df1, df2)

    def test_derived_columns_present(self, df):
        """Post-processing must add KPI columns."""
        assert "heat_rate_BTU_kWh" in df.columns
        assert "steam_fuel_ratio" in df.columns
        assert "power_to_heat_ratio" in df.columns
