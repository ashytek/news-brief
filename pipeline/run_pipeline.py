#!/usr/bin/env python3
"""
Main pipeline runner.
Run this script on your home machine — it will loop every 90 minutes.

Usage:
    python run_pipeline.py           # runs once immediately, then loops
    python run_pipeline.py --once    # runs once and exits
    python run_pipeline.py --retry   # retries failed transcripts only, then exits
"""

import os
import re
import sys
import time
import schedule
import subprocess
import traceback
from datetime import datetime

import requests as _requests

import db
import fetch_sources
import get_transcripts
import summarise
import cluster
import llm
import archive_transcripts


def _ping_healthcheck(success: bool = True):
    """Ping Healthchecks.io if HEALTHCHECK_URL is set in .env.
    success=True → normal ping (run succeeded)
    success=False → /fail ping (run errored)
    """
    url = os.environ.get("HEALTHCHECK_URL", "").strip()
    if not url:
        return
    try:
        endpoint = url if success else f"{url.rstrip('/')}/fail"
        _requests.get(endpoint, timeout=5)
    except Exception:
        pass  # never let monitoring break the pipeline

INTERVAL_MINUTES = 90


_WORD_BOUNDARY_CACHE: dict[str, "re.Pattern[str]"] = {}


def _kw_pattern(kw: str) -> "re.Pattern[str]":
    """Compile (and cache) a word-boundary regex for a topic keyword.

    Multi-word keywords ("strait of hormuz") collapse internal whitespace to
    `\\s+` so they still match across line breaks or double-spaced text.
    """
    if kw not in _WORD_BOUNDARY_CACHE:
        import re as _re
        parts = [_re.escape(p) for p in kw.split()]
        body = r"\s+".join(parts) if parts else _re.escape(kw)
        _WORD_BOUNDARY_CACHE[kw] = _re.compile(rf"\b{body}\b", _re.IGNORECASE)
    return _WORD_BOUNDARY_CACHE[kw]


def match_topics(text: str, keywords: list[str]) -> list[str]:
    """Word-boundary keyword match — avoids 'ai' matching 'said', etc."""
    if not text:
        return []
    return [kw for kw in keywords if _kw_pattern(kw).search(text)]


