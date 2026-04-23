"""
Gemini-powered summarisation. Zero cost at current volumes (free tier).

- gemini-2.0-flash  →  general news bullets + cluster synthesis
- gemini-2.5-pro    →  prophetic extraction (1M-token context, thinking mode)

Claude fallback removed — Gemini's exponential retry in llm.py handles
transient failures. Add anthropic back to requirements.txt and uncomment
_claude_fallback() below if you ever need it again.
"""
from __future__ import annotations

import llm
from config import MAX_BULLETS

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

BULLET_SYSTEM = """You are a news summariser for a busy emergency medicine doctor who wants to stay informed on global affairs, geopolitics, technology, and faith-related news.

Extract the most newsworthy points from the full transcript below.

Rules:
- Extract 5-8 bullet points covering ALL major claims, facts, and developments — scan the ENTIRE transcript, not just the beginning
- Each bullet must be a complete, self-contained fact — specific and concrete, never vague
- For each bullet, find the transcript start_time (in seconds) of the sentence it comes from
- Always include names, numbers, countries, percentages, dates, dollar amounts where present
- If the video covers multiple topics or segments, ensure every major topic gets at least one bullet
- Headline: max 12 words, punchy, factual — state the single most important fact
- Summary: 2 sentences, plain English, covering the who/what/why
- If transcript is an article (no timestamps), use null for timestamp_seconds"""

PROPHETIC_BULLET_SYSTEM = """You are extracting prophetic content from a ministry video for a discerning Christian leader.
Your ONLY task is to extract prophetic declarations, visions, words, and warnings from across the ENTIRE video.

INCLUDE — extract these specifically:
- Direct prophetic declarations ("The Lord says...", "I hear the Spirit saying...", "God showed me...", "Thus says the Lord...")
- Visions and what was seen — include specific imagery, symbols, colours, numbers seen
- Prophetic words over specific nations, cities, leaders, regions, or groups of people
- Prophetic warnings and urgent spiritual alerts
- Declared seasons, timelines, or windows ("this year", "in 40 days", etc.)
- Names of people, nations, regions, or events spoken over prophetically

EXCLUDE completely — do not summarise these:
- General gospel preaching, Bible teaching, or scripture exposition
- Worship, prayer, or altar call descriptions
- Fundraising, ministry announcements, or promotional content
- General pastoral encouragement without a specific prophetic declaration
- Testimonies unless they contain a direct prophetic word or vision
- If a declaration appears multiple times, include it ONCE only (first occurrence)

Be precise and literal. If a nation is named, name it. If a number or date is declared, quote it exactly.
Use the prophet's own language where possible."""

SYNTHESIS_SYSTEM = """You synthesise multiple news perspectives into a structured brief for a busy doctor.
Given multiple source stories on the same event, produce:
- core_fact: one sentence — the undisputed factual core of the event
- consensus: 2-3 sentences — what all or most sources agree on
- perspectives: array of per-source angles (max 4), each with the unique framing that source adds"""

# ---------------------------------------------------------------------------
# Native JSON schemas — Gemini enforces these natively; no markdown stripping needed
# ---------------------------------------------------------------------------

BULLET_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "summary":  {"type": "string"},
        "bullets": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text":              {"type": "string"},
                    "timestamp_seconds": {"type": "integer", "nullable": True},
                },
                "required": ["text"],
            },
        },
    },
    "required": ["headline", "summary", "bullets"],
}

SYNTHESIS_SCHEMA = {
    "type": "object",
    "properties": {
        "core_fact":   {"type": "string"},
        "consensus":   {"type": "string"},
        "perspectives": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source":          {"type": "string"},
                    "angle":           {"type": "string"},
                    "timestamp_link":  {"type": "string", "nullable": True},
                },
                "required": ["source", "angle"],
            },
        },
    },
    "required": ["core_fact", "consensus", "perspectives"],
}


# ---------------------------------------------------------------------------
# Transcript builder
# ---------------------------------------------------------------------------

def build_transcript_context(title: str, transcript: str, segments: list[dict]) -> str:
    """
    Build the full transcript context.
    Uses ALL segments (no cutoff) up to 80,000 chars.
    Gemini 2.5 Pro supports 1M tokens so we can raise this limit if needed.
    """
    MAX_CHARS = 80_000

    if segments:
        context = f"Title: {title}\n\nTranscript with timestamps:\n"
        for seg in segments:
            line = f"[{int(seg['start'])}s] {seg['text']}\n"
            if len(context) + len(line) > MAX_CHARS:
                context += "\n[remaining transcript omitted — summarise what you have above]\n"
                break
            context += line
    else:
        text = transcript[:MAX_CHARS]
        if len(transcript) > MAX_CHARS:
            text += "\n[article truncated]"
        context = f"Title: {title}\n\nArticle text:\n{text}"

    return context


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def summarise_video(
    title: str,
    transcript: str,
    segments: list[dict],
    category: str,
) -> dict | None:
    """
    Returns {"headline", "summary", "bullets": [{"text", "timestamp_seconds"}]}
    or None on failure.

    Prophetic → Gemini 2.5 Pro with thinking (nuanced extraction, full context)
    General   → Gemini 2.0 Flash (cost-efficient, fast)
    """
    context = build_transcript_context(title, transcript, segments)
    is_prophetic = (category == "prophetic")

    if is_prophetic:
        result = llm.pro_json(
            contents=context,
            system_instruction=PROPHETIC_BULLET_SYSTEM,
            response_schema=BULLET_SCHEMA,
            temperature=0.2,
            max_output_tokens=3072,
            thinking_budget=4096,   # enables reasoning; raise to 8192 for complex videos
        )
    else:
        result = llm.flash_json(
            contents=context,
            system_instruction=BULLET_SYSTEM,
            response_schema=BULLET_SCHEMA,
            temperature=0.2,
            max_output_tokens=4096,
        )

    if not result:
        print(f"    ✗ Summarisation failed (Gemini returned None)")
        return None

    result["bullets"] = result.get("bullets", [])[:MAX_BULLETS]
    return result


def synthesise_cluster(
    category: str,
    stories: list[dict],
) -> dict | None:
    """
    Synthesises a multi-source cluster → {"core_fact", "consensus", "perspectives"}
    Uses Gemini Flash (free, fast).
    """
    if len(stories) < 2:
        return None

    stories_text = ""
    for i, s in enumerate(stories, 1):
        stories_text += f"\n--- Source {i}: {s['source_name']} ---\n"
        stories_text += f"Headline: {s['headline']}\n"
        stories_text += f"Summary: {s['summary']}\n"
        stories_text += "Key points:\n"
        for b in s.get("bullets", [])[:4]:
            ts = f" [{b['timestamp_seconds']}s]" if b.get("timestamp_seconds") else ""
            stories_text += f"  • {b['text']}{ts}\n"
        if s.get("video_url"):
            stories_text += f"Video: {s['video_url']}\n"

    result = llm.flash_json(
        contents=f"Category: {category}\n\nStories:\n{stories_text}",
        system_instruction=SYNTHESIS_SYSTEM,
        response_schema=SYNTHESIS_SCHEMA,
        temperature=0.2,
        max_output_tokens=2048,
    )

    return result
