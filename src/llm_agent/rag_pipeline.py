"""
CogeTwin — RAG Pipeline
========================
Retrieval-Augmented Generation over plant knowledge base.
Documents ingested:
  - Plant operation manuals (synthetic)
  - Equipment specifications
  - Historical fault reports
  - Safety procedures

Vector store: ChromaDB (persistent, local)
Embeddings  : sentence-transformers all-MiniLM-L6-v2 (free, local, fast)
"""

from __future__ import annotations

import logging
import textwrap
from pathlib import Path

import chromadb
from chromadb.config import Settings as ChromaSettings
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_core.documents import Document

from src.config import get_settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Synthetic Plant Knowledge Base
# ---------------------------------------------------------------------------

PLANT_DOCUMENTS = [
    Document(
        page_content=textwrap.dedent("""
            BOILER OPERATIONS MANUAL — Section 3: Pressure Control
            Normal operating pressure range: 9.0 – 10.5 MPa.
            If boiler pressure drops below 8.5 MPa, check fuel flow rate and burner settings.
            Rapid pressure drop (>0.5 MPa/min) indicates possible tube leak — initiate emergency
            shutdown procedure SOP-B-04. Steam drum level should be maintained at 50±10%.
            High pressure alarm triggers at 11.0 MPa; safety relief valve opens at 11.5 MPa.
        """).strip(),
        metadata={"source": "boiler_manual", "section": "pressure_control", "type": "manual"},
    ),
    Document(
        page_content=textwrap.dedent("""
            TURBINE MAINTENANCE GUIDE — Section 5: Vibration Analysis
            Normal turbine vibration: < 2.5 mm/s RMS.
            Warning zone: 2.5 – 5.0 mm/s — increase monitoring frequency, inspect bearings.
            Danger zone: > 5.0 mm/s — reduce load to 50%, schedule inspection within 24h.
            Critical: > 8.0 mm/s — emergency shutdown required immediately.
            Common causes of elevated vibration: bearing wear, blade erosion, shaft misalignment,
            steam quality issues (moisture content > 0.5%).
        """).strip(),
        metadata={"source": "turbine_manual", "section": "vibration", "type": "manual"},
    ),
    Document(
        page_content=textwrap.dedent("""
            EFFICIENCY OPTIMIZATION GUIDE — Section 2: Steam Waste Reduction
            Target: steam waste < 0.1 kg/s under normal operating conditions.
            Primary causes of steam waste:
              1. Process demand lower than extraction capacity — reduce extraction valve opening
              2. Steam valve drift — recalibrate control valve CV-12 quarterly
              3. Load imbalance — adjust fuel-air ratio via BMS controller
            Optimal boiler temperature for efficiency: 470–490°C at full load.
            Superheat margin should be maintained at least 30°C above saturation temperature.
            Every 1°C reduction in exhaust temperature improves boiler efficiency by ~0.25%.
        """).strip(),
        metadata={"source": "efficiency_guide", "section": "steam_waste", "type": "best_practice"},
    ),
    Document(
        page_content=textwrap.dedent("""
            FAULT REPORT: BOILER TUBE FOULING (Incident #BF-2024-07)
            Date: July 2024 | Duration: 3 days | Severity: Moderate
            Symptoms: Boiler efficiency dropped from 87% to 81%. Exhaust temperature rose
            by 28°C over 48 hours. Steam generation reduced by 8% at constant fuel flow.
            Root Cause: Scale buildup on waterside of superheater tubes (silica deposits).
            Corrective Action: Chemical descaling using citric acid solution (3% concentration),
            followed by 4-hour flush. Efficiency restored to 88%.
            Prevention: Maintain feedwater TDS < 0.5 ppm; weekly blowdown mandatory.
        """).strip(),
        metadata={"source": "fault_reports", "section": "BF-2024-07", "type": "incident_report"},
    ),
    Document(
        page_content=textwrap.dedent("""
            FAULT REPORT: BEARING WEAR (Incident #BW-2024-03)
            Date: March 2024 | Duration: 4 days | Severity: Moderate
            Symptoms: Vibration on turbine DE bearing increased from 1.8 to 4.2 mm/s over 3 days.
            Lube oil temperature elevated by 7°C. Slight increase in power output fluctuation.
            Root Cause: Inadequate lubrication due to oil filter blockage; metal particles detected
            in oil sample via spectrographic analysis.
            Corrective Action: Replace oil filter, flush lube oil system, replace bearing pads.
            Total downtime: 18 hours. Cost: ₹1.2 Lakhs.
            Prevention: Monthly oil sampling; filter replacement every 2000 operating hours.
        """).strip(),
        metadata={"source": "fault_reports", "section": "BW-2024-03", "type": "incident_report"},
    ),
    Document(
        page_content=textwrap.dedent("""
            CONDENSER OPERATIONS — Section 4: Fouling Management
            Normal condenser backpressure: 0.007 – 0.009 MPa.
            Fouling indicator: backpressure rising above 0.012 MPa at design cooling water temp.
            Each 1 kPa rise in condenser pressure reduces turbine output by ~0.3%.
            Cooling water flow should maintain 8°C temperature rise across condenser.
            Online tube cleaning system (Taprogge) should run continuously.
            Annual tube bundle inspection and mechanical cleaning required.
        """).strip(),
        metadata={"source": "condenser_manual", "section": "fouling", "type": "manual"},
    ),
    Document(
        page_content=textwrap.dedent("""
            COGENERATION OPTIMIZATION — Section 1: Heat-Power Balance
            The power-to-heat ratio (PHR) for this plant is designed at 0.45.
            Optimal extraction steam pressure for process: 0.5 MPa (saturation ~152°C).
            When process heat demand drops: reduce extraction flow, increase condenser throughput.
            When grid power demand peaks: maximize HP turbine output, minimize extraction.
            Thermal efficiency formula: η_th = (W_elec + Q_process) / Q_fuel
            Target: η_th > 70% in cogeneration mode; η_elec > 30% in power-only mode.
        """).strip(),
        metadata={"source": "cogeneration_guide", "section": "heat_power_balance", "type": "best_practice"},
    ),
    Document(
        page_content=textwrap.dedent("""
            LUBE OIL SYSTEM — Section 2: Temperature Monitoring
            Normal lube oil supply temperature: 45 – 55°C.
            High temperature alarm: 65°C — check cooler performance and cooling water flow.
            High temperature trip: 75°C — automatic turbine trip initiated.
            Low temperature interlock: < 35°C — start immersion heater, delay start.
            Oil viscosity (ISO VG 46) must be maintained; sample monthly for oxidation and metal content.
            Elevated lube oil temperature combined with high vibration = bearing failure imminent.
        """).strip(),
        metadata={"source": "lube_oil_manual", "section": "temperature", "type": "manual"},
    ),
    Document(
        page_content=textwrap.dedent("""
            FUEL SYSTEM — Section 3: Flow Control
            Natural gas fuel flow at full load: 0.52 kg/s.
            Minimum stable flame load: 0.18 kg/s (35% MCR).
            Fuel valve CV-01 characteristics: equal percentage, Cv=180.
            Signs of fuel valve sticking: step changes in flame temperature, unstable burner operation,
            fuel flow oscillations > ±5% at steady load.
            Calibrate fuel flow transmitter FT-01 quarterly using portable ultrasonic meter.
        """).strip(),
        metadata={"source": "fuel_manual", "section": "flow_control", "type": "manual"},
    ),
    Document(
        page_content=textwrap.dedent("""
            EMERGENCY PROCEDURES — Section 1: Rapid Pressure Loss
            If boiler pressure drops > 1 MPa in under 5 minutes:
              Step 1: Sound alarm, notify shift supervisor immediately.
              Step 2: Isolate feedwater control valve FCV-01.
              Step 3: Open vent valve VV-03 to relieve remaining pressure safely.
              Step 4: Shut main steam stop valve MSV-01.
              Step 5: Initiate emergency fuel shutdown via BMS panel.
              Step 6: Complete shutdown checklist SOP-E-01 before any inspection.
            Do NOT open boiler inspection ports while pressure > 0.1 MPa.
        """).strip(),
        metadata={"source": "emergency_procedures", "section": "pressure_loss", "type": "procedure"},
    ),
]


