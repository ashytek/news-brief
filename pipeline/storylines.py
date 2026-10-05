"""
Storylines (SPEC.md, catch-up phase 2): group same-event news reports into one
"developing story" and keep a short running recap of it.

How a story is assigned (news categories only; prophetic never forms one):
  1. Shortlist: same-category stories from the last 7 days with embedding
     cosine >= 0.70, best 8. Embeddings alone cannot define a storyline (same
     event: 0.63-0.90, unrelated pairs reach ~0.81 — SPEC.md "Evidence"), so
  2. one Gemini Flash call confirms which candidate, if any, is the same
     specific event. A match with a tracked storyline joins it; a match with a
     lone earlier report starts a new storyline holding both.
Recaps: one Flash call per storyline with 3+ reports whenever its report count
has moved on from the count its recap was built from (so a failed refresh heals
itself on the next run).

Two backends run the SAME engine:
  - DbBackend     live pipeline. Shortlist = the match_recent_stories RPC
                  (supabase/migrations/storylines.sql), which keeps ~10 MB of
                  embeddings per run out of the free-tier egress budget.
  - MemoryBackend backfill / dry run / tests. Shortlist in Python over a pool
                  loaded once, nothing is written, so groupings can be eyeballed
                  before the database is touched.

Fail-soft by design: a story must never be lost, and a run must never fail,
because of a storyline. Everything the live hooks do is wrapped; a missing
migration disables storylines for the process with one hint line; repeated
Gemini failures stop the calls for the rest of the run (the retry backoff would
otherwise add ~1 min per story).

Do NOT reuse the removed `clusters` table / `cluster_id` columns / clustering
code (removed July 2026 — CLAUDE.md "Feature 3"). Storylines are a different,
Ash-approved design (SPEC.md).
"""
from __future__ import annotations

import json
import math
import operator
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import db
import llm

NEWS_CATEGORIES = ("india_global", "tech_ai")

WINDOW_DAYS = 7              # candidates come from this far back; storylines go inactive after it
MIN_SIM = 0.70               # shortlist floor (SPEC.md: 0.85 misses most of a storyline, 0.70 chains)
MAX_CANDIDATES = 8
MIN_RECAP_STORIES = 3        # fewer than this and the UI shows plain headlines
MAX_RECAP_MEMBERS = 30       # newest N reports feed a recap (bounds the prompt)
MAX_CONSECUTIVE_LLM_FAILURES = 3

LOCAL_TZ = ZoneInfo("Europe/London")   # "a day" is Ash's day, like the app's day groups

_MISSING_CODES = ("PGRST202", "PGRST204", "PGRST205", "42703", "42P01", "42883")