def process_transcripts_and_summarise(items, stats, source_map):
    """
    Shared logic: fetch transcripts, summarise, embed, cluster.
    Works for both new items and retry items.
    Returns updated stats.
    """
    processed = []

    for item in items:
        print(f"  → {item['title'][:60]}…")
        transcript_text, status, segments = get_transcripts.fetch_transcript(item)

        # Update/insert video record
        video_record = {
            "source_id": item["source_id"],
            "external_id": item["external_id"],
            "title": item["title"],
            "url": item["url"],
            "published_at": item["published_at"],
            "transcript_text": transcript_text,
            "transcript_status": status,
            "fetched_at": "now()",
            "thumbnail_url": item.get("thumbnail_url"),  # persist thumbnail from fetch phase
        }
        video_id = item.get("video_id") or db.upsert_video(video_record)

        # If retrying, update the existing row
        if item.get("video_id") and transcript_text:
            db.get_db().table("videos").update({
                "transcript_text": transcript_text,
                "transcript_status": status,
                "fetched_at": "now()",
            }).eq("id", item["video_id"]).execute()

        if transcript_text:
            stats["transcripts_fetched"] += 1
            processed.append({
                **item,
                "video_id": video_id,
                "transcript_text": transcript_text,
                "segments": segments,
            })
        else:
            print(f"    ✗ No transcript")

    # Summarise
    print(f"\n  Summarising {len(processed)} items with Claude…")
    story_ids = []

    # Load topic keywords once for this batch
    topic_keywords = db.get_topic_keywords()

    for item in processed:
        source = source_map.get(item["source_id"], {})
        category = source.get("category", "tech_ai")

        print(f"  → Summarising: {item['title'][:50]}…")
        summary_data = summarise.summarise_video(
            title=item["title"],
            transcript=item["transcript_text"],
            segments=item.get("segments", []),
            category=category,
        )

        if not summary_data:
            print(f"    ✗ Summarisation failed")
            continue

        story_record = {
            "video_id": item["video_id"],
            "source_id": item["source_id"],
            "category": category,
            "headline": summary_data["headline"],
            "summary": summary_data["summary"],
            "bullets": summary_data["bullets"],
        }
        story_id = db.insert_story(story_record)
        stats["stories_created"] += 1
        story_ids.append((story_id, summary_data["headline"], summary_data["summary"], category))

        # Tag with matching topic keywords
        if topic_keywords:
            searchable = " ".join([
                summary_data["headline"],
                summary_data["summary"],
                " ".join(b["text"] for b in summary_data.get("bullets", [])),
                item["title"],
            ])
            matched = match_topics(searchable, topic_keywords)
            if matched:
                db.tag_story_topics(story_id, matched)
                print(f"    ✓ Story saved · topics: {', '.join(matched)}")
            else:
                print(f"    ✓ Story saved")
        else:
            print(f"    ✓ Story saved")

    # Embed + cluster new stories
    print(f"\n  Embedding and clustering {len(story_ids)} stories…")
    clustered = 0

    for story_id, headline, summary_text, category in story_ids:
        cluster_id = cluster.embed_and_cluster_story(
            story_id=story_id,
            headline=headline,
            summary=summary_text,
            category=category,
        )
        if cluster_id:
            clustered += 1

    stats["clusters_touched"] = stats.get("clusters_touched", 0) + clustered

    # Also embed any previously saved stories that are still missing embeddings
    missing = db.get_stories_missing_embeddings(limit=30)
    if missing:
        print(f"\n  Embedding {len(missing)} previously unembedded stories…")
        for s in missing:
            cluster.embed_and_cluster_story(
                story_id=s["id"],
                headline=s["headline"],
                summary=s["summary"],
                category=s["category"],
            )

    # Synthesise
    print("\n  Synthesising clusters…")
    cluster.synthesise_ready_clusters()

    return stats


def recluster_all():
    """
    Reset all cluster assignments and re-cluster every embedded story from scratch.
    Useful after fixing the clustering logic or after a first bulk embedding run.
    """
    print(f"\n{'='*60}")
    print(f"🔁 Re-clustering all stories at {datetime.now().strftime('%H:%M:%S %d/%m/%Y')}")
    print(f"{'='*60}")

    supabase_db = db.get_db()

    # Wipe existing cluster assignments on stories
    supabase_db.table("stories").update({"cluster_id": None}).neq("id", "00000000-0000-0000-0000-000000000000").execute()
    # Delete all clusters
    supabase_db.table("clusters").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    print("  Cleared all existing clusters.")

    # Fetch all embedded stories ordered oldest-first
    res = supabase_db.table("stories") \
        .select("id, headline, summary, category, embedding") \
        .not_.is_("embedding", "null") \
        .order("created_at", desc=False) \
        .execute()
    stories = res.data
    print(f"  Re-clustering {len(stories)} stories…\n")

    clustered = 0
    for s in stories:
        embedding = s["embedding"]
        if not embedding:
            continue
        cluster_id, is_new = cluster.find_or_create_cluster(
            story_id=s["id"],
            story_embedding=embedding,
            category=s["category"],
        )
        if cluster_id:
            db.assign_story_to_cluster(s["id"], cluster_id)
            if not is_new:
                db.increment_cluster_story_count(cluster_id)
            action = "new cluster" if is_new else "joined cluster"
            print(f"  ✓ {s['headline'][:55]}… → {action} {cluster_id[:8]}")
            clustered += 1
        else:
            print(f"  · {s['headline'][:55]}… → solo")

    print(f"\n  Synthesising clusters…")
    cluster.synthesise_ready_clusters()
    print(f"\n✅ Re-cluster done! {clustered}/{len(stories)} stories clustered.")
    print(f"{'='*60}\n")


