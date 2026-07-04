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
from config import MAX_BULLETS, MAX_BULLETS_PROPHETIC, PROPHETIC_BULLETS_PER_SECONDS

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

BULLET_SYSTEM = """You are writing a chronological video walkthrough for a busy emergency medicine doctor. He reads instead of watching — your job is to let him experience the video's full arc in two minutes, in order, with nothing important missing.

OVERVIEW (the "summary" field)
- 2-4 sentences of flowing prose capturing the video's THESIS, not merely its topic: what question it explores, what it argues, and where it lands.
- If the video carries a tension or a twist ("X looks responsible, but the real driver is Y"), the overview MUST carry that arc — set-up AND conclusion.
- No throat-clearing. "This video discusses…" is banned. Write like the opening paragraph of a good briefing note.

SECTIONS (the "bullets" field — chronological sections, NOT importance-ranked bullets)
Walk the video START to END, in order. Each section = one beat/topic of the video.
Each section must have:
- timestamp_seconds — where this beat begins in the transcript
- title — a descriptive mini-headline for the beat, 3-8 words. Written like a section header: "The Mechanics of an Omega Block", "The Primary Factor: El Niño", "Broadcast Outro". Never generic ("Introduction", "More Details").
- text — 2-4 sentences of explanatory prose:
  · EXPLAIN THE MECHANISM, not just the claim. If the presenter explains how something works, teach it back clearly (e.g. what an Omega block is and why it stalls jet streams — not just "an Omega block is causing it").
  · Keep every hard specific exactly as stated: names, numbers, dates, percentages, temperatures, currency amounts.
  · Preserve sharp, provocative, or controversial framing in the presenter's own words — never soften or abstract it.
  · Flowing sentences, not telegraphic fragments.

COVERAGE RULES
- Sections must span the ENTIRE runtime: first section at/near the start, last section at/near the end. Do not cluster sections in the opening third.
- A ~5-minute segment needs roughly 4-6 sections; a ~10-minute piece 6-9. Every distinct topic gets its own section.
- If the video ends with promotion or sign-off, include it as a brief one-line final section (title like "Broadcast Outro") so the walkthrough visibly reaches the end.
- NO OVERLAP: each beat appears exactly once, in its chronological place.
- If the transcript is an article (no timestamps), use null for timestamp_seconds and order sections as the article flows.

HEADLINE
- Max 12 words, punchy, factual.
- MUST include at least one proper noun (person, place, or organisation) unless the event is truly abstract."""