class NotMigrated(Exception):
    """supabase/migrations/storylines.sql has not been applied yet."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _dt(value) -> datetime | None:
    if not value:
        return None
    d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _local_date(dt: datetime) -> str:
    return dt.astimezone(LOCAL_TZ).date().isoformat()


def _day_label(dt: datetime) -> str:
    d = dt.astimezone(LOCAL_TZ)
    return f"{d:%a} {d.day} {d:%b}"


def _unit(vec) -> list[float]:
    v = [float(x) for x in vec]
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def _dot(a: list[float], b: list[float]) -> float:
    return sum(map(operator.mul, a, b))


def _gist(story: dict, limit: int) -> str:
    """What a reader would see first: the short lead when there is one, else the
    start of the overview (stories are not backfilled with `short` before the
    first time this runs)."""
    short = story.get("short")
    text = short.get("lead") if isinstance(short, dict) and short.get("lead") else story.get("summary")
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] + "…"


def _brief(story: dict, limit: int = 600) -> str:
    """Lead + key points when the story has a short version, else the overview."""
    short = story.get("short")
    if isinstance(short, dict) and short.get("lead"):
        points = " ".join(f"• {p}" for p in (short.get("key_points") or []))
        text = f"{short['lead']} {points}".strip()
    else:
        text = story.get("summary") or ""
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def clean_title(raw) -> str:
    t = " ".join(raw.split()).strip(" \"'“”") if isinstance(raw, str) else ""
    return t if len(t) <= 120 else t[:120].rsplit(" ", 1)[0]


def _is_missing(exc: Exception) -> bool:
    return getattr(exc, "code", None) in _MISSING_CODES


def _check_migrated(exc: Exception) -> None:
    """Turn 'the storylines migration is not applied' into NotMigrated."""
    text = str(exc)
    if _is_missing(exc) and ("storyline" in text or "match_recent_stories" in text):
        raise NotMigrated(text[:120]) from exc


def story_from_row(row: dict) -> dict:
    """Normalise a `stories` row (with joined videos/sources) to the dict the
    engine works with."""
    video = row.get("videos") or {}
    if isinstance(video, list):
        video = video[0] if video else {}
    source = row.get("sources") or {}
    if isinstance(source, list):
        source = source[0] if source else {}
    created = _dt(row["created_at"])
    emb = row.get("embedding")
    if isinstance(emb, str):
        emb = json.loads(emb)
    return {
        "id": row["id"],
        "category": row["category"],
        "headline": row.get("headline") or "",
        "summary": row.get("summary") or "",
        "short": row.get("short"),
        "source": source.get("name") or "?",
        "created_at": created,
        "when": _dt(video.get("published_at")) or created,   # what the UI shows
        "storyline_id": row.get("storyline_id"),
        "vec": _unit(emb) if emb else None,
    }


_BASE_COLS = ["id", "category", "headline", "summary", "created_at", "videos(published_at)", "sources(name)"]
_OPTIONAL_COLS = ["short", "storyline_id"]   # absent until their migrations are run


def fetch_stories(build, *, require_storyline_id: bool = False, extra: list[str] | None = None) -> list[dict]:
    """Run build(select_string) -> rows, dropping optional columns that do not
    exist yet (`short` before stories_short.sql, `storyline_id` before
    storylines.sql) instead of failing. With require_storyline_id the latter
    raises NotMigrated — the live path cannot work without it."""
    optional = list(_OPTIONAL_COLS)
    while True:
        cols = ", ".join(_BASE_COLS + optional + (extra or []))
        try:
            return [story_from_row(r) for r in build(cols)]
        except NotMigrated:
            raise
        except Exception as e:
            bad = next((c for c in optional if c in str(e)), None) if getattr(e, "code", None) in ("42703", "PGRST204") else None
            if bad is None:
                _check_migrated(e)
                raise
            if bad == "storyline_id" and require_storyline_id:
                raise NotMigrated(str(e)[:120]) from e
            optional.remove(bad)


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

ASSIGN_SYSTEM = """You decide whether a new news report belongs to a developing story that earlier reports already cover. The reader is a busy doctor catching up after days away: he wants one card per real-world event, not ten near-identical reports.

WHAT COUNTS AS THE SAME STORY
- One specific event or incident and its direct follow-ups: the event itself, new details, eyewitness or official accounts, reactions, investigations, consequences.
- Different outlets covering it count, even when the headlines are worded very differently or one headline leaves out a name or place that another uses.
- Reports may disagree on figures or details. That does not make them different stories.

WHAT DOES NOT
- A shared broad topic, country, person, company or ongoing theme (a war, the economy, an election campaign, a bilateral relationship) when the reports are about different specific developments.
- Round-up or multi-topic videos (one headline over several unrelated items): answer null unless the report is clearly about the same single event.

HOW TO ANSWER
- Candidates are labelled A, B, C... Each is either a DEVELOPING STORY already tracked (with its title and a recent report) or a SINGLE REPORT that is not part of any story yet.
- match: the label of the ONE candidate about the same specific event as the new report, or null if none is. When unsure, null: a wrong merge could get an unrelated report marked as read unseen, while a missed merge only costs one extra row.
- title: only when match is a SINGLE REPORT (you are starting a story from those two reports): a neutral title of at most 12 words naming the event, in English. Otherwise an empty string."""

ASSIGN_SCHEMA = {
    "type": "object",
    "properties": {
        "match": {"type": "string", "nullable": True},
        "title": {"type": "string"},
    },
    "required": ["match", "title"],
}

RECAP_SYSTEM = """You write the running recap of a developing news story for a busy doctor who has been away for days. You are given every report on it so far, in date order, each as [date · source] headline — gist. Several outlets may report the same thing.

OUTPUT
- title: at most 12 words, neutral, naming the event, in English.
- so_far: one entry per EARLIER day (every day except the newest), oldest first. text is ONE sentence of at most 35 words: what happened or was reported that day. Merge reports from the same day. If the story spans a single day, so_far is an empty list.
- latest: the NEWEST day's developments in 1-3 sentences (at most 60 words): what is new, not a retelling of earlier days.

