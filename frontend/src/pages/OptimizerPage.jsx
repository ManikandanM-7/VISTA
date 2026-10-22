import { useState } from "react";
import { Zap, Play, RefreshCw, Sparkles, TrendingUp, TrendingDown } from "lucide-react";

const API = "http://localhost:8000";

const SCENARIOS = [
  { id:"peak_demand",         emoji:"⚡", label:"Peak Demand",    desc:"Maximize turbine power output"    },
  { id:"efficiency",          emoji:"♻️", label:"Max Efficiency", desc:"Best thermal efficiency ratio"    },
  { id:"low_demand",          emoji:"🌙", label:"Off-Peak",       desc:"Low demand, safe operation"       },
  { id:"steam_minimization",  emoji:"💧", label:"Min Steam Waste",desc:"Reduce steam losses"              },
  { id:"maintenance_mode",    emoji:"🔧", label:"Maintenance",    desc:"Safe low-temperature ramp-down"  },
];

const PARAMS = {
  boiler_temp_C:       { label:"Boiler Temperature", unit:"°C"   },
  boiler_pressure_MPa: { label:"Boiler Pressure",    unit:"MPa"  },
  fuel_flow_kgs:       { label:"Fuel Flow Rate",     unit:"kg/s" },
  steam_valve_pct:     { label:"Steam Valve",        unit:"%"    },
};

function Delta({ v }) {
  if (v == null || Math.abs(v) < 0.0001) return <span style={{ fontSize:11, color:"#94a3b8" }}>—</span>;
  const pos = v > 0;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:99,
      background: pos ? "#d1fae5":"#fee2e2", color: pos ? "#065f46":"#991b1b" }}>
      {pos ? <TrendingUp size={9}/> : <TrendingDown size={9}/>}
      {pos?"+":""}{v.toFixed(3)}
    </span>
  );
}

