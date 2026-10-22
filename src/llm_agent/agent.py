"""
CogeTwin — LLM Agent (LangGraph Stateful Agent)
=================================================
A stateful, tool-using AI agent that helps plant operators understand
and optimize the cogeneration plant.

Tools available to the agent:
  1. get_plant_state       — current digital twin state
  2. get_optimization      — run optimizer, get setpoint recommendations
  3. get_anomaly_log       — recent anomaly events
  4. search_plant_manuals  — RAG search over documentation
  5. run_what_if           — simulate a parameter change scenario

State: conversation history (last 10 turns) + plant context
"""

from __future__ import annotations

import json
import logging
import asyncio
from langchain_core.messages import AIMessage
from datetime import datetime, timezone
from typing import Annotated, Any, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from src.config import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Agent State
# ---------------------------------------------------------------------------

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    plant_state: dict[str, Any]
    anomaly_log: list[dict]


# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are CogeTwin AI — an expert AI assistant for a 10 MW cogeneration (CHP) plant.
You have deep knowledge of:
  - Rankine cycle thermodynamics and steam power plant operations
  - Turbine, boiler, and condenser behavior
  - Energy optimization and efficiency improvement
  - Fault diagnosis and root cause analysis
  - Plant safety procedures and operating standards

You have access to tools to check real-time plant status, run optimization,
query historical anomalies, and search through plant manuals.

Guidelines:
  - Always be specific with numbers and units (MPa, °C, kg/s, kW)
  - When something is abnormal, explain WHY it's abnormal using physics
  - Recommend concrete operator actions, not vague suggestions
  - Cite sources from plant manuals when relevant
  - If uncertain, say so — plant safety is paramount
  - Keep answers concise but technically complete