RULES
- Use only what the reports say. Keep names and figures exact. When a report attributes a claim to someone, keep the attribution; do not turn claims into facts, and add no interpretation.
- Say each fact once: no repetition across days or sources.
- If reports disagree on a figure or detail, say so plainly (for example "reports differ: 140 vs 174 killed"). Never pick one silently.
- Use the exact YYYY-MM-DD dates given in the input. Write in English."""

RECAP_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "so_far": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"date": {"type": "string"}, "text": {"type": "string"}},
                "required": ["date", "text"],
            },
        },
        "latest": {
            "type": "object",
            "properties": {"date": {"type": "string"}, "text": {"type": "string"}},
            "required": ["date", "text"],
        },
    },
    "required": ["title", "so_far", "latest"],
}


def recap_prompt(title: str, members: list[dict]) -> tuple[str, str]:
    """(system_instruction, contents) for a recap. members are story dicts in
    date order. Split out so the backfill can estimate cost from the real text."""
    lines = [f"Working title: {title}", "", "REPORTS"]
    for m in members:
        lines.append(f"[{_local_date(m['when'])} · {m['source']}] {m['headline']} — {_brief(m)}")
    return RECAP_SYSTEM, "\n".join(lines)


def clean_recap(raw, members: list[dict]) -> dict | None:
    """Validate the model's recap against the reports it was built from.
    Returns {"title", "recap": {"so_far", "latest"}} or None when unusable.

    Dates are checked against the members' real days: `latest` always carries
    the newest day (the model cannot move it), and so_far entries for unknown
    or not-earlier days are dropped rather than shown with a wrong date."""
    if not isinstance(raw, dict) or not members:
        return None
    days = sorted({_local_date(m["when"]) for m in members})
    newest = days[-1]
    latest = raw.get("latest")
    latest_text = " ".join(str(latest.get("text") or "").split()) if isinstance(latest, dict) else ""
    if not latest_text:
        return None
    so_far = []
    seen = set()
    for item in raw.get("so_far") or []:
        if not isinstance(item, dict):
            continue
        date = str(item.get("date") or "").strip()
        text = " ".join(str(item.get("text") or "").split())
        if text and date in days and date < newest and date not in seen:
            seen.add(date)
            so_far.append({"date": date, "text": text})
    so_far.sort(key=lambda e: e["date"])
    return {
        "title": clean_title(raw.get("title")),
        "recap": {"so_far": so_far, "latest": {"date": newest, "text": latest_text}},
    }


# ---------------------------------------------------------------------------
# Backends
# ---------------------------------------------------------------------------

def _group(scored: list[tuple[float, dict]], storylines: dict[str, dict]) -> list[dict]:
    """Best-first (similarity, story) pairs -> candidate entries. Reports that
    belong to one tracked storyline collapse into a single entry that shows the
    most recent of them; lone reports stay separate."""
    entries: list[dict] = []
    by_storyline: dict[str, dict] = {}
    for sim, s in scored:
        sid = s.get("storyline_id")
        sl = storylines.get(sid) if sid else None
        if sid and sl is None:
            continue    # in a storyline we know nothing about: never steal it
        if sl is None:
            entries.append({"kind": "story", "id": s["id"], "sim": sim, "story": s})
        elif sid in by_storyline:
            e = by_storyline[sid]
            if s["when"] > e["story"]["when"]:
                e["story"] = s
        else:
            e = {"kind": "storyline", "id": sid, "sim": sim, "story": s,
                 "title": sl["title"], "count": sl["count"]}
            by_storyline[sid] = e
            entries.append(e)
    return entries


class MemoryBackend:
    """All state in memory; writes nothing. Stories are added as they are
    processed, so a chronological replay sees exactly what the live pipeline
    would have seen at each point."""

    def __init__(self, stories: list[dict] | None = None):
        self.stories: dict[str, dict] = {}
        self.storylines: dict[str, dict] = {}
        self._n = 0
        for s in stories or []:
            self.add(s)

    def add(self, story: dict) -> None:
        self.stories[story["id"]] = story

    def candidates(self, story: dict) -> list[dict]:
        if story.get("vec") is None:
            return []
        floor = story["created_at"] - timedelta(days=WINDOW_DAYS)
        scored = []
        for o in self.stories.values():
            if o["id"] == story["id"] or o["category"] != story["category"] or o.get("vec") is None:
                continue
            if o["created_at"] < floor:
                continue
            sim = _dot(story["vec"], o["vec"])
            if sim >= MIN_SIM:
                scored.append((sim, o))
        scored.sort(key=lambda t: -t[0])
        return _group(scored[:MAX_CANDIDATES], self.storylines)

    def create_storyline(self, category: str, title: str) -> str:
        self._n += 1
        sid = f"S{self._n}"
        self.storylines[sid] = {"id": sid, "title": title, "category": category, "count": 0}
        return sid

    def assign(self, stories: list[dict], sid: str) -> None:
        for s in stories:
            s["storyline_id"] = sid
            self.stories[s["id"]] = s    # the story being processed is not in the pool yet
        self.storylines[sid]["count"] = sum(1 for s in self.stories.values() if s.get("storyline_id") == sid)

    def discard(self, sid: str) -> None:
        self.storylines.pop(sid, None)

    # -- recaps (used by tests / previews) --
    def recap_targets(self) -> list[dict]:
        return [dict(sl, story_count=sl["count"]) for sl in self.storylines.values()
                if sl["count"] >= MIN_RECAP_STORIES and sl.get("recap_story_count", 0) != sl["count"]]

    def members(self, sid: str) -> list[dict]:
        ms = sorted((s for s in self.stories.values() if s.get("storyline_id") == sid), key=lambda s: s["when"])
        return ms[-MAX_RECAP_MEMBERS:]

    def save_recap(self, sid: str, title: str, recap: dict, story_count: int) -> None:
        sl = self.storylines[sid]
        if title:
            sl["title"] = title
        sl["recap"] = recap
        sl["recap_story_count"] = story_count

    def snapshot(self) -> list[dict]:
        """Storylines with their members, biggest first — what the preview shows."""
        out = []
        for sid, sl in self.storylines.items():
            ms = sorted((s for s in self.stories.values() if s.get("storyline_id") == sid), key=lambda s: s["when"])
            out.append({
                "key": sid, "category": sl["category"], "title": sl["title"],
                "members": [{"id": m["id"], "headline": m["headline"], "source": m["source"],
                             "when": m["when"].isoformat()} for m in ms],
            })
        out.sort(key=lambda e: -len(e["members"]))
        return out


class DbBackend:
    """The live pipeline's backend (service-role Supabase client)."""

    def __init__(self, client=None):
        self.client = client or db.get_db()

    def fetch_story(self, story_id: str) -> dict | None:
        rows = fetch_stories(
            lambda cols: self.client.table("stories").select(cols).eq("id", story_id).execute().data,
            require_storyline_id=True,
        )
        return rows[0] if rows else None

    def candidates(self, story: dict) -> list[dict]:
        since = (story["created_at"] - timedelta(days=WINDOW_DAYS)).isoformat()
        try:
            rows = self.client.rpc("match_recent_stories", {
                "query_embedding": story["vec"],
                "p_category": story["category"],
                "p_since": since,
                "p_min_sim": MIN_SIM,
                "p_limit": MAX_CANDIDATES,
                "p_exclude_id": story["id"],
            }).execute().data
        except Exception as e:
            _check_migrated(e)
            raise
        if not rows:
            return []
        sims = {r["id"]: r["similarity"] for r in rows}
        metas = fetch_stories(
            lambda cols: self.client.table("stories").select(cols).in_("id", list(sims)).execute().data,
            require_storyline_id=True,
        )
        by_id = {m["id"]: m for m in metas}
        scored = [(sims[r["id"]], by_id[r["id"]]) for r in rows if r["id"] in by_id]
        sids = sorted({s["storyline_id"] for _, s in scored if s.get("storyline_id")})
        storylines: dict[str, dict] = {}
        if sids:
            for r in self.client.table("storylines").select("id, title, category, story_count") \
                    .in_("id", sids).execute().data:
                storylines[r["id"]] = {"id": r["id"], "title": r["title"], "category": r["category"],
                                       "count": r["story_count"]}
        return _group(scored, storylines)

    def create_storyline(self, category: str, title: str) -> str:
        return self.client.table("storylines").insert(
            {"category": category, "title": title}
        ).execute().data[0]["id"]

    def assign(self, stories: list[dict], sid: str) -> None:
        self.client.table("stories").update({"storyline_id": sid}) \
            .in_("id", [s["id"] for s in stories]).execute()
        self._refresh_counts(sid)

    def discard(self, sid: str) -> None:
        try:
            self.client.table("storylines").delete().eq("id", sid).execute()
        except Exception:
            pass    # an empty storyline row is inert (the UI needs 3+ reports)

    def _refresh_counts(self, sid: str) -> None:
        rows = self.client.table("stories").select("created_at, videos(published_at)") \
            .eq("storyline_id", sid).execute().data
        whens = []
        for r in rows:
            v = r.get("videos") or {}
            if isinstance(v, list):
                v = v[0] if v else {}
            whens.append(_dt(v.get("published_at")) or _dt(r["created_at"]))
        patch = {"story_count": len(rows)}
        if whens:
            patch["first_report_at"] = min(whens).isoformat()
            patch["last_report_at"] = max(whens).isoformat()
        self.client.table("storylines").update(patch).eq("id", sid).execute()

    # -- recaps --
    def recap_targets(self) -> list[dict]:
        since = (datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)).isoformat()
        try:
            rows = self.client.table("storylines") \
                .select("id, title, category, story_count, recap_story_count") \
                .gte("story_count", MIN_RECAP_STORIES).gte("last_report_at", since) \
                .order("last_report_at", desc=True).execute().data
        except Exception as e:
            _check_migrated(e)
            raise
        return [r for r in rows if (r.get("recap_story_count") or 0) != r["story_count"]]

    def members(self, sid: str) -> list[dict]:
        rows = fetch_stories(
            lambda cols: self.client.table("stories").select(cols).eq("storyline_id", sid)
            .order("created_at", desc=True).limit(MAX_RECAP_MEMBERS).execute().data,
            require_storyline_id=True,
        )
        return sorted(rows, key=lambda s: s["when"])

    def save_recap(self, sid: str, title: str, recap: dict, story_count: int) -> None:
        patch = {"recap": recap, "recap_story_count": story_count,
                 "recap_updated_at": datetime.now(timezone.utc).isoformat()}
        if title:
            patch["title"] = title
        self.client.table("storylines").update(patch).eq("id", sid).execute()


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class Engine:
    def __init__(self, backend):
        self.backend = backend
        self.llm_failures = 0       # consecutive; the live hook stops at MAX_CONSECUTIVE_LLM_FAILURES
        self.decisions: list[dict] = []

    @staticmethod
    def build_prompt(story: dict, entries: list[dict]) -> tuple[str, dict[str, dict]]:
        """(contents, {label: entry}). Public so the backfill can price the
        exact text it would send."""
        lines = [
            "NEW REPORT",
            f"Date: {_day_label(story['when'])} · Source: {story['source']}",
            f"Headline: {story['headline']}",
            f"Gist: {_gist(story, 450)}",
            "",
            "CANDIDATES",
        ]
        labels: dict[str, dict] = {}
        for i, e in enumerate(entries):
            label = chr(ord("A") + i)
            labels[label] = e
            s = e["story"]
            when = f"{_day_label(s['when'])}, {s['source']}"
            if e["kind"] == "storyline":
                lines.append(f'{label} — DEVELOPING STORY, {e["count"]} reports: "{e["title"]}"')
                lines.append(f"   A recent report ({when}): {s['headline']} — {_gist(s, 220)}")
            else:
                lines.append(f"{label} — SINGLE REPORT ({when}): {s['headline']}")
                lines.append(f"   {_gist(s, 250)}")
        return "\n".join(lines), labels

    def process(self, story: dict) -> dict:
        """Decide and apply one story's storyline. Returns the decision record:
        action is none (no match / no candidates), join, create, or error
        (Gemini gave nothing usable — the story simply stays unassigned)."""
        rec = {"story": story["id"], "headline": story["headline"], "category": story["category"],
               "when": story["when"].isoformat(), "candidates": 0, "best_sim": None,
               "action": "none", "target": None, "title": None, "other": None}
        try:
            entries = self.backend.candidates(story)
            rec["candidates"] = len(entries)
            if entries:
                rec["best_sim"] = round(entries[0]["sim"], 3)
                self._decide(story, entries, rec)
        finally:
            if hasattr(self.backend, "add"):
                self.backend.add(story)
            self.decisions.append(rec)
        return rec

    def _decide(self, story: dict, entries: list[dict], rec: dict) -> None:
        contents, labels = self.build_prompt(story, entries)
        result = llm.flash_json(
            contents=contents,
            system_instruction=ASSIGN_SYSTEM,
            response_schema=ASSIGN_SCHEMA,
            temperature=0.0,
            max_output_tokens=256,
            thinking_budget=0,   # explicit: omitting it leaves Flash's dynamic thinking on
        )
        if not isinstance(result, dict):
            self.llm_failures += 1
            rec["action"] = "error"
            return
        self.llm_failures = 0

        match = result.get("match")
        choice = labels.get(match.strip().strip(".:)").upper()) if isinstance(match, str) else None
        if choice is None:
            return    # null, "none", or a label we never offered: treat as no match
        title = clean_title(result.get("title"))

        if choice["kind"] == "storyline":
            sid = choice["id"]
            self.backend.assign([story], sid)
            rec.update(action="join", target=sid)
            return

        other = choice["story"]
        title = title or clean_title(other["headline"])
        sid = self.backend.create_storyline(story["category"], title)
        try:
            self.backend.assign([other, story], sid)
        except Exception:
            self.backend.discard(sid)
            raise
        rec.update(action="create", target=sid, title=title, other=other["id"])


