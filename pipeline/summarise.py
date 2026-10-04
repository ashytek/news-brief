"""
Gemini-powered summarisation — all categories on gemini-2.5-flash (paid
tier, ~£2.50/month at Sept 2026 volume). See summarise_video for why Pro
and Flash-Lite are not used.

Claude fallback removed — Gemini's exponential retry in llm.py handles
transient failures. Add anthropic back to requirements.txt and uncomment
_claude_fallback() below if you ever need it again.
"""
from __future__ import annotations

import llm
from config import MAX_BULLETS, MAX_BULLETS_PROPHETIC, PROPHETIC_BULLETS_PER_SECONDS, TRANSCRIPT_WINDOW_SECONDS

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

# Wording for the short card, shared by the two main prompts and the backfill
# prompts so "short" means the same thing however it is generated (SPEC.md).
# The word caps are parameters because condensing a finished walkthrough
# overshoots them (live test, 4 Oct: 139-153 words at 35/20 against a 100-120
# target), so the backfill asks for less.
def _short_rules_news(lead_words: int, point_words: int) -> str:
    return f"""- lead — 1-2 sentences, at most {lead_words} words: what happened or what the video argues, and where it lands (the outcome or the twist). Do not just repeat the headline.
- key_points — 3-5 bullets, each ONE sentence of at most {point_words} words, each carrying a distinct, important specific. Keep every name, number, date, percentage and currency amount exactly as stated. No section titles, no timestamps, no "the video says".
- Total length 100-120 words. It must stand alone: a reader who sees only this should still know the story.
- Stay faithful. Keep attributions and hedges ("according to CNN", "alleged", "reportedly", "I think"). Never state as fact what is attributed to a source, never strengthen a claim ("raised questions" is not "exposed failures"), never merge facts from different sources into one claim, and add nothing that is not in the source."""


def _short_rules_prophetic(lead_words: int, point_words: int) -> str:
    return f"""- lead — 1-2 sentences, at most {lead_words} words: the broadcast's overall thrust and its weightiest declaration.
- key_points — 3-5 bullets, each ONE sentence of at most {point_words} words, naming the most significant declarations, visions or warnings. Quote nations, dates, numbers and names exactly as declared. Use the speaker's own terms and keep their force, but do not add labels, characterisations or doctrine the speaker did not state. Leave out [CONTEXT] items, scripture scaffolding and promotion.
- Total length 100-120 words. It must stand alone: a reader who sees only this should still know what was declared.
- Stay faithful. Attribute declarations to the speaker, keep their hedges, and add nothing that is not in the source."""


_SHORT_RULES_NEWS = _short_rules_news(35, 20)
_SHORT_RULES_PROPHETIC = _short_rules_prophetic(35, 20)

BULLET_SYSTEM = f"""You are writing a chronological video walkthrough for a busy emergency medicine doctor. He reads instead of watching — your job is to let him experience the video's full arc in two minutes, in order, with nothing important missing.

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
- MUST include at least one proper noun (person, place, or organisation) unless the event is truly abstract.

SHORT VERSION (the "short" field)
A skim card of about 120 words in total. Write it LAST, condensing the sections above, so it never contradicts them. ("The source" below is the transcript.)
{_SHORT_RULES_NEWS}

LANGUAGE
- Always write the headline, summary, short version, and every section in English, whatever language the transcript is in (e.g. Hindi). Translate faithfully; keep names and figures exact.

CONTENT CHECK
- Set has_content to false ONLY if the transcript has no usable material to summarise (e.g. silence, music only, a bare scripture reading with no commentary). Otherwise true."""

PROPHETIC_BULLET_SYSTEM = f"""You are extracting prophetic content from a ministry video for a discerning Christian leader who wants COMPREHENSIVE coverage of every prophetic element across the entire broadcast.

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
Before submitting, count your sections. Check timestamps span from early in the video to near the end. If your latest timestamp is less than 50% through the video duration, you have under-covered — go back and add more from the latter half.

SHORT VERSION (the "short" field)
A skim card of about 120 words in total. Write it LAST, condensing the sections above, so it never contradicts them. It is separate from the section list — the section-count targets above do not apply to it. ("The source" below is the transcript.)
{_SHORT_RULES_PROPHETIC}

LANGUAGE
- Always write the headline, summary, short version, and every section in English, whatever language the transcript is in (e.g. Hindi). Translate faithfully; keep names and figures exact.

CONTENT CHECK
- Set has_content to false ONLY if the transcript has no prophetic or ministry content (e.g. silence, music only, a bare scripture reading with no commentary). Otherwise true."""