PROPHETIC_BULLET_SYSTEM = """You are extracting prophetic content from a ministry video for a discerning Christian leader who wants COMPREHENSIVE coverage of every prophetic element across the entire broadcast.

═══ COVERAGE — NON-NEGOTIABLE ═══
1. The transcript may be 30 minutes, 1 hour, or 2+ hours. You MUST cover the ENTIRE video — NOT just the opening section.
2. Mentally divide the transcript into TIME WINDOWS of 5 minutes each. From EVERY 5-minute window that contains any prophetic content, you MUST extract at least one bullet. Use the timestamps in the transcript to verify your coverage spans the full duration.
3. Before finalising, scan your bullet timestamps. If the gap between two consecutive bullets exceeds 8 minutes AND there is prophetic content in that gap, you MUST add a bullet for it.
4. Aim for 12-25 bullets total for a long broadcast (60+ min). Short videos (under 15 min) can have 5-10 bullets. NEVER stop at 5-8 bullets for a long video — that is failure.
5. The LAST 20% of the video often contains the most concentrated prophetic declarations and altar moments. Pay extra attention to the final third — do not let your bullets cluster only at the start.

═══ INCLUDE — extract every instance ═══
- Direct prophetic declarations ("The Lord says...", "I hear the Spirit saying...", "God showed me...", "Thus says the Lord...", "I prophesy...", "I decree...", "I release...")
- Visions and what was seen — include specific imagery, symbols, colours, numbers, animals, locations
- Prophetic words over specific nations, cities, leaders, regions, governments, industries, churches, denominations, or groups
- Prophetic warnings, urgent spiritual alerts, calls to repentance or watchfulness
- Declared seasons, timelines, windows, dates ("this year", "in 40 days", "by November", "the next 7 years")
- Dreams shared and their interpretations
- Discernment about spiritual climate, principalities, demonic strategies named specifically
- Prophetic intercession patterns — what the speaker is praying INTO based on revelation
- Prophetic acts (declarations through symbolic action — anointing, decreeing, breaking)
- Names of people, nations, regions, ministries, or events spoken over prophetically
- Confirmations or echoes of prior prophecies the speaker references

═══ ALSO CAPTURE (mark with [CONTEXT] prefix) ═══
- Scripture passages used as the foundation of a prophetic word — quote the reference
- Personal testimonies that anchor or confirm a prophetic declaration
- Historical or political context the prophet provides to frame a word

═══ EXCLUDE only ═══
- Pure fundraising, channel promotion, conference advertising
- Off-topic small talk, technical issues, audio checks
- Generic worship lyrics with no prophetic interpretation attached

═══ STYLE — chronological walkthrough sections ═══
Each extracted item is a SECTION of a chronological walkthrough, in video order:
- timestamp_seconds — where this moment begins
- title — a 3-8 word mini-headline naming the declaration/vision/word (e.g. "Vision: Three Storms Over Britain", "Decree Over India's Government", "[CONTEXT] Isaiah 60 Foundation"). Keep the [CONTEXT] prefix ON THE TITLE for context items.
- text — 2-4 sentences of flowing prose. Be precise and literal: if a nation is named, name it; if a number or date is declared, quote it exactly. Use the prophet's own language and preserve their force and edge — do not soften. Give enough of the surrounding moment that the reader experiences the broadcast's flow, not a fragment.
- Avoid duplication — if a declaration repeats, include it ONCE at first occurrence.
- The overview ("summary" field): 2-4 sentences of prose capturing the broadcast's overall thrust and its weightiest declarations.

═══ OUTPUT VERIFICATION ═══
Before submitting, count your sections. Check timestamps span from early in the video to near the end. If your latest timestamp is less than 50% through the video duration, you have under-covered — go back and add more from the latter half."""

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
                    "title":             {"type": "string"},
                    "text":              {"type": "string"},
                    "timestamp_seconds": {"type": "integer", "nullable": True},
                },
                # title required for the walkthrough format; stories created
                # before this change simply lack the key (frontend falls back
                # to the old dot-bullet rendering for those).
                "required": ["title", "text"],
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
    Uses ALL segments up to 200,000 chars — covers ~90 min of video at typical density.
    Gemini 2.5 Flash supports 1M tokens so this is well within limits.
    """
    MAX_CHARS = 200_000

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

    Prophetic     → Gemini 2.5 Pro with thinking (nuanced extraction)
    India/Global  → Gemini 2.5 Pro (geopolitics benefits from deeper reasoning)
    Others        → Gemini 2.5 Flash (cost-efficient)
    """
    context = build_transcript_context(title, transcript, segments)

    if category == "prophetic":
        # Long broadcasts (60-120 min) need much higher output budget.
        # 25 bullets × ~80 tokens each + headline + summary ≈ 2.5K, but we
        # give plenty of headroom + thinking budget for nuanced extraction.
        result = llm.pro_json(
            contents=context,
            system_instruction=PROPHETIC_BULLET_SYSTEM,
            response_schema=BULLET_SCHEMA,
            temperature=0.2,
            max_output_tokens=16384,
            thinking_budget=8192,
        )
    elif category == "india_global":
        result = llm.pro_json(
            contents=context,
            system_instruction=BULLET_SYSTEM,
            response_schema=BULLET_SCHEMA,
            temperature=0.2,
            max_output_tokens=8192,   # prose sections run ~3x longer than the old bullets
            thinking_budget=2048,
        )
    else:
        result = llm.flash_json(
            contents=context,
            system_instruction=BULLET_SYSTEM,
            response_schema=BULLET_SCHEMA,
            temperature=0.2,
            max_output_tokens=8192,   # prose sections run ~3x longer than the old bullets
        )

    if not result:
        print(f"    ✗ Summarisation failed (Gemini returned None)")
        return None

    # Reject no-content sentinels Gemini sometimes returns when a video has
    # no usable material (scripture readings, silent videos, etc.)
    headline = result.get("headline", "")
    NO_CONTENT_PHRASES = ("no new", "no prophetic", "no content", "no information", "scripture reading", "no news")
    if any(p in headline.lower() for p in NO_CONTENT_PHRASES):
        print(f"    · Skipped — Gemini reported no usable content: {headline[:60]}")
        return None

    # Category-specific bullet cap.
    # Prophetic broadcasts get a much higher cap because they pack many distinct
    # declarations across long runtimes; the prompt also enforces a soft floor
    # of ~1 bullet per 5 min of video so coverage scales with duration.
    cap = MAX_BULLETS_PROPHETIC if category == "prophetic" else MAX_BULLETS
    result["bullets"] = result.get("bullets", [])[:cap]
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
        max_output_tokens=4096,
    )

    return result
