"""
One-shot recovery: find videos that have transcripts but no story, and summarise them.
Run when Gemini failures left transcripts in the DB without corresponding stories.

Usage:
    python recover_unsummarised.py
"""
from __future__ import annotations

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

import db
import summarise
import cluster

def match_topics(text: str, keywords: list[str]) -> list[str]:
    text_lower = text.lower()
    return [kw for kw in keywords if kw.lower() in text_lower]


def recover():
    client = db.get_db()

    # Find videos with transcripts that have no corresponding story
    res = client.table("videos") \
        .select("id, source_id, title, url, published_at, transcript_text, thumbnail_url, sources(id, name, category)") \
        .eq("transcript_status", "fetched") \
        .order("published_at", desc=True) \
        .limit(200) \
        .execute()

    all_videos = res.data

    # Filter: only those without a story
    story_res = client.table("stories").select("video_id").execute()
    story_video_ids = {s["video_id"] for s in story_res.data if s["video_id"]}

    orphaned = [v for v in all_videos if v["id"] not in story_video_ids and v.get("transcript_text")]

    print(f"Found {len(orphaned)} videos with transcripts but no story\n")

    if not orphaned:
        print("Nothing to recover.")
        return

    topic_keywords = db.get_topic_keywords()
    story_ids = []

    for v in orphaned:
        source = v.get("sources") or {}
        category = source.get("category", "tech_ai")
        title = v.get("title", "")
        transcript = v.get("transcript_text", "")

        print(f"  → {title[:60]}…")
        summary_data = summarise.summarise_video(
            title=title,
            transcript=transcript,
            segments=[],
            category=category,
        )

        if not summary_data:
            print(f"    ✗ Summarisation failed — skipping")
            continue

        story_record = {
            "video_id": v["id"],
            "source_id": v["source_id"],
            "category": category,
            "headline": summary_data["headline"],
            "summary": summary_data["summary"],
            "bullets": summary_data["bullets"],
        }
        story_id = db.insert_story(story_record)
        story_ids.append((story_id, summary_data["headline"], summary_data["summary"], category))

        if topic_keywords:
            searchable = " ".join([
                summary_data["headline"],
                summary_data["summary"],
                " ".join(b["text"] for b in summary_data.get("bullets", [])),
                title,
            ])
            matched = match_topics(searchable, topic_keywords)
            if matched:
                db.tag_story_topics(story_id, matched)
                print(f"    ✓ Story saved · topics: {', '.join(matched)}")
            else:
                print(f"    ✓ Story saved")
        else:
            print(f"    ✓ Story saved")

    print(f"\n  Embedding and clustering {len(story_ids)} recovered stories…")
    for story_id, headline, summary_text, category in story_ids:
        cluster.embed_and_cluster_story(
            story_id=story_id,
            headline=headline,
            summary=summary_text,
            category=category,
        )

    print("\n  Synthesising clusters…")
    cluster.synthesise_ready_clusters()

    print(f"\n✅ Recovery complete — {len(story_ids)} stories created")


if __name__ == "__main__":
    recover()