# ---------------------------------------------------------------------------
# RAG Pipeline
# ---------------------------------------------------------------------------

class PlantRAGPipeline:
    """
    Manages the ChromaDB vector store and retrieval for the LLM agent.
    Uses local HuggingFace embeddings — no external API calls for retrieval.
    """

    EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

    def __init__(self) -> None:
        self.cfg = get_settings()
        self._vectorstore: Chroma | None = None
        self._embeddings: HuggingFaceEmbeddings | None = None

    def initialize(self) -> "PlantRAGPipeline":
        """Build or load the vector store. Call once at startup."""
        logger.info("Initializing RAG pipeline ...")

        self._embeddings = HuggingFaceEmbeddings(
            model_name=self.EMBEDDING_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )

        persist_dir = str(self.cfg.chroma_persist_dir)

        # Create a persistent ChromaDB client — shared by Chroma langchain wrapper
        chroma_client = chromadb.PersistentClient(
            path=persist_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        collection_names = [c.name for c in chroma_client.list_collections()]

        if self.cfg.chroma_collection in collection_names:
            logger.info("Loading existing ChromaDB collection '%s'", self.cfg.chroma_collection)
            self._vectorstore = Chroma(
                client=chroma_client,
                collection_name=self.cfg.chroma_collection,
                embedding_function=self._embeddings,
            )
        else:
            logger.info("Building ChromaDB collection from %d documents ...", len(PLANT_DOCUMENTS))
            self._vectorstore = Chroma.from_documents(
                documents=PLANT_DOCUMENTS,
                embedding=self._embeddings,
                collection_name=self.cfg.chroma_collection,
                client=chroma_client,
            )
            logger.info("ChromaDB collection created and persisted.")

        return self

    def retrieve(self, query: str, k: int = 3) -> list[Document]:
        """
        Semantic search over the knowledge base.

        Args:
            query : Natural language question or context
            k     : Number of documents to retrieve
        Returns:
            List of most relevant Document objects
        """
        if self._vectorstore is None:
            raise RuntimeError("RAG pipeline not initialized. Call initialize() first.")
        return self._vectorstore.similarity_search(query, k=k)

    def retrieve_as_text(self, query: str, k: int = 3) -> str:
        """Convenience method — returns retrieved docs as a single formatted string."""
        docs = self.retrieve(query, k=k)
        if not docs:
            return "No relevant plant documentation found."
        parts = []
        for i, doc in enumerate(docs, 1):
            source = doc.metadata.get("source", "unknown")
            parts.append(f"[Source {i}: {source}]\n{doc.page_content}")
        return "\n\n---\n\n".join(parts)

    def add_incident_report(self, title: str, content: str, metadata: dict | None = None) -> None:
        """Dynamically add a new incident report to the knowledge base."""
        if self._vectorstore is None:
            raise RuntimeError("RAG pipeline not initialized.")
        doc = Document(
            page_content=f"{title}\n\n{content}",
            metadata={"source": "dynamic_incident", "type": "incident_report",
                      **(metadata or {})},
        )
        self._vectorstore.add_documents([doc])
        logger.info("Added incident report '%s' to knowledge base", title)
