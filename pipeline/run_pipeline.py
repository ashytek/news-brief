#!/usr/bin/env python3
"""
Main pipeline runner.
Invoked by GitHub Actions (.github/workflows/news-pipeline.yml) 4x/day with --once.

Usage:
    python run_pipeline.py --once    # runs once and exits (the only mode GH Actions uses)
    python run_pipeline.py --retry   # retries failed transcripts only, then exits
"""

import os
import re
import sys
import subprocess
import traceback
from datetime import datetime, timezone, timedelta

import requests as _requests

import db
import fetch_sources
import get_transcripts
import summarise
import cluster
import llm
import archive_transcripts
import update_weights
from config import MAX_VANTAGE_RECAP_SECONDS


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

DB_SIZE_ALERT_MB = 400  # warn before Supabase free-tier's 500MB cap


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


def _is_vantage_source(source: dict) -> bool:
    """Mirrors the frontend's isVantage heuristic (ReaderClient.tsx) — no
    dedicated column exists on `sources` to identify this more precisely."""
    name = (source.get("name") or "").lower()
    return "vantage" in name or "firstpost" in name


def process_transcripts_and_summarise(items, stats, source_map, retry_delay_range=None):
    """
    Shared logic: fetch transcripts, summarise, embed, cluster.
    Works for both new items and retry items.
    retry_delay_range: optional (min, max) seconds override for the
    pre-request jitter — used for retry batches to back off harder without
    monkey-patching the process-global random module (see get_transcripts.
    _adaptive_pre_request_delay).
    Returns updated stats.
    """
    processed = []
    consecutive_failures = 0
    MAX_CONSECUTIVE_FAILURES = 3  # abort early if YouTube is 429-ing everything

    for idx, item in enumerate(items):
        print(f"  → {item['title'][:60]}…")

        # Vantage/Firstpost videos over ~20min are usually recap/rehash
        # content, not worth Gemini tokens — skip before any network call.
        # duration_seconds is only reliably populated for fresh discovery
        # items (see fetch_sources.annotate_durations), so this can't catch
        # a long recap re-entering via the retry/recovery queues — accepted,
        # low-cost gap (see Feature 2 plan notes).
        source = source_map.get(item["source_id"], {})
        dur = item.get("duration_seconds")
        if dur and dur > MAX_VANTAGE_RECAP_SECONDS and _is_vantage_source(source):
            print(f"    · Skipped long Vantage recap ({int(dur)}s > {MAX_VANTAGE_RECAP_SECONDS}s)")
            # 'skipped_filter' — NOT a new status. videos.transcript_status has
            # a DB-level CHECK constraint (no local migration source — created
            # directly in Supabase) limiting it to a fixed enum; introducing
            # 'skipped_long_recap' violated it and crashed every run outright
            # (the whole pipeline, not just this one video) the moment a long
            # Vantage recap was discovered. 'skipped_filter' is already an
            # allowed value and unused by any other current code — reusing it
            # needs no migration. Allowed set confirmed via existing rows:
            # fetched, no_transcript, skipped_short, skipped_filter, pending,
            # not_applicable.
            transcript_text, status, segments = None, "skipped_filter", []
        else:
            transcript_text, status, segments = get_transcripts.fetch_transcript(item, retry_delay_range)

        if status == "failed":
            # Only true fetch failures (IP block, network) count toward abort.
            # skipped_short and no_transcript are intentional outcomes, not errors.
            consecutive_failures += 1
            if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                print(f"  ⚠ {consecutive_failures} consecutive failures — aborting batch (likely IP rate-limited)")
                # This item and everything still unprocessed would otherwise
                # vanish silently — the loop below that writes a video row
                # never runs for them because we break before reaching it.
                # Without a DB row they don't enter the retry queue; they'd
                # only resurface if fetch_sources happens to rediscover them,
                # which depends on each source's lookback_hours window.
                for pending in items[idx:]:
                    if pending.get("video_id"):
                        continue  # retry item — already has a row, leave its status alone
                    try:
                        db.upsert_video({
                            "source_id": pending["source_id"],
                            "external_id": pending["external_id"],
                            "title": pending["title"],
                            "url": pending["url"],
                            "published_at": pending["published_at"],
                            "transcript_text": None,
                            "transcript_status": "failed",
                            "fetched_at": "now()",
                            "thumbnail_url": pending.get("thumbnail_url"),
                        })
                    except Exception as e:
                        print(f"    ✗ Couldn't persist abort-time failure for {pending.get('title', '?')[:40]}: {e}")
                break
        else:
            consecutive_failures = 0  # reset on any non-failure (including skips)

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

        # If retrying, always persist the fresh status — even a no-text
        # outcome like skipped_short. The old `and transcript_text` guard
        # meant a retried short resolved to skipped_short and never got
        # written, leaving transcript_status stuck at 'failed': every
        # subsequent run re-fetched (and re-paid for) the same short until
        # the 14-day stale-failure expiry finally caught it.
        if item.get("video_id"):
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

    # Embed new stories (for semantic/hybrid search — clustering removed)
    print(f"\n  Embedding {len(story_ids)} stories…")

    for story_id, headline, summary_text, category in story_ids:
        try:
            cluster.embed_and_cluster_story(
                story_id=story_id,
                headline=headline,
                summary=summary_text,
                category=category,
            )
        except Exception as e:
            # One embedding failure (non-retryable 4xx, or a sustained outage
            # after cluster.get_embedding exhausts its own retries) must not
            # abort the rest of the batch — the retry pass and daily jobs
            # still need to run.
            print(f"    ✗ Embedding failed for story {story_id}: {e}")

    # Also embed any previously saved stories that are still missing embeddings
    missing = db.get_stories_missing_embeddings(limit=30)
    if missing:
        print(f"\n  Embedding {len(missing)} previously unembedded stories…")
        for s in missing:
            try:
                cluster.embed_and_cluster_story(
                    story_id=s["id"],
                    headline=s["headline"],
                    summary=s["summary"],
                    category=s["category"],
                )
            except Exception as e:
                # Without this, a single poison row here re-wedges every
                # future run at the same point — this query always serves
                # it first (get_stories_missing_embeddings orders by
                # created_at desc, and the row stays embedding IS NULL).
                print(f"    ✗ Embedding failed for story {s['id']}: {e}")

    return stats


