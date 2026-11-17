/* ═══════════════════════════════════════════════════════════════════════════
 * CogenerationPlant3D.jsx — Masterclass Interactive 3D CHP Digital Twin
 * ═══════════════════════════════════════════════════════════════════════════
 * A spacious, clutter-free, production-ready 3D digital twin for a
 * Combined Heat and Power (CHP) Cogeneration Station.
 * Built with React 18/19, @react-three/fiber, @react-three/drei, and Three.js.
 *
 * KEY HIGHLIGHTS & ARCHITECTURE:
 *  1. SPACIOUS INDUSTRIAL FOOTPRINT (260m x 260m):
 *     - Generous physical clearance between all subsystems
 *     - Asphalt access roads, safety walkways, hazard striping
 *     - Central elevated pipe bridge trestles supporting high-pressure lines
 *     - Perimeter lighting towers pushed out to boundaries (no camera obstruction)
 *
 *  2. DECLUTTERED 3D VIEWPORT:
 *     - Clean 3D view by default: No overlapping 2D HTML badges!
 *     - Subsystem tags appear ONLY on hover, on selection, or during faults
 *     - Global "Tags: Minimal / All" toolbar toggle
 *
 *  3. COMPREHENSIVE INDUSTRIAL SUBSYSTEMS:
 *     - Boiler Island (Drum, Downcomers, Fire Core, Dual Safety Valves, Stack)
 *     - Power Generation Island (HP/LP Steam Turbine, Bladed Rotor, Alternator)
 *     - Surface Condenser Island (Dual-Pass Condenser & Dual Feedwater Pumps)
 *     - Cooling Yard (Induced-Draft Cooling Tower with spinning fan & vapor)
 *     - Elevated Deaerator & Feedwater Storage Tower
 *     - Natural Gas Metering & Regulating Skid (GMRS)
 *     - High-Voltage Electrical Substation & 110 kV Transmission Gantry
 *     - Interconnecting Steam, Process Heat & Condensate Piping Network
 *
 *  4. INTERACTION & CONTROLS:
 *     - 100% Free 360° Orbit, Right-Click Pan Anywhere, Scroll Zoom
 *     - 6 Smooth Camera Presets that immediately yield to mouse interaction
 *     - 3 Atmospheres: Daylight Studio ☀️, Night Shift 🌙, FLIR Infrared 🔥
 *     - Interactive Operating Valves (MSV-01, PRV-01, FCV-01) with sound
 *     - Web Audio 50 Hz Turbine Drone + Alarm Siren
 *     - Embedded Gemini AI Copilot + Live SCADA Telemetry Stream
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useState, useEffect, useRef, useMemo, useCallback, Suspense, Component } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import {
  Sun, Moon, Flame, Volume2, VolumeX, Camera, Move, ZoomIn,
  RefreshCw, Send, Loader2, Sparkles, Tag, Eye, EyeOff, RotateCw, AlertTriangle
} from "lucide-react";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ERROR BOUNDARY (Prevents full-page unmounting on WebGL / JS errors)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("3D Digital Twin Error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: "100%", height: "calc(100vh - 64px)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: "#0c1322", color: "white", fontFamily: "'Inter', sans-serif", padding: 24,
        }}>
          <AlertTriangle size={36} color="#ef4444" style={{ marginBottom: 12 }} />
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "#ef4444", marginBottom: 6 }}>
            3D Digital Twin Runtime Error
          </h2>
          <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 16 }}>
            An unexpected error occurred while rendering the WebGL scene.
          </p>
          <pre style={{
            background: "rgba(0,0,0,0.5)", padding: "12px 16px", borderRadius: 8,
            color: "#fca5a5", fontSize: 11, maxWidth: 600, overflowX: "auto", border: "1px solid rgba(239,68,68,0.3)"
          }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 18, background: "#0284c7", color: "white", border: "none",
              padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13
            }}
          >
            Reload Scene
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * CONSTANTS & CONFIGURATION
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const API = "http://localhost:8000";
const WS  = "ws://localhost:8000/ws/live";

const FAULTS = {
  NONE:      { id: "NONE",      label: "Nominal Operations",    desc: "100% capacity continuous rating, all subsystems within bounds" },
  BOILER:    { id: "BOILER",    label: "Boiler Overheat",       desc: "Superheater tube scaling — core temp exceeds 510°C, relief valves pop" },
  TURBINE:   { id: "TURBINE",   label: "Turbine Bearing Wear",  desc: "Radial bearing play — vibration exceeds 6.2 mm/s, casing oscillation" },
  CONDENSER: { id: "CONDENSER", label: "Condenser Vacuum Loss", desc: "Cooling loop degradation — backpressure rises, efficiency drops" },
  TRIP:      { id: "TRIP",      label: "Emergency Plant Trip",  desc: "Full automated ESD shutdown, safety valves pop, alarms sound" },
};

/* Camera View Presets (Calibrated for the Spacious 80m Footprint) */
const CAMERAS = {
  OVERVIEW:   { pos: [-46, 36, 54], target: [2, 4, -4],   name: "Overview" },
  BOILER:     { pos: [-34, 16, 18], target: [-22, 6, 0],  name: "Boiler Island" },
  TURBINE:    { pos: [12, 15, 24],  target: [13, 5, 0],   name: "Turbine Hall" },
  CONDENSER:  { pos: [24, 12, -4],  target: [12, 3, -16], name: "Condenser" },
  COOLING:    { pos: [-16, 18, -38],target: [-24, 6, -26],name: "Cooling Tower" },
  SUBSTATION: { pos: [44, 16, 18],  target: [30, 5, 0],   name: "Switchyard" },
};

/* Color Themes */
const PALETTES = {
  DAY: {
    sky: "#0c1322",
    fog: "#0c1322",
    ambient: "#e2e8f0",
    sun: "#fffbeb",
    ambientInt: 1.35,
    sunInt: 2.8,
    floor: "#161f30",
    road: "#0f172a",
    gridAccent: "#06b6d4",
    gridSub: "#1e293b",
    boiler: "#ea580c",
    boilerFrame: "#eab308",
    turbine: "#0284c7",
    turbineStage2: "#38bdf8",
    generator: "#059669",
    condenser: "#0d9488",
    coolingTower: "#475569",
    pumps: "#dc2626",
    deaerator: "#0284c7",
    pipeHP: "#f97316",
    pipeCondensate: "#0284c7",
    pipeProcess: "#a855f7",
    pipeGas: "#eab308",
  },
  NIGHT: {
    sky: "#04070f",
    fog: "#04070f",
    ambient: "#1e293b",
    sun: "#93c5fd",
    ambientInt: 0.5,
    sunInt: 0.8,
    floor: "#0b101b",
    road: "#070c14",
    gridAccent: "#00f0ff",
    gridSub: "#111827",
    boiler: "#ea580c",
    boilerFrame: "#ca8a04",
    turbine: "#0284c7",
    turbineStage2: "#0284c7",
    generator: "#059669",
    condenser: "#0d9488",
    coolingTower: "#334155",
    pumps: "#dc2626",
    deaerator: "#0369a1",
    pipeHP: "#f97316",
    pipeCondensate: "#00e5ff",
    pipeProcess: "#c084fc",
    pipeGas: "#eab308",
  },
  THERMAL: {
    sky: "#020408",
    fog: "#020408",
    ambient: "#ffffff",
    sun: "#ffffff",
    ambientInt: 1.5,
    sunInt: 1.6,
    floor: "#050811",
    road: "#03060a",
    gridAccent: "#38bdf8",
    gridSub: "#0f172a",
    boiler: "#ffffff", // 480°C
    boilerFrame: "#7c2d12",
    turbine: "#ff8800", // 385°C
    turbineStage2: "#ffaa00",
    generator: "#eab308", // 70°C
    condenser: "#06b6d4", // 42°C
    coolingTower: "#0284c7", // 28°C
    pumps: "#3b82f6", // 35°C
    deaerator: "#f97316", // 105°C
    pipeHP: "#ffffff", // 480°C
    pipeCondensate: "#00e5ff", // 38°C
    pipeProcess: "#ff5500", // 220°C
    pipeGas: "#facc15",
  },
};