Current time: {current_time}
Active LLM backend: {backend}
"""


# ---------------------------------------------------------------------------
# Tool Definitions (injected with live dependencies at runtime)
# ---------------------------------------------------------------------------

def build_tools(
    state_estimator,
    optimizer,
    anomaly_log_getter,
    rag_pipeline,
):
    """
    Build tool functions with captured dependencies.
    Returns a list of LangChain tools.
    """

    @tool
    def get_plant_state() -> str:
        """
        Get the current real-time state of the cogeneration plant digital twin.
        Returns all sensor readings and predicted KPIs.
        """
        try:
            state = state_estimator.get_current_state()
            if not state:
                return "Plant state not available — digital twin not yet initialized."
            summary = {
                "boiler_temp_C":          round(state.get("boiler_temp_C", 0), 2),
                "boiler_pressure_MPa":    round(state.get("boiler_pressure_MPa", 0), 3),
                "turbine_power_kW":       round(state.get("turbine_power_kW", 0), 1),
                "thermal_efficiency_pct": round(state.get("thermal_efficiency", 0) * 100, 2),
                "steam_waste_kgs":        round(state.get("steam_waste_kgs", 0), 3),
                "vibration_mm_s":         round(state.get("vibration_turbine_mm_s", 0), 3),
                "lube_oil_temp_C":        round(state.get("lube_oil_temp_C", 0), 1),
                "load_factor_pct":        round(state.get("load_factor", 0) * 100, 1),
                "fault_active":           state.get("fault_active", "none"),
            }
            return json.dumps(summary, indent=2)
        except Exception as e:
            return f"Error reading plant state: {e}"

    @tool
    def get_optimization_recommendation(power_demand_kW: float = 8000.0) -> str:
        """
        Run the plant optimization engine and return optimal setpoint recommendations.
        Args:
            power_demand_kW: Required electrical power output in kW (default 8000)
        """
        try:
            from src.optimizer.engine import OptimizationConfig
            current_state = state_estimator.get_current_state()
            current_setpoints = {
                "boiler_temp_C":       current_state.get("boiler_temp_C", 480),
                "boiler_pressure_MPa": current_state.get("boiler_pressure_MPa", 10.0),
                "fuel_flow_kgs":       current_state.get("fuel_flow_kgs", 0.45),
                "steam_valve_pct":     current_state.get("load_factor", 0.8),
            }
            cfg = OptimizationConfig(power_demand_kW=power_demand_kW)
            optimizer.cfg = cfg
            result = optimizer.optimize(current_setpoints)

            return json.dumps({
                "success": result.success,
                "optimal_setpoints": {k: round(v, 3) for k, v in result.optimal_setpoints.items()},
                "predicted_kpis": {k: round(v, 4) for k, v in result.predicted_kpis.items()},
                "estimated_savings": result.estimated_savings,
                "solve_time_s": result.solve_time_s,
                "message": result.message,
            }, indent=2)
        except Exception as e:
            return f"Optimization error: {e}"

    @tool
    def get_anomaly_log(limit: int = 5) -> str:
        """
        Retrieve recent plant anomaly events.
        Args:
            limit: Number of recent anomalies to return (default 5)
        """
        try:
            events = anomaly_log_getter(limit=limit)
            if not events:
                return "No anomalies detected in the recent operating window."
            return json.dumps(events, indent=2, default=str)
        except Exception as e:
            return f"Error fetching anomaly log: {e}"

    @tool
    def search_plant_manuals(query: str) -> str:
        """
        Search the plant operations manuals, maintenance guides, and fault reports.
        Use this to look up procedures, specifications, or historical incidents.
        Args:
            query: Natural language search query
        """
        try:
            return rag_pipeline.retrieve_as_text(query, k=3)
        except Exception as e:
            return f"Knowledge base search error: {e}"

    @tool
    def run_what_if(parameter: str, change_value: float) -> str:
        """
        Simulate what would happen if a plant parameter changes.
        Args:
            parameter: One of: boiler_temp_C, boiler_pressure_MPa, fuel_flow_kgs, steam_valve_pct
            change_value: How much to change it (positive or negative delta)
        """
        try:
            current_state = state_estimator.get_current_state()
            base_setpoints = {
                "boiler_temp_C":       current_state.get("boiler_temp_C", 480),
                "boiler_pressure_MPa": current_state.get("boiler_pressure_MPa", 10.0),
                "fuel_flow_kgs":       current_state.get("fuel_flow_kgs", 0.45),
                "steam_valve_pct":     current_state.get("load_factor", 0.8),
            }
            from src.optimizer.engine import SETPOINT_BOUNDS
            if parameter not in SETPOINT_BOUNDS:
                return (f"Unknown parameter '{parameter}'. "
                        f"Valid options: {list(SETPOINT_BOUNDS.keys())}")

            predicted_kpis = optimizer.what_if(base_setpoints, {parameter: change_value})
            current_kpis   = optimizer._model_fn(base_setpoints)

            return json.dumps({
                "scenario": f"{parameter} changed by {change_value:+.2f}",
                "before":   {k: round(v, 4) for k, v in current_kpis.items()},
                "after":    {k: round(v, 4) for k, v in predicted_kpis.items()},
                "delta":    {k: round(predicted_kpis.get(k, 0) - current_kpis.get(k, 0), 4)
                             for k in predicted_kpis},
            }, indent=2)
        except Exception as e:
            return f"What-if simulation error: {e}"

    return [get_plant_state, get_optimization_recommendation,
            get_anomaly_log, search_plant_manuals, run_what_if]


# ---------------------------------------------------------------------------
# Agent Builder
# ---------------------------------------------------------------------------

class CogeTwinAgent:
    """
    LangGraph-based conversational agent with tool use and memory.
    """

    def __init__(
        self,
        llm_router,
        state_estimator,
        optimizer,
        rag_pipeline,
        anomaly_log_getter=None,
    ) -> None:
        self._router          = llm_router
        self._state_estimator = state_estimator
        self._optimizer       = optimizer
        self._rag             = rag_pipeline
        self._log_getter      = anomaly_log_getter or (lambda limit=5: [])
        self._graph           = None
        self._conversation_history: list[BaseMessage] = []

    def build(self) -> "CogeTwinAgent":
        """Compile the LangGraph agent graph."""
        tools = build_tools(
            state_estimator  = self._state_estimator,
            optimizer        = self._optimizer,
            anomaly_log_getter = self._log_getter,
            rag_pipeline     = self._rag,
        )

        tool_node = ToolNode(tools)

        def call_model(state: AgentState) -> dict:
            llm = self._router.get_llm_for_chain(temperature=0.1, max_tokens=2048)
            llm_with_tools = llm.bind_tools(tools)

            system_msg = SYSTEM_PROMPT.format(
                current_time=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                backend=self._router.active_backend,
            )
            from langchain_core.messages import SystemMessage
            messages = [SystemMessage(content=system_msg)] + state["messages"]

            response = llm_with_tools.invoke(messages)
            return {"messages": [response]}

        def should_continue(state: AgentState) -> str:
            last = state["messages"][-1]
            if hasattr(last, "tool_calls") and last.tool_calls:
                return "tools"
            return END

        graph = StateGraph(AgentState)
        graph.add_node("agent", call_model)
        graph.add_node("tools", tool_node)
        graph.add_edge(START, "agent")
        graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
        graph.add_edge("tools", "agent")

        self._graph = graph.compile()
        logger.info("CogeTwin agent graph compiled with %d tools", len(tools))
        return self

    async def chat(self, user_message: str) -> dict:
        """
        Send a message and get a response.
        Returns: {response, backend, tool_calls_made}
        """
        if self._graph is None:
            self.build()

        self._conversation_history.append(HumanMessage(content=user_message))

        # Trim history to last 10 turns (20 messages)
        trimmed = self._conversation_history[-20:]

        state = AgentState(
            messages    = trimmed,
            plant_state = self._state_estimator.get_current_state(),
            anomaly_log = [],
        )

        try:
            result = await asyncio.wait_for(self._graph.ainvoke(state), timeout=25.0)
        except Exception as e:
            logger.error(f"Agent graph execution failed: {e}")
            result = {"messages": [AIMessage(content="⚠️ AI Backend Error: The model is currently unavailable or rate-limited. Please try again in a few moments.")]}
        ai_messages = [m for m in result["messages"] if isinstance(m, AIMessage)]

        if ai_messages:
            content = ai_messages[-1].content
            if isinstance(content, list):
                response_text = " ".join([b.get("text", "") for b in content if isinstance(b, dict) and "text" in b])
            else:
                response_text = str(content)
            self._conversation_history.append(ai_messages[-1])
        else:
            response_text = "I was unable to generate a response. Please try again."

        tool_calls = [
            m.name for m in result["messages"]
            if isinstance(m, ToolMessage)
        ]

        return {
            "response":        response_text,
            "backend":         self._router.active_backend,
            "model":           self._router.active_model,
            "tool_calls_made": tool_calls,
        }

    def reset(self) -> None:
        """Clear conversation history."""
        self._conversation_history.clear()