def recover_missing_stories(stats, source_map):
    """Re-attempt summarisation for videos whose transcript was fetched
    successfully but never produced a story (summarise_video returned None —
    e.g. Gemini quota exhausted mid-run). Without this, those videos are
    lost forever: nothing else revisits a video once transcript_status is
    'fetched'. Segments aren't persisted, so recovered stories fall back to
    plain (non-timestamped) bullets — degraded but far better than silently
    dropped.
    """
    orphans = db.get_videos_missing_stories(limit=30)
    if not orphans:
        return stats

    print(f"\n  Recovering {len(orphans)} video(s) with fetched transcripts but no story…")
    topic_keywords = db.get_topic_keywords()

    for video in orphans:
        try:
            source = source_map.get(video["source_id"], {})
            category = source.get("category", "tech_ai")

            summary_data = summarise.summarise_video(
                title=video["title"],
                transcript=video["transcript_text"],
                segments=[],
                category=category,
            )
            if not summary_data:
                print(f"    ✗ Still failing to summarise: {video['title'][:50]}")
                continue

            story_id = db.insert_story({
                "video_id": video["id"],
                "source_id": video["source_id"],
                "category": category,
                "headline": summary_data["headline"],
                "summary": summary_data["summary"],
                "bullets": summary_data["bullets"],
            })
            stats["stories_created"] += 1
            print(f"    ✓ Recovered: {summary_data['headline'][:50]}")

            if topic_keywords:
                searchable = " ".join([
                    summary_data["headline"],
                    summary_data["summary"],
                    " ".join(b["text"] for b in summary_data.get("bullets", [])),
                    video["title"],
                ])
                matched = match_topics(searchable, topic_keywords)
                if matched:
                    db.tag_story_topics(story_id, matched)

            cluster.embed_and_cluster_story(
                story_id=story_id,
                headline=summary_data["headline"],
                summary=summary_data["summary"],
                category=category,
            )
        except Exception as e:
            print(f"    ✗ Recovery failed for {video.get('title', video.get('id'))[:50]}: {e}")

    return stats


