import { useState, useEffect, useRef } from "react";
import ReactECharts from "echarts-for-react";
import { Thermometer, Zap, Activity, Droplets, Radio, Cpu, Wind, Gauge, Flame, Waves, BarChart3 } from "lucide-react";

const API = "http://localhost:8000";
const WS  = "ws://localhost:8000/ws/live";

const KPIS = [
  { key:"boiler_temp_C",          label:"Boiler Temp",   unit:"C",    Icon:Thermometer, grad:"linear-gradient(135deg,#f59e0b,#ef4444)", shadow:"rgba(245,158,11,0.4)", mult:1   },
  { key:"turbine_power_kW",       label:"Turbine Power", unit:"kW",   Icon:Zap,         grad:"linear-gradient(135deg,#6366f1,#8b5cf6)", shadow:"rgba(99,102,241,0.4)", mult:1   },
  { key:"thermal_efficiency",     label:"Thermal Eff",   unit:"%",    Icon:Activity,    grad:"linear-gradient(135deg,#10b981,#059669)", shadow:"rgba(16,185,129,0.4)", mult:100 },
  { key:"steam_waste_kgs",        label:"Steam Waste",   unit:"kg/s", Icon:Droplets,    grad:"linear-gradient(135deg,#ef4444,#dc2626)", shadow:"rgba(239,68,68,0.4)",  mult:1   },
  { key:"vibration_turbine_mm_s", label:"Vibration",     unit:"mm/s", Icon:Radio,       grad:"linear-gradient(135deg,#a855f7,#7c3aed)", shadow:"rgba(168,85,247,0.4)", mult:1   },
];

const STATS = [
  { label:"24h Avg Thermal Eff",  key:"avg_thermal_efficiency_pct", unit:"%",  Icon:Activity,  grad:"linear-gradient(135deg,#10b981,#059669)" },
  { label:"24h Total Steam Waste",key:"total_steam_waste_kg",        unit:"kg", Icon:Droplets,  grad:"linear-gradient(135deg,#ef4444,#dc2626)" },
  { label:"24h Avg Power",        key:"avg_turbine_power_kW",        unit:"kW", Icon:Zap,       grad:"linear-gradient(135deg,#6366f1,#8b5cf6)" },
  { label:"24h Anomalies",        key:"anomaly_count_24h",           unit:"",   Icon:BarChart3, grad:"linear-gradient(135deg,#f59e0b,#d97706)" },
];

const CHARTS = [
  { key:"turbine_power_kW",   label:"Turbine Power (kW)",     mult:1,   c1:"#6366f1", c2:"#a5b4fc" },
  { key:"thermal_efficiency", label:"Thermal Efficiency (%)", mult:100, c1:"#10b981", c2:"#6ee7b7" },
  { key:"steam_waste_kgs",    label:"Steam Waste (kg/s)",     mult:1,   c1:"#ef4444", c2:"#fca5a5" },
  { key:"boiler_temp_C",      label:"Boiler Temp (C)",        mult:1,   c1:"#f59e0b", c2:"#fde68a" },
];

