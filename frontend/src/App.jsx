import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import LiveTwin from "./pages/LiveTwin";
import OptimizerPage from "./pages/OptimizerPage";
import ChatPage from "./pages/ChatPage";
import AnomalyLog from "./pages/AnomalyLog";
import Plant3D from "./pages/Plant3D";
import { Activity, Zap, Bot, AlertTriangle, Factory, Box } from "lucide-react";
import "./index.css";

const NAV = [
  { to: "/",          label: "Live Twin",  Icon: Activity      },
  { to: "/3d-plant",  label: "3D Plant",   Icon: Box           },
  { to: "/optimizer", label: "Optimizer",  Icon: Zap           },
  { to: "/chat",      label: "AI Chat",    Icon: Bot           },
  { to: "/anomalies", label: "Anomalies",  Icon: AlertTriangle },
];

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display:"flex", flexDirection:"column", height:"100vh" }}>

        {/* ── NAV ── */}
        <header className="g-nav" style={{ padding:"0 32px", height:64, display:"flex", alignItems:"center", gap:28 }}>
          {/* Logo */}
          <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
            <div style={{
              width:38, height:38, borderRadius:12,
              background:"linear-gradient(135deg,#6366f1,#3b82f6)",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 4px 12px rgba(99,102,241,.35)"
            }}>
              <Factory size={19} color="white" />
            </div>
            <span style={{ fontWeight:800, fontSize:18, letterSpacing:"-0.02em" }}>
              <span className="g-text">CogeTwin</span>
              <span style={{ color:"#475569", fontWeight:600 }}> AI</span>
            </span>
          </div>

          {/* Nav links */}
          <nav style={{ display:"flex", gap:4 }}>
            {NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
              >
                <Icon size={15} /> {label}
              </NavLink>
            ))}
          </nav>

          {/* Right */}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:12 }}>
            <div className="g-card" style={{ padding:"6px 14px", display:"flex", alignItems:"center", gap:8, borderRadius:99 }}>
              <div className="live-dot" />
              <span style={{ fontSize:12, fontWeight:600, color:"#059669" }}>System Online</span>
            </div>
            <span style={{ fontSize:11, color:"#94a3b8", fontWeight:500 }}>
              LLM-Powered Digital Twin · Cogeneration Plant
            </span>
          </div>
        </header>

        {/* ── PAGES ── */}
        <main className="main-scroll">
          <Routes>
            <Route path="/"          element={<LiveTwin />}      />
            <Route path="/3d-plant"  element={<Plant3D />}       />
            <Route path="/optimizer" element={<OptimizerPage />} />
            <Route path="/chat"      element={<ChatPage />}      />
            <Route path="/anomalies" element={<AnomalyLog />}    />
          </Routes>
        </main>

      </div>
    </BrowserRouter>
  );
}