/* Asset Telemetry & Spec Directory */
const ASSETS = {
  boiler: {
    id: "BOILER_01",
    label: "High-Pressure Utility Boiler",
    tag: "SG-101",
    color: "#ea580c",
    tempNominal: "478.0°C",
    pressureNominal: "10.0 MPa",
    desc: "Natural-circulation industrial boiler generating 10.5 kg/s superheated steam at 10.0 MPa with dual safety relief valves.",
    specs: [
      { label: "Thermal Capacity", val: "45.0 MWth" },
      { label: "Design Pressure", val: "12.5 MPa" },
      { label: "Fuel Input", val: "Natural Gas (0.45 kg/s)" },
      { label: "Combustion Eff.", val: "91.4%" },
    ],
  },
  turbine: {
    id: "TURBINE_A",
    label: "Multi-Stage Steam Turbine",
    tag: "ST-201",
    color: "#0284c7",
    tempNominal: "385.0°C",
    pressureNominal: "9.8 MPa",
    desc: "High-efficiency combined extraction-condensing steam turbine driving the synchronous alternator and supplying intermediate process steam.",
    specs: [
      { label: "Electrical Output", val: "10.0 MWe" },
      { label: "Shaft Speed", val: "3,000 RPM" },
      { label: "Vibration Baseline", val: "1.15 mm/s" },
      { label: "Isentropic Eff.", val: "88.6%" },
    ],
  },
  generator: {
    id: "GEN_01",
    label: "Synchronous Alternator",
    tag: "GEN-301",
    color: "#059669",
    tempNominal: "68.5°C",
    pressureNominal: "11.0 kV",
    desc: "Brushless 3-phase alternator converting mechanical turbine shaft power into 11 kV electricity for plant auxiliaries and grid export.",
    specs: [
      { label: "Rated Power", val: "12.5 MVA" },
      { label: "Terminal Voltage", val: "11.0 kV" },
      { label: "Power Factor", val: "0.85" },
      { label: "Frequency", val: "50.0 Hz" },
    ],
  },
  condenser: {
    id: "CONDENSER_01",
    label: "Surface Steam Condenser",
    tag: "SC-401",
    color: "#0d9488",
    tempNominal: "42.3°C",
    pressureNominal: "0.008 MPa",
    desc: "Dual-pass shell-and-tube surface condenser maintaining turbine exhaust vacuum (-92 kPa) and returning purified condensate to the feedwater cycle.",
    specs: [
      { label: "Thermal Duty", val: "14.2 MWth" },
      { label: "Cooling Water Flow", val: "1,200 m³/h" },
      { label: "Tube Material", val: "Titanium Gr.2" },
      { label: "Exhaust Vacuum", val: "92 kPa" },
    ],
  },
  pumps: {
    id: "PUMPS_C",
    label: "Boiler Feedwater Pumps",
    tag: "BFP-701 A/B",
    color: "#dc2626",
    tempNominal: "105.0°C",
    pressureNominal: "11.2 MPa",
    desc: "High-pressure centrifugal feedwater pump station with 1 duty and 1 standby pump delivering polished feedwater to the steam drum.",
    specs: [
      { label: "Discharge Pressure", val: "11.2 MPa" },
      { label: "Motor Rating", val: "350 kW" },
      { label: "Flow Rate", val: "12.0 kg/s" },
      { label: "NPSH Margin", val: "+2.4 m" },
    ],
  },
  coolingTower: {
    id: "COOLING_01",
    label: "Induced-Draft Cooling Tower",
    tag: "CT-501",
    color: "#0284c7",
    tempNominal: "28.5°C",
    pressureNominal: "0.25 MPa",
    desc: "Evaporative mechanical-draft cooling tower rejecting waste condenser heat to atmosphere via high-volume top fan airflow.",
    specs: [
      { label: "Water Flow", val: "1,200 m³/h" },
      { label: "Fan Power", val: "90 kW" },
      { label: "Inlet Temp", val: "38.0°C" },
      { label: "Outlet Temp", val: "28.0°C" },
    ],
  },
  deaerator: {
    id: "DEAERATOR_01",
    label: "Deaerator & Storage Tank",
    tag: "DA-601",
    color: "#0284c7",
    tempNominal: "105.0°C",
    pressureNominal: "0.20 MPa",
    desc: "Elevated spray-tray deaerator stripping corrosive dissolved O2 and CO2 from feedwater before high-pressure injection.",
    specs: [
      { label: "Operating Pressure", val: "0.20 MPa" },
      { label: "Dissolved O2", val: "< 5 ppb" },
      { label: "Storage Volume", val: "45 m³" },
      { label: "Feedwater Temp", val: "105.0°C" },
    ],
  },
  chpHeader: {
    id: "CHP_PROCESS",
    label: "Process Heat Extraction Manifold",
    tag: "CHP-801",
    color: "#a855f7",
    tempNominal: "220.0°C",
    pressureNominal: "1.2 MPa",
    desc: "Combined Heat and Power (CHP) extraction manifold delivering 8.5 MWth of clean saturated process steam to industrial users.",
    specs: [
      { label: "Extraction Flow", val: "3.5 kg/s" },
      { label: "Thermal Capacity", val: "8.5 MWth" },
      { label: "Steam Pressure", val: "1.2 MPa" },
      { label: "Total CHP Eff.", val: "88.5%" },
    ],
  },
  gasSkid: {
    id: "GMRS_SKID",
    label: "Gas Metering & Regulating Station",
    tag: "GMRS-901",
    color: "#eab308",
    tempNominal: "18.0°C",
    pressureNominal: "2.5 MPa",
    desc: "Natural gas receiving, filtering, heating, and pressure regulation skid feeding the boiler burner management system.",
    specs: [
      { label: "Inlet Pressure", val: "2.5 MPa" },
      { label: "Regulated Output", val: "0.35 MPa" },
      { label: "Mass Flow", val: "0.45 kg/s" },
      { label: "Filter Rating", val: "5 Micron" },
    ],
  },
  switchyard: {
    id: "SUBSTATION_01",
    label: "110 kV Electrical Switchyard",
    tag: "SWYD-110",
    color: "#d97706",
    tempNominal: "45.0°C",
    pressureNominal: "110 kV",
    desc: "High-voltage transmission gantry with SF6 circuit breakers, disconnectors, and grid tie lines exporting cogenerated electrical energy.",
    specs: [
      { label: "Grid Voltage", val: "110 kV" },
      { label: "Breaker Type", val: "SF6 Live Tank" },
      { label: "Transformer Ratio", val: "11/110 kV" },
      { label: "Grid Status", val: "Synchronized" },
    ],
  },
};


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * PROCEDURAL WEB AUDIO SYNTHESIZER
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.humGain = null;
    this.alarmOsc = null;
    this.alarmGain = null;
    this.isPlaying = false;
  }

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    this.humGain = this.ctx.createGain();

    osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(50, this.ctx.currentTime); // 50 Hz grid frequency
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(100, this.ctx.currentTime);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(120, this.ctx.currentTime);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(this.humGain);
    this.humGain.connect(this.ctx.destination);
    this.humGain.gain.setValueAtTime(0, this.ctx.currentTime);

    osc1.start();
    osc2.start();
  }

  start() {
    this.init();
    if (this.ctx?.state === "suspended") this.ctx.resume();
    if (this.humGain) {
      this.humGain.gain.setTargetAtTime(0.04, this.ctx.currentTime, 0.3);
    }
    this.isPlaying = true;
  }

  stop() {
    if (this.humGain && this.ctx) {
      this.humGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
    this.isPlaying = false;
  }

  playValveClick() {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(600, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.08);
    } catch {}
  }

  triggerAlarm(active) {
    if (!this.ctx) return;
    if (active && !this.alarmOsc) {
      this.alarmOsc = this.ctx.createOscillator();
      this.alarmGain = this.ctx.createGain();
      this.alarmOsc.type = "square";
      this.alarmOsc.frequency.setValueAtTime(880, this.ctx.currentTime);
      this.alarmOsc.connect(this.alarmGain);
      this.alarmGain.connect(this.ctx.destination);
      this.alarmGain.gain.setValueAtTime(0.02, this.ctx.currentTime);
      this.alarmOsc.start();
    } else if (!active && this.alarmOsc) {
      try {
        this.alarmGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        setTimeout(() => {
          this.alarmOsc?.stop();
          this.alarmOsc?.disconnect();
          this.alarmOsc = null;
        }, 150);
      } catch {
        this.alarmOsc = null;
      }
    }
  }
}

const audio = new SoundEngine();


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * REUSABLE 3D VISUAL HELPERS
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* Raycasting wrapper with hover tracking */
function Clickable({ assetId, onSelect, onHover, children, ...props }) {
  return (
    <mesh
      {...props}
      onClick={e => { e.stopPropagation(); onSelect(assetId); }}
      onPointerOver={e => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
        if (onHover) onHover(assetId);
      }}
      onPointerOut={e => {
        e.stopPropagation();
        document.body.style.cursor = "default";
        if (onHover) onHover(null);
      }}
    >
      {children}
    </mesh>
  );
}

/* Machine Foundation Plinth with Hazard Yellow Curb & Accent Underglow */
function MachinePlinth({ position, size, curbColor = "#eab308", underglow = "#0284c7" }) {
  return (
    <group position={position}>
      <mesh position={[0, size[1] / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color="#263143" roughness={0.7} metalness={0.2} />
      </mesh>
      {/* Perimeter Safety Yellow Curb */}
      <mesh position={[0, size[1] + 0.02, 0]} receiveShadow>
        <boxGeometry args={[size[0] + 0.16, 0.04, size[2] + 0.16]} />
        <meshStandardMaterial color={curbColor} metalness={0.3} roughness={0.4} />
      </mesh>
      <pointLight position={[0, 0.25, 0]} color={underglow} intensity={1.2} distance={10} decay={2} />
    </group>
  );
}

/* Structural Pipe Rack Trestle (A-Frame / H-Frame columns) */
function PipeTrestle({ position, height = 8.8, width = 2.4 }) {
  return (
    <group position={position}>
      {/* Left Column */}
      <mesh position={[-width / 2, height / 2, 0]} castShadow>
        <boxGeometry args={[0.2, height, 0.2]} />
        <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Right Column */}
      <mesh position={[width / 2, height / 2, 0]} castShadow>
        <boxGeometry args={[0.2, height, 0.2]} />
        <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Top Crossarm */}
      <mesh position={[0, height, 0]} castShadow>
        <boxGeometry args={[width + 0.5, 0.22, 0.22]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Mid Cross Tie */}
      <mesh position={[0, height * 0.55, 0]} castShadow>
        <boxGeometry args={[width, 0.16, 0.16]} />
        <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

/* Flanged pipe fitting */
function FlangeRing({ position, rotation = [0,0,0], radius = 0.32, color = "#f59e0b" }) {
  return (
    <mesh position={position} rotation={rotation} castShadow>
      <torusGeometry args={[radius, 0.05, 10, 24]} />
      <meshStandardMaterial color={color} metalness={0.85} roughness={0.2} />
    </mesh>
  );
}

/* CatmullRom Industrial Tube */
function PipeTube({ points, color = "#f97316", radius = 0.20, segments = 64 }) {
  const geometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      points.map(p => new THREE.Vector3(...p)),
      false, "catmullrom", 0.4
    );
    return new THREE.TubeGeometry(curve, segments, radius, 16, false);
  }, [points, radius, segments]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={color} metalness={0.5} roughness={0.25} />
    </mesh>
  );
}

