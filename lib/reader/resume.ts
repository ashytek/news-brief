/**
 * Coming back to the app after it sat in the background (roadmap session 7): the
 * rules, as plain functions (no React, no Supabase) so they can be tested offline:
 * `node --experimental-strip-types lib/reader/resume.test.mjs`.
 *
 * An installed PWA is not reloaded when you switch back to it, so without this the
 * feed, the read marks, the status chip and "N new since you left" stay as they
 * were when you left, hours ago. Resuming after a while should feel like opening
 * the app, without throwing away your place when you were only gone a moment.
 *
 * No imports at all, so Node's type stripping can load this file (the 24 h of the
 * catch-up rule is passed in by the caller rather than imported).
 */

const MINUTE = 60_000

/** Away at least this long and the feed is refreshed (quietly, in the background).
 *  The same age at which a feed kept from before a trip to Search is revalidated
 *  (`FEED_STALE_MS` in ReaderProvider). Shorter than this: nothing happens. */
export const RESUME_REFRESH_AFTER_MS = 10 * MINUTE

export type ResumeDecision = {
  /** Reload the stories, read marks and pipeline status in the background. */
  refresh: boolean
  /** Count this as a new visit: "since you left" is measured from when you hid the
   *  app and the notice may show again. */
  newVisit: boolean
  /** Make the catch-up decision again, as on a fresh open (24 h or more away). */
  redecide: boolean
}

/**
 * - under 10 min: nothing (a notification glance must not move anything);
 * - 10 min to 24 h: refresh in the background and start a new visit, **unless the
 *   catch-up view is showing** — its notice ("Away 3 days · 48 new") is measured
 *   from the visit before it, and moving that would change what it says under you;
 * - 24 h or more: the same as opening the app — new visit, catch-up decided afresh
 *   (the loads follow from the decision, so no separate refresh).
 */
export function decideResume({ awayMs, catchUpOn, reopenAfterMs }: {
  awayMs: number
  catchUpOn: boolean
  /** How long away counts as opening the app afresh: the catch-up rule's 24 h. */
  reopenAfterMs: number
}): ResumeDecision {
  if (awayMs < RESUME_REFRESH_AFTER_MS) return { refresh: false, newVisit: false, redecide: false }
  if (awayMs >= reopenAfterMs) return { refresh: false, newVisit: true, redecide: true }
  return { refresh: true, newVisit: !catchUpOn, redecide: false }
}
