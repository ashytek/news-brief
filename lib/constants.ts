/**
 * Shared UI constants — Supabase select strings, dwell thresholds and time
 * formatters used across the reader, archive, topics panel, and today feed.
 */
/** Category names, order and colours live in `lib/categories.ts`. */

// Supabase select strings — keep in sync with lib/types.
// Explicitly omits transcript_text/embedding blobs so payloads stay slim.
export const STORY_SELECT =
  'id, source_id, video_id, category, headline, summary, bullets, short, storyline_id, cluster_id, matched_topics, created_at, ' +
  'videos(id, url, published_at, thumbnail_url, duration_seconds)'

/** Dwell auto-read thresholds, seconds on screen (Ash, 9 Oct 2026): a short
 *  card is read in about 40 s; once its sections are expanded (or when there
 *  is no short version and the long summary shows) it takes 120 s. */
export const DWELL_SHORT_SECONDS = 40
export const DWELL_LONG_SECONDS = 120

/** Storyline columns for the catch-up view (the table is read-only for the app). */
export const STORYLINE_SELECT =
  'id, category, title, recap, story_count, recap_story_count, first_report_at, last_report_at, recap_updated_at'

/** Video length for the thumbnail badge: "7:05" or "1:02:03". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`
}

/** mm:ss formatting for video timestamps */
export function formatTime(seconds: number): string {
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