def retry_failed():
    """Re-process all videos that previously failed transcript extraction."""
    print(f"\n{'='*60}")
    print(f"🔄 Retrying failed transcripts at {datetime.now().strftime('%H:%M:%S %d/%m/%Y')}")
    print(f"{'='*60}")

    failed = db.get_failed_videos(limit=50)
    if failed:
        print(f"  Found {len(failed)} failed videos to retry\n")
        source_map = {s["id"]: s for s in db.get_active_sources()}
        stats = {"transcripts_fetched": 0, "stories_created": 0, "clusters_touched": 0}
        items = [{
            "video_id": v["id"],
            "source_id": v["source_id"],
            "external_id": v["external_id"],
            "title": v["title"],
            "url": v["url"],
            "published_at": v["published_at"],
            "transcript_status": v["transcript_status"],
        } for v in failed]
        stats = process_transcripts_and_summarise(items, stats, source_map)
        print(f"\n✅ Retry done! {stats['stories_created']} stories created")
    else:
        print("  No failed videos to retry.")

    # Always embed any stories that are missing embeddings (catches crash survivors)
    missing = db.get_stories_missing_embeddings(limit=50)
    if missing:
        print(f"\n  Embedding {len(missing)} stories that are missing embeddings…")
        for s in missing:
            try:
                cluster.embed_and_cluster_story(
                    story_id=s["id"],
                    headline=s["headline"],
                    summary=s["summary"],
                    category=s["category"],
                )
            except Exception as e:
                print(f"    ✗ Embedding failed: {e}")
        print("  Synthesising clusters…")
        cluster.synthesise_ready_clusters()
        print(f"  ✓ Embedding complete")

    print(f"\n{'='*60}\n")


def run_once():
    print(f"\n{'='*60}")
    print(f"📰 Pipeline run starting at {datetime.now().strftime('%H:%M:%S %d/%m/%Y')}")
    print(f"{'='*60}")

    run_id = db.start_pipeline_run()
    stats = {
        "sources_checked": 0,
        "videos_found": 0,
        "transcripts_fetched": 0,
        "stories_created": 0,
        "clusters_touched": 0,
    }

    try:
        source_map = {s["id"]: s for s in db.get_active_sources()}

        # ── Step 1: Fetch new items from all sources ──────────────────────
        print("\n[1/4] Fetching sources…")
        new_items, fetch_stats = fetch_sources.fetch_all_sources()
        stats["sources_checked"] = fetch_stats["sources_checked"]
        stats["videos_found"] = fetch_stats["videos_found"]
        print(f"  → {len(new_items)} new items total")

        if new_items:
            # ── Steps 2-4: Transcripts → Summarise → Embed → Cluster ─────
            print("\n[2/4] Extracting transcripts…")
            stats = process_transcripts_and_summarise(new_items, stats, source_map)

        # ── Step 5: Retry previously failed transcripts (AFTER new items) ─
        # Moved to end so fresh videos are never starved by the retry burst.
        # Uses a longer jitter (10-20s) to avoid re-triggering IP rate limits.
        failed = db.get_failed_videos(limit=10)
        if failed:
            print(f"\n[5/5] Retrying {len(failed)} previously failed transcripts…")
            retry_items = [{
                "video_id": v["id"],
                "source_id": v["source_id"],
                "external_id": v["external_id"],
                "title": v["title"],
                "url": v["url"],
                "published_at": v["published_at"],
                "transcript_status": v["transcript_status"],
            } for v in failed]
            # Patch the transcript fetcher to use a longer delay for retries
            import get_transcripts as _gt
            _orig_sleep = _gt.random.uniform
            _gt.random.uniform = lambda a, b: _orig_sleep(10.0, 20.0)  # type: ignore
            try:
                stats = process_transcripts_and_summarise(retry_items, stats, source_map)
            finally:
                _gt.random.uniform = _orig_sleep  # restore

        if not new_items and not failed:
            print("  Nothing new. Run complete.")

        status_str = "success" if stats["stories_created"] > 0 else "partial"
        db.finish_pipeline_run(run_id, status_str, stats)

        # ── Token usage summary ───────────────────────────────────────────
        usage = llm.get_usage()
        flash_tok = usage["flash_input_tokens"] + usage["flash_output_tokens"]
        pro_tok   = usage["pro_input_tokens"] + usage["pro_output_tokens"]
        print(f"\n{'='*60}")
        print(f"✅ Done! {stats['stories_created']} stories created, {stats['clusters_touched']} clustered")
        print(f"   LLM: {usage['calls']} calls · Flash {flash_tok:,} tokens · Pro {pro_tok:,} tokens · {usage['failures']} failures")
        print(f"{'='*60}\n")

        # Persist token usage to pipeline_runs (columns may not exist yet — ignore errors)
        try:
            db.get_db().table("pipeline_runs").update({
                "gemini_calls":         usage["calls"],
                "gemini_failures":      usage["failures"],
                "gemini_flash_tokens":  flash_tok,
                "gemini_pro_tokens":    pro_tok,
            }).eq("id", run_id).execute()
        except Exception:
            pass  # columns added separately via Supabase SQL migration

        # ── Daily transcript archival (runs once per day at 03:xx) ───────
        if datetime.now().hour == 3:
            try:
                print("Running daily transcript archival…")
                archive_transcripts.archive_old_transcripts()
            except Exception as e:
                print(f"  ⚠ Archival error (non-fatal): {e}")

        # ── Healthcheck ping (set HEALTHCHECK_URL in .env to enable) ─────
        _ping_healthcheck(success=True)

    except Exception as e:
        print(f"\n❌ Pipeline error: {e}")
        traceback.print_exc()
        db.finish_pipeline_run(run_id, "failed", {**stats, "error_log": [str(e)]})
        _ping_healthcheck(success=False)