export default function OptimizerPage() {
  const [scenario, setScenario] = useState(null);
  const [demand,   setDemand]   = useState(8000);
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [wiParam,  setWiParam]  = useState("boiler_temp_C");
  const [wiDelta,  setWiDelta]  = useState(10);
  const [wiRes,    setWiRes]    = useState(null);
  const [wiLoad,   setWiLoad]   = useState(false);

  async function run() {
    setLoading(true); setResult(null);
    try {
      const r = await fetch(`${API}/optimizer/run`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(scenario ? { scenario } : { power_demand_kW: demand })
      });
      setResult(await r.json());
    } catch { setResult({ error:"Cannot reach API on port 8000." }); }
    setLoading(false);
  }

  async function whatIf() {
    setWiLoad(true);
    try {
      const r = await fetch(`${API}/optimizer/what-if`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ parameter: wiParam, change_value: parseFloat(wiDelta) })
      });
      setWiRes(await r.json());
    } catch { setWiRes({ error:"Cannot reach API." }); }
    setWiLoad(false);
  }

  return (
    <div style={{ padding:"24px 32px", display:"flex", flexDirection:"column", gap:18 }}>

      {/* ── Header ── */}
      <div>
        <h1 style={{ fontSize:24, fontWeight:800, color:"#0f172a", letterSpacing:"-0.03em" }}>Optimization Engine</h1>
        <p style={{ fontSize:13, color:"#64748b", marginTop:3 }}>SLSQP multi-objective setpoint optimizer with physics constraints</p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"300px 1fr", gap:20, alignItems:"start" }}>

        {/* ── Config Panel ── */}
        <div className="g-card-strong" style={{ padding:22, display:"flex", flexDirection:"column", gap:18 }}>
          <div style={{ fontSize:14, fontWeight:700, color:"#334155", display:"flex", alignItems:"center", gap:7 }}>
            <Zap size={15} color="#6366f1" /> Configuration
          </div>

          <div>
            <div className="sec-label" style={{ marginBottom:6 }}>Power Demand (kW)</div>
            <div style={{ position:"relative" }}>
              <input type="number" className="g-input mono"
                style={{ fontWeight:600, fontSize:16, paddingRight:36 }}
                value={demand} min={3000} max={11000} step={100}
                onChange={e => { setDemand(+e.target.value); setScenario(null); }} />
              <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", fontSize:11, color:"#94a3b8" }}>kW</span>
            </div>
          </div>

          <div>
            <div className="sec-label" style={{ marginBottom:8 }}>Scenario Presets</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {SCENARIOS.map(s => (
                <button key={s.id} className={`scenario-btn${scenario===s.id?" sel":""}`}
                  onClick={() => setScenario(scenario===s.id ? null : s.id)}>
                  <span style={{ fontSize:18, flexShrink:0 }}>{s.emoji}</span>
                  <div>
                    <div className="sc-title">{s.label}</div>
                    <div className="sc-desc">{s.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <button className="btn-primary" onClick={run} disabled={loading}
            style={{ padding:"12px 0", width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            {loading
              ? <RefreshCw size={15} style={{ animation:"spin 1s linear infinite" }} />
              : <Play size={15} />}
            {loading ? "Optimizing…" : "Run Optimizer"}
          </button>
        </div>

        {/* ── Results Panel ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {!result && !loading && (
            <div className="g-card" style={{ padding:64, textAlign:"center" }}>
              <Sparkles size={42} style={{ margin:"0 auto 12px", color:"#c7d2fe" }} />
              <p style={{ color:"#64748b", fontWeight:500, fontSize:15 }}>
                Configure parameters and click <strong style={{ color:"#6366f1" }}>Run Optimizer</strong>
              </p>
              <p style={{ color:"#94a3b8", fontSize:12, marginTop:6 }}>
                SLSQP solver · 4 decision variables · physics bounds · multi-objective
              </p>
            </div>
          )}

          {loading && (
            <div className="g-card" style={{ padding:64, textAlign:"center" }}>
              <div style={{ width:40, height:40, border:"4px solid #e0e7ff", borderTopColor:"#6366f1", borderRadius:"50%", animation:"spin 1s linear infinite", margin:"0 auto 12px" }} />
              <p style={{ color:"#64748b" }}>Running SLSQP optimization…</p>
            </div>
          )}

          {result && !result.error && (
            <>
              {/* Savings */}
              {result.estimated_savings && (
                <div className="g-card-strong" style={{ padding:20 }}>
                  <div className="sec-label" style={{ marginBottom:12 }}>Estimated Savings</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
                    {Object.entries(result.estimated_savings).map(([k,v]) => (
                      <div key={k} style={{ background:"linear-gradient(135deg,#ecfdf5,#d1fae5)", border:"1px solid #6ee7b7", borderRadius:12, padding:"12px 14px", textAlign:"center" }}>
                        <div className="mono" style={{ fontSize:18, fontWeight:700, color:"#065f46" }}>
                          {typeof v==="number" ? (v>0?"+":"")+v.toFixed(4) : String(v)}
                        </div>
                        <div style={{ fontSize:11, color:"#059669", marginTop:4 }}>{k.replace(/_/g," ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Optimal setpoints */}
              {result.optimal_setpoints && (
                <div className="g-card-strong" style={{ padding:20 }}>
                  <div className="sec-label" style={{ marginBottom:12 }}>Optimal Setpoints</div>
                  {Object.entries(result.optimal_setpoints).map(([k,v]) => {
                    const m = PARAMS[k] || { label:k, unit:"" };
                    return (
                      <div key={k} style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:12, alignItems:"center", padding:"10px 12px", borderRadius:10, background:"rgba(99,102,241,0.04)", marginBottom:6 }}>
                        <span style={{ fontSize:13, fontWeight:500, color:"#334155" }}>{m.label}</span>
                        <span className="mono" style={{ fontSize:14, fontWeight:700, color:"#6366f1" }}>
                          {v.toFixed(3)} <span style={{ fontSize:11, color:"#94a3b8" }}>{m.unit}</span>
                        </span>
                        <Delta v={0} />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Predicted KPIs */}
              {result.predicted_kpis && (
                <div className="g-card-strong" style={{ padding:20 }}>
                  <div className="sec-label" style={{ marginBottom:12 }}>Predicted KPIs After Optimization</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
                    {Object.entries(result.predicted_kpis).map(([k,v]) => (
                      <div key={k} style={{ background:"rgba(99,102,241,0.05)", border:"1px solid rgba(99,102,241,0.12)", borderRadius:12, padding:"12px 14px", textAlign:"center" }}>
                        <div className="mono" style={{ fontSize:17, fontWeight:700, color:"#6366f1" }}>{typeof v==="number" ? v.toFixed(4) : String(v)}</div>
                        <div style={{ fontSize:11, color:"#64748b", marginTop:4 }}>{k.replace(/_/g," ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status bar */}
              <div style={{ borderRadius:12, padding:"10px 16px", fontSize:12, fontWeight:500, display:"flex", gap:8, alignItems:"center",
                background: result.success ? "#ecfdf5" : "#fef9c3",
                border: `1px solid ${result.success ? "#6ee7b7":"#fcd34d"}`,
                color: result.success ? "#065f46":"#92400e" }}>
                <span>{result.success ? "✓ Converged" : "⚠ Partial solution"}</span>
                <span style={{ color:"#94a3b8" }}>·</span>
                <span>{result.message}</span>
                <span style={{ marginLeft:"auto", color:"#94a3b8" }}>Solved in {result.solve_time_s}s</span>
              </div>
            </>
          )}

          {result?.error && (
            <div className="g-card" style={{ padding:20, color:"#ef4444", fontSize:14, border:"1px solid #fca5a5", background:"#fff1f2" }}>
              ⚠️ {result.error}
            </div>
          )}
        </div>
      </div>

      {/* ── What-If Simulator ── */}
      <div className="g-card-strong" style={{ padding:22 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"#334155", marginBottom:16 }}>
          ⚗️ What-If Simulator
          <span style={{ fontSize:12, fontWeight:400, color:"#94a3b8", marginLeft:8 }}>Simulate the impact of a single parameter change</span>
        </div>
        <div style={{ display:"flex", gap:14, alignItems:"flex-end", flexWrap:"wrap" }}>
          <div style={{ flex:1, minWidth:160 }}>
            <div className="sec-label" style={{ marginBottom:6 }}>Parameter</div>
            <select className="g-input" value={wiParam} onChange={e=>setWiParam(e.target.value)}>
              {Object.entries(PARAMS).map(([k,m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </div>
          <div style={{ width:130 }}>
            <div className="sec-label" style={{ marginBottom:6 }}>Delta Change</div>
            <input type="number" step={0.5} className="g-input mono" value={wiDelta} onChange={e=>setWiDelta(e.target.value)} />
          </div>
          <button className="btn-purple" onClick={whatIf} disabled={wiLoad}
            style={{ padding:"10px 22px", display:"flex", alignItems:"center", gap:7, flexShrink:0 }}>
            {wiLoad ? <RefreshCw size={14} style={{ animation:"spin 1s linear infinite" }}/> : <Sparkles size={14}/>}
            {wiLoad ? "Simulating…" : "Simulate"}
          </button>
        </div>
        {wiRes && !wiRes.error && (
          <div style={{ marginTop:16, display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10 }}>
            {Object.entries(wiRes.predicted_kpis||{}).map(([k,v]) => (
              <div key={k} style={{ background:"rgba(255,255,255,.70)", border:"1px solid #e0e7ff", borderRadius:12, padding:"12px 14px", textAlign:"center" }}>
                <div style={{ fontSize:11, color:"#64748b", marginBottom:6 }}>{k.replace(/_/g," ")}</div>
                <div className="mono" style={{ fontSize:16, fontWeight:700, color:"#6366f1" }}>{v.toFixed(4)}</div>
              </div>
            ))}
          </div>
        )}
        {wiRes?.error && <div style={{ marginTop:12, color:"#ef4444", fontSize:13 }}>{wiRes.error}</div>}
      </div>

    </div>
  );
}
