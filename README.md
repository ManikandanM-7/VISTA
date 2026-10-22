# VISTA — Cognitive Digital Twin for Cogeneration Plant Optimization

> **Cognitive Digital Twin with Real-Time Anomaly Detection and LLM-Augmented Root Cause Analysis for Cogeneration Plant Optimization**

A full-stack, production-grade Cognitive Digital Twin (CDT) system for monitoring, diagnosing, and optimizing a 10 MW cogeneration (CHP) plant in real time.

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite, React Router v7, Three.js, Apache ECharts, Tailwind CSS v4 |
| **3D Visualization** | `@react-three/fiber`, `@react-three/drei` |
| **Backend** | FastAPI, Uvicorn (ASGI), Python 3.11+ |
| **ML / DL** | PyTorch (BiLSTM + LSTM Autoencoder), scikit-learn |
| **LLM Agent** | Google Gemini 2.5 Flash, LangChain, LangGraph (ReAct) |
| **RAG** | FAISS (in-memory), `sentence-transformers/all-MiniLM-L6-v2` |
| **Real-time** | WebSocket (native FastAPI, 1 Hz broadcast) |

---

## ✨ Features

- **Live Twin Dashboard** — Real-time glassmorphism dashboard streaming all 74 plant sensors at 1 Hz via WebSocket
- **3D Digital Twin** — Interactive 3D plant model built with Three.js; anomalies are spatially overlaid on the physical component
- **BiLSTM State Estimator** — Predicts KPIs (thermal efficiency, turbine power, etc.) from a 60-step sensor window
- **LSTM Autoencoder Anomaly Detector** — Unsupervised anomaly detection on 74 multivariate sensor streams
- **RAG-Augmented AI Chat** — Conversational agent grounded in plant documentation via FAISS vector search + Gemini LLM
- **Optimizer** — Setpoint recommendation engine for peak demand scenarios
- **Anomaly Log** — Full log with LLM-generated Root Cause Analysis reports per event

---

## 🚀 Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- A [Google Gemini API Key](https://aistudio.google.com/app/apikey)

### 1. Clone the repo
```bash
git clone https://github.com/ManikandanM-7/VISTA.git
cd VISTA
```

### 2. Backend Setup
```bash
# Create virtual environment
python -m venv .venv
.\.venv\Scripts\activate   # Windows
source .venv/bin/activate  # Mac/Linux

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

### 3. Frontend Setup
```bash
cd frontend
npm install
```

### 4. Run the app
**Terminal 1 — Backend:**
```bash
# From project root
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --host 0.0.0.0 --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) 🚀

---

## 📁 Project Structure

```
VISTA/
├── src/
│   ├── api/               # FastAPI app + routes (plant, chat, optimizer, anomalies)
│   ├── digital_twin/      # BiLSTM state estimator + LSTM Autoencoder
│   ├── llm_agent/         # LLM router, LangGraph agent, RAG pipeline, explainer
│   └── optimizer/         # Setpoint optimization engine
├── frontend/
│   └── src/
│       └── pages/         # LiveTwin, Plant3D, ChatPage, OptimizerPage, AnomalyLog
├── models/                # Trained model weights (not tracked in git)
├── data/
│   └── processed/         # Scaler + feature metadata
├── .env.example           # Template for environment variables
└── requirements.txt
```

---

## 🔑 Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
```

---

## 👥 Team

Built as a Final Year Engineering Project.

**Project Title:** *Cognitive Digital Twin with Real-Time Anomaly Detection and LLM-Augmented Root Cause Analysis for Cogeneration Plant Optimization*