def retry_failed():
    """Re-process all videos that previously failed transcript extraction."""
    print(f"\n{'='*60}")
    print(f"🔄 Retrying failed transcripts at {datetime.now().strftime('%H:%M:%S %d/%m/%Y')}")
    print(f"{'='*60}")

    failed = db.get_failed_videos(limit=50)
    if failed:
        print(f"  Found {len(failed)} failed videos to retry\n")
        source_map = {s["id"]: s for s in db.get_active_sources()}
        stats = {"transcripts_fetched": 0, "stories_created": 0}
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
        print(f"  ✓ Embedding complete")

    print(f"\n{'='*60}\n")


def run_once():
    # Reset per-run transcript state (rate-limit streak + audio-fallback
    # budget) so each scheduled run starts fresh. Without this, a bad run
    # (streak=15 → 240s waits) poisons every subsequent run in the same
    # long-lived launchd process for the rest of the day.
    get_transcripts.reset_run_state()

    print(f"\n{'='*60}")
    print(f"📰 Pipeline run starting at {datetime.now().strftime('%H:%M:%S %d/%m/%Y')}")
    print(f"{'='*60}")

    # ── Skip if a manual trigger already covered this window ──────────────
    # Set via GitHub Actions' github.event_name expression (news-pipeline.yml).
    # Only scheduled runs are ever skipped — a manual trigger always runs.
    trigger_source = os.environ.get("PIPELINE_TRIGGER_SOURCE", "schedule")
    if trigger_source == "schedule":
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
            # status IN (success, partial) only — a failed or still-running
            # manual trigger must NOT suppress the next scheduled run too,
            # or a crashed manual trigger compounds into ~12h of silence.
            recent_manual = db.get_db().table("pipeline_runs") \
                .select("started_at") \
                .eq("trigger_source", "manual") \
                .in_("status", ["success", "partial"]) \
                .gte("started_at", cutoff) \
                .order("started_at", desc=True) \
                .limit(1) \
                .execute().data
            if recent_manual:
                print(f"⏭ Skipping scheduled run — manual trigger covered this window "
                      f"at {recent_manual[0]['started_at']}")
                # A deliberate skip is a healthy state — ping success so the
                # healthcheck dead-man's switch doesn't fire a false "down"
                # alert a few hours later. No pipeline_runs row is written
                # for a skipped run (keeps the zero-story-streak / health
                # indicator logic reading only real runs).
                _ping_healthcheck(success=True)
                return
        except Exception as e:
            # Fail open — if the skip-check itself errors, run normally
            # rather than silently skipping (or crashing) a scheduled run.
            print(f"⚠ Skip-check error (non-fatal, running normally): {e}")

    run_id = db.start_pipeline_run(trigger_source=trigger_source)
    stats = {
        "sources_checked": 0,
        "videos_found": 0,
        "transcripts_fetched": 0,
        "stories_created": 0,
    }

    # Set by any soft-fail alert below (zero-story streak, Apify degradation,
    # DB size) so the unconditional success ping at the end of the run
    # doesn't immediately flip the healthcheck back to "up" and erase it.
    soft_failed = False

    try:
        source_map = {s["id"]: s for s in db.get_active_sources()}

        # ── Step 1: Fetch new items from all sources ──────────────────────
        print("\n[1/4] Fetching sources…")
        new_items, fetch_stats = fetch_sources.fetch_all_sources()
        stats["sources_checked"] = fetch_stats["sources_checked"]
        stats["videos_found"] = fetch_stats["videos_found"]
        print(f"  → {len(new_items)} new items total")

        # Cap items processed per run — discovery volume is unbounded (a
        # source with a long gap since its last check can surface up to 200
        # items), and nothing else caps how much a single run tries to fetch/
        # summarise/embed within the 45-minute workflow timeout. Anything
        # over the cap isn't lost: it has no video row yet, so it's simply
        # rediscovered by fetch_sources on the next scheduled run.
        MAX_ITEMS_PER_RUN = 60
        if len(new_items) > MAX_ITEMS_PER_RUN:
            print(f"  ⚠ Capping to {MAX_ITEMS_PER_RUN} items this run "
                  f"({len(new_items) - MAX_ITEMS_PER_RUN} deferred to next run)")
            new_items = new_items[:MAX_ITEMS_PER_RUN]

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
            # Explicit override, not a monkey-patch of the global `random`
            # module — the old approach also stretched unrelated jitter in
            # llm.py/cluster.py's backoff sleeps for the duration of the
            # retry batch, and did nothing on the Apify path anyway (that
            # path uses a fixed 1s pause and never calls random.uniform).
            stats = process_transcripts_and_summarise(
                retry_items, stats, source_map, retry_delay_range=(10.0, 20.0)
            )

        # ── Step 6: Recover videos whose transcript fetched but never got
        # summarised (e.g. Gemini quota exhausted mid-run) ─────────────────
        try:
            stats = recover_missing_stories(stats, source_map)
        except Exception as e:
            print(f"  ⚠ Recovery pass error (non-fatal): {e}")

        if not new_items and not failed:
            print("  Nothing new. Run complete.")

        status_str = "success" if stats["stories_created"] > 0 else "partial"
        db.finish_pipeline_run(run_id, status_str, stats)

        # ── Zero-story streak alert ──────────────────────────────────────
        # If 3+ consecutive runs produced 0 stories, ping the healthcheck
        # as failed so we get notified rather than silently going dark.
        # 3 runs × 6h = 18h of no content — definitely something wrong.
        if stats["stories_created"] == 0:
            try:
                recent = db.get_db().table("pipeline_runs") \
                    .select("stories_created") \
                    .order("started_at", desc=True) \
                    .limit(3) \
                    .execute().data
                zero_streak = sum(
                    1 for r in recent
                    if (r.get("stories_created") or 0) == 0
                )
                if zero_streak >= 3:
                    print(f"  ⚠ {zero_streak} consecutive zero-story runs — pinging healthcheck FAIL")
                    _ping_healthcheck(success=False)
                    soft_failed = True
            except Exception as e:
                print(f"  ⚠ Zero-streak check error (non-fatal): {e}")

        # ── Transcript source-mix check ────────────────────────────────────
        # The zero-story-streak check above only catches total blackout. It
        # misses the more likely failure mode: Apify (primary) silently
        # degrading — credit exhausted, actor broken — while the fragile
        # local fallback chain (yt-dlp/timedtext/AssemblyAI) quietly absorbs
        # the load and stories keep appearing. That's exactly the scenario
        # that produced the pre-v2 firefights, so flag it same-run instead
        # of waiting for the fallback chain to fail too.
        fetcher_mix = get_transcripts.get_fetcher_mix()
        total_via_fetchers = sum(fetcher_mix.values())
        if os.environ.get("APIFY_TOKEN", "").strip() and total_via_fetchers > 0 and fetcher_mix.get("apify", 0) == 0:
            print(f"  ⚠ Apify produced 0/{total_via_fetchers} transcripts this run "
                  f"(mix: {fetcher_mix}) — primary path degraded, running on local fallback chain")
            _ping_healthcheck(success=False)
            soft_failed = True
        elif fetcher_mix:
            print(f"  Transcript sources this run: {fetcher_mix}")

        # Persist source mix to pipeline_runs (column may not exist yet — ignore errors)
        try:
            db.get_db().table("pipeline_runs").update({
                "fetcher_mix": fetcher_mix,
            }).eq("id", run_id).execute()
        except Exception:
            pass  # column added separately via Supabase SQL migration

        # ── Database size check ──────────────────────────────────────────
        # Supabase free tier caps the database at 500MB. stories.embedding
        # (vector(3072), ~12KB/row) is the fastest-growing column with no
        # pruning in place — warn well before the cap silently blocks inserts.
        try:
            size_mb = db.get_db().rpc("get_database_size_mb", {}).execute().data
            if size_mb is not None:
                if size_mb >= DB_SIZE_ALERT_MB:
                    print(f"  ⚠ Database size {size_mb:.0f}MB — approaching the 500MB plan cap")
                    _ping_healthcheck(success=False)
                    soft_failed = True
                else:
                    print(f"  DB size: {size_mb:.0f}MB")
        except Exception as e:
            print(f"  ⚠ DB size check error (non-fatal, RPC may not exist yet): {e}")

        # ── Token usage summary ───────────────────────────────────────────
        usage = llm.get_usage()
        # Thinking tokens are included in the per-model totals persisted
        # below — they bill at the output rate, so a total that excluded
        # them under-reported spend (which is exactly what happened before
        # 14 Sep 2026).
        flash_tok = usage["flash_input_tokens"] + usage["flash_output_tokens"] + usage["flash_thinking_tokens"]
        pro_tok   = usage["pro_input_tokens"] + usage["pro_output_tokens"] + usage["pro_thinking_tokens"]
        print(f"\n{'='*60}")
        print(f"✅ Done! {stats['stories_created']} stories created")
        print(f"   LLM: {usage['calls']} calls · Flash {flash_tok:,} tokens "
              f"(in {usage['flash_input_tokens']:,} / out {usage['flash_output_tokens']:,} / thinking {usage['flash_thinking_tokens']:,}) "
              f"· Pro {pro_tok:,} tokens (thinking {usage['pro_thinking_tokens']:,}) · {usage['failures']} failures")
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

        # ── Daily jobs (run once per ~24h, regardless of schedule offset) ──
        # Old gate was `if datetime.now().hour == 6:` which never fired because
        # the 6-hour schedule offset rarely hit exactly hour 6. A later fix
        # persisted the marker to a local file — which doesn't survive
        # GitHub Actions' fresh checkout each run, so daily jobs (weight
        # updates especially) ran on all 4 scheduled runs/day instead of 1.
        # The database is the only state that actually persists between runs.
        _should_run_daily = True
        try:
            recent = db.get_db().table("pipeline_runs") \
                .select("daily_jobs_ran_at") \
                .not_.is_("daily_jobs_ran_at", "null") \
                .order("daily_jobs_ran_at", desc=True) \
                .limit(1) \
                .execute().data
            if recent:
                _last = datetime.fromisoformat(recent[0]["daily_jobs_ran_at"].replace("Z", "+00:00"))
                _should_run_daily = (datetime.now(timezone.utc) - _last).total_seconds() > 22 * 3600
        except Exception as e:
            print(f"  ⚠ Daily-jobs marker check error (non-fatal, defaulting to run): {e}")

        if _should_run_daily:
            print("\n── Running daily jobs ─────────────────────────────")
            try:
                print("  · Archiving old transcripts…")
                archive_transcripts.archive_old_transcripts()
            except Exception as e:
                print(f"  ⚠ Archival error (non-fatal): {e}")

            try:
                print("  · Updating engagement weights…")
                update_weights.run()
            except Exception as e:
                print(f"  ⚠ Weight update error (non-fatal): {e}")

            try:
                expired = db.expire_stale_failures()
                if expired:
                    print(f"  · Expired {expired} stale failed videos (>14d old → no_transcript)")
                else:
                    print(f"  · No stale failed videos to expire")
            except Exception as e:
                print(f"  ⚠ Stale failure expiry error (non-fatal): {e}")

            # Persist marker so we don't repeat for ~24h (column may not
            # exist yet — ignore errors, matching the fetcher_mix/usage
            # columns above; migration in supabase/migrations/)
            try:
                db.get_db().table("pipeline_runs").update({
                    "daily_jobs_ran_at": "now()",
                }).eq("id", run_id).execute()
            except Exception as e:
                print(f"  ⚠ Couldn't persist daily marker (non-fatal): {e}")

        # ── Healthcheck ping (set HEALTHCHECK_URL in .env to enable) ─────
        # Skip the success ping if a soft-fail alert already fired above —
        # otherwise this unconditional ping flips the check back to "up"
        # seconds later and the alert never surfaces as a lasting down state.
        if not soft_failed:
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
    retry_mode = "--retry" in sys.argv

    _code_version_banner()
    print(f"   Supabase:   connected")

    if retry_mode:
        print(f"   Mode: retry failed transcripts")
        retry_failed()
    else:
        print(f"   Mode: run once")
        run_once()


if __name__ == "__main__":
    main()