def refresh_recaps(backend, *, limit: int | None = None) -> dict:
    """Recap every storyline with 3+ reports whose recap is out of date.
    Stops after repeated Gemini failures; a failed storyline keeps its old
    recap and is retried by the next run."""
    stats = {"targets": 0, "refreshed": 0, "failed": 0}
    consecutive = 0
    targets = backend.recap_targets()
    stats["targets"] = len(targets)
    for sl in targets[:limit] if limit else targets:
        members = backend.members(sl["id"])
        if len(members) < MIN_RECAP_STORIES:
            continue
        system, contents = recap_prompt(sl["title"], members)
        result = llm.flash_json(
            contents=contents,
            system_instruction=system,
            response_schema=RECAP_SCHEMA,
            temperature=0.2,
            max_output_tokens=2048,
            thinking_budget=0,
        )
        cleaned = clean_recap(result, members)
        if cleaned is None:
            stats["failed"] += 1
            consecutive += 1
            print(f"    ✗ Recap failed: {sl['title'][:60]}")
            if consecutive >= MAX_CONSECUTIVE_LLM_FAILURES:
                print(f"    ⚠ {consecutive} recap failures in a row — stopping recaps for this run")
                break
            continue
        consecutive = 0
        backend.save_recap(sl["id"], cleaned["title"], cleaned["recap"], sl["story_count"])
        stats["refreshed"] += 1
        print(f"    ✓ Recap: {cleaned['title'] or sl['title']} ({sl['story_count']} reports)")
    return stats