def _code_version_banner():
    """Emit a startup line that ties the running process to a code revision.

    Makes stale long-running processes obvious in the log: if the SHA in the
    banner doesn't match `git rev-parse HEAD` after a pull, the process was
    started before the latest changes were applied.
    """
    started = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sha = "unknown"
    dirty = ""
    try:
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sha = subprocess.check_output(
            ["git", "-C", repo_root, "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
            timeout=2,
        ).decode().strip()
        # Detect uncommitted changes — service-the-truth on what's actually running
        status = subprocess.check_output(
            ["git", "-C", repo_root, "status", "--porcelain"],
            stderr=subprocess.DEVNULL,
            timeout=2,
        ).decode().strip()
        dirty = " (dirty)" if status else ""
    except Exception:
        pass
    print(f"📰 News Brief Pipeline")
    print(f"   started_at: {started}")
    print(f"   pid:        {os.getpid()}")
    print(f"   code_sha:   {sha}{dirty}")


def main():
    retry_mode    = "--retry" in sys.argv
    recluster_mode = "--recluster" in sys.argv
    once = "--once" in sys.argv or retry_mode or recluster_mode

    _code_version_banner()
    print(f"   Supabase:   connected")

    if recluster_mode:
        print(f"   Mode: re-cluster all embedded stories")
        recluster_all()
    elif retry_mode:
        print(f"   Mode: retry failed transcripts")
        retry_failed()
    else:
        print(f"   Mode: {'run once' if once else f'every {INTERVAL_MINUTES} minutes'}")
        run_once()

    if not once:
        schedule.every(INTERVAL_MINUTES).minutes.do(run_once)
        print(f"\n⏰ Next run in {INTERVAL_MINUTES} minutes. Press Ctrl+C to stop.\n")
        while True:
            schedule.run_pending()
            time.sleep(30)


if __name__ == "__main__":
    main()
