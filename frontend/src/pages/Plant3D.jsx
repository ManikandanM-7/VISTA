import { useState, useEffect, useRef, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Environment, Html, Edges } from "@react-three/drei";
import { Send, MousePointer2, Move, ZoomIn, RefreshCw, AlertTriangle, Info, AlertCircle, Loader2 } from "lucide-react";

const API = "http://localhost:8000";
const WS  = "ws://localhost:8000/ws/live";

/* ─────────── helpers ─────────── */
const SEV_CONFIG = {
  critical: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", headerBg: "#991b1b", Icon: AlertTriangle },
  moderate: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", headerBg: "rgba(245,158,11,0.25)", Icon: AlertCircle },
  minor:    { color: "#10b981", bg: "rgba(16,185,129,0.08)", headerBg: "rgba(16,185,129,0.25)", Icon: Info },
  none:     { color: "#94a3b8", bg: "rgba(148,163,184,0.08)", headerBg: "rgba(148,163,184,0.25)", Icon: Info },
};

/* Asset → live-data fields mapping */
const ASSET_FIELDS = {
  boiler:  [
    { label: "Temp",       key: "boiler_temp_C",       unit: "°C",   fmt: v => v.toFixed(1) },
    { label: "Pressure",   key: "boiler_pressure_MPa", unit: "bar",  fmt: v => (v * 10).toFixed(1) },
    { label: "Efficiency", key: "boiler_efficiency",   unit: "%",    fmt: v => (v * 100).toFixed(1) },
    { label: "Steam Flow", key: "steam_flow_kgs",      unit: "kg/s", fmt: v => v.toFixed(3) },
  ],
  turbine: [
    { label: "Power Out",  key: "turbine_power_kW",       unit: "kW",   fmt: v => v.toFixed(1) },
    { label: "Vibration",  key: "vibration_turbine_mm_s", unit: "mm/s", fmt: v => v.toFixed(3) },
    { label: "Elec. Eff",  key: "electrical_efficiency",  unit: "%",    fmt: v => (v * 100).toFixed(1) },
    { label: "Exhaust T",  key: "exhaust_temp_C",         unit: "°C",   fmt: v => v.toFixed(1) },
  ],
  pump: [
    { label: "Thermal Eff",key: "thermal_efficiency",  unit: "%",    fmt: v => (v * 100).toFixed(1) },
    { label: "Process Steam",key:"process_steam_flow_kgs",unit:"kg/s",fmt: v => v.toFixed(3) },
    { label: "Steam Waste",key: "steam_waste_kgs",     unit: "kg/s", fmt: v => v.toFixed(3) },
    { label: "Load Factor",key: "load_factor",         unit: "",     fmt: v => v.toFixed(3) },
  ],
};
const ASSET_NAMES = { boiler: "BOILER 1", turbine: "TURBINE A", pump: "PUMP C" };

/* ─────────── 3-D sub-components ─────────── */
function GlowingBox({ size, color }) {
  return (
    <mesh>
      <boxGeometry args={size} />
      <meshBasicMaterial color={color} transparent opacity={0.08} />
      <Edges scale={1.05} threshold={15} color={color} />
    </mesh>
  );
}

