"""
Supabase database helpers.
Uses the service-role key so it bypasses RLS — only used by the pipeline.
"""
from __future__ import annotations

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


def get_failed_videos(limit: int = 50) -> list:
    """Return videos whose transcript fetch failed so we can retry them."""
    db = get_db()
    return db.table("videos") \
        .select("*, sources(category)") \
        .eq("transcript_status", "failed") \
        .order("published_at", desc=True) \
        .limit(limit) \
        .execute().data


def mark_video_permanent_failure(video_id: str):
    """Mark a video as permanently unprocessable — stops future retry attempts."""
    db = get_db()
    db.table("videos").update({
        "transcript_status": "no_transcript",
    }).eq("id", video_id).execute()


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


def get_recent_embeddings(category: str, hours: int = 48) -> list[dict]:
    """Fetch recent story embeddings for clustering."""
    db = get_db()
    res = db.rpc("get_recent_embeddings_for_clustering", {
        "p_category": category,
        "p_hours": hours
    }).execute()
    return res.data


def get_or_create_cluster(category: str) -> str:
    db = get_db()
    res = db.table("clusters").insert({"category": category}).execute()
    return res.data[0]["id"]


def assign_story_to_cluster(story_id: str, cluster_id: str):
    db = get_db()
    db.table("stories").update({"cluster_id": cluster_id}).eq("id", story_id).execute()


def update_cluster(cluster_id: str, updates: dict):
    db = get_db()
    db.table("clusters").update(updates).eq("id", cluster_id).execute()


def increment_cluster_story_count(cluster_id: str):
    db = get_db()
    db.rpc("increment_cluster_story_count", {"p_cluster_id": cluster_id}).execute()


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


def start_pipeline_run() -> str:
    db = get_db()
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
