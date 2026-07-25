"""
Supabase database helpers.
Uses the service-role key so it bypasses RLS — only used by the pipeline.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY

_client: Client | None = None


def get_db() -> Client:
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client


def get_active_sources():
    db = get_db()
    return db.table("sources").select("*").eq("is_active", True).execute().data


def get_failed_videos(limit: int = 50, max_age_days: int = 14) -> list:
    """Return videos whose transcript fetch failed so we can retry them.

    Videos published more than max_age_days ago are excluded — they have
    been retried many times already and are very unlikely to ever succeed
    (e.g. unrecognised permanent error, sustained IP block that never cleared).
    expire_stale_failures() handles marking those as no_transcript in bulk.
    """
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    return db.table("videos") \
        .select("*, sources(category)") \
        .eq("transcript_status", "failed") \
        .gte("published_at", cutoff) \
        .order("published_at", desc=True) \
        .limit(limit) \
        .execute().data


def expire_stale_failures(max_age_days: int = 14) -> int:
    """Mark failed videos older than max_age_days as no_transcript.

    This prevents the retry queue from accumulating videos that have been
    failing for weeks — whether due to an unrecognised permanent error message
    or a sustained IP block that never cleared. Returns the count updated.
    """
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    res = db.table("videos") \
        .update({"transcript_status": "no_transcript"}) \
        .eq("transcript_status", "failed") \
        .lt("published_at", cutoff) \
        .execute()
    return len(res.data)


def mark_video_permanent_failure(video_id: str):
    """Mark a video as permanently unprocessable — stops future retry attempts."""
    db = get_db()
    db.table("videos").update({
        "transcript_status": "no_transcript",
    }).eq("id", video_id).execute()


def get_videos_missing_stories(limit: int = 30, lookback_hours: int = 72) -> list:
    """Videos whose transcript was fetched successfully but never produced a
    story (summarise_video returned None — e.g. Gemini quota exhausted
    mid-run). Nothing else in the scheduled pipeline revisits these, so they
    were silently lost forever without this. Bounded lookback avoids
    re-scanning the whole table on every run."""
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=lookback_hours)).isoformat()
    fetched = db.table("videos") \
        .select("id, title, url, published_at, transcript_text, source_id") \
        .eq("transcript_status", "fetched") \
        .gte("fetched_at", cutoff) \
        .order("fetched_at", desc=True) \
        .limit(limit * 3) \
        .execute().data
    if not fetched:
        return []
    video_ids = [v["id"] for v in fetched]
    has_story = db.table("stories") \
        .select("video_id") \
        .in_("video_id", video_ids) \
        .execute().data
    covered = {s["video_id"] for s in has_story}
    return [v for v in fetched if v["id"] not in covered][:limit]


def get_stories_missing_embeddings(limit: int = 50) -> list:
    """Return stories that were summarised but not yet embedded (e.g. after a crash)."""
    db = get_db()
    return db.table("stories") \
        .select("id, headline, summary, category") \
        .is_("embedding", "null") \
        .order("created_at", desc=True) \
        .limit(limit) \
        .execute().data


def video_exists(source_id: str, external_id: str) -> bool:
    db = get_db()
    res = db.table("videos") \
        .select("id") \
        .eq("source_id", source_id) \
        .eq("external_id", external_id) \
        .limit(1) \
        .execute()
    return len(res.data) > 0


def upsert_video(record: dict) -> str:
    """Returns the video UUID."""
    db = get_db()
    res = db.table("videos").upsert(record, on_conflict="source_id,external_id").execute()
    return res.data[0]["id"]


def update_video_transcript(video_id: str, transcript: str, status: str):
    db = get_db()
    db.table("videos").update({
        "transcript_text": transcript,
        "transcript_status": status,
        "fetched_at": "now()"
    }).eq("id", video_id).execute()


def insert_story(record: dict) -> str:
    db = get_db()
    res = db.table("stories").insert(record).execute()
    return res.data[0]["id"]


def mark_source_success(source_id: str):
    db = get_db()
    db.table("sources").update({
        "last_checked_at": "now()",
        "last_success_at": "now()",
        "consecutive_failures": 0
    }).eq("id", source_id).execute()


def mark_source_failure(source_id: str):
    db = get_db()
    db.rpc("increment_source_failure", {"p_source_id": source_id}).execute()


def log_pipeline_run(status: str, stats: dict) -> str:
    db = get_db()
    res = db.table("pipeline_runs").insert({
        "status": status,
        "finished_at": "now()",
        **stats
    }).execute()
    return res.data[0]["id"]


def start_pipeline_run(trigger_source: str = "schedule") -> str:
    db = get_db()
    try:
        res = db.table("pipeline_runs").insert({
            "status": "running",
            "trigger_source": trigger_source,
        }).execute()
    except Exception:
        # trigger_source column may not exist yet — ignore and insert
        # without it (see supabase/migrations/pipeline_runs_trigger_source.sql).
        # A run must never fail to start over an optional/cosmetic column.
        res = db.table("pipeline_runs").insert({"status": "running"}).execute()
    return res.data[0]["id"]


def finish_pipeline_run(run_id: str, status: str, stats: dict):
    db = get_db()
    db.table("pipeline_runs").update({
        "status": status,
        "finished_at": "now()",
        **stats
    }).eq("id", run_id).execute()


def get_topic_keywords() -> list[str]:
    """Return all active topic keyword strings from the topic_keywords table."""
    db = get_db()
    res = db.table("topic_keywords").select("keyword").eq("is_active", True).execute()
    return [row["keyword"] for row in res.data]


def tag_story_topics(story_id: str, matched_topics: list[str]):
    """Write the matched_topics array to a story row."""
    db = get_db()
    db.table("stories").update({
        "matched_topics": matched_topics
    }).eq("id", story_id).execute()