function AlertPin({ position, icon: Icon, color, text }) {
  return (
    <Html position={position} center zIndexRange={[100, 0]}>
      <div style={{
        display:"flex", alignItems:"center", gap:8,
        background:"rgba(10,14,20,0.88)", backdropFilter:"blur(4px)",
        border:`1.5px solid ${color}`, borderRadius:4,
        padding:"5px 11px", color, fontFamily:"sans-serif",
        fontWeight:"bold", fontSize:11, whiteSpace:"nowrap",
        boxShadow:`0 0 15px ${color}44`, pointerEvents:"none"
      }}>
        <div style={{ background:color, color:"#111", borderRadius:"50%", width:18, height:18, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon size={12} strokeWidth={3} />
        </div>
        {text}
      </div>
    </Html>
  );
}

/* Clickable mesh wrapper */
function SelectableMesh({ id, selected, onSelect, children, ...props }) {
  const [hov, setHov] = useState(false);
  return (
    <mesh
      {...props}
      onClick={e => { e.stopPropagation(); onSelect(id); }}
      onPointerOver={e => { e.stopPropagation(); setHov(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={e => { setHov(false); document.body.style.cursor = "default"; }}
    >
      {children}
    </mesh>
  );
}

function BoilerUnit({ live, selected, onSelect, anomalies }) {
  const temp = live.boiler_temp_C || 450;
  const anom = anomalies.find(a => a.asset_id === "B1" || a.anomaly_type?.toLowerCase().includes("boiler"));
  const isCritical = anom?.severity === "critical" || temp > 495;
  const color = isCritical ? "#ef4444" : selected ? "#3b82f6" : "#334155";

  return (
    <group position={[-5, 2, -2]} onClick={e => { e.stopPropagation(); onSelect("boiler"); }}>
      {/* Smokestack */}
      <mesh position={[-2, 6, -2]}>
        <cylinderGeometry args={[0.8, 1, 12, 16]} />
        <meshStandardMaterial color="#475569" roughness={0.9} />
      </mesh>
      {/* Body */}
      <SelectableMesh id="boiler" selected={selected} onSelect={onSelect} castShadow receiveShadow>
        <boxGeometry args={[4, 4, 6]} />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.4} emissive={isCritical ? "#ef4444" : selected ? "#1d4ed8" : "#000"} emissiveIntensity={isCritical ? 0.15 : selected ? 0.1 : 0} />
      </SelectableMesh>
      <mesh position={[2.1, 0, 0]} castShadow>
        <boxGeometry args={[0.5, 3, 4]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <Html position={[0, 0, 3.1]} center transform distanceFactor={15}>
        <div style={{ color:"white", background:"#111", padding:"4px 12px", border:`1px solid ${selected?"#3b82f6":"#444"}`, fontSize:24, fontWeight:"bold", cursor:"pointer" }}>BOILER 1</div>
      </Html>
      {isCritical && (
        <group>
          <GlowingBox size={[4.4, 4.4, 6.4]} color="#ef4444" />
          <AlertPin position={[0, 4, 0]} icon={AlertTriangle} color="#ef4444" text={`CRITICAL: HIGH TEMP (${temp.toFixed(1)}°C)`} />
        </group>
      )}
    </group>
  );
}

function TurbineUnit({ live, selected, onSelect, anomalies }) {
  const turbineRef = useRef();
  const power = live.turbine_power_kW || 8000;
  const vibration = live.vibration_turbine_mm_s || 0;
  const anom = anomalies.find(a => a.asset_id === "T-A" || a.anomaly_type?.toLowerCase().includes("turbine") || a.anomaly_type?.toLowerCase().includes("vibrat"));
  const isWarning = anom?.severity === "critical" || anom?.severity === "moderate" || vibration > 4.5;
  const color = isWarning ? "#f59e0b" : selected ? "#3b82f6" : "#64748b";

  useFrame((_, delta) => {
    if (turbineRef.current) turbineRef.current.rotation.x += Math.max(0.5, power / 2000) * delta;
  });

  return (
    <group position={[4, 1.5, 2]} onClick={e => { e.stopPropagation(); onSelect("turbine"); }}>
      <mesh ref={turbineRef} castShadow receiveShadow rotation={[0, 0, Math.PI/2]}>
        <cylinderGeometry args={[1.5, 1.5, 3.5, 24]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.8} emissive={isWarning ? "#f59e0b" : selected ? "#1d4ed8" : "#000"} emissiveIntensity={isWarning ? 0.12 : selected ? 0.1 : 0} />
      </mesh>
      <SelectableMesh id="turbine" selected={selected} onSelect={onSelect} position={[3.5, -0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.5, 2.6, 2.6]} />
        <meshStandardMaterial color={selected ? "#334155" : "#475569"} />
      </SelectableMesh>
      <Html position={[0, 2, 0]} center transform distanceFactor={15}>
        <div style={{ color:"white", background:"#111", padding:"4px 12px", border:`1px solid ${selected?"#3b82f6":"#444"}`, fontSize:20, fontWeight:"bold", cursor:"pointer" }}>TURBINE A</div>
      </Html>
      {isWarning && (
        <group>
          <GlowingBox size={[4.2, 3.5, 3.5]} color="#f59e0b" />
          <AlertPin position={[1, 3.5, 0]} icon={AlertCircle} color="#f59e0b" text={`WARNING: VIBRATION ${vibration.toFixed(2)} mm/s`} />
        </group>
      )}
    </group>
  );
}

function PumpUnit({ live, selected, onSelect, anomalies }) {
  const eff = live.thermal_efficiency || 0.88;
  const anom = anomalies.find(a => a.asset_id === "P-C" || a.anomaly_type?.toLowerCase().includes("pump") || a.anomaly_type?.toLowerCase().includes("effic"));
  const isInfo = anom || eff < 0.85;
  const color = isInfo ? "#eab308" : selected ? "#3b82f6" : "#475569";

  return (
    <group position={[3, 1, 8]} onClick={e => { e.stopPropagation(); onSelect("pump"); }}>
      <SelectableMesh id="pump" selected={selected} onSelect={onSelect} castShadow receiveShadow>
        <boxGeometry args={[1.5, 2, 2.5]} />
        <meshStandardMaterial color={selected ? "#1e3a5f" : "#334155"} />
      </SelectableMesh>
      <mesh position={[-1.2, -0.2, 0]} rotation={[Math.PI/2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.8, 0.8, 1, 16]} />
        <meshStandardMaterial color={color} metalness={0.6} emissive={isInfo ? "#854d0e" : "#000"} emissiveIntensity={isInfo ? 0.2 : 0} />
      </mesh>
      <Html position={[0, 1.5, 0]} center transform distanceFactor={15}>
        <div style={{ color:"white", background:"#111", padding:"2px 8px", border:`1px solid ${selected?"#3b82f6":"#444"}`, fontSize:16, fontWeight:"bold", cursor:"pointer" }}>PUMP C</div>
      </Html>
      {isInfo && (
        <AlertPin position={[0, 3, 0]} icon={Info} color="#eab308" text={`INFO: EFF ${(eff*100).toFixed(1)}%`} />
      )}
    </group>
  );
}

function Pipes() {
  const P = ({ pos, rot, len }) => (
    <mesh position={pos} rotation={rot} castShadow>
      <cylinderGeometry args={[0.25, 0.25, len, 12]} />
      <meshStandardMaterial color="#94a3b8" metalness={0.7} roughness={0.3} />
    </mesh>
  );
  return (
    <group>
      <P pos={[-2, 1, 0]}  rot={[0, 0, Math.PI/2]} len={6} />
      <P pos={[1, 1, 1]}   rot={[Math.PI/2, 0, 0]} len={2} />
      <P pos={[1, 1, 5]}   rot={[Math.PI/2, 0, 0]} len={6} />
      <P pos={[2, 1, 8]}   rot={[0, 0, Math.PI/2]} len={2} />
      <P pos={[-5, 0.5, 4]}rot={[Math.PI/2, 0, 0]} len={10} />
      <P pos={[-1, 0.5, 9]}rot={[0, 0, Math.PI/2]} len={8} />
    </group>
  );
}

function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#64748b" roughness={1} />
      </mesh>
      <gridHelper args={[100, 50, "#94a3b8", "#475569"]} position={[0, 0.01, 0]} />
      <mesh position={[-15, 3, -15]} castShadow receiveShadow><boxGeometry args={[10, 6, 20]} /><meshStandardMaterial color="#cbd5e1" /></mesh>
      <mesh position={[15, 2, -15]} castShadow receiveShadow><boxGeometry args={[20, 4, 10]} /><meshStandardMaterial color="#cbd5e1" /></mesh>
      <mesh position={[-15, 2, 15]} castShadow receiveShadow><boxGeometry args={[12, 4, 12]} /><meshStandardMaterial color="#cbd5e1" /></mesh>
    </group>
  );
}

/* Deselect on click empty ground */
function ClickCatcher({ onDeselect }) {
  const { scene } = useThree();
  return (
    <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -0.01, 0]} onClick={() => onDeselect(null)}>
      <planeGeometry args={[200, 200]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

/* ─────────── Main page ─────────── */
export default function Plant3D() {
  const [live,      setLive]      = useState({});
  const [anomalies, setAnomalies] = useState([]);
  const [selected,  setSelected]  = useState(null);   // "boiler" | "turbine" | "pump" | null
  const [sevTab,    setSevTab]    = useState("all");

  /* Chat state */
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState("");
  const [sending,  setSending]  = useState(false);
  const chatEndRef = useRef(null);
  const wsRef      = useRef(null);

  /* WebSocket — live feed */
  useEffect(() => {
    const connect = () => {
      const s = new WebSocket(WS);
      wsRef.current = s;
      s.onmessage = e => setLive(JSON.parse(e.data));
      s.onclose   = () => setTimeout(connect, 3000);
      s.onerror   = () => s.close();
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  /* Anomaly log — poll every 10 s */
  useEffect(() => {
    const fetch_ = () =>
      fetch(`${API}/anomalies/log?limit=20`)
        .then(r => r.json())
        .then(d => setAnomalies(d.events || []))
        .catch(() => {});
    fetch_();
    const id = setInterval(fetch_, 10000);
    return () => clearInterval(id);
  }, []);

  /* Auto-scroll chat */
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  /* Send chat message to real AI */
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const userMsg = { role: "user", text };
    setMessages(m => [...m, userMsg]);
    setInput("");
    setSending(true);
    try {
      const r = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const d = await r.json();
      setMessages(m => [...m, { role: "ai", text: d.response || d.message || "No response." }]);
    } catch {
      setMessages(m => [...m, { role: "ai", text: "⚠️ Could not reach AI backend." }]);
    } finally {
      setSending(false);
    }
  };

  /* Derived values */
  const efficiency = live.thermal_efficiency || 0;
  const power      = live.turbine_power_kW   || 0;
  const boilerTemp = live.boiler_temp_C       || 0;
  const pressure   = live.boiler_pressure_MPa || 0;

  const sevCounts = {
    all:      anomalies.length,
    critical: anomalies.filter(a => a.severity === "critical").length,
    moderate: anomalies.filter(a => a.severity === "moderate").length,
    minor:    anomalies.filter(a => a.severity === "minor").length,
  };
  const filteredAnomalies = sevTab === "all" ? anomalies : anomalies.filter(a => a.severity === sevTab);

  /* Asset data card based on selection */
  const assetLabel  = selected ? ASSET_NAMES[selected] : "PLANT OVERVIEW";
  const assetFields = selected ? ASSET_FIELDS[selected] : [];

  return (
    <div style={{ width:"100%", height:"calc(100vh - 64px)", position:"relative", background:"#e2e8f0", overflow:"hidden", fontFamily:"system-ui, sans-serif" }}>

      {/* ── 3D CANVAS ── */}
      <Canvas shadows camera={{ position:[-18, 15, 22], fov:40 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[20,30,10]} intensity={1.5} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} />
        <Ground />
        <BoilerUnit  live={live} anomalies={anomalies} selected={selected==="boiler"}  onSelect={setSelected} />
        <TurbineUnit live={live} anomalies={anomalies} selected={selected==="turbine"} onSelect={setSelected} />
        <PumpUnit    live={live} anomalies={anomalies} selected={selected==="pump"}    onSelect={setSelected} />
        <Pipes />
        <ClickCatcher onDeselect={setSelected} />
        <Environment preset="city" />
        <OrbitControls maxPolarAngle={Math.PI/2 - 0.1} />
      </Canvas>

      {/* ── LEFT PANEL: Anomalies ── */}
      <div style={{ position:"absolute", top:16, left:16, width:300, bottom:52, background:"#1a1f26", border:"1px solid #334155", borderRadius:8, display:"flex", flexDirection:"column", color:"white", boxShadow:"0 10px 30px rgba(0,0,0,0.5)" }}>
        <div style={{ padding:"12px 16px", fontSize:13, fontWeight:"bold", borderBottom:"1px solid #334155", letterSpacing:"0.05em" }}>
          ANOMALIES SUMMARY
          <span style={{ float:"right", fontSize:10, color:"#64748b", fontWeight:"normal" }}>live · auto-refresh 10s</span>
        </div>

        {/* Severity tabs */}
        <div style={{ display:"flex", borderBottom:"1px solid #334155" }}>
          {["all","critical","moderate","minor"].map(s => (
            <div key={s} onClick={() => setSevTab(s)} style={{
              flex:1, textAlign:"center", padding:"9px 0", fontSize:11, cursor:"pointer",
              color: sevTab===s ? (s==="critical"?"#ef4444":s==="moderate"?"#f59e0b":s==="minor"?"#10b981":"#10b981") : "#64748b",
              borderBottom: sevTab===s ? `2px solid ${s==="critical"?"#ef4444":s==="moderate"?"#f59e0b":s==="minor"?"#10b981":"#6366f1"}` : "none",
              fontWeight: sevTab===s ? "bold" : "normal",
            }}>
              {s.charAt(0).toUpperCase()+s.slice(1)} ({sevCounts[s]})
            </div>
          ))}
        </div>

        {/* Real anomaly cards */}
        <div style={{ flex:1, overflowY:"auto", padding:10, display:"flex", flexDirection:"column", gap:8 }}>
          {filteredAnomalies.length === 0 ? (
            <div style={{ color:"#475569", fontSize:12, textAlign:"center", marginTop:24 }}>
              {anomalies.length === 0 ? "No anomalies detected yet.\nRCA reports appear when the live detector fires." : `No ${sevTab} anomalies.`}
            </div>
          ) : filteredAnomalies.map(ev => {
            const cfg = SEV_CONFIG[ev.severity] || SEV_CONFIG.none;
            const Icon = cfg.Icon;
            return (
              <div key={ev.id} style={{ background:cfg.bg, border:`1px solid ${cfg.color}`, borderRadius:6, overflow:"hidden" }}>
                <div style={{ background:cfg.headerBg, padding:"5px 11px", fontSize:11, fontWeight:"bold", color:cfg.color, display:"flex", alignItems:"center", gap:6 }}>
                  <Icon size={11} /> {(ev.severity||"").toUpperCase()} · {ev.anomaly_type?.replace(/_/g," ")||"Anomaly"}
                </div>
                <div style={{ padding:"8px 11px", fontSize:11, color:"#cbd5e1", lineHeight:1.6 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"65px 1fr" }}>
                    <span style={{ color:"#64748b" }}>Asset ID:</span><span>{ev.asset_id || "—"}</span>
                    <span style={{ color:"#64748b" }}>Score:</span><span className="mono">{ev.anomaly_score?.toFixed(4) || "—"}</span>
                    <span style={{ color:"#64748b" }}>Time:</span><span>{ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : "—"}</span>
                  </div>
                  {ev.top_sensors?.length > 0 && (
                    <div style={{ marginTop:4, color:"#94a3b8" }}>Sensors: <span style={{ color:"#cbd5e1" }}>{ev.top_sensors.slice(0,2).join(", ")}</span></div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT PANEL: Asset + Chat ── */}
      <div style={{ position:"absolute", top:16, right:16, width:310, bottom:52, display:"flex", flexDirection:"column", gap:12 }}>

        {/* Asset Data — changes on 3D click */}
        <div style={{ background:"#1a1f26", border:`1px solid ${selected?"#3b82f6":"#334155"}`, borderRadius:8, color:"white", boxShadow:"0 10px 30px rgba(0,0,0,0.5)" }}>
          <div style={{ padding:"10px 14px", fontSize:11, fontWeight:"bold", borderBottom:"1px solid #334155", color:"#94a3b8", letterSpacing:"0.05em" }}>
            ASSET DATA {selected && <span style={{ color:"#3b82f6" }}>· CLICK 3D MODEL TO SWITCH</span>}
          </div>
          <div style={{ padding:"12px 14px" }}>
            <div style={{ fontSize:13, fontWeight:"bold", color:"#10b981", marginBottom:10 }}>{assetLabel} — LIVE</div>
            {selected ? (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", rowGap:8, fontSize:12, color:"#94a3b8" }}>
                {assetFields.map(f => {
                  const raw = live[f.key];
                  const val = raw != null ? f.fmt(raw) : "—";
                  return (
                    <>
                      <div key={f.label}>{f.label}:</div>
                      <div key={f.key} style={{ color:"white", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{val} <span style={{ color:"#475569", fontSize:10 }}>{f.unit}</span></div>
                    </>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize:11, color:"#475569" }}>Click a 3D component (Boiler, Turbine, Pump) to see its live sensor readings here.</div>
            )}
          </div>
        </div>

        {/* AI Chat — real backend */}
        <div style={{ flex:1, background:"#1a1f26", border:"1px solid #334155", borderRadius:8, display:"flex", flexDirection:"column", color:"white", boxShadow:"0 10px 30px rgba(0,0,0,0.5)" }}>
          <div style={{ padding:"10px 14px", fontSize:11, fontWeight:"bold", borderBottom:"1px solid #334155", color:"#94a3b8", letterSpacing:"0.05em" }}>
            AI INSIGHTS — LIVE AGENT
          </div>
          <div style={{ flex:1, padding:12, overflowY:"auto", display:"flex", flexDirection:"column", gap:10 }}>
            {messages.length === 0 && (
              <div style={{ color:"#475569", fontSize:11, textAlign:"center", marginTop:16 }}>
                Ask the AI about any anomaly or plant condition…
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role==="user" ? "flex-end" : "flex-start",
                background: m.role==="user" ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.04)",
                borderLeft: m.role==="ai" ? "2px solid #6366f1" : "none",
                border: m.role==="user" ? "1px solid #4f46e5" : "1px solid #1e293b",
                padding:"8px 10px", borderRadius:6, fontSize:11, color:"#e2e8f0", lineHeight:1.55,
                maxWidth:"90%", whiteSpace:"pre-wrap"
              }}>
                <span style={{ fontWeight:"bold", color: m.role==="user"?"#a5b4fc":"#94a3b8" }}>
                  {m.role==="user" ? "You" : "AI Agent"}:{" "}
                </span>
                {m.text}
              </div>
            ))}
            {sending && (
              <div style={{ display:"flex", alignItems:"center", gap:6, color:"#475569", fontSize:11 }}>
                <Loader2 size={13} style={{ animation:"spin 1s linear infinite" }} /> Thinking…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding:10, borderTop:"1px solid #334155", display:"flex", gap:8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key==="Enter" && sendMessage()}
              placeholder="Ask about the plant…"
              style={{ flex:1, background:"rgba(255,255,255,0.05)", border:"1px solid #334155", borderRadius:5, padding:"7px 10px", color:"white", fontSize:11, outline:"none" }}
            />
            <button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              style={{ background: sending||!input.trim() ? "#1e293b" : "#4f46e5", border:"none", borderRadius:5, width:32, display:"flex", alignItems:"center", justifyContent:"center", cursor: sending ? "wait" : "pointer" }}
            >
              <Send size={14} color="white" />
            </button>
          </div>
        </div>
      </div>

      {/* Hint overlay */}
      <div style={{ position:"absolute", bottom:60, right:360, display:"flex", flexDirection:"column", gap:7, color:"#94a3b8", fontSize:10, fontWeight:"bold", letterSpacing:"0.08em", textAlign:"right" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:5 }}>ORBIT <MousePointer2 size={11} color="#06b6d4" /></div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:5 }}>PAN <Move size={11} color="#06b6d4" /></div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:5 }}>ZOOM <ZoomIn size={11} color="#06b6d4" /></div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:5 }}>RESET VIEW <RefreshCw size={11} color="#06b6d4" /></div>
      </div>

      {/* ── BOTTOM STATUS BAR ── */}
      <div style={{ position:"absolute", bottom:0, left:0, right:0, height:40, background:"#11151a", borderTop:"1px solid #334155", display:"flex", alignItems:"center", justifyContent:"center", gap:36, color:"#64748b", fontSize:11, fontWeight:"bold", letterSpacing:"0.05em" }}>
        <span>SYSTEM STATUS: <span style={{ color:"#10b981" }}>LIVE</span></span>
        <div style={{ width:1, height:16, background:"#334155" }} />
        <span>DATA REFRESH: <span style={{ color:"#10b981" }}>1s</span></span>
        <div style={{ width:1, height:16, background:"#334155" }} />
        <span>PLANT EFFICIENCY: <span style={{ color: efficiency > 0 ? (efficiency > 0.85 ? "#10b981" : "#f59e0b") : "#64748b" }}>{efficiency ? (efficiency*100).toFixed(1)+"%" : "—"}</span></span>
        <div style={{ width:1, height:16, background:"#334155" }} />
        <span>POWER OUTPUT: <span style={{ color:"#10b981" }}>{power ? (power/1000).toFixed(2)+"MW" : "—"}</span></span>
      </div>
    </div>
  );
}