const SENSOR_META = {
  boiler_temp_C:              { label:"Boiler Temp",         unit:"C",    Icon:Thermometer, grad:"linear-gradient(135deg,#f59e0b,#ef4444)" },
  boiler_pressure_MPa:        { label:"Boiler Pressure",     unit:"MPa",  Icon:Gauge,       grad:"linear-gradient(135deg,#f97316,#ea580c)" },
  steam_flow_kgs:             { label:"Steam Flow",          unit:"kg/s", Icon:Wind,        grad:"linear-gradient(135deg,#06b6d4,#0284c7)" },
  fuel_flow_kgs:              { label:"Fuel Flow",           unit:"kg/s", Icon:Flame,       grad:"linear-gradient(135deg,#ef4444,#991b1b)" },
  turbine_power_kW:           { label:"Turbine Power",       unit:"kW",   Icon:Zap,         grad:"linear-gradient(135deg,#6366f1,#8b5cf6)" },
  process_steam_flow_kgs:     { label:"Process Steam",       unit:"kg/s", Icon:Waves,       grad:"linear-gradient(135deg,#0ea5e9,#0369a1)" },
  condenser_duty_kW:          { label:"Condenser Duty",      unit:"kW",   Icon:Activity,    grad:"linear-gradient(135deg,#8b5cf6,#6d28d9)" },
  thermal_efficiency:         { label:"Thermal Eff",         unit:"%",    Icon:Activity,    grad:"linear-gradient(135deg,#10b981,#059669)", mult:100 },
  electrical_efficiency:      { label:"Electrical Eff",      unit:"%",    Icon:Cpu,         grad:"linear-gradient(135deg,#3b82f6,#1d4ed8)", mult:100 },
  steam_waste_kgs:            { label:"Steam Waste",         unit:"kg/s", Icon:Droplets,    grad:"linear-gradient(135deg,#ef4444,#dc2626)" },
  boiler_efficiency:          { label:"Boiler Efficiency",   unit:"%",    Icon:Flame,       grad:"linear-gradient(135deg,#f59e0b,#b45309)", mult:100 },
  exhaust_temp_C:             { label:"Exhaust Temp",        unit:"C",    Icon:Thermometer, grad:"linear-gradient(135deg,#64748b,#334155)" },
  vibration_turbine_mm_s:     { label:"Vibration",           unit:"mm/s", Icon:Radio,       grad:"linear-gradient(135deg,#a855f7,#7c3aed)" },
  lube_oil_temp_C:            { label:"Lube Oil Temp",       unit:"C",    Icon:Gauge,       grad:"linear-gradient(135deg,#84cc16,#4d7c0f)" },
  condenser_pressure_MPa:     { label:"Condenser Pressure",  unit:"MPa",  Icon:Gauge,       grad:"linear-gradient(135deg,#06b6d4,#0e7490)" },
  ambient_temp_C:             { label:"Ambient Temp",        unit:"C",    Icon:Thermometer, grad:"linear-gradient(135deg,#34d399,#059669)" },
  load_factor:                { label:"Load Factor",         unit:"",     Icon:BarChart3,   grad:"linear-gradient(135deg,#f59e0b,#d97706)" },
  pred_thermal_efficiency:    { label:"Pred Thermal Eff",    unit:"%",    Icon:Activity,    grad:"linear-gradient(135deg,#7c3aed,#4c1d95)", isPred:true, mult:100 },
  pred_electrical_efficiency: { label:"Pred Electrical Eff", unit:"%",    Icon:Cpu,         grad:"linear-gradient(135deg,#5b21b6,#3730a3)", isPred:true, mult:100 },
  pred_turbine_power_kW:      { label:"Pred Turbine Power",  unit:"kW",   Icon:Zap,         grad:"linear-gradient(135deg,#4f46e5,#3730a3)", isPred:true },
  pred_steam_waste_kgs:       { label:"Pred Steam Waste",    unit:"kg/s", Icon:Droplets,    grad:"linear-gradient(135deg,#be185d,#9f1239)", isPred:true },
};

function chartOpt(data, key, mult, c1, c2) {
  const n = data.length;
  const vals = data.map(d => { const v = d[key]; return typeof v === "number" ? +(v * mult).toFixed(4) : null; });
  const step = Math.max(1, Math.floor(n / 5));
  const labels = data.map((_, i) => {
    if (i % step === 0) { const d = new Date(Date.now() - (n - i) * 1000); return `${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}`; }
    return "";
  });
  return {
    backgroundColor:"transparent", animation:false,
    tooltip:{ trigger:"axis", axisPointer:{ lineStyle:{ color:c1+"88", width:1.5 } }, backgroundColor:"rgba(15,23,42,0.85)", borderColor:"transparent", textStyle:{ color:"#f1f5f9", fontSize:12 } },
    grid:{ left:44, right:8, top:8, bottom:22 },
    xAxis:{ type:"category", data:labels, axisLabel:{ color:"rgba(100,116,139,0.7)", fontSize:10 }, axisLine:{ lineStyle:{ color:"rgba(226,232,240,0.5)" } }, axisTick:{ show:false }, splitLine:{ show:false } },
    yAxis:{ type:"value", axisLabel:{ color:"rgba(100,116,139,0.7)", fontSize:10 }, splitLine:{ lineStyle:{ color:"rgba(241,245,249,0.8)", type:"dashed" } } },
    series:[{ data:vals, type:"line", smooth:0.4, symbol:"none",
      lineStyle:{ color:c1, width:2.5, shadowColor:c1+"66", shadowBlur:8 },
      areaStyle:{ color:{ type:"linear",x:0,y:0,x2:0,y2:1, colorStops:[{ offset:0, color:c1+"55" },{ offset:1, color:c2+"08" }] }}
    }]
  };
}

const glass = {
  background:"rgba(255,255,255,0.55)",
  backdropFilter:"blur(24px) saturate(180%)",
  WebkitBackdropFilter:"blur(24px) saturate(180%)",
  border:"1px solid rgba(255,255,255,0.65)",
  borderRadius:20,
  boxShadow:"0 8px 32px rgba(31,38,135,0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
};

const glassPanel = { ...glass, background:"rgba(255,255,255,0.45)", border:"1px solid rgba(255,255,255,0.55)" };

