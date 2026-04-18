"""
Claude-powered summarisation.
Uses Haiku for general bullet extraction and Sonnet for prophetic content + cluster synthesis.
"""
from __future__ import annotations

import json
import re
from anthropic import Anthropic

from config import ANTHROPIC_API_KEY, HAIKU_MODEL, SONNET_MODEL, MAX_BULLETS

client = Anthropic(api_key=ANTHROPIC_API_KEY)

# ---------------------------------------------------------------------------
# General news prompt (Israel, India & Global, Tech & AI)
# ---------------------------------------------------------------------------

BULLET_SYSTEM = """You are a news summariser for a busy emergency medicine doctor who wants to stay informed on global affairs, geopolitics, technology, and faith-related news.
Extract the most newsworthy points from the full transcript below.
Output ONLY valid JSON, no prose, no markdown fences.

Rules:
- Extract 5-8 bullet points covering ALL major claims, facts, and developments — scan the ENTIRE transcript, not just the beginning
- Each bullet must be a complete, self-contained fact — specific and concrete, never vague
- For each bullet, find the transcript start_time (in seconds) of the sentence it comes from
- Always include names, numbers, countries, percentages, dates, dollar amounts where present
- If the video covers multiple topics or segments, ensure every major topic gets at least one bullet
- Headline: max 12 words, punchy, factual — state the single most important fact
- Summary: 2 sentences, plain English, covering the who/what/why
- If transcript is an article (no timestamps), use null for timestamp_seconds
"""

# ---------------------------------------------------------------------------
# Prophetic content prompt — Troy Black, prophetic declarations, visions
# ---------------------------------------------------------------------------

PROPHETIC_BULLET_SYSTEM = """You are extracting prophetic content from a ministry video for a discerning Christian leader.
Your ONLY task is to extract prophetic declarations, visions, words, and warnings from across the ENTIRE video.
Output ONLY valid JSON, no prose, no markdown fences.

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

Be precise and literal. If a nation is named, name it. If a number or date is declared, quote it exactly. Use the prophet's own language where possible.

Rules:
- Extract 5-8 bullet points, one per distinct prophetic declaration or vision element — scan the ENTIRE video
- For each bullet, find the transcript start_time (in seconds) of the prophetic statement
- Headline: state the primary prophetic declaration or main theme in max 12 words
- Summary: 2 sentences capturing the core prophetic message and who/what it is over
"""

BULLET_SCHEMA = """Output this exact JSON shape:
{
  "headline": "string",
  "summary": "string",
  "bullets": [
    {"text": "string", "timestamp_seconds": integer_or_null},
    ...
  ]
}"""

SYNTHESIS_SYSTEM = """You synthesise multiple news perspectives into a structured brief for a busy doctor.
Output ONLY valid JSON. No markdown, no prose outside JSON.

Given multiple source stories on the same event, produce:
- core_fact: one sentence — the undisputed factual core of the event
- consensus: 2-3 sentences — what all or most sources agree on
- perspectives: array of per-source angles (max 4), each with the unique framing that source adds
"""


def build_transcript_context(title: str, transcript: str, segments: list[dict]) -> str:
    """
    Build the full transcript context for Claude.
    Uses ALL segments (no arbitrary cutoff) up to 80,000 chars.
    This ensures long videos (30–90 min prophetic content) are fully covered.
    """
    MAX_CHARS = 80_000

    if segments:
        context = f"Title: {title}\n\nTranscript with timestamps:\n"
        for seg in segments:  # ALL segments — no truncation at 300
            line = f"[{int(seg['start'])}s] {seg['text']}\n"
            if len(context) + len(line) > MAX_CHARS:
                context += "\n[remaining transcript omitted — summarise what you have above]\n"
                break
            context += line
    else:
        # Article text — no timestamps
        text = transcript[:MAX_CHARS]
        if len(transcript) > MAX_CHARS:
            text += "\n[article truncated]"
        context = f"Title: {title}\n\nArticle text:\n{text}"

    return context


def summarise_video(
    title: str,
    transcript: str,
    segments: list[dict],
    category: str
) -> dict | None:
    """
    Returns {"headline", "summary", "bullets": [{"text", "timestamp_seconds"}]}
    or None on failure.

    Prophetic category uses a specialised prompt (Sonnet) focused on declarations
    and visions. All other categories use the general news prompt (Haiku).
    """
    context = build_transcript_context(title, transcript, segments)

    is_prophetic = (category == "prophetic")
    system_prompt = (PROPHETIC_BULLET_SYSTEM if is_prophetic else BULLET_SYSTEM) + "\n\n" + BULLET_SCHEMA
    # Use Sonnet for prophetic (nuanced extraction) — Haiku for everything else (cost-efficient)
    model = SONNET_MODEL if is_prophetic else HAIKU_MODEL

    try:
        response = client.messages.create(
            model=model,
            max_tokens=2048,  # Increased — longer videos need more output
            system=system_prompt,
            messages=[{"role": "user", "content": context}]
        )
        raw = response.content[0].text.strip()

        # Strip markdown fences if present
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)

        result = json.loads(raw)
        result["bullets"] = result["bullets"][:MAX_BULLETS]
        return result

    except Exception as e:
        print(f"    ✗ Summarisation error: {e}")
        return None


def synthesise_cluster(
    category: str,
    stories: list[dict]  # List of {source_name, headline, summary, bullets, video_url}
) -> dict | None:
    """
    Uses Sonnet to synthesise a cluster from multiple stories.
    Returns {"core_fact", "consensus", "perspectives": [...]}
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

    schema = """{
  "core_fact": "string",
  "consensus": "string",
  "perspectives": [
    {"source": "source name", "angle": "unique framing from this source", "timestamp_link": "full youtube url with ?t=Xs or null"},
    ...
  ]
}"""

    try:
        response = client.messages.create(
            model=SONNET_MODEL,
            max_tokens=1024,
            system=SYNTHESIS_SYSTEM + "\n\nOutput JSON:\n" + schema,
            messages=[{"role": "user", "content": f"Category: {category}\n\nStories:\n{stories_text}"}]
        )
        raw = response.content[0].text.strip()
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
        return json.loads(raw)

    except Exception as e:
        print(f"    ✗ Synthesis error: {e}")
        return None
