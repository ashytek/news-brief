"""
Centralised Gemini client with retry, backoff, and structured JSON output.
All LLM calls in the pipeline go through this module.

Uses google-genai v1.x SDK (from google import genai).
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from google import genai
from google.genai import types

from config import GOOGLE_API_KEY, GEMINI_FLASH_MODEL, GEMINI_PRO_MODEL

_log = logging.getLogger(__name__)
_client = genai.Client(api_key=GOOGLE_API_KEY)

# In-memory token usage tracking (reset per process)
_usage: dict[str, int] = {
    "flash_input_tokens":  0,
    "flash_output_tokens": 0,
    "pro_input_tokens":    0,
    "pro_output_tokens":   0,
    "calls":               0,
    "failures":            0,
}


def get_usage() -> dict:
    """Return a copy of token usage counters accumulated this process."""
    return dict(_usage)


def reset_usage():
    for k in _usage:
        _usage[k] = 0


# ---------------------------------------------------------------------------
# Core generation function (with manual retry/backoff, no extra deps)
# ---------------------------------------------------------------------------

def _generate(
    model: str,
    contents: str,
    system_instruction: str | None = None,
    response_schema: dict | None = None,
    temperature: float = 0.2,
    max_output_tokens: int = 2048,
    thinking_budget: int | None = None,
    max_retries: int = 4,
) -> str | None:
    """
    Call Gemini, return raw text. Retries with exponential backoff on quota/5xx.
    Returns None on permanent failure.
    """
    import time, random

    config_kwargs: dict[str, Any] = {
        "temperature": temperature,
        "max_output_tokens": max_output_tokens,
    }
    if system_instruction:
        config_kwargs["system_instruction"] = system_instruction
    if response_schema:
        config_kwargs["response_mime_type"] = "application/json"
        config_kwargs["response_schema"] = response_schema
    if thinking_budget is not None:
        config_kwargs["thinking_config"] = types.ThinkingConfig(
            thinking_budget=thinking_budget
        )

    _usage["calls"] += 1

    for attempt in range(max_retries + 1):
        try:
            resp = _client.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(**config_kwargs),
            )

            # Track token usage
            um = getattr(resp, "usage_metadata", None)
            if um:
                in_tok  = getattr(um, "prompt_token_count", 0) or 0
                out_tok = getattr(um, "candidates_token_count", 0) or 0
                if "flash" in model:
                    _usage["flash_input_tokens"]  += in_tok
                    _usage["flash_output_tokens"] += out_tok
                else:
                    _usage["pro_input_tokens"]  += in_tok
                    _usage["pro_output_tokens"] += out_tok

            return resp.text or ""

        except Exception as e:
            msg = str(e).lower()
            is_retryable = any(x in msg for x in (
                "429", "quota", "resource_exhausted", "rate", "500", "502", "503", "504"
            ))
            if is_retryable and attempt < max_retries:
                wait = min(4 * (2 ** attempt) + random.uniform(0, 2), 120)
                _log.warning(f"Gemini retryable error (attempt {attempt+1}): {str(e)[:80]}. Waiting {wait:.0f}s…")
                time.sleep(wait)
                continue

            _usage["failures"] += 1
            _log.error(f"Gemini failed after {attempt+1} attempt(s): {str(e)[:120]}")
            return None

    _usage["failures"] += 1
    return None


# ---------------------------------------------------------------------------
# Public JSON generation function
# ---------------------------------------------------------------------------

def generate_json(
    model: str,
    contents: str,
    system_instruction: str,
    response_schema: dict,
    temperature: float = 0.2,
    max_output_tokens: int = 2048,
    thinking_budget: int | None = None,
) -> dict | list | None:
    """
    Generate structured JSON output from Gemini.
    Returns parsed Python dict/list, or None on failure.
    Gemini's response_schema enforcement means markdown fences rarely appear,
    but we strip them defensively.
    """
    raw = _generate(
        model=model,
        contents=contents,
        system_instruction=system_instruction,
        response_schema=response_schema,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        thinking_budget=thinking_budget,
    )
    if not raw or not raw.strip():
        return None

    # Strip markdown fences (defensive — schema should prevent these)
    raw = re.sub(r"^```(?:json)?\n?", "", raw.strip())
    raw = re.sub(r"\n?```$", "", raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        _log.error(f"Gemini returned invalid JSON: {e}\nRaw snippet: {raw[:300]}")
        return None


# ---------------------------------------------------------------------------
# Convenience wrappers
# ---------------------------------------------------------------------------

def flash_json(
    contents: str,
    system_instruction: str,
    response_schema: dict,
    **kwargs,
) -> dict | list | None:
    """Generate JSON with Gemini 2.0 Flash (fast, free, general use)."""
    return generate_json(
        model=GEMINI_FLASH_MODEL,
        contents=contents,
        system_instruction=system_instruction,
        response_schema=response_schema,
        **kwargs,
    )


def pro_json(
    contents: str,
    system_instruction: str,
    response_schema: dict,
    **kwargs,
) -> dict | list | None:
    """Generate JSON with Gemini 2.5 Pro (1M context, thinking, prophetic use)."""
    return generate_json(
        model=GEMINI_PRO_MODEL,
        contents=contents,
        system_instruction=system_instruction,
        response_schema=response_schema,
        **kwargs,
    )