# ---------------------------------------------------------------------------
# Live hooks (called from the pipeline; never raise)
# ---------------------------------------------------------------------------

_live: Engine | None = None
_disabled = False


def reset_live() -> None:
    global _live, _disabled
    _live, _disabled = None, False


def _disable(reason: str) -> None:
    global _disabled
    _disabled = True
    print(f"    ⚠ Storylines off for this run: {reason}")


def assign_after_embed(story_id: str, category: str, embedding: list) -> None:
    """Called by cluster.embed_and_cluster_story once a story has its embedding
    — the one choke point every embed path goes through, so a story is assigned
    exactly once, when it is embedded. Never raises."""
    global _live
    if _disabled or category not in NEWS_CATEGORIES:
        return
    try:
        if _live is None:
            _live = Engine(DbBackend())
        story = _live.backend.fetch_story(story_id)
        if story is None:
            return
        story["vec"] = embedding
        rec = _live.process(story)
        if rec["action"] == "join":
            print(f"    ↳ Storyline: joined an existing one")
        elif rec["action"] == "create":
            print(f"    ↳ Storyline: new — {rec['title']}")
        elif rec["action"] == "error":
            print(f"    ↳ Storyline: no answer from Gemini (story left unassigned)")
        if _live.llm_failures >= MAX_CONSECUTIVE_LLM_FAILURES:
            _disable(f"{_live.llm_failures} Gemini failures in a row")
    except NotMigrated:
        _disable("supabase/migrations/storylines.sql has not been run")
    except Exception as e:
        print(f"    ⚠ Storyline assignment skipped (non-fatal): {str(e)[:120]}")


def refresh_recaps_live() -> None:
    """End-of-run recap refresh. Never raises."""
    if _disabled:
        return
    try:
        backend = DbBackend()
        stats = refresh_recaps(backend)
        if stats["targets"]:
            print(f"  Storyline recaps: {stats['refreshed']}/{stats['targets']} refreshed"
                  + (f", {stats['failed']} failed" if stats["failed"] else ""))
    except NotMigrated:
        _disable("supabase/migrations/storylines.sql has not been run")
    except Exception as e:
        print(f"  ⚠ Storyline recap refresh skipped (non-fatal): {str(e)[:120]}")
