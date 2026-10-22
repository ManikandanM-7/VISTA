import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, RefreshCw, Wifi, WifiOff, ChevronRight } from "lucide-react";

const API = "http://localhost:8000";

const INIT_MSG = {
  role: "assistant",
  content: "Hello! I'm CogeTwin AI 🏭\n\nI have access to your plant's real-time digital twin, optimization engine, anomaly log, and operations manuals. Ask me anything about the cogeneration plant!"
};

const SUGGESTIONS = [
  { q:"Why is steam pressure dropping?",           emoji:"📉" },
  { q:"What is current thermal efficiency?",       emoji:"♻️" },
  { q:"Explain the current vibration reading",     emoji:"📊" },
  { q:"What to do if boiler temp exceeds 510°C?", emoji:"🚨" },
  { q:"Recommend setpoints for peak demand",       emoji:"⚡" },
  { q:"What caused the last anomaly?",             emoji:"⚠️" },
  { q:"How does condenser fouling affect output?", emoji:"🔧" }
];

function TypingDots() {
  return (
    <div style={{ display:"flex", gap:4, padding:"12px 16px", alignItems:"center", height:44 }}>
      <div className="dot-flashing" style={{ animationDelay: "0s" }} />
      <div className="dot-flashing" style={{ animationDelay: "0.2s" }} />
      <div className="dot-flashing" style={{ animationDelay: "0.4s" }} />
    </div>
  );
}

function Bubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display:"flex", gap:10, flexDirection: isUser ? "row-reverse":"row", alignItems:"flex-start" }}>
      {/* Avatar */}
      <div style={{
        width:36, height:36, borderRadius:10, flexShrink:0,
        display:"flex", alignItems:"center", justifyContent:"center",
        background: isUser
          ? "linear-gradient(135deg,#6366f1,#3b82f6)"
          : "linear-gradient(135deg,#10b981,#059669)",
        boxShadow:"0 4px 10px rgba(0,0,0,0.12)"
      }}>
        {isUser ? <User size={15} color="white"/> : <Bot size={15} color="white"/>}
      </div>

      {/* Bubble */}
      <div style={{ maxWidth:"75%", display:"flex", flexDirection:"column", gap:6, alignItems: isUser?"flex-end":"flex-start" }}>
        <div style={{
          padding:"12px 16px",
          borderRadius: isUser ? "18px 4px 18px 18px":"4px 18px 18px 18px",
          background: isUser ? "linear-gradient(135deg,#818cf8,#6366f1)":"rgba(255,255,255,0.82)",
          color: isUser ? "#fff":"#1e293b",
          fontSize:14.5, lineHeight:1.5,
          boxShadow:"0 4px 14px rgba(0,0,0,0.06)",
          border: isUser ? "none":"1px solid rgba(255,255,255,.9)",
          backdropFilter: isUser ? "none":"blur(16px)",
        }}>
          {msg.content}
        </div>

        {/* Tool call badges */}
        {msg.tools?.length > 0 && (
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {msg.tools.map(t => (
              <span key={t} style={{ fontSize:10, background:"#ede9fe", color:"#6d28d9", border:"1px solid #ddd6fe", borderRadius:99, padding:"2px 10px", fontWeight:600 }}>
                ⚙️ {t.replace(/_/g," ")}
              </span>
            ))}
          </div>
        )}

        {/* Meta */}
        {msg.backend && (
          <span style={{ fontSize:10, color:"#94a3b8" }}>
            via <strong>{msg.backend}</strong> • {msg.model}
          </span>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [msgs,    setMsgs]    = useState([INIT_MSG]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [status,  setStatus]  = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/chat/llm-status`).then(r=>r.json()).then(setStatus).catch(()=>{});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [msgs, loading]);

  async function send(text) {
    const m = (text || input).trim();
    if (!m || loading) return;
    setInput("");
    setMsgs(p => [...p, { role:"user", content:m }]);
    setLoading(true);
    try {
      const r = await fetch(`${API}/chat/message`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ message: m })
      });
      if (!r.ok) {
        setMsgs(p => [...p, { role:"assistant", content:`⚠️ API Error: The server returned status ${r.status}. This usually means the AI model is rate limited or unavailable.` }]);
        setLoading(false);
        return;
      }
      const d = await r.json();
      setMsgs(p => [...p, {
        role:"assistant", content:d.response,
        backend:d.backend, model:d.model,
        tools: d.tool_calls_made || []
      }]);
      if (d.backend) setStatus(s => s ? {...s, active_backend:d.backend, active_model:d.model} : s);
    } catch {
      setMsgs(p => [...p, { role:"assistant", content:"⚠️ Could not reach the API. Make sure the backend is running on port 8000." }]);
    }
    setLoading(false);
  }

  async function reset() {
    await fetch(`${API}/chat/reset`, { method:"POST" }).catch(()=>{});
    setMsgs([INIT_MSG]);
  }

  const online = status?.active_backend === "gemini";
  const PAGE_H = "calc(100vh - 64px)";

  return (
    <div style={{ height:PAGE_H, display:"flex", overflow:"hidden" }}>

      {/* ⬅️ Sidebar ⬅️ */}
      <div className="g-nav" style={{ width:272, flexShrink:0, borderRight:"1px solid rgba(255,255,255,.6)", padding:"20px 16px", display:"flex", flexDirection:"column", gap:16, overflowY:"auto" }}>

        {/* LLM Status Card */}
        <div style={{
          borderRadius:14, padding:"14px 16px",
          background: online ? "linear-gradient(135deg,#ecfdf5,#d1fae5)":"linear-gradient(135deg,#fef9c3,#fef3c7)",
          border:`1px solid ${online?"#6ee7b7":"#fcd34d"}`
        }}>
          <div className="sec-label" style={{ marginBottom:8 }}>LLM Backend</div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {online ? <Wifi size={15} color="#059669"/> : <WifiOff size={15} color="#d97706"/>}
            <span style={{ fontWeight:700, fontSize:13.5, color: online?"#065f46":"#92400e" }}>
              {online ? "🟢 Gemini 2.5 Flash":"🟠 Ollama (Local)"}
            </span>
          </div>
          <p style={{ fontSize:11, color:"#64748b", marginTop:5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {status?.active_model || "—"}
          </p>
        </div>

        {/* Suggestions */}
        <div style={{ flex:1 }}>
          <div className="sec-label" style={{ marginBottom:10 }}>Suggested Questions</div>
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            {SUGGESTIONS.map(({ q, emoji }) => (
              <button key={q} onClick={() => send(q)} style={{
                display:"flex", alignItems:"center", gap:8, padding:"9px 10px",
                borderRadius:10, background:"transparent", border:"1px solid transparent",
                cursor:"pointer", textAlign:"left", width:"100%", transition:"all .15s",
                fontFamily:"inherit"
              }}
              onMouseEnter={e=>{ e.currentTarget.style.background="rgba(255,255,255,.65)"; e.currentTarget.style.borderColor="rgba(99,102,241,.15)"; }}
              onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; e.currentTarget.style.borderColor="transparent"; }}>
                <span style={{ fontSize:14, flexShrink:0 }}>{emoji}</span>
                <span style={{ fontSize:12, color:"#475569", flex:1, lineHeight:1.4 }}>{q}</span>
                <ChevronRight size={11} color="#cbd5e1" style={{ flexShrink:0 }} />
              </button>
            ))}
          </div>
        </div>

        {/* Reset */}
        <button onClick={reset} style={{
          padding:"8px 12px", borderRadius:10,
          background:"transparent", border:"1px solid rgba(99,102,241,.15)",
          cursor:"pointer", fontSize:12, color:"#94a3b8",
          display:"flex", alignItems:"center", gap:6, fontFamily:"inherit", transition:"all .15s"
        }}
        onMouseEnter={e=>{ e.currentTarget.style.color="#64748b"; }}
        onMouseLeave={e=>{ e.currentTarget.style.color="#94a3b8"; }}>
          <RefreshCw size={11}/> Clear conversation
        </button>
      </div>

      {/* 💬 Chat Area 💬 */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* Messages */}
        <div style={{ flex:1, overflowY:"auto", padding:"24px 28px", display:"flex", flexDirection:"column", gap:20 }}>
          {msgs.map((m,i) => <Bubble key={i} msg={m}/>)}
          {loading && (
            <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
              <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(135deg,#10b981,#059669)", boxShadow:"0 4px 10px rgba(0,0,0,0.12)" }}>
                <Bot size={15} color="white"/>
              </div>
              <div style={{ background:"rgba(255,255,255,0.82)", border:"1px solid rgba(255,255,255,.9)", borderRadius:"4px 18px 18px 18px", backdropFilter:"blur(16px)" }}>
                <TypingDots/>
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {/* Input bar */}
        <div className="g-nav" style={{ padding:"14px 28px", borderTop:"1px solid rgba(255,255,255,.6)" }}>
          <div style={{ display:"flex", gap:10, background:"rgba(255,255,255,.85)", border:"1px solid rgba(255,255,255,.95)", borderRadius:16, padding:"10px 14px", backdropFilter:"blur(20px)", boxShadow:"0 4px 20px rgba(99,102,241,0.08)" }}>
            <input
              style={{ flex:1, background:"transparent", border:"none", outline:"none", fontSize:14, color:"#1e293b", fontFamily:"inherit" }}
              placeholder="Ask about the plant — sensors, efficiency, faults, optimization..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key==="Enter" && !e.shiftKey && send()}
            />
            <button className="btn-primary" onClick={() => send()} disabled={loading||!input.trim()}
              style={{ width:38, height:38, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <Send size={15}/>
            </button>
          </div>
          <p style={{ textAlign:"center", fontSize:11, color:"#94a3b8", marginTop:8 }}>
            AI may make mistakes • always verify critical actions with plant safety procedures
          </p>
        </div>
      </div>

    </div>
  );
}
