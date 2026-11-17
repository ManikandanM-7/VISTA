"""
CogeTwin — LLM Router (Online/Offline Auto-Switch + Multi-Key Rotation)
=======================================================================
Detects internet connectivity and routes LLM calls to:
  Online  → Gemini 2.5 Flash (Google AI — with automated multi-key rotation)
  Offline → Ollama + Llama 3.2 7B (local, CPU/GPU)

The rest of the application calls this router and is
completely unaware of which backend is active.
"""

from __future__ import annotations

import asyncio
import logging
import socket
import time
from enum import Enum
from functools import lru_cache

import httpx
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_ollama import ChatOllama

from src.config import get_settings

logger = logging.getLogger(__name__)


class LLMBackend(str, Enum):
    GEMINI = "gemini"
    OLLAMA = "ollama"


class LLMRouter:
    """
    Singleton-style LLM router with automatic key rotation and offline failover.

    Usage:
        router = LLMRouter()
        response = await router.chat("Why is steam pressure dropping?")
        print(router.active_backend)   # "gemini" or "ollama"
    """

    def __init__(self, is_background: bool = False) -> None:
        self.is_background    = is_background
        self.cfg              = get_settings()
        self._backend         = LLMBackend.GEMINI
        self._last_check_time = 0.0
        self._check_interval  = 30.0     # re-check connectivity every 30s
        self._gemini_llm: ChatGoogleGenerativeAI | None = None
        self._ollama_llm: ChatOllama | None             = None

        # Build available key pool
        self._keys: list[str] = list(self.cfg.gemini_api_keys_list)
        if not self._keys and self.cfg.gemini_api_key:
            self._keys = [self.cfg.gemini_api_key]

        # Use separate initial key offsets to prevent background tasks from starving chat
        if self.is_background and len(self._keys) >= 3:
            self._key_index = 2
        else:
            self._key_index = 0

    # ------------------------------------------------------------------
    # Key Rotation & Public API
    # ------------------------------------------------------------------

    @property
    def current_api_key(self) -> str:
        """Returns the currently active Gemini API key."""
        if self._keys:
            return self._keys[self._key_index % len(self._keys)]
        if self.is_background and self.cfg.gemini_background_api_key:
            return self.cfg.gemini_background_api_key
        return self.cfg.gemini_api_key

    def rotate_key(self) -> str:
        """Rotate to the next available Gemini API key in the pool."""
        if not self._keys:
            return ""
        self._key_index = (self._key_index + 1) % len(self._keys)
        self._gemini_llm = None  # Force recreate LLM instance with new key
        new_key = self.current_api_key
        logger.warning(
            "Rotating Gemini API key to index %d (ending ...%s)",
            self._key_index,
            new_key[-6:] if len(new_key) >= 6 else new_key,
        )
        return new_key

    @property
    def active_backend(self) -> str:
        return self._backend.value

    @property
    def active_model(self) -> str:
        if self._backend == LLMBackend.GEMINI:
            return self.cfg.gemini_model
        return self.cfg.ollama_model

    async def chat(
        self,
        user_message: str,
        system_prompt: str | None = None,
        history: list[BaseMessage] | None = None,
        temperature: float = 0.1,
        max_tokens: int = 2048,
    ) -> str:
        """
        Send a chat message and return the assistant's text response.
        Auto-detects and falls back between Gemini and Ollama with multi-key rotation.
        """
        await self._refresh_backend()

        messages = self._build_messages(user_message, system_prompt, history or [])

        max_attempts = max(1, len(self._keys)) if self._backend == LLMBackend.GEMINI else 1
        for attempt in range(max_attempts):
            try:
                llm  = self._get_llm(temperature, max_tokens)
                resp: AIMessage = await llm.ainvoke(messages)
                content = resp.content
                if isinstance(content, list):
                    content = " ".join(
                        part.get("text", "") if isinstance(part, dict) else str(part)
                        for part in content
                    )
                return str(content)

            except Exception as exc:
                logger.warning(
                    "LLM call failed on %s (key index %d): %s.",
                    self._backend, self._key_index, exc
                )
                if self._backend == LLMBackend.GEMINI and len(self._keys) > 1 and attempt < max_attempts - 1:
                    self.rotate_key()
                else:
                    return await self._fallback_chat(messages, temperature, max_tokens)

        return await self._fallback_chat(messages, temperature, max_tokens)

    def get_llm_for_chain(
        self, temperature: float = 0.1, max_tokens: int = 2048
    ) -> BaseChatModel:
        """
        Returns the active LangChain LLM instance.
        Used by LangGraph agents that construct chains directly.
        """
        return self._get_llm(temperature, max_tokens)

    # ------------------------------------------------------------------
    # Connectivity Detection
    # ------------------------------------------------------------------

    async def _refresh_backend(self) -> None:
        """Re-check connectivity if the cache interval has elapsed."""
        now = time.monotonic()
        if now - self._last_check_time < self._check_interval:
            return

        online = await self._is_online()
        has_gemini = bool(self.cfg.gemini_api_key or self._keys)
        if online and has_gemini:
            self._backend = LLMBackend.GEMINI
        else:
            self._backend = LLMBackend.OLLAMA
            if not online:
                logger.info("No internet — switching to Ollama offline LLM")
            elif not has_gemini:
                logger.warning("No GEMINI_API_KEY available — using Ollama")

        self._last_check_time = now

    async def _is_online(self) -> bool:
        """
        Non-blocking check of internet connectivity.
        Tries google.com:443 (standard HTTPS) first, then fallback to DNS (8.8.8.8:53, 1.1.1.1:53).
        """
        targets = [
            ("google.com", 443),
            (self.cfg.llm_ping_host, 53),
            ("1.1.1.1", 53),
        ]
        loop = asyncio.get_event_loop()
        for host, port in targets:
            try:
                await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda h=host, p=port: socket.create_connection(
                            (h, p),
                            timeout=self.cfg.llm_ping_timeout,
                        ),
                    ),
                    timeout=self.cfg.llm_ping_timeout + 1,
                )
                return True
            except Exception:
                continue
        return False

    # ------------------------------------------------------------------
    # LLM Instances
    # ------------------------------------------------------------------

    def _get_llm(self, temperature: float, max_tokens: int) -> BaseChatModel:
        if self._backend == LLMBackend.GEMINI:
            return self._get_gemini(temperature, max_tokens)
        return self._get_ollama(temperature, max_tokens)

    def _get_gemini(self, temperature: float, max_tokens: int) -> ChatGoogleGenerativeAI:
        api_key = self.current_api_key
        if (self._gemini_llm is None
                or self._gemini_llm.temperature != temperature):
            self._gemini_llm = ChatGoogleGenerativeAI(
                model=self.cfg.gemini_model,
                google_api_key=api_key,
                temperature=temperature,
                max_output_tokens=max_tokens,
                max_retries=1,
                convert_system_message_to_human=False,
            )
        return self._gemini_llm

    def _get_ollama(self, temperature: float, max_tokens: int) -> ChatOllama:
        if (self._ollama_llm is None
                or self._ollama_llm.temperature != temperature):
            self._ollama_llm = ChatOllama(
                model=self.cfg.ollama_model,
                base_url=self.cfg.ollama_base_url,
                temperature=temperature,
                num_predict=max_tokens,
            )
        return self._ollama_llm

    # ------------------------------------------------------------------
    # Fallback
    # ------------------------------------------------------------------

    async def _fallback_chat(
        self,
        messages: list[BaseMessage],
        temperature: float,
        max_tokens: int,
    ) -> str:
        """Try the other backend when primary fails."""
        fallback = (LLMBackend.OLLAMA
                    if self._backend == LLMBackend.GEMINI
                    else LLMBackend.GEMINI)
        logger.info("Attempting fallback to %s", fallback)
        try:
            self._backend = fallback
            llm  = self._get_llm(temperature, max_tokens)
            resp = await llm.ainvoke(messages)
            return str(resp.content)
        except Exception as exc:
            logger.error("Both LLM backends failed: %s", exc)
            self._backend = LLMBackend.GEMINI  # Reset to primary Gemini for next attempt
            return (
                "⚠️ Both online (Gemini) and offline (Ollama) LLM backends are "
                "currently unavailable. Please check your Gemini API key or ensure "
                "Ollama is running (`ollama serve`)."
            )

    # ------------------------------------------------------------------
    # Message Builder
    # ------------------------------------------------------------------

    @staticmethod
    def _build_messages(
        user_message: str,
        system_prompt: str | None,
        history: list[BaseMessage],
    ) -> list[BaseMessage]:
        messages: list[BaseMessage] = []
        if system_prompt:
            messages.append(SystemMessage(content=system_prompt))
        messages.extend(history)
        messages.append(HumanMessage(content=user_message))
        return messages


@lru_cache(maxsize=1)
def get_llm_router() -> LLMRouter:
    """Application-wide singleton LLM router."""
    return LLMRouter()
