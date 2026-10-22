"""
CogeTwin — Anomaly Explainer
==============================
Generates structured Root Cause Analysis (RCA) reports for detected anomalies.
Uses the LLM agent + RAG to produce human-readable incident reports.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


RCA_PROMPT_TEMPLATE = """\
You are an expert cogeneration plant engineer performing a Root Cause Analysis.

ANOMALY DETECTED:
{anomaly_info}

RELEVANT PLANT DOCUMENTATION:
{rag_context}

CURRENT PLANT STATE:
{plant_state}

Write a structured Root Cause Analysis report with these exact sections:

## Anomaly Summary
[One sentence description of what happened]

## Probable Root Cause
[Most likely cause based on the symptoms and plant documentation, with reasoning]

## Contributing Factors
[2-3 bullet points of secondary contributing factors]

## Immediate Actions Required
[Numbered list of specific operator actions to take RIGHT NOW, in priority order]

## Monitoring Recommendations
[What parameters to watch closely over next 2-4 hours]

## Prevention Strategy
[Long-term prevention measures — max 3 bullet points]

Severity: {severity}
Be specific with sensor values, thresholds, and procedures. Reference documentation where relevant.
"""


class AnomalyExplainer:
    """
    Generates structured RCA reports for plant anomaly events.
    """

    def __init__(self, llm_router, rag_pipeline) -> None:
        self._router = llm_router
        self._rag    = rag_pipeline
        self._history: list[dict] = []   # In-memory anomaly log

    async def explain(
        self,
        anomaly_result: dict[str, Any],
        plant_state: dict[str, Any],
    ) -> dict:
        """
        Generate a full RCA report for an anomaly event.

        Args:
            anomaly_result : Output from AnomalyDetector.predict()
            plant_state    : Current plant state dict
        Returns:
            dict with report text and metadata
        """
        # Build a search query from the anomaly type
        anomaly_type = anomaly_result.get("anomaly_type", "unknown")
        sensor_contribs = anomaly_result.get("sensor_contributions", {})
        top_sensors = list(sensor_contribs.keys())[:3]

        search_query = f"{anomaly_type} {' '.join(top_sensors)} plant fault troubleshooting"
        rag_context  = self._rag.retrieve_as_text(search_query, k=3)

        # Format anomaly info
        anomaly_info = json.dumps({
            "anomaly_type":        anomaly_type,
            "severity":            anomaly_result.get("severity", "unknown"),
            "anomaly_score":       anomaly_result.get("anomaly_score", 0),
            "reconstruction_error": anomaly_result.get("reconstruction_error", 0),
            "top_affected_sensors": sensor_contribs,
        }, indent=2)

        # Format plant state (top relevant fields)
        state_summary = json.dumps({
            k: round(v, 3) if isinstance(v, float) else v
            for k, v in plant_state.items()
            if k not in ["timestamp", "day", "hour", "minute",
                         "cum_steam_waste_kg", "thermal_efficiency_15min_avg"]
        }, indent=2)

        prompt = RCA_PROMPT_TEMPLATE.format(
            anomaly_info = anomaly_info,
            rag_context  = rag_context,
            plant_state  = state_summary,
            severity     = anomaly_result.get("severity", "unknown").upper(),
        )

        report_text = await self._router.chat(
            user_message  = prompt,
            system_prompt = "You are a senior plant engineer writing a Root Cause Analysis report.",
            temperature   = 0.15,
            max_tokens    = 1500,
        )

        event = {
            "id":            len(self._history) + 1,
            "timestamp":     datetime.now(timezone.utc).isoformat(),
            "anomaly_type":  anomaly_type,
            "severity":      anomaly_result.get("severity", "unknown"),
            "anomaly_score": anomaly_result.get("anomaly_score", 0),
            "top_sensors":   top_sensors,
            "rca_report":    report_text,
            "llm_backend":   self._router.active_backend,
        }
        self._history.append(event)

        logger.info("RCA generated for anomaly: %s (severity=%s, backend=%s)",
                    anomaly_type, event["severity"], event["llm_backend"])
        return event

    def get_log(self, limit: int = 10) -> list[dict]:
        """Return the most recent anomaly events."""
        return list(reversed(self._history))[:limit]

    def get_event(self, event_id: int) -> dict | None:
        for event in self._history:
            if event["id"] == event_id:
                return event
        return None