export default function LiveTwin() {
  const [live,    setLive]    = useState({});
  const [hist,    setHist]    = useState([]);
  const [kpis,    setKpis]    = useState({});
  const [wsAlive, setWsAlive] = useState(false);
  const histRef = useRef([]);
  const wsRef   = useRef(null);

  useEffect(() => {
    fetch(`${API}/plant/kpis`).then(r=>r.json()).then(setKpis).catch(()=>{});
    fetch(`${API}/plant/sensors/history`).then(r=>r.json()).then(d=>{
      if (Array.isArray(d)) { histRef.current = d.slice(-60); setHist([...histRef.current]); }
    }).catch(()=>{});
    const connect = () => {
      const s = new WebSocket(WS);
      wsRef.current = s;
      s.onopen  = () => setWsAlive(true);
      s.onclose = () => { setWsAlive(false); setTimeout(connect, 3000); };
      s.onerror = () => s.close();
      s.onmessage = e => {
        const d = JSON.parse(e.data);
        setLive(d);
        histRef.current = [...histRef.current.slice(-59), { ...d, _t:Date.now() }];
        setHist([...histRef.current]);
      };
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  const sensorEntries = Object.entries(live).filter(([k]) => !["fault_active","anomaly_flag","live_anomaly","_t"].includes(k));

  return (
    <div style={{ padding:"24px 28px", display:"flex", flexDirection:"column", gap:18 }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:800, color:"#0f172a", letterSpacing:"-0.03em", margin:0 }}>Live Digital Twin</h1>
          <p style={{ fontSize:13, color:"#64748b", marginTop:4, margin:0 }}>Real-time cogeneration plant telemetry — 1 Hz WebSocket feed</p>
        </div>
        <div style={{ ...glass, padding:"8px 18px", display:"flex", alignItems:"center", gap:8, borderRadius:99 }}>
          <div className="pulse-anim" style={{ width:8, height:8, borderRadius:"50%", background: wsAlive ? "#10b981" : "#94a3b8", boxShadow: wsAlive ? "0 0 0 2px rgba(16,185,129,0.25), 0 0 8px #10b981" : "none" }}/>
          <span style={{ fontSize:13, fontWeight:600, color: wsAlive ? "#059669":"#94a3b8" }}>{wsAlive ? "Live Feed" : "Reconnecting..."}</span>
        </div>
      </div>

      {/* 5 KPI Cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:14 }}>
        {KPIS.map(({ key, label, unit, Icon, grad, shadow, mult }) => {
          const raw = live[key]; const val = raw != null ? raw * mult : null;
          const disp = val != null ? val.toFixed(mult === 100 ? 1 : 2) : "--";
          return (
            <div key={key} style={{ ...glass, padding:"20px 18px", display:"flex", flexDirection:"column", gap:14, transition:"transform 0.2s, box-shadow 0.2s", cursor:"default" }}
              onMouseEnter={e => { e.currentTarget.style.transform="translateY(-4px)"; e.currentTarget.style.boxShadow=`0 20px 48px ${shadow}, inset 0 1px 0 rgba(255,255,255,0.9)`; }}
              onMouseLeave={e => { e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow=glass.boxShadow; }}>
              <div style={{ width:48, height:48, borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", background:grad, boxShadow:`0 6px 18px ${shadow}` }}>
                <Icon size={22} color="white" strokeWidth={1.8} />
              </div>
              <div>
                <div style={{ fontSize:10.5, color:"#64748b", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>{label}</div>
                <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                  <span style={{ fontSize:26, fontWeight:800, color:"#0f172a", lineHeight:1, fontVariantNumeric:"tabular-nums" }}>{disp}</span>
                  <span style={{ fontSize:12, color:"#94a3b8", fontWeight:600 }}>{unit}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4 Summary Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
        {STATS.map(({ label, key, unit, Icon, grad }) => {
          const val = kpis[key]; const disp = val != null ? (typeof val==="number" ? val.toFixed(1) : val) : "--";
          return (
            <div key={key} style={{ ...glass, padding:"16px 18px", display:"flex", alignItems:"center", gap:14 }}>
              <div style={{ width:44, height:44, borderRadius:13, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", background:grad, boxShadow:"0 4px 14px rgba(0,0,0,0.12)" }}>
                <Icon size={18} color="white" strokeWidth={1.8}/>
              </div>
              <div>
                <div style={{ fontSize:10.5, color:"#64748b", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 }}>{label}</div>
                <div style={{ fontSize:20, fontWeight:800, color:"#0f172a", fontVariantNumeric:"tabular-nums" }}>
                  {disp}<span style={{ fontSize:12, color:"#94a3b8", fontWeight:600, marginLeft:3 }}>{unit}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 2x2 Charts */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        {CHARTS.map(({ key, label, mult, c1, c2 }) => {
          const last = hist.length ? hist[hist.length-1]?.[key] : null;
          return (
            <div key={key} style={{ ...glassPanel, padding:"18px 20px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:c1, flexShrink:0, boxShadow:`0 0 6px ${c1}` }}/>
                <span style={{ fontSize:13, fontWeight:700, color:"#1e293b" }}>{label}</span>
                {last != null && <span style={{ marginLeft:"auto", fontSize:12, fontWeight:700, color:c1, fontVariantNumeric:"tabular-nums" }}>{(last * mult).toFixed(mult===100 ? 1 : 3)}</span>}
              </div>
              <ReactECharts option={chartOpt(hist, key, mult, c1, c2)} style={{ height:160 }} opts={{ renderer:"canvas" }} notMerge={false} lazyUpdate={true} />
            </div>
          );
        })}
      </div>

      {/* Live Telemetry Matrix — all sensors */}
      <div style={{ ...glassPanel, padding:"22px 24px" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:20 }}>
          <div className="pulse-anim" style={{ width:9, height:9, borderRadius:"50%", marginRight:10, background:"#10b981", boxShadow:"0 0 0 3px rgba(16,185,129,0.15), 0 0 10px #10b981" }}/>
          <span style={{ fontSize:16, fontWeight:800, color:"#0f172a", letterSpacing:"-0.02em" }}>Live Telemetry Matrix</span>
          <div style={{ marginLeft:"auto", fontSize:11, fontWeight:700, color:"#059669", background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.25)", padding:"4px 12px", borderRadius:99 }}>~1Hz Stream</div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(165px, 1fr))", gap:12 }}>
          {sensorEntries.map(([k, v]) => {
            const meta    = SENSOR_META[k];
            const isPred  = meta?.isPred || k.startsWith("pred_");
            const label   = meta?.label  || k.replace(/_/g," ");
            const unit    = meta?.unit   || "";
            const grad    = meta?.grad   || (isPred ? "linear-gradient(135deg,#7c3aed,#4c1d95)" : "linear-gradient(135deg,#475569,#334155)");
            const mult    = meta?.mult   || 1;
            const Icon    = meta?.Icon   || Cpu;
            const numVal  = typeof v === "number" ? v * mult : null;
            const displayVal = numVal !== null ? numVal.toFixed(Math.abs(mult) > 1 ? 1 : 3) : String(v);

            return (
              <div key={k} style={{
                  background: isPred ? "rgba(124,58,237,0.06)" : "rgba(255,255,255,0.55)",
                  backdropFilter:"blur(16px) saturate(180%)",
                  WebkitBackdropFilter:"blur(16px) saturate(180%)",
                  border: isPred ? "1px solid rgba(124,58,237,0.2)" : "1px solid rgba(255,255,255,0.7)",
                  borderRadius:16, padding:"14px 14px",
                  display:"flex", flexDirection:"column", gap:10,
                  boxShadow:"0 4px 14px rgba(31,38,135,0.05), inset 0 1px 0 rgba(255,255,255,0.6)",
                  transition:"transform 0.18s ease, box-shadow 0.18s ease", cursor:"default",
                }}
                onMouseEnter={e => { e.currentTarget.style.transform="translateY(-3px) scale(1.02)"; e.currentTarget.style.boxShadow="0 14px 36px rgba(31,38,135,0.12), inset 0 1px 0 rgba(255,255,255,0.7)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform="translateY(0) scale(1)"; e.currentTarget.style.boxShadow="0 4px 14px rgba(31,38,135,0.05), inset 0 1px 0 rgba(255,255,255,0.6)"; }}
              >
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:28, height:28, borderRadius:8, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", background:grad, boxShadow:"0 3px 8px rgba(0,0,0,0.18)" }}>
                    <Icon size={13} color="white" strokeWidth={2.2}/>
                  </div>
                  <span style={{ fontSize:10, fontWeight:700, color: isPred ? "#7c3aed" : "#64748b", textTransform:"uppercase", letterSpacing:"0.05em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {isPred ? "AI " : ""}{label}
                  </span>
                </div>
                <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
                  <span style={{ fontSize:19, fontWeight:800, lineHeight:1, fontVariantNumeric:"tabular-nums", color: typeof v==="string"&&v!=="none" ? "#ef4444" : isPred ? "#7c3aed" : "#0f172a" }}>
                    {displayVal}
                  </span>
                  {unit && <span style={{ fontSize:10, fontWeight:600, color:"#94a3b8" }}>{unit}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
