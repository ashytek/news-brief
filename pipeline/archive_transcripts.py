"""
Compress and archive transcripts older than 14 days to Supabase Storage,
then null out transcript_text to free DB space.

This keeps you on the Supabase free tier (500MB) indefinitely:
  - 50 videos/day × 80KB/transcript × 14 days ≈ 56MB in the DB at any time
  - Older content compressed (~5x) and moved to Storage (free tier: 1GB)

Supabase setup required (one-time):
  1. Dashboard → Storage → New bucket: name="transcripts", Public=No
  2. Dashboard → SQL Editor:
       ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript_archived_path TEXT;

Run manually:    python archive_transcripts.py
Runs daily at 03:xx automatically from run_pipeline.py
"""
from __future__ import annotations

import gzip
import io
from datetime import datetime, timedelta, timezone

import db

ARCHIVE_AFTER_DAYS = 14
BUCKET = "transcripts"


def archive_old_transcripts(batch_size: int = 100):
    supabase = db.get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=ARCHIVE_AFTER_DAYS)).isoformat()

    rows = (
        supabase.table("videos")
        .select("id, transcript_text, transcript_archived_path")
        .lt("fetched_at", cutoff)
        .not_.is_("transcript_text", "null")
        .is_("transcript_archived_path", "null")
        .limit(batch_size)
        .execute()
        .data
    )

    if not rows:
        print(f"  Archive: no transcripts older than {ARCHIVE_AFTER_DAYS} days to process.")
        return

    print(f"  Archive: compressing {len(rows)} transcripts to Supabase Storage…")
    success = 0

    for row in rows:
        vid = row["id"]
        text = row.get("transcript_text") or ""
        if not text.strip():
            # Already empty — just mark it archived
            supabase.table("videos").update({
                "transcript_text": None,
                "transcript_archived_path": "empty",
            }).eq("id", vid).execute()
            continue

        # Gzip compress
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            gz.write(text.encode("utf-8"))
        compressed = buf.getvalue()

        path = f"{vid}.txt.gz"
        try:
            supabase.storage.from_(BUCKET).upload(
                path,
                compressed,
                {"content-type": "application/gzip", "x-upsert": "true"},
            )
            supabase.table("videos").update({
                "transcript_text": None,
                "transcript_archived_path": path,
            }).eq("id", vid).execute()
            success += 1
        except Exception as e:
            print(f"    ✗ Failed to archive {vid[:8]}: {e}")

    print(f"  Archive: ✓ {success}/{len(rows)} transcripts archived "
          f"(freed ~{success * 40:.0f}KB from DB)")


def restore_transcript(video_id: str) -> str | None:
    """Restore a transcript from Storage for re-summarisation."""
    supabase = db.get_db()
    row = (
        supabase.table("videos")
        .select("transcript_archived_path")
        .eq("id", video_id)
        .single()
        .execute()
        .data
    )
    if not row or not row.get("transcript_archived_path"):
        return None
    path = row["transcript_archived_path"]
    if path == "empty":
        return ""
    try:
        data = supabase.storage.from_(BUCKET).download(path)
        return gzip.decompress(data).decode("utf-8")
    except Exception as e:
        print(f"  ✗ Failed to restore transcript for {video_id[:8]}: {e}")
        return None


if __name__ == "__main__":
    archive_old_transcripts()
