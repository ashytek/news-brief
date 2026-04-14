"""
Clusters stories that cover the same event using pgvector cosine similarity.
Uses Google text-embedding-004 via direct REST API (bypasses SDK namespace issues).
Also triggers Sonnet synthesis for clusters with 2+ stories.
"""
from __future__ import annotations

import requests
from supabase import Client
import db
import summarise
from config import GOOGLE_API_KEY, CLUSTER_THRESHOLD

EMBEDDING_MODEL = "models/gemini-embedding-001"
EMBEDDING_DIM = 3072
_EMBED_URL = f"https://generativelanguage.googleapis.com/v1beta/{EMBEDDING_MODEL}:embedContent"


def get_embedding(text: str) -> list:
    """Get embedding vector via direct REST call to Google's v1beta API."""
    payload = {
        "model": EMBEDDING_MODEL,
        "content": {
            "parts": [{"text": text[:8000]}]
        }
    }
    resp = requests.post(
        _EMBED_URL,
        params={"key": GOOGLE_API_KEY},
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]["values"]


def find_or_create_cluster(
    story_id: str,
    story_embedding: list,
    category: str
) -> tuple:
    """
    Find a similar story within the threshold using pgvector.
    Returns (cluster_id, is_new_cluster):
    - (existing_id, False) → matched story already in a cluster, join it
    - (new_id,      True)  → matched story was solo, new cluster created for both
    - (None,        False) → no match, stay solo
    """
    supabase_db: Client = db.get_db()

    result = supabase_db.rpc("find_similar_cluster", {
        "p_embedding": story_embedding,
        "p_category": category,
        "p_story_id": story_id,
        "p_threshold": CLUSTER_THRESHOLD,
    }).execute()

    matches = result.data
    if not matches:
        return None, False

    match = matches[0]
    existing_cluster_id = match.get("cluster_id")
    matched_story_id = match.get("matched_story_id")

    if existing_cluster_id:
        # Matched story is already in a cluster — join it
        return existing_cluster_id, False

    # Matched story is solo — birth a new cluster and pull both stories in
    cluster_res = supabase_db.table("clusters").insert({
        "category": category,
        "story_count": 2,
    }).execute()
    new_cluster_id = cluster_res.data[0]["id"]

    # Assign the previously-solo matched story
    supabase_db.table("stories").update({
        "cluster_id": new_cluster_id
    }).eq("id", matched_story_id).execute()

    return new_cluster_id, True


def embed_and_cluster_story(
    story_id: str,
    headline: str,
    summary: str,
    category: str,
) -> str | None:
    """
    Generate embedding for a story, store it, and try to assign a cluster.
    Returns cluster_id if matched, None if solo.
    """
    text_to_embed = f"{headline}. {summary}"
    print(f"    Embedding: {text_to_embed[:60]}…")

    embedding = get_embedding(text_to_embed)

    db.get_db().table("stories").update({
        "embedding": embedding
    }).eq("id", story_id).execute()

    cluster_id, is_new_cluster = find_or_create_cluster(story_id, embedding, category)

    if cluster_id:
        action = "Formed new cluster" if is_new_cluster else "Joined cluster"
        print(f"    → {action} {cluster_id[:8]}…")
        db.assign_story_to_cluster(story_id, cluster_id)
        if not is_new_cluster:
            # Only increment for existing clusters — new clusters already set story_count=2
            db.increment_cluster_story_count(cluster_id)
        return cluster_id

    print(f"    → Solo story")
    return None


def synthesise_ready_clusters():
    """
    Find clusters with 2+ stories that haven't been synthesised yet
    and run Sonnet synthesis on them.
    """
    supabase_db: Client = db.get_db()

    result = supabase_db.table("clusters") \
        .select("id, category, story_count") \
        .gte("story_count", 2) \
        .is_("synthesised_at", "null") \
        .execute()

    clusters = result.data
    print(f"  {len(clusters)} cluster(s) need synthesis")

    for cluster in clusters:
        cluster_id = cluster["id"]
        category = cluster["category"]

        stories_result = supabase_db.table("stories") \
            .select("id, headline, summary, bullets, video_id, source_id, sources(name), videos(url)") \
            .eq("cluster_id", cluster_id) \
            .execute()

        stories_data = stories_result.data
        if len(stories_data) < 2:
            continue

        stories_for_synthesis = []
        for s in stories_data:
            video_url = s.get("videos", {}).get("url") if s.get("videos") else None
            stories_for_synthesis.append({
                "source_name": s.get("sources", {}).get("name", "Unknown") if s.get("sources") else "Unknown",
                "headline": s["headline"],
                "summary": s["summary"],
                "bullets": s.get("bullets", []),
                "video_url": video_url,
            })

        print(f"    Synthesising cluster {cluster_id[:8]} ({len(stories_data)} stories)…")
        synthesis = summarise.synthesise_cluster(category, stories_for_synthesis)

        if synthesis:
            db.update_cluster(cluster_id, {
                "core_fact": synthesis.get("core_fact"),
                "consensus": synthesis.get("consensus"),
                "perspectives": synthesis.get("perspectives", []),
                "synthesised_at": "now()",
                "last_updated_at": "now()",
            })
            print(f"    ✓ Synthesised")
        else:
            print(f"    ✗ Synthesis failed, will retry next run")
