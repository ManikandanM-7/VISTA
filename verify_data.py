import pandas as pd

df = pd.read_csv('data/raw/plant_sensors.csv')
print(f'Rows: {len(df):,}')
print(f'Columns ({len(df.columns)}): {list(df.columns)}')
print(f'Anomaly rows: {(df["anomaly_flag"]==1).sum():,}')
print(f'Unique faults: {df["fault_active"].unique()}')
print(f'Date range: {df["timestamp"].min()} to {df["timestamp"].max()}')
print()
print(df[['timestamp','boiler_temp_C','turbine_power_kW',
          'thermal_efficiency','steam_waste_kgs','fault_active']].tail(5).to_string())
print()
print("--- Stats ---")
print(df[['boiler_temp_C','turbine_power_kW','thermal_efficiency','steam_waste_kgs']].describe().round(3))
