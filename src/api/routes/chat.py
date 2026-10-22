"""API routes — AI Chat"""
from __future__ import annotations
from fastapi import APIRouter
from pydantic import BaseModel

router    = APIRouter()
app_state = None


class ChatRequest(BaseModel):
    message: str
    reset_history: bool = False


@router.post("/message")
async def chat_message(req: ChatRequest):
    """Send a message to the LLM agent."""
    if req.reset_history:
        app_state.agent.reset()

    result = await app_state.agent.chat(req.message)
    return {
        "response":        result["response"],
        "backend":         result["backend"],
        "model":           result["model"],
        "tool_calls_made": result["tool_calls_made"],
    }


@router.post("/reset")
async def reset_chat():
    """Clear conversation history."""
    app_state.agent.reset()
    return {"status": "conversation history cleared"}


@router.get("/llm-status")
async def llm_status():
    """Current LLM backend status."""
    router_ = app_state.llm_router
    return {
        "active_backend": router_.active_backend,
        "active_model":   router_.active_model,
        "online_model":   router_.cfg.gemini_model,
        "offline_model":  router_.cfg.ollama_model,
    }
