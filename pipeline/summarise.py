"""
Claude-powered summarisation.
Uses Haiku for bullet extraction (cheap) and Sonnet for cluster synthesis (smart).
"""
from __future__ import annotations

import json
import re
from anthropic import Anthropic

from config import ANTHROPIC_API_KEY, HAIKU_MODEL, SONNET_MODEL, MAX_BULLETS

client = Anthropic(api_key=ANTHROPIC_API_KEY)

BULLET_SYSTEM = """You are a news summariser for a busy emergency medicine doctor who wants to stay informed on global affairs, geopolitics, technology, and faith-related news.
Extract the most newsworthy points from the transcript below.
Output ONLY valid JSON, no prose, no markdown fences.

Rules:
- Extract 5-8 bullet points covering all major claims, facts, and developments in the video
- Each bullet should be a complete, self-contained fact — not vague, not a summary of a summary
- For each bullet, find the transcript start_time (in seconds) of the sentence it comes from
- Be specific — always include names, numbers, countries, percentages, dates, dollar amounts where present
- If the video has multiple segments or topics, ensure each topic gets at least one bullet
- Headline: max 12 words, punchy, factual — state the most important fact
- Summary: 2 sentences, plain English, covering the who/what/why
- If transcript is an article (no timestamps), use null for timestamp_seconds
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


def truncate_transcript(transcript: str, segments: list[dict], max_chars: int = 12000) -> str:
    """Trim transcript to fit context, keeping first max_chars characters."""
    if len(transcript) <= max_chars:
        return transcript
    return transcript[:max_chars] + "\n[transcript truncated]"


def summarise_video(
    title: str,
    transcript: str,
    segments: list[dict],
    category: str
) -> dict | None:
    """
    Returns {"headline", "summary", "bullets": [{"text", "timestamp_seconds"}]}
    or None on failure.
    """
    # Build segment time index for quick lookup: text → start_time
    seg_index = {}
    for seg in segments:
        key = seg["text"].strip()[:40]
        seg_index[key] = int(seg.get("start", 0))

    # Include segment timestamps inline for Claude to reference
    if segments:
        context = f"Title: {title}\n\nTranscript with timestamps:\n"
        for seg in segments[:300]:  # First 300 segments
            context += f"[{int(seg['start'])}s] {seg['text']}\n"
    else:
        context = f"Title: {title}\n\nArticle text:\n{transcript}"

    context = truncate_transcript(context, segments)

    try:
        response = client.messages.create(
            model=HAIKU_MODEL,
            max_tokens=1024,
            system=BULLET_SYSTEM + "\n\n" + BULLET_SCHEMA,
            messages=[{"role": "user", "content": context}]
        )
        raw = response.content[0].text.strip()

        # Strip markdown fences if present
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)

        result = json.loads(raw)
        # Enforce max bullets
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