# ---------------------------------------------------------------------------
# Native JSON schemas — Gemini enforces these natively; no markdown stripping needed
# ---------------------------------------------------------------------------

BULLET_SCHEMA = {
    "type": "object",
    "properties": {
        # Explicit no-content flag — replaces the old headline substring
        # check, which silently dropped real stories like "Govt says no new
        # lockdown".
        "has_content": {"type": "boolean"},
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
        # Skim card (~120 words). Declared AFTER bullets on purpose: the SDK
        # keeps this dict's key order as the generation order, so the model
        # condenses sections it has already written instead of guessing ahead.
        "short": {
            "type": "object",
            "properties": {
                "lead":       {"type": "string"},
                "key_points": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["lead", "key_points"],
        },
    },
    "required": ["has_content", "headline", "summary", "bullets", "short"],
}

# Same shape on its own — used when a short version is generated from an
# already-written story (backfill) rather than alongside the summary.
SHORT_SCHEMA = BULLET_SCHEMA["properties"]["short"]

MAX_SHORT_POINTS = 5
MIN_SHORT_POINTS = 3     # trimming never goes below this
MAX_SHORT_WORDS = 140    # ceiling for lead + points together (target 100-120)

# ---------------------------------------------------------------------------
# Transcript builder
# ---------------------------------------------------------------------------

def merge_segments(segments: list[dict], window_seconds: int = TRANSCRIPT_WINDOW_SECONDS) -> list[dict]:
    """
    Coalesce caption segments (typically one every 2-6 s) into fixed time
    windows, each keeping the start time of its first caption. A '[Ns] '
    prefix on every raw caption was ~19% of prompt characters; 30 s windows
    cut total input ~15% (measured on real IGR + prophetic captions) with
    no loss of text. Section timestamps land on a window start, i.e. at or
    just before the beat — the right direction for a deep link.
    """
    merged: list[dict] = []
    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        start = float(seg.get("start") or 0)
        if merged and start < merged[-1]["start"] + window_seconds:
            merged[-1]["text"] += " " + text
        else:
            merged.append({"start": start, "text": text})
    return merged


def build_transcript_context(title: str, transcript: str, segments: list[dict]) -> str:
    """
    Build the full transcript context.
    Uses ALL segments up to 200,000 chars — covers ~90 min of video at typical density.
    Gemini 2.5 Flash supports 1M tokens so this is well within limits.
    """
    MAX_CHARS = 200_000

    if segments:
        context = f"Title: {title}\n\nTranscript with timestamps:\n"
        for seg in merge_segments(segments):
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
# Short version (skim card)
# ---------------------------------------------------------------------------

_SHORT_FROM_SECTIONS_NEWS = f"""You condense an existing video walkthrough into a skim card for a busy emergency medicine doctor who reads instead of watching.

You are given the headline, overview and sections of a walkthrough that has already been written. Use ONLY what they say — add no facts, causes or interpretation, and keep sharp or provocative framing as it is. The overview summarises the sections: where its wording is stronger than the sections support, follow the sections. When unsure who said or found something, leave that detail out. ("The source" below is that walkthrough.)

SHORT VERSION
A skim card of about 120 words in total.
{_short_rules_news(30, 15)}

LANGUAGE
- Write in English. Keep names and figures exact."""

_SHORT_FROM_SECTIONS_PROPHETIC = f"""You condense an existing prophetic broadcast walkthrough into a skim card for a discerning Christian leader.

You are given the headline, overview and sections of a walkthrough that has already been written. Use ONLY what they say — add nothing, and do not soften the declarations. Open the lead with the speaker's name (or "the speaker") and a verb of speech such as declares, says or warns, and phrase each key point as the speaker's claim, never as established fact. The overview summarises the sections: where its wording is stronger than the sections support, follow the sections. When unsure who said something, leave that detail out. ("The source" below is that walkthrough.)

SHORT VERSION
A skim card of about 120 words in total.
{_short_rules_prophetic(30, 15)}

LANGUAGE
- Write in English. Keep names and figures exact."""


def clean_short(raw) -> dict | None:
    """
    Normalise the model's `short` block to {"lead": str, "key_points": [str]},
    or None when it is unusable. None is safe: the UI falls back to the long
    summary, whereas a card with an empty lead or no points would show a hole.
    """
    if not isinstance(raw, dict):
        return None
    lead = raw.get("lead")
    lead = lead.strip() if isinstance(lead, str) else ""
    points = raw.get("key_points")
    points = [
        p.strip() for p in points if isinstance(p, str) and p.strip()
    ] if isinstance(points, list) else []
    if not lead or not points:
        return None
    points = points[:MAX_SHORT_POINTS]
    # The prompts ask for 100-120 words; models overshoot. Trailing points are
    # the least important, so an over-long card loses its last bullet(s) — the
    # full sections stay one tap away.
    words = lambda s: len(s.split())
    while len(points) > MIN_SHORT_POINTS and words(lead) + sum(words(p) for p in points) > MAX_SHORT_WORDS:
        points.pop()
    return {"lead": lead, "key_points": points}


def short_prompt(headline: str, summary: str, bullets: list[dict], category: str) -> tuple[str, str]:
    """(system_instruction, contents) for generating a short version from an
    already-written story. Split out so the backfill's dry-run estimates cost
    from the exact text that would be sent."""
    lines = []
    for i, b in enumerate(bullets or [], 1):
        title = (b.get("title") or "").strip()
        text = (b.get("text") or "").strip()
        lines.append(f"{i}. {title} — {text}" if title else f"{i}. {text}")
    contents = f"Headline: {headline}\n\nOverview: {summary}\n\nSections:\n" + "\n".join(lines)
    system = _SHORT_FROM_SECTIONS_PROPHETIC if category == "prophetic" else _SHORT_FROM_SECTIONS_NEWS
    return system, contents


def generate_short(headline: str, summary: str, bullets: list[dict], category: str) -> dict | None:
    """Short version for a story that already exists — no transcript needed.
    Returns the cleaned {"lead", "key_points"} or None on failure."""
    system, contents = short_prompt(headline, summary, bullets, category)
    result = llm.flash_json(
        contents=contents,
        system_instruction=system,
        response_schema=SHORT_SCHEMA,
        temperature=0.2,
        max_output_tokens=1024,
        thinking_budget=0,   # explicit: omitting it leaves Flash's dynamic thinking on
    )
    return clean_short(result)


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
    Returns {"headline", "summary", "bullets": [{"text", "timestamp_seconds"}],
    "short": {"lead", "key_points"} | None} or None on failure. A missing or
    malformed short version is None, never a reason to drop the story.

    Prophetic     → Gemini 2.5 Flash with a 4096 thinking budget
    Everything else → Gemini 2.5 Flash with thinking OFF

    Pro was dropped 14 Sep 2026: every story was running on it (Pro output
    is $10/MTok and thinking bills at that rate), which is what pushed the
    bill past £10/month. A live A/B on real IGR + prophetic transcripts
    showed Flash matching Pro's coverage and preserving every hard figure
    (Flash-Lite did NOT — it dropped numbers and inverted chronology once,
    so it is deliberately not used). llm.pro_json is kept for rollback.
    """
    context = build_transcript_context(title, transcript, segments)

    if category == "prophetic":
        # Long broadcasts (60-120 min) need much higher output budget.
        # 25 bullets × ~80 tokens each + headline + summary ≈ 2.5K, but we
        # give plenty of headroom + a thinking budget for nuanced extraction
        # (Flash at 4096 reached further into a 58-min sermon than Pro at 8192).
        result = llm.flash_json(
            contents=context,
            system_instruction=PROPHETIC_BULLET_SYSTEM,
            response_schema=BULLET_SCHEMA,
            temperature=0.2,
            max_output_tokens=16384,
            thinking_budget=4096,
        )
    else:
        # thinking_budget=0 fully disables thinking on Flash (not possible on
        # Pro, min 128). Omitting it would leave Flash's dynamic thinking ON
        # and bill those tokens as output — so it is set explicitly.
        result = llm.flash_json(
            contents=context,
            system_instruction=BULLET_SYSTEM,
            response_schema=BULLET_SCHEMA,
            temperature=0.2,
            max_output_tokens=8192,   # prose sections run ~3x longer than the old bullets
            thinking_budget=0,
        )

    if not result:
        print(f"    ✗ Summarisation failed (Gemini returned None)")
        return None

    # Reject videos Gemini flags as having no usable material (scripture
    # readings, silent videos, etc.). Missing key → treat as content.
    if result.pop("has_content", True) is False:
        print(f"    · Skipped — Gemini reported no usable content: {result.get('headline', '')[:60]}")
        return None

    # Category-specific bullet cap.
    # Prophetic broadcasts get a much higher cap because they pack many distinct
    # declarations across long runtimes; the prompt also enforces a soft floor
    # of ~1 bullet per 5 min of video so coverage scales with duration.
    cap = MAX_BULLETS_PROPHETIC if category == "prophetic" else MAX_BULLETS
    result["bullets"] = result.get("bullets", [])[:cap]
    result["short"] = clean_short(result.get("short"))
    return result