/* Fluid flow particle pulses */
function PipeFlowParticles({ points, count = 18, color = "#fffbeb", speed = 0.4, size = 0.12, paused = false }) {
  const curve = useMemo(() => new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), [points]);
  const meshRefs = useRef([]);

  useFrame(({ clock }) => {
    if (paused) return;
    const t = clock.elapsedTime * speed;
    meshRefs.current.forEach((m, i) => {
      if (!m) return;
      const progress = ((t + (i / count)) % 1);
      const pos = curve.getPointAt(progress);
      m.position.copy(pos);
    });
  });

  if (paused) return null;
  return (
    <group>
      {Array.from({ length: count }).map((_, i) => (
        <mesh key={i} ref={el => (meshRefs.current[i] = el)}>
          <sphereGeometry args={[size, 8, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/* Volumetric Vapor / Smoke Plume */
function VaporPlume({ position, particleCount = 18, color = "#cbd5e1", spread = 0.35, riseSpeed = 1.2, scaleMax = 1.8, height = 8.5 }) {
  const particles = useRef([]);

  const initialData = useMemo(() => {
    return Array.from({ length: particleCount }).map((_, i) => ({
      offset: (i / particleCount),
      xRand: (Math.random() - 0.5) * spread,
      zRand: (Math.random() - 0.5) * spread,
      rotSpeed: (Math.random() - 0.5) * 2,
    }));
  }, [particleCount, spread]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * riseSpeed;
    particles.current.forEach((p, i) => {
      if (!p) return;
      const d = initialData[i];
      const prog = (t + d.offset) % 1;
      p.position.y = prog * height;
      p.position.x = d.xRand * (1 + prog * 2.8);
      p.position.z = d.zRand * (1 + prog * 2.8);
      const s = 0.28 + prog * scaleMax;
      p.scale.set(s, s, s);
      p.material.opacity = (1 - prog) * 0.4;
      p.rotation.z += d.rotSpeed * 0.02;
    });
  });

  return (
    <group position={position}>
      {initialData.map((_, i) => (
        <mesh key={i} ref={el => (particles.current[i] = el)}>
          <dodecahedronGeometry args={[0.5, 0]} />
          <meshStandardMaterial color={color} transparent opacity={0.3} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/* Pulsing Wireframe Anomaly Cage */
function AnomalyCage({ size, active, color = "#ef4444" }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    if (ref.current && active) {
      const s = 1.0 + Math.sin(clock.elapsedTime * 4) * 0.03;
      ref.current.scale.setScalar(s);
      ref.current.material.opacity = 0.35 + Math.sin(clock.elapsedTime * 4) * 0.3;
    }
  });

  if (!active) return null;
  return (
    <mesh ref={ref}>
      <boxGeometry args={size} />
      <meshBasicMaterial color={color} wireframe transparent opacity={0.5} />
    </mesh>
  );
}

/* Sleek Distance-Scaled Badge (Only displayed when visible) */
function SleekBadge({ position, text, color = "#0284c7", active = false, warning = false }) {
  return (
    <Html position={position} center distanceFactor={28}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: warning ? 11 : 9.5,
        fontWeight: 800,
        background: warning ? "rgba(220,38,38,0.95)" : active ? "rgba(2,132,199,0.95)" : "rgba(15,23,42,0.90)",
        color: "white",
        padding: warning ? "4px 10px" : "3px 8px",
        borderRadius: 5,
        border: `1.5px solid ${warning ? "#fca5a5" : active ? "#38bdf8" : color}`,
        boxShadow: warning ? "0 0 20px #ef4444" : "0 4px 14px rgba(0,0,0,0.6)",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        transition: "all 0.2s ease",
      }}>
        {text}
      </div>
    </Html>
  );
}

/* Interactive Operational Valve Handwheel */
function InteractiveValve({ position, rotation = [0, 0, 0], isOpen, onToggle, tag, color = "#ef4444", showTag = false }) {
  const wheelRef = useRef();
  const [hovered, setHovered] = useState(false);

  useFrame((_, delta) => {
    if (wheelRef.current) {
      const targetRot = isOpen ? 0 : Math.PI;
      wheelRef.current.rotation.z = THREE.MathUtils.lerp(wheelRef.current.rotation.z, targetRot, delta * 6);
    }
  });

  return (
    <group
      position={position}
      rotation={rotation}
      onClick={e => { e.stopPropagation(); onToggle(); }}
      onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = "pointer"; setHovered(true); }}
      onPointerOut={() => { document.body.style.cursor = "default"; setHovered(false); }}
    >
      {/* Valve Body */}
      <mesh castShadow>
        <boxGeometry args={[0.45, 0.45, 0.45]} />
        <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Stem */}
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 0.5, 12]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Handwheel */}
      <group ref={wheelRef} position={[0, 0.72, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.26, 0.04, 8, 20]} />
          <meshStandardMaterial color={isOpen ? color : "#64748b"} metalness={0.5} roughness={0.3} />
        </mesh>
        {[0, Math.PI / 2].map((r, i) => (
          <mesh key={i} rotation={[Math.PI / 2, 0, r]}>
            <boxGeometry args={[0.5, 0.03, 0.03]} />
            <meshStandardMaterial color="#94a3b8" />
          </mesh>
        ))}
      </group>

      {/* Show valve badge ONLY on hover or if global tags are enabled */}
      {(hovered || showTag) && (
        <Html position={[0, 1.1, 0]} center distanceFactor={24}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 800,
            background: isOpen ? "rgba(16,185,129,0.92)" : "rgba(239,68,68,0.92)",
            color: "white", padding: "2px 6px", borderRadius: 3, border: "1px solid white",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)", whiteSpace: "nowrap", pointerEvents: "none",
          }}>
            {tag} · {isOpen ? "OPEN" : "CLOSED"}
          </div>
        </Html>
      )}
    </group>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 1. HIGH-PRESSURE UTILITY BOILER ISLAND (BOILER_01)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function BoilerIsland({ live, fault, palette, selected, onSelect, onHover, hovered, showAllTags }) {
  const temp = live?.boiler_temp_C ?? 478;
  const isFault = fault === FAULTS.BOILER.id || fault === FAULTS.TRIP.id;
  const glowRef = useRef();

  useFrame(({ clock }) => {
    if (glowRef.current) {
      const heat = Math.min(1, Math.max(0, (temp - 300) / 240));
      const flick = Math.sin(clock.elapsedTime * 8) * 0.15 + 0.85;
      glowRef.current.material.emissiveIntensity = (isFault ? 3.5 : 2.0) * heat * flick;
    }
  });

  const isHighlighted = selected || hovered === "boiler";
  const shouldShowTag = showAllTags || isHighlighted || isFault;

  return (
    <group position={[-22, 0, 0]}>
      {/* Plinth */}
      <MachinePlinth position={[0, 0, 0]} size={[8.6, 0.5, 6.4]} curbColor={palette.boilerFrame} underglow="#f97316" />

      {/* Steel Frame Columns */}
      {[[-3.4, 0, -2.4], [3.4, 0, -2.4], [-3.4, 0, 2.4], [3.4, 0, 2.4]].map((pos, i) => (
        <mesh key={`col-${i}`} position={[pos[0], 4.6, pos[2]]} castShadow>
          <boxGeometry args={[0.26, 8.8, 0.26]} />
          <meshStandardMaterial color={palette.boilerFrame} metalness={0.4} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 8.9, -2.4]} castShadow>
        <boxGeometry args={[7.0, 0.22, 0.22]} />
        <meshStandardMaterial color={palette.boilerFrame} metalness={0.4} roughness={0.3} />
      </mesh>
      <mesh position={[0, 8.9, 2.4]} castShadow>
        <boxGeometry args={[7.0, 0.22, 0.22]} />
        <meshStandardMaterial color={palette.boilerFrame} metalness={0.4} roughness={0.3} />
      </mesh>

      {/* Main Boiler Shell */}
      <Clickable assetId="boiler" onSelect={onSelect} onHover={onHover}
        position={[0, 4.6, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[2.0, 2.0, 5.8, 36]} />
        <meshStandardMaterial
          color={isFault ? "#dc2626" : palette.boiler}
          metalness={0.5} roughness={0.25}
          emissive={isFault ? "#ef4444" : isHighlighted ? "#38bdf8" : "#000"}
          emissiveIntensity={isFault ? 0.45 : isHighlighted ? 0.35 : 0}
        />
      </Clickable>

      {/* End Caps & Reinforcing Rings */}
      {[-2.91, 2.91].map((x, i) => (
        <mesh key={`cap-${i}`} position={[x, 4.6, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[2.02, 2.02, 0.14, 36]} />
          <meshStandardMaterial color="#9a3412" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
      {[-1.8, 0, 1.8].map((x, i) => (
        <mesh key={`ring-${i}`} position={[x, 4.6, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[2.08, 0.08, 10, 36]} />
          <meshStandardMaterial color="#f59e0b" metalness={0.9} roughness={0.2} />
        </mesh>
      ))}

      {/* Steam Drum & Downcomers */}
      <mesh position={[0, 7.8, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.72, 0.72, 4.8, 24]} />
        <meshStandardMaterial color="#9a3412" metalness={0.7} roughness={0.25} />
      </mesh>
      {[-1.6, -0.8, 0, 0.8, 1.6].map((x, i) => (
        <mesh key={`downcomer-${i}`} position={[x, 6.2, 0.8]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 2.8, 12]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}

      {/* Incandescent Flamebox Core */}
      <mesh ref={glowRef} position={[0, 4.6, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[1.4, 1.4, 5.4, 24]} />
        <meshStandardMaterial
          color={isFault ? "#ff0000" : "#ff5500"}
          emissive={isFault ? "#ff0000" : "#ff5500"}
          emissiveIntensity={2.5}
          transparent opacity={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Dual Spring-Loaded Safety Relief Valves */}
      {[-0.9, 0.9].map((x, i) => (
        <group key={`psv-${i}`} position={[x, 8.6, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.12, 0.12, 0.75, 12]} />
            <meshStandardMaterial color="#dc2626" metalness={0.6} />
          </mesh>
          <mesh position={[0, 0.48, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.36, 12]} />
            <meshStandardMaterial color="#b91c1c" metalness={0.7} />
          </mesh>
          {isFault && (
            <VaporPlume position={[0, 0.7, 0]} particleCount={14} color="#f8fafc" riseSpeed={2.8} spread={0.25} height={6.0} />
          )}
        </group>
      ))}

      {/* Aviation Red/White Striped Smokestack */}
      <mesh position={[-1.5, 10.6, 0]} castShadow>
        <cylinderGeometry args={[0.55, 0.75, 5.0, 20]} />
        <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.25} />
      </mesh>
      <mesh position={[-1.5, 13.4, 0]} castShadow>
        <cylinderGeometry args={[0.55, 0.55, 0.8, 20]} />
        <meshStandardMaterial color="#ef4444" metalness={0.2} roughness={0.3} />
      </mesh>
      <mesh position={[-1.5, 14.2, 0]} castShadow>
        <cylinderGeometry args={[0.55, 0.55, 0.8, 20]} />
        <meshStandardMaterial color="#f8fafc" metalness={0.2} roughness={0.3} />
      </mesh>
      <mesh position={[-1.5, 15.0, 0]} castShadow>
        <cylinderGeometry args={[0.55, 0.55, 0.8, 20]} />
        <meshStandardMaterial color="#ef4444" metalness={0.2} roughness={0.3} />
      </mesh>

      {/* Rising Smoke Plume */}
      <VaporPlume position={[-1.5, 15.6, 0]} particleCount={18} color="#94a3b8" riseSpeed={1.6} spread={0.4} height={9.0} />

      {/* Anomaly Wireframe */}
      <group position={[0, 4.6, 0]}>
        <AnomalyCage size={[8.0, 6.0, 5.6]} active={isFault} color="#ef4444" />
      </group>

      {/* Floating Tag (Visible ONLY when selected, hovered, or in fault) */}
      {shouldShowTag && (
        <SleekBadge
          position={[0, 1.6, 3.2]}
          text={isFault ? "🔥 BOILER_01 · CRITICAL OVERHEAT" : `🔥 BOILER_01 (${temp.toFixed(1)}°C)`}
          color="#ea580c"
          active={isHighlighted}
          warning={isFault}
        />
      )}

      <pointLight position={[0, 4.6, 0]} color="#f97316" intensity={isFault ? 5.5 : 3.2} distance={20} decay={2} />
    </group>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 2. POWER GENERATION ISLAND (Turbine_A + GEN_01)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function TurbineIsland({ live, fault, palette, selected, onSelect, onHover, hovered, showAllTags }) {
  const power = live?.turbine_power_kW ?? 8600;
  const isFault = fault === FAULTS.TURBINE.id || fault === FAULTS.TRIP.id;

  const rotorRef = useRef();
  const shaftRef = useRef();
  const turbineGroup = useRef();

  useFrame(({ clock }, delta) => {
    const rpm = fault === FAULTS.TRIP.id ? 0.05 : Math.max(0.4, power / 1800);
    if (rotorRef.current) rotorRef.current.rotation.x += rpm * delta;
    if (shaftRef.current) shaftRef.current.rotation.x += rpm * delta;

    if (isFault && turbineGroup.current) {
      const shake = Math.sin(clock.elapsedTime * 50) * 0.025 * (fault === FAULTS.TURBINE.id ? 2.5 : 0.8);
      turbineGroup.current.position.y = shake;
    }
  });

  const isTurbineHigh = selected === "turbine" || hovered === "turbine";
  const isGenHigh     = selected === "generator" || hovered === "generator";
  const showTurbineTag = showAllTags || isTurbineHigh || isFault;
  const showGenTag     = showAllTags || isGenHigh;

  return (
    <group position={[12, 0, 0]}>
      {/* Heavy Turbine Plinth */}
      <MachinePlinth position={[2.0, 0, 0]} size={[15.0, 0.5, 5.0]} curbColor={palette.boilerFrame} underglow="#0284c7" />

      <group ref={turbineGroup}>
        {/* HP Turbine Stage */}
        <Clickable assetId="turbine" onSelect={onSelect} onHover={onHover}
          position={[-1.8, 4.5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[1.5, 1.7, 4.2, 36]} />
          <meshStandardMaterial
            color={isFault ? "#dc2626" : palette.turbine}
            metalness={0.5} roughness={0.25}
            emissive={isFault ? "#ef4444" : isTurbineHigh ? "#38bdf8" : "#000"}
            emissiveIntensity={isFault ? 0.45 : isTurbineHigh ? 0.35 : 0}
          />
        </Clickable>

        {/* LP Second Stage */}
        <mesh position={[1.6, 4.5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[1.2, 1.5, 2.6, 36]} />
          <meshStandardMaterial color={palette.turbineStage2} metalness={0.6} roughness={0.2} />
        </mesh>

        {/* Bladed Rotor */}
        <mesh ref={rotorRef} position={[-1.8, 4.5, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.55, 0.55, 6.2, 20]} />
          <meshStandardMaterial color="#f1f5f9" metalness={0.95} roughness={0.1} emissive="#00f0ff" emissiveIntensity={0.25} />
        </mesh>

        {/* Shaft */}
        <mesh ref={shaftRef} position={[4.6, 4.5, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.24, 0.24, 2.4, 16]} />
          <meshStandardMaterial color="#e2e8f0" metalness={0.9} roughness={0.15} />
        </mesh>

        {/* Generator */}
        <Clickable assetId="generator" onSelect={onSelect} onHover={onHover}
          position={[6.6, 4.5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[1.4, 1.4, 2.6, 32]} />
          <meshStandardMaterial
            color={palette.generator}
            metalness={0.5} roughness={0.25}
            emissive={isGenHigh ? "#10b981" : "#000"}
            emissiveIntensity={isGenHigh ? 0.4 : 0}
          />
        </Clickable>

        {/* Terminal Box */}
        <mesh position={[6.6, 3.2, 1.3]} castShadow>
          <boxGeometry args={[1.4, 0.7, 0.5]} />
          <meshStandardMaterial color="#f59e0b" metalness={0.3} roughness={0.4} />
        </mesh>

        {/* Anomaly Cage */}
        <group position={[1.5, 4.5, 0]}>
          <AnomalyCage size={[12.6, 4.6, 4.4]} active={isFault} color="#ef4444" />
        </group>
      </group>

      {/* Badges (Visible ONLY on condition) */}
      {showTurbineTag && (
        <SleekBadge
          position={[-1.8, 2.0, 2.6]}
          text={isFault ? "⚡ TURBINE_A · BEARING FAULT" : "⚡ TURBINE_A (ST-201)"}
          color="#0284c7"
          active={isTurbineHigh}
          warning={isFault}
        />
      )}
      {showGenTag && (
        <SleekBadge
          position={[6.6, 2.0, 2.6]}
          text={`🔋 GEN_01 (${(power / 1000).toFixed(2)} MW)`}
          color="#059669"
          active={isGenHigh}
        />
      )}

      <pointLight position={[0, 5, 2]} color="#38bdf8" intensity={2.6} distance={18} decay={2} />
    </group>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 3. CONDENSER ISLAND (Condenser_01)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function CondenserIsland({ fault, palette, selected, onSelect, onHover, hovered, showAllTags }) {
  const isFault = fault === FAULTS.CONDENSER.id || fault === FAULTS.TRIP.id;
  const isHighlighted = selected === "condenser" || hovered === "condenser";
  const shouldShowTag = showAllTags || isHighlighted || isFault;

  return (
    <group position={[12, 0, -16]}>
      {/* Plinth */}
      <MachinePlinth position={[0, 0, 0]} size={[8.4, 0.5, 5.4]} curbColor={palette.boilerFrame} underglow="#0d9488" />

      {/* Condenser Vessel */}
      <Clickable assetId="condenser" onSelect={onSelect} onHover={onHover}
        position={[0, 2.8, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[1.5, 1.5, 6.2, 36]} />
        <meshStandardMaterial
          color={isFault ? "#f59e0b" : palette.condenser}
          metalness={0.5} roughness={0.25}
          emissive={isFault ? "#f59e0b" : isHighlighted ? "#38bdf8" : "#000"}
          emissiveIntensity={isFault ? 0.4 : isHighlighted ? 0.35 : 0}
        />
      </Clickable>

      {/* Naval Bronze End Heads */}
      {[-3.16, 3.16].map((x, i) => (
        <mesh key={`cep-${i}`} position={[x, 2.8, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[1.55, 1.55, 0.16, 36]} />
          <meshStandardMaterial color="#d97706" metalness={0.85} roughness={0.2} />
        </mesh>
      ))}

      {/* Anomaly Cage */}
      <group position={[0, 2.8, 0]}>
        <AnomalyCage size={[7.2, 3.8, 3.8]} active={isFault} color="#f59e0b" />
      </group>

      {shouldShowTag && (
        <SleekBadge
          position={[0, 1.0, 2.8]}
          text={isFault ? "❄️ CONDENSER_01 · VACUUM LOW" : "❄️ CONDENSER_01 (42°C)"}
          color="#0d9488"
          active={isHighlighted}
          warning={isFault}
        />
      )}

      <pointLight position={[0, 3.5, 2]} color="#14b8a6" intensity={2.4} distance={15} decay={2} />
    </group>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 4. FEEDWATER ISLAND (Elevated Deaerator & BFP Pumps)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function FeedwaterIsland({ palette, selected, onSelect, onHover, hovered, showAllTags }) {
  const pA = useRef();
  const pB = useRef();

  useFrame((_, delta) => {
    if (pA.current) pA.current.rotation.z += 6 * delta;
    if (pB.current) pB.current.rotation.z += 6 * delta;
  });

  const isDaHigh    = selected === "deaerator" || hovered === "deaerator";
  const isPumpsHigh = selected === "pumps" || hovered === "pumps";

  return (
    <group position={[-6, 0, -16]}>
      {/* ── Elevated Deaerator Tower ── */}
      <group position={[-3.5, 0, 0]}>
        <MachinePlinth position={[0, 0, 0]} size={[4.8, 0.45, 3.8]} curbColor="#0284c7" underglow="#0284c7" />
        {/* Support Legs */}
        {[-1.4, 1.4].map((x, xi) =>
          [-1.0, 1.0].map((z, zi) => (
            <mesh key={`leg-${xi}-${zi}`} position={[x, 3.4, z]} castShadow>
              <boxGeometry args={[0.16, 6.8, 0.16]} />
              <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.25} />
            </mesh>
          ))
        )}

        <Clickable assetId="deaerator" onSelect={onSelect} onHover={onHover}
          position={[0, 7.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[1.05, 1.05, 3.8, 28]} />
          <meshStandardMaterial
            color={palette.deaerator}
            metalness={0.5} roughness={0.25}
            emissive={isDaHigh ? "#0284c7" : "#000"}
            emissiveIntensity={isDaHigh ? 0.35 : 0}
          />
        </Clickable>

        <mesh position={[0, 8.8, 0]} castShadow>
          <cylinderGeometry args={[0.5, 0.5, 1.8, 20]} />
          <meshStandardMaterial color="#0284c7" metalness={0.7} roughness={0.2} />
        </mesh>

        {(showAllTags || isDaHigh) && (
          <SleekBadge
            position={[0, 4.2, 1.8]}
            text="💧 DEAERATOR_01 (105°C)"
            color="#0284c7"
            active={isDaHigh}
          />
        )}
      </group>

      {/* ── High-Pressure Boiler Feedwater Pumps (BFP 01A/B) ── */}
      <group position={[3.5, 0, 0]}>
        <MachinePlinth position={[0, 0, 0]} size={[4.8, 0.45, 3.8]} curbColor="#dc2626" underglow="#dc2626" />

        {/* Duty Pump A */}
        <Clickable assetId="pumps" onSelect={onSelect} onHover={onHover} position={[-1.2, 0, 0]}>
          <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.75, 0.75, 1.1, 20]} />
            <meshStandardMaterial color={palette.pumps} metalness={0.5} roughness={0.25} />
          </mesh>
          <mesh ref={pA} position={[0, 2.05, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.12, 12]} />
            <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.15} />
          </mesh>
          <mesh position={[0, 2.5, 0]} castShadow>
            <cylinderGeometry args={[0.55, 0.55, 0.95, 18]} />
            <meshStandardMaterial color={palette.turbine} metalness={0.5} roughness={0.25} />
          </mesh>
        </Clickable>

        {/* Standby Pump B */}
        <Clickable assetId="pumps" onSelect={onSelect} onHover={onHover} position={[1.2, 0, 0]}>
          <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.75, 0.75, 1.1, 20]} />
            <meshStandardMaterial color={palette.pumps} metalness={0.5} roughness={0.25} />
          </mesh>
          <mesh ref={pB} position={[0, 2.05, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.12, 12]} />
            <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.15} />
          </mesh>
          <mesh position={[0, 2.5, 0]} castShadow>
            <cylinderGeometry args={[0.55, 0.55, 0.95, 18]} />
            <meshStandardMaterial color={palette.turbine} metalness={0.5} roughness={0.25} />
          </mesh>
        </Clickable>

        {(showAllTags || isPumpsHigh) && (
          <SleekBadge
            position={[0, 1.0, 1.8]}
            text="🔴 BFP_01 A/B (11.2 MPa)"
            color="#dc2626"
            active={isPumpsHigh}
          />
        )}
      </group>
    </group>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 5. COOLING TOWER YARD
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function CoolingTowerIsland({ palette, selected, onSelect, onHover, hovered, showAllTags }) {
  const fanRef = useRef();

  useFrame((_, delta) => {
    if (fanRef.current) fanRef.current.rotation.y += 4 * delta;
  });

  const isHigh = selected === "coolingTower" || hovered === "coolingTower";

  return (
    <group position={[-24, 0, -26]}>
      <MachinePlinth position={[0, 0, 0]} size={[9.6, 0.5, 9.6]} curbColor="#0284c7" underglow="#06b6d4" />

      <Clickable assetId="coolingTower" onSelect={onSelect} onHover={onHover}
        position={[0, 4.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.8, 3.8, 8.0, 32]} />
        <meshStandardMaterial
          color={palette.coolingTower}
          metalness={0.3} roughness={0.6}
          emissive={isHigh ? "#0284c7" : "#000"}
          emissiveIntensity={isHigh ? 0.35 : 0}
        />
      </Clickable>

      {/* Fan */}
      <group ref={fanRef} position={[0, 8.5, 0]}>
        <mesh>
          <cylinderGeometry args={[0.35, 0.35, 0.22, 12]} />
          <meshStandardMaterial color="#0284c7" metalness={0.9} />
        </mesh>
        {[0, 1, 2, 3].map(i => (
          <mesh key={`blade-${i}`} position={[0, 0, 0]} rotation={[0, (i * Math.PI) / 2, 0.2]}>
            <boxGeometry args={[0.4, 0.04, 2.3]} />
            <meshStandardMaterial color="#38bdf8" metalness={0.7} />
          </mesh>
        ))}
      </group>

      {/* Evaporative Plume */}
      <VaporPlume position={[0, 8.8, 0]} particleCount={20} color="#e0f2fe" riseSpeed={1.0} spread={0.65} scaleMax={2.4} height={9.0} />

      {(showAllTags || isHigh) && (
        <SleekBadge
          position={[0, 1.4, 4.4]}
          text="❄️ COOLING_01 (1,200 m³/h)"
          color="#0284c7"
          active={isHigh}
        />
      )}
    </group>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 6. AUXILIARY SKIDS (GMRS Gas Skid + Electrical Switchyard)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function AuxiliarySkids({ palette, selected, onSelect, onHover, hovered, showAllTags }) {
  const isGasHigh  = selected === "gasSkid" || hovered === "gasSkid";
  const isSwydHigh = selected === "switchyard" || hovered === "switchyard";

  return (
    <group>
      {/* ── Natural Gas Fuel Metering & Regulating Skid (GMRS) ── */}
      <Clickable assetId="gasSkid" onSelect={onSelect} onHover={onHover} position={[-34, 0, 10]}>
        <MachinePlinth position={[0, 0, 0]} size={[5.2, 0.4, 4.0]} curbColor="#eab308" underglow="#eab308" />
        {/* Gas Filter Separator Vessels */}
        {[-1.4, 0.2].map((x, i) => (
          <mesh key={`gf-${i}`} position={[x, 1.5, 0]} castShadow>
            <cylinderGeometry args={[0.4, 0.4, 2.2, 16]} />
            <meshStandardMaterial color="#eab308" metalness={0.4} roughness={0.3} />
          </mesh>
        ))}
        {/* Metering Run */}
        <mesh position={[0, 1.3, 0.9]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.12, 0.12, 3.8, 12]} />
          <meshStandardMaterial color="#eab308" metalness={0.5} roughness={0.2} />
        </mesh>

        {(showAllTags || isGasHigh) && (
          <SleekBadge
            position={[0, 0.8, 2.2]}
            text="🟡 GMRS-901 GAS SKID"
            color="#eab308"
            active={isGasHigh}
          />
        )}
      </Clickable>

      {/* ── 110 kV High-Voltage Transmission Substation ── */}
      <Clickable assetId="switchyard" onSelect={onSelect} onHover={onHover} position={[30, 0, 0]}>
        <MachinePlinth position={[0, 0, 0]} size={[8.5, 0.45, 9.5]} curbColor="#d97706" underglow="#38bdf8" />

        {/* Step-Up Transformer (XFMR_01) */}
        <group position={[-2.4, 0, 0]}>
          <mesh position={[0, 2.4, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.8, 3.0, 2.6]} />
            <meshStandardMaterial color="#d97706" metalness={0.4} roughness={0.35} />
          </mesh>
          {[-1.2, 1.2].map((z, i) => (
            <mesh key={`rad-${i}`} position={[0, 2.4, z]} castShadow>
              <boxGeometry args={[2.6, 2.2, 0.22]} />
              <meshStandardMaterial color="#b45309" metalness={0.6} roughness={0.3} />
            </mesh>
          ))}
          {[-0.7, 0, 0.7].map((x, i) => (
            <mesh key={`bush-${i}`} position={[x, 4.3, 0]} castShadow>
              <cylinderGeometry args={[0.09, 0.18, 1.0, 12]} />
              <meshStandardMaterial color="#b91c1c" metalness={0.2} roughness={0.2} />
            </mesh>
          ))}
        </group>

        {/* Lattice Gantry Towers & Insulators */}
        <group position={[2.2, 0, 0]}>
          {[-2.8, 2.8].map((z, i) => (
            <mesh key={`gt-${i}`} position={[0, 6.2, z]} castShadow>
              <boxGeometry args={[0.32, 12.4, 0.32]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.2} />
            </mesh>
          ))}
          <mesh position={[0, 12.0, 0]} castShadow>
            <boxGeometry args={[0.38, 0.38, 6.4]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.2} />
          </mesh>
          {[-2.0, 0, 2.0].map((z, i) => (
            <mesh key={`ins-${i}`} position={[0, 10.2, z]}>
              <cylinderGeometry args={[0.15, 0.08, 2.4, 12]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.3} roughness={0.2} />
            </mesh>
          ))}
        </group>

        {(showAllTags || isSwydHigh) && (
          <SleekBadge
            position={[0, 1.0, 4.6]}
            text="⚡ 110 kV SWITCHYARD (11/110 kV)"
            color="#d97706"
            active={isSwydHigh}
          />
        )}
      </Clickable>

      {/* ── 4 Perimeter Lattice Floodlight Towers (Shifted way out to corners!) ── */}
      {[[-46, 36], [46, 36], [-46, -38], [46, -38]].map((pos, i) => (
        <group key={`lighttower-${i}`} position={[pos[0], 0, pos[1]]}>
          <mesh position={[0, 9.0, 0]} castShadow>
            <boxGeometry args={[0.45, 18.0, 0.45]} />
            <meshStandardMaterial color="#64748b" metalness={0.8} />
          </mesh>
          <mesh position={[0, 18.2, 0]} castShadow>
            <boxGeometry args={[1.8, 0.5, 1.4]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
          <pointLight position={[0, 18.0, 0]} color="#fffbeb" intensity={2.2} distance={60} decay={2} />
        </group>
      ))}
    </group>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 7. ELEVATED PIPING NETWORK & INTERACTIVE VALVES
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function PipingAndValves({ palette, valves, onToggleValve, selected, onSelect, onHover, hovered, showAllTags }) {
  /* HP Steam runs Boiler [-22, 0, 0] -> Turbine [12, 0, 0] */
  const hpPoints = [
    [-19.4, 6.2, 0],
    [-17.0, 9.0, 0],
    [-8.0, 9.0, 0],
    [0.0, 9.0, 0],
    [7.5, 9.0, 0],
    [10.2, 5.8, 0],
  ];

  /* Cogeneration Process Steam runs from Turbine out to process header */
  const processPoints = [
    [13.5, 4.8, 0],
    [13.5, 7.5, 0],
    [13.5, 7.5, 5.5],
    [4.0, 7.5, 8.5],
    [-4.0, 6.0, 8.5],
  ];

  /* Condensate return line: Condenser [12, 0, -16] -> BFP [-3, 0, -16] -> Boiler [-22, 0, 0] */
  const condensatePoints = [
    [12.0, 1.8, -14.0],
    [5.0, 1.8, -16.0],
    [-2.5, 2.0, -16.0],
    [-9.0, 2.0, -16.0],
    [-15.0, 2.2, -8.0],
    [-22.0, 2.8, -3.0],
    [-22.0, 4.0, 0.0],
  ];

  /* Cooling loop: Condenser [12, 0, -16] -> Cooling Tower [-24, 0, -26] */
  const coolingPoints = [
    [9.5, 2.4, -16.0],
    [2.0, 1.6, -18.0],
    [-10.0, 1.6, -22.0],
    [-20.5, 2.6, -26.0],
  ];

  const isChpHigh = selected === "chpHeader" || hovered === "chpHeader";

  return (
    <group>
      {/* ── Elevated Pipe Rack Trestles ── */}
      <PipeTrestle position={[-12, 0, 0]} height={8.8} width={2.2} />
      <PipeTrestle position={[-2, 0, 0]}  height={8.8} width={2.2} />
      <PipeTrestle position={[6, 0, 0]}   height={8.8} width={2.2} />

      {/* 1. HP Superheated Steam (Boiler → Turbine) */}
      <PipeTube points={hpPoints} color={palette.pipeHP} radius={0.24} />
      <PipeFlowParticles points={hpPoints} count={22} color="#fffbeb" speed={0.5} size={0.14} paused={!valves.MSV01.open} />
      <FlangeRing position={[-19.4, 6.2, 0]} rotation={[0, 0, Math.PI / 2]} radius={0.38} />
      <FlangeRing position={[10.2, 5.8, 0]}  rotation={[0, 0, Math.PI / 2]} radius={0.38} />

      {/* Main Steam Stop Valve (MSV-01) mounted at elevated rack */}
      <InteractiveValve
        position={[-5.0, 9.0, 0]}
        isOpen={valves.MSV01.open}
        onToggle={() => onToggleValve("MSV01")}
        tag="MSV-01"
        color="#ef4444"
        showTag={showAllTags}
      />

      {/* 2. Cogeneration Process Heat Extraction Header */}
      <PipeTube points={processPoints} color={palette.pipeProcess} radius={0.20} />
      <PipeFlowParticles points={processPoints} count={16} color="#f5d0fe" speed={0.4} size={0.11} paused={!valves.PRV01.open} />
      <InteractiveValve
        position={[8.0, 7.5, 7.0]}
        isOpen={valves.PRV01.open}
        onToggle={() => onToggleValve("PRV01")}
        tag="PRV-01"
        color="#a855f7"
        showTag={showAllTags}
      />

      {/* Process Heat Tag (Visible on hover/select or all tags) */}
      {(showAllTags || isChpHigh) && (
        <Html position={[-4.0, 7.0, 8.5]} center distanceFactor={26}>
          <div
            onClick={() => onSelect("chpHeader")}
            style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 800,
              background: "rgba(168,85,247,0.95)", color: "white",
              padding: "3px 9px", borderRadius: 4, border: "1.5px solid white",
              boxShadow: "0 4px 12px rgba(168,85,247,0.5)", cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            🏭 CHP PROCESS HEAT · 8.5 MWth
          </div>
        </Html>
      )}

      {/* 3. Condensate Return Header */}
      <PipeTube points={condensatePoints} color={palette.pipeCondensate} radius={0.18} />
      <PipeFlowParticles points={condensatePoints} count={22} color="#38bdf8" speed={0.45} size={0.10} paused={!valves.FCV01.open} />
      <InteractiveValve
        position={[-12.0, 2.1, -12.0]}
        isOpen={valves.FCV01.open}
        onToggle={() => onToggleValve("FCV01")}
        tag="FCV-01"
        color="#0284c7"
        showTag={showAllTags}
      />

      {/* 4. Cooling Loop (Condenser → Cooling Tower) */}
      <PipeTube points={coolingPoints} color="#06b6d4" radius={0.22} />
    </group>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 8. INDUSTRIAL GROUND & ROADWAYS
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function GroundAndGrid({ palette, onDeselect }) {
  return (
    <group onClick={() => onDeselect(null)}>
      {/* Foundation Concrete Slab */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[260, 260]} />
        <meshStandardMaterial color={palette.floor} roughness={0.4} metalness={0.2} />
      </mesh>

      {/* Asphalt Access Roadways */}
      {/* North-South Main Central Roadway */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-2, 0.005, 0]} receiveShadow>
        <planeGeometry args={[7.0, 140]} />
        <meshStandardMaterial color={palette.road} roughness={0.7} metalness={0.1} />
      </mesh>
      {/* East-West Cross Roadway */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, -8]} receiveShadow>
        <planeGeometry args={[140, 6.0]} />
        <meshStandardMaterial color={palette.road} roughness={0.7} metalness={0.1} />
      </mesh>

      {/* Road Dashed Centerline */}
      {[-50, -35, -20, -5, 10, 25, 40, 55].map(z => (
        <mesh key={`dash-${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[-2, 0.015, z]}>
          <planeGeometry args={[0.3, 5.0]} />
          <meshBasicMaterial color="#ffffff" opacity={0.65} transparent />
        </mesh>
      ))}

      {/* Grid Helper */}
      <gridHelper
        args={[260, 130, palette.gridAccent, palette.gridSub]}
        position={[0, 0.02, 0]}
      />
    </group>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 9. MASTER HUD & TELEMETRY DASHBOARD
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function MasterHUD({
  selected, live, fault, onSetFault, atmosphere, onSetAtmosphere,
  soundOn, onToggleSound, currentView, onSetView, onResetCamera,
  showAllTags, onToggleAllTags,
  onSendChat, chatMessages, chatSending
}) {
  const meta = selected ? ASSETS[selected] : null;
  const [chatInput, setChatInput] = useState("");

  return (
    <>
      {/* ── Top Central Toolbar (Atmosphere, Audio, Tags, Camera) ── */}
      <div style={{
        position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
        background: "rgba(15,23,42,0.92)", backdropFilter: "blur(20px)",
        border: "1.5px solid rgba(100,116,139,0.35)", borderRadius: 14,
        padding: "6px 14px", display: "flex", alignItems: "center", gap: 10,
        color: "white", zIndex: 20, boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
      }}>
        {/* Camera Preset Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Camera size={13} color="#38bdf8" />
          <span style={{ fontSize: 9.5, fontWeight: 700, color: "#94a3b8", marginRight: 2 }}>CAM:</span>
          {Object.entries(CAMERAS).map(([key, c]) => (
            <button
              key={key}
              onClick={() => onSetView(key)}
              style={{
                background: currentView === key ? "#0284c7" : "rgba(255,255,255,0.06)",
                border: "none", borderRadius: 6, padding: "4px 8px",
                color: currentView === key ? "white" : "#94a3b8",
                fontSize: 10, fontWeight: 700, cursor: "pointer",
              }}
            >
              {c.name}
            </button>
          ))}
          <button
            onClick={onResetCamera}
            title="Reset overview"
            style={{
              background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 6,
              padding: "4px 7px", color: "#38bdf8", cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
            }}
          >
            <RefreshCw size={11} /> Reset
          </button>
        </div>

        <div style={{ width: 1, height: 18, background: "#334155" }} />

        {/* 🏷️ Tags Visibility Toggle: Minimal / All */}
        <button
          onClick={onToggleAllTags}
          style={{
            background: showAllTags ? "#6366f1" : "rgba(255,255,255,0.06)",
            border: `1px solid ${showAllTags ? "#818cf8" : "transparent"}`,
            borderRadius: 7, padding: "4px 9px",
            color: "white", fontSize: 10.5, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 5,
          }}
          title={showAllTags ? "Click to declutter and hide static 2D tags" : "Click to display all equipment tags"}
        >
          {showAllTags ? <Eye size={12} /> : <EyeOff size={12} color="#94a3b8" />}
          <span>{showAllTags ? "Tags: All" : "Tags: Clean"}</span>
        </button>

        <div style={{ width: 1, height: 18, background: "#334155" }} />

        {/* Atmosphere Selector: Day / Night / FLIR IR */}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => onSetAtmosphere("DAY")}
            style={{
              background: atmosphere === "DAY" ? "#f59e0b" : "rgba(255,255,255,0.06)",
              border: "none", borderRadius: 6, padding: "4px 8px",
              color: "white", fontSize: 10.5, fontWeight: 800, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <Sun size={12} /> Day
          </button>
          <button
            onClick={() => onSetAtmosphere("NIGHT")}
            style={{
              background: atmosphere === "NIGHT" ? "#3b82f6" : "rgba(255,255,255,0.06)",
              border: "none", borderRadius: 6, padding: "4px 8px",
              color: "white", fontSize: 10.5, fontWeight: 800, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <Moon size={12} /> Night
          </button>
          <button
            onClick={() => onSetAtmosphere("THERMAL")}
            style={{
              background: atmosphere === "THERMAL" ? "linear-gradient(135deg,#ff0055,#ff5500)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${atmosphere === "THERMAL" ? "#ff0055" : "transparent"}`,
              borderRadius: 6, padding: "4px 8px",
              color: "white", fontSize: 10.5, fontWeight: 800, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <Flame size={12} /> FLIR IR
          </button>
        </div>

        <div style={{ width: 1, height: 18, background: "#334155" }} />

        {/* Audio Toggle */}
        <button
          onClick={onToggleSound}
          style={{
            background: soundOn ? "#059669" : "rgba(255,255,255,0.06)",
            border: "none", borderRadius: 7, padding: "4px 8px",
            color: "white", fontSize: 10.5, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4,
          }}
        >
          {soundOn ? <Volume2 size={13} /> : <VolumeX size={13} color="#94a3b8" />}
          {soundOn ? "SOUND ON" : "MUTED"}
        </button>
      </div>

      {/* ── Top-Left: Digital Twin Inspector ── */}
      <div style={{
        position: "absolute", top: 16, left: 16, width: 340,
        background: "rgba(15,23,42,0.92)", backdropFilter: "blur(20px)",
        border: `1.5px solid ${meta ? meta.color : "rgba(100,116,139,0.35)"}`,
        borderRadius: 16, color: "white", fontFamily: "'Inter', sans-serif",
        boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 30px ${meta ? meta.color + "33" : "transparent"}`,
        zIndex: 15, transition: "all 0.25s ease",
      }}>
        {/* Header */}
        <div style={{
          padding: "13px 16px", borderBottom: "1px solid rgba(100,116,139,0.25)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", color: "#94a3b8" }}>
              DIGITAL TWIN INSPECTOR
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: meta ? meta.color : "#38bdf8", marginTop: 2 }}>
              {meta ? meta.label : "Select 3D Equipment"}
            </div>
            {meta && (
              <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace", marginTop: 1 }}>
                TAG: <span style={{ color: meta.color, fontWeight: 800 }}>{meta.tag}</span>
              </div>
            )}
          </div>
          {meta && (
            <button
              onClick={() => {
                onSendChat(`Perform an operational diagnostic on ${meta.label} (${meta.tag}). What are its current operating parameters and risks?`);
              }}
              style={{
                background: "linear-gradient(135deg,#6366f1,#4f46e5)",
                border: "none", borderRadius: 7, padding: "5px 9px",
                color: "white", fontSize: 10, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <Sparkles size={11} /> Diagnose
            </button>
          )}
        </div>

        {/* Content */}
        {meta ? (
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.5, marginBottom: 10 }}>
              {meta.desc}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              {meta.specs.map((s, i) => (
                <div key={i} style={{
                  background: "rgba(255,255,255,0.05)", borderRadius: 6,
                  padding: "7px 9px", border: "1px solid rgba(255,255,255,0.08)",
                }}>
                  <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: meta.color, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", marginTop: 1 }}>
                    {s.val}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ padding: "18px 16px", color: "#94a3b8", fontSize: 11.5, textAlign: "center", lineHeight: 1.6 }}>
            👆 Click on any equipment or valves in 3D to inspect real-time specs.
          </div>
        )}

        {/* SCADA Fault Injection */}
        <div style={{
          padding: "10px 16px", borderTop: "1px solid rgba(100,116,139,0.25)",
          background: "rgba(0,0,0,0.25)", borderRadius: "0 0 16px 16px",
        }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", marginBottom: 5 }}>
            SCADA FAULT SIMULATION:
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {Object.values(FAULTS).map(f => (
              <button
                key={f.id}
                onClick={() => onSetFault(f.id)}
                style={{
                  background: fault === f.id
                    ? (f.id === "NONE" ? "#10b981" : "#ef4444")
                    : "rgba(255,255,255,0.06)",
                  border: `1px solid ${fault === f.id ? "white" : "rgba(100,116,139,0.3)"}`,
                  borderRadius: 5, padding: "3px 7px",
                  color: fault === f.id ? "white" : "#cbd5e1",
                  fontSize: 9.5, fontWeight: 700, cursor: "pointer",
                }}
              >
                {f.id === "NONE" ? "🟢 Nominal" : `🚨 ${f.label.split(" ")[0]}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Free View Navigation Guide (Bottom Left) ── */}
      <div style={{
        position: "absolute", bottom: 52, left: 16,
        background: "rgba(15,23,42,0.85)", backdropFilter: "blur(12px)",
        border: "1px solid rgba(100,116,139,0.3)", borderRadius: 10,
        padding: "8px 12px", color: "#94a3b8", fontSize: 10, fontWeight: 700,
        display: "flex", flexDirection: "column", gap: 4, zIndex: 10, pointerEvents: "none",
      }}>
        <div style={{ color: "#38bdf8", fontWeight: 800, fontSize: 10.5, marginBottom: 2 }}>
          FREE 360° NAVIGATION
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <RotateCw size={11} color="#38bdf8" /> <span>Left Drag: Orbit / Rotate 360°</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Move size={11} color="#38bdf8" /> <span>Right Drag / Shift+Drag: Pan Anywhere</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ZoomIn size={11} color="#38bdf8" /> <span>Scroll Wheel: Smooth Zoom</span>
        </div>
      </div>

      {/* ── Bottom-Right: Embedded Gemini AI Copilot ── */}
      <div style={{
        position: "absolute", bottom: 52, right: 16, width: 350, maxHeight: 310,
        background: "rgba(15,23,42,0.92)", backdropFilter: "blur(20px)",
        border: "1.5px solid rgba(100,116,139,0.4)", borderRadius: 14,
        display: "flex", flexDirection: "column", overflow: "hidden",
        fontFamily: "'Inter', sans-serif", color: "white",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)", zIndex: 15,
      }}>
        <div style={{
          padding: "9px 13px", borderBottom: "1px solid rgba(100,116,139,0.25)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "linear-gradient(90deg, rgba(56,189,248,0.15), transparent)",
        }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: "#38bdf8" }}>
            🤖 COGETWIN AI COPILOT
          </span>
          <span style={{ fontSize: 9.5, color: "#10b981", fontWeight: 700 }}>● GEMINI ONLINE</span>
        </div>

        <div style={{
          flex: 1, overflowY: "auto", padding: 10,
          display: "flex", flexDirection: "column", gap: 7, maxHeight: 185,
        }}>
          {chatMessages.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 11, textAlign: "center", padding: "10px 4px", lineHeight: 1.5 }}>
              Ask about boiler heat rates, turbine vibration, or optimization recommendations…
            </div>
          ) : chatMessages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                background: m.role === "user" ? "linear-gradient(135deg,#6366f1,#4f46e5)" : "rgba(255,255,255,0.08)",
                border: m.role === "ai" ? "1px solid rgba(255,255,255,0.12)" : "none",
                borderRadius: 7, padding: "6px 10px", maxWidth: "90%",
                fontSize: 11, lineHeight: 1.5, color: m.role === "user" ? "white" : "#e2e8f0",
                whiteSpace: "pre-wrap",
              }}
            >
              {m.text}
            </div>
          ))}
          {chatSending && (
            <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5, color: "#38bdf8", fontSize: 10.5 }}>
              <Loader2 size={11} className="animate-spin" /> Reasoning with digital twin models…
            </div>
          )}
        </div>

        <div style={{
          padding: 7, borderTop: "1px solid rgba(100,116,139,0.25)",
          display: "flex", gap: 5, background: "rgba(0,0,0,0.2)",
        }}>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && chatInput.trim() && !chatSending) {
                onSendChat(chatInput.trim());
                setChatInput("");
              }
            }}
            placeholder="Ask AI about this 3D plant…"
            style={{
              flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(100,116,139,0.3)",
              borderRadius: 6, padding: "5px 9px", color: "white", fontSize: 11, outline: "none",
            }}
          />
          <button
            onClick={() => {
              if (chatInput.trim() && !chatSending) {
                onSendChat(chatInput.trim());
                setChatInput("");
              }
            }}
            disabled={chatSending || !chatInput.trim()}
            style={{
              background: chatSending || !chatInput.trim() ? "rgba(255,255,255,0.08)" : "#0284c7",
              border: "none", borderRadius: 6, width: 30,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: chatSending ? "wait" : "pointer",
            }}
          >
            <Send size={12} color="white" />
          </button>
        </div>
      </div>

      {/* ── Bottom SCADA Telemetry Ribbon ── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: 40,
        background: "rgba(10,14,22,0.96)", borderTop: "1.5px solid rgba(56,189,248,0.25)",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 26,
        color: "#94a3b8", fontSize: 11, fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <span>SYSTEM: <span style={{
          color: fault === "NONE" ? "#10b981" : "#ef4444", fontWeight: 800
        }}>
          {fault === "NONE" ? "● STEADY-STATE (LIVE)" : `🚨 FAULT: ${FAULTS[fault]?.label}`}
        </span></span>
        <div style={{ width: 1, height: 16, background: "#334155" }} />
        <span>EFFICIENCY: <span style={{ color: "#38bdf8", fontWeight: 800 }}>
          {live?.thermal_efficiency != null ? `${(live.thermal_efficiency * 100).toFixed(1)}%` : "68.2%"}
        </span></span>
        <div style={{ width: 1, height: 16, background: "#334155" }} />
        <span>TURBINE POWER: <span style={{ color: "#10b981", fontWeight: 800 }}>
          {live?.turbine_power_kW != null ? `${(live.turbine_power_kW / 1000).toFixed(2)} MW` : "9.88 MW"}
        </span></span>
        <div style={{ width: 1, height: 16, background: "#334155" }} />
        <span>CHP THERMAL: <span style={{ color: "#a855f7", fontWeight: 800 }}>8.5 MWth</span></span>
        <div style={{ width: 1, height: 16, background: "#334155" }} />
        <span>BOILER CORE: <span style={{ color: "#f97316", fontWeight: 800 }}>
          {live?.boiler_temp_C != null ? `${live.boiler_temp_C.toFixed(1)}°C` : "479.7°C"}
        </span></span>
      </div>
    </>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * MAIN ROOT 3D COMPONENT WITH UNRESTRICTED ORBIT / PAN
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function CogenerationPlant3D() {
  const [live, setLive] = useState({});
  const wsRef = useRef(null);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS);
      wsRef.current = ws;
      ws.onmessage = e => setLive(JSON.parse(e.data));
      ws.onclose = () => setTimeout(connect, 3000);
      ws.onerror = () => ws.close();
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  /* Interactivity States */
  const [selected, setSelected] = useState(null); // Deselected by default for clean view
  const [hovered, setHovered] = useState(null);
  const [showAllTags, setShowAllTags] = useState(false); // Clean 3D view by default!
  const [fault, setFault] = useState("NONE");
  const [atmosphere, setAtmosphere] = useState("DAY");
  const [soundOn, setSoundOn] = useState(false);
  const [currentView, setCurrentView] = useState("OVERVIEW");

  /* Valves State */
  const [valves, setValves] = useState({
    MSV01: { open: true, tag: "MSV-01" },
    FCV01: { open: true, tag: "FCV-01" },
    PRV01: { open: true, tag: "PRV-01" },
  });

  const toggleValve = useCallback((key) => {
    audio.playValveClick();
    setValves(prev => ({
      ...prev,
      [key]: { ...prev[key], open: !prev[key].open },
    }));
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn(prev => {
      const n = !prev;
      if (n) audio.start();
      else audio.stop();
      return n;
    });
  }, []);

  const handleSetFault = useCallback((fId) => {
    setFault(fId);
    if (fId !== "NONE") {
      audio.triggerAlarm(true);
    } else {
      audio.triggerAlarm(false);
    }
  }, []);

  /* Camera Controls Ref for Unrestricted Orbit & Pan */
  const controlsRef = useRef();
  const targetCam = useRef(null);
  const targetLook = useRef(null);
  const isTransitioning = useRef(false);

  const setCameraPreset = useCallback((key) => {
    setCurrentView(key);
    const config = CAMERAS[key];
    if (!config || !controlsRef.current) return;
    targetCam.current = new THREE.Vector3(...config.pos);
    targetLook.current = new THREE.Vector3(...config.target);
    isTransitioning.current = true;
  }, []);

  const resetCamera = useCallback(() => {
    setCameraPreset("OVERVIEW");
  }, [setCameraPreset]);

  /* Mini AI chat */
  const [chatMessages, setChatMessages] = useState([]);
  const [chatSending, setChatSending] = useState(false);

  const sendChat = useCallback(async (text) => {
    setChatMessages(m => [...m, { role: "user", text }]);
    setChatSending(true);
    try {
      const r = await fetch(`${API}/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const d = await r.json();
      setChatMessages(m => [...m, { role: "ai", text: d.response || "No response from twin." }]);
    } catch {
      setChatMessages(m => [...m, { role: "ai", text: "⚠️ Could not connect to AI backend." }]);
    } finally {
      setChatSending(false);
    }
  }, []);

  const pal = PALETTES[atmosphere] || PALETTES.DAY;

  return (
    <div style={{
      width: "100%", height: "calc(100vh - 64px)",
      position: "relative", background: pal.sky, overflow: "hidden",
    }}>
      {/* ── 3D WEBGL CANVAS ── */}
      <Canvas
        shadows
        camera={{ position: CAMERAS.OVERVIEW.pos, fov: 42 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        dpr={[1, 2]}
      >
        <color attach="background" args={[pal.sky]} />
        <fog attach="fog" args={[pal.sky, 50, 180]} />

        {/* ── Balanced Industrial Lighting Rig ── */}
        <ambientLight intensity={pal.ambientInt} color={pal.ambient} />
        <directionalLight
          position={[35, 55, 30]}
          intensity={pal.sunInt}
          castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-camera-left={-55}
          shadow-camera-right={55}
          shadow-camera-top={55}
          shadow-camera-bottom={-55}
          shadow-camera-near={0.1}
          shadow-camera-far={160}
          shadow-bias={-0.0005}
          color={pal.sun}
        />
        <hemisphereLight intensity={0.65} groundColor="#0f172a" color="#38bdf8" />

        {/* Localized Machine Point Lights */}
        <pointLight position={[-22, 12, 3]} intensity={3.0} color="#f97316" distance={40} decay={2} />
        <pointLight position={[12, 12, 3]}  intensity={2.8} color="#00e5ff" distance={38} decay={2} />
        <pointLight position={[12, 8, -16]} intensity={2.2} color="#14b8a6" distance={30} decay={2} />
        <pointLight position={[-24, 11, -26]} intensity={2.4} color="#38bdf8" distance={35} decay={2} />

        <Suspense fallback={null}>
          <CameraTransitionHook
            controlsRef={controlsRef}
            targetCam={targetCam}
            targetLook={targetLook}
            isTransitioning={isTransitioning}
          />

          {/* 1. High-Pressure Boiler Island */}
          <BoilerIsland
            live={live}
            fault={fault}
            palette={pal}
            selected={selected === "boiler"}
            hovered={hovered}
            onSelect={setSelected}
            onHover={setHovered}
            showAllTags={showAllTags}
          />

          {/* 2. Power Generation Island (Turbine + Alternator) */}
          <TurbineIsland
            live={live}
            fault={fault}
            palette={pal}
            selected={selected}
            hovered={hovered}
            onSelect={setSelected}
            onHover={setHovered}
            showAllTags={showAllTags}
          />

          {/* 3. Condenser Island */}
          <CondenserIsland
            fault={fault}
            palette={pal}
            selected={selected}
            hovered={hovered}
            onSelect={setSelected}
            onHover={setHovered}
            showAllTags={showAllTags}
          />

          {/* 4. Feedwater Island (Deaerator + BFP Pumps) */}
          <FeedwaterIsland
            palette={pal}
            selected={selected}
            hovered={hovered}
            onSelect={setSelected}
            onHover={setHovered}
            showAllTags={showAllTags}
          />

          {/* 5. Cooling Tower Yard */}
          <CoolingTowerIsland
            palette={pal}
            selected={selected}
            hovered={hovered}
            onSelect={setSelected}
            onHover={setHovered}
            showAllTags={showAllTags}
          />

          {/* 6. Auxiliary Skids (Gas Skid + High-Voltage Substation) */}
          <AuxiliarySkids
            palette={pal}
            selected={selected}
            hovered={hovered}
            onSelect={setSelected}
            onHover={setHovered}
            showAllTags={showAllTags}
          />

          {/* 7. Elevated Interconnecting Piping Network & Valves */}
          <PipingAndValves
            palette={pal}
            valves={valves}
            onToggleValve={toggleValve}
            selected={selected}
            onSelect={setSelected}
            onHover={setHovered}
            hovered={hovered}
            showAllTags={showAllTags}
          />

          {/* 8. Spacious Ground & Roadways */}
          <GroundAndGrid
            palette={pal}
            onDeselect={setSelected}
          />

          {/* ── UNRESTRICTED 360° ORBIT, PAN & ROTATE CONTROLS ── */}
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enablePan={true}
            enableRotate={true}
            enableZoom={true}
            screenSpacePanning={true}
            panSpeed={1.0}
            rotateSpeed={0.8}
            zoomSpeed={1.2}
            minDistance={3}
            maxDistance={320}
            maxPolarAngle={Math.PI / 2 + 0.35}
            enableDamping={true}
            dampingFactor={0.06}
            onStart={() => {
              isTransitioning.current = false;
            }}
          />
        </Suspense>
      </Canvas>

      {/* ── MASTER HUD INTERFACE ── */}
      <MasterHUD
        selected={selected}
        live={live}
        fault={fault}
        onSetFault={handleSetFault}
        atmosphere={atmosphere}
        onSetAtmosphere={setAtmosphere}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        currentView={currentView}
        onSetView={setCameraPreset}
        onResetCamera={resetCamera}
        showAllTags={showAllTags}
        onToggleAllTags={() => setShowAllTags(prev => !prev)}
        onSendChat={sendChat}
        chatMessages={chatMessages}
        chatSending={chatSending}
      />
    </div>
  );
}

/* Helper hook to animate camera transitions while yielding to mouse */
function CameraTransitionHook({ controlsRef, targetCam, targetLook, isTransitioning }) {
  useFrame(({ camera }) => {
    if (isTransitioning.current && targetCam.current && targetLook.current && controlsRef.current) {
      camera.position.lerp(targetCam.current, 0.05);
      controlsRef.current.target.lerp(targetLook.current, 0.05);
      controlsRef.current.update();
      if (
        camera.position.distanceTo(targetCam.current) < 0.25 &&
        controlsRef.current.target.distanceTo(targetLook.current) < 0.25
      ) {
        isTransitioning.current = false;
      }
    }
  });
  return null;
}
