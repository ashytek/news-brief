#!/usr/bin/env python3
"""One-off: put FRESH videos that were marked permanent for lack of captions back to retryable.

Before roadmap session 11 the pipeline marked a video `no_transcript` (permanent) the moment Apify said
NO_CAPTIONS_AVAILABLE, even if it had been published minutes earlier, and YouTube often adds auto-captions
some hours after upload. This script sets those videos back to `failed`, which is the state the retry
pass picks up, so the next run (with the session-11 code, which keeps a video younger than 48 h retryable)
tries them again.

    ./venv/bin/python reset_fresh_no_captions.py                 # DRY RUN: prints what it would change
    ./venv/bin/python reset_fresh_no_captions.py --apply         # does it
    ./venv/bin/python reset_fresh_no_captions.py --hours 48      # look back 48 h instead of 72 h
    ./venv/bin/python reset_fresh_no_captions.py --only ID1,ID2  # restrict to these YouTube ids

How it finds them, and how sure it can be. The `videos` table does NOT store why a video was made
permanent (no error column), so the candidates are: transcript_status = 'no_transcript', no transcript
text, a YouTube video, published within --hours. Two confidence levels are printed:

  likely   marked on or after 9 Oct 2026 20:07 UTC (the first GitHub run on the session-9 code). From then
           on the local fetchers are skipped on Actions, so Apify's NO_CAPTIONS_AVAILABLE (or an empty
           transcript) is the ONLY way a fresh video becomes no_transcript.
  unsure   marked earlier. The old chain could also make a premiere or a live stream permanent
           (an Apify EXTRACTION_ERROR turned into a permanent verdict, yt-dlp 'live event'...).

Both are reset. A wrong reset costs at most one Apify fetch per run (about $0.001) until the video is
48 h old, and a premiere that has since aired is picked up, which is a gain.

Videos 48-72 h old are reset too (the brief's window is 72 h): they get exactly one more fetch and are
made permanent again at once if there are still no captions (the 48 h rule applies from the retry on).

No other table is touched, and nothing is deleted. The update only matches rows that are still
`no_transcript`, so a row another process changed in the meantime is left alone.
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timedelta, timezone

# First GitHub Actions run on the session-9 code (see the module docstring).
SESSION9_CI_CUTOFF = datetime(2026, 10, 9, 20, 7, tzinfo=timezone.utc)

SELECT = ("id, external_id, title, url, published_at, created_at, fetched_at, "
          "transcript_status, transcript_text, sources(name, source_type)")


def _ts(value) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _youtube_id(row: dict) -> str | None:
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", row.get("url") or "")
    return m.group(1) if m else None


def find_candidates(client, now: datetime, hours: float = 72, only: set[str] | None = None) -> list[dict]:
    """Read-only. Returns candidate rows (newest first), each with `confidence`, `age_h` and `yt_id` added."""
    since = (now - timedelta(hours=hours)).isoformat()
    rows = (client.table("videos").select(SELECT)
            .eq("transcript_status", "no_transcript")
            .gte("published_at", since)
            .order("published_at", desc=True)
            .execute().data)
    out = []
    for r in rows:
        if (r.get("transcript_text") or "").strip():
            continue                      # it has a transcript: nothing to retry
        yt = _youtube_id(r)
        if not yt:
            continue                      # not a YouTube video
        if only and yt not in only and r["id"] not in only:
            continue
        pub, marked = _ts(r.get("published_at")), _ts(r.get("fetched_at"))
        out.append({
            **r,
            "yt_id": yt,
            "age_h": (now - pub).total_seconds() / 3600 if pub else None,
            "confidence": "likely" if marked and marked >= SESSION9_CI_CUTOFF else "unsure",
        })
    return out


def apply_reset(client, candidates: list[dict]) -> int:
    """Set each candidate back to 'failed'. Returns how many rows were actually changed."""
    changed = 0
    for c in candidates:
        res = (client.table("videos").update({"transcript_status": "failed"})
               .eq("id", c["id"]).eq("transcript_status", "no_transcript").execute())
        changed += len(res.data or [])
    return changed


def _print_table(cands: list[dict], hours: float) -> None:
    print(f"\n{len(cands)} video(s) marked no_transcript, no transcript text, published in the last {hours:g} h:\n")
    for c in cands:
        src = (c.get("sources") or {}).get("name") or "?"
        age = f"{c['age_h']:.0f}h" if c["age_h"] is not None else "?"
        print(f"  {c['yt_id']}  {src[:24]:<24}  pub {str(c['published_at'])[:16]}Z ({age:>4} old)  "
              f"marked {str(c.get('fetched_at') or '?')[:16]}Z  {c['confidence']:<6}  "
              f"status={c['transcript_status']}  | {(c.get('title') or '')[:70]}")
    likely = sum(1 for c in cands if c["confidence"] == "likely")
    print(f"\n  likely (marked on the session-9 code, Apify no-captions verdict): {likely}   unsure (older code): {len(cands) - likely}")


def main(argv: list[str] | None = None, client=None, now: datetime | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true", help="really change the rows (default: dry run)")
    ap.add_argument("--hours", type=float, default=72, help="look back this many hours (default 72)")
    ap.add_argument("--only", default="", help="comma-separated YouTube ids (or video row ids) to restrict to")
    args = ap.parse_args(argv)

    if client is None:
        import db   # imported here so the module can be imported (and tested) without Supabase settings
        client = db.get_db()
    now = now or datetime.now(timezone.utc)
    only = {x.strip() for x in args.only.split(",") if x.strip()} or None

    cands = find_candidates(client, now, args.hours, only)
    _print_table(cands, args.hours)

    if not cands:
        print("\nNothing to do.")
        return 0
    if not args.apply:
        print("\nDRY RUN: nothing was changed. Re-run with --apply to set these back to 'failed' "
              "(the retry pass picks them up on the next pipeline run).")
        return 0

    changed = apply_reset(client, cands)
    print(f"\nAPPLIED: {changed} of {len(cands)} row(s) set from 'no_transcript' to 'failed'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
