/**
 * The app's own copy of the last feed it loaded, so a cold start with no signal
 * (the service worker brings the app itself, public/sw.js) still shows the stories
 * you had, honestly labelled as saved. localStorage, one key per feed, written after
 * every successful load and read back only when a load fails.
 *
 * Sizes on real data: Today (60 stories) and a Sections feed (100) are a few hundred
 * KB each as JSON, the catch-up pool (up to 400) under 1 MB, read marks (2,000 ids)
 * ~80 KB; localStorage allows about 5 MB. A write that doesn't fit is skipped, never
 * an error. Cleared on sign-out (lib/offline.ts).
 */

const PREFIX = 'newsbrief_feed_'

export type SavedFeed<T> = { at: number; data: T }

/** The key for one feed: `today`, `tab_<section>` or `catchup_<tab>`, or any other name. */
export const feedKey = (name: string) => PREFIX + name

/** Save after the current task, so a 300 KB JSON.stringify never sits in the way of the
 *  render that just committed the same stories. */
export function saveFeed(name: string, data: unknown): void {
  if (typeof window === 'undefined') return
  setTimeout(() => {
    try {
      localStorage.setItem(feedKey(name), JSON.stringify({ at: Date.now(), data } satisfies SavedFeed<unknown>))
    } catch { /* storage blocked or full: no offline copy of this feed */ }
  }, 0)
}

/** The saved feed, or null if there is none or it is not the shape `valid` expects
 *  (a copy written by a different version of the app must not crash this one). */
export function loadFeed<T>(name: string, valid: (data: unknown) => data is T): SavedFeed<T> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(feedKey(name))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedFeed<unknown>> | null
    if (!parsed || typeof parsed.at !== 'number' || !valid(parsed.data)) return null
    return { at: parsed.at, data: parsed.data }
  } catch {
    return null
  }
}

/** Forget every saved feed (sign-out). */
export function clearFeeds(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key)
  } catch { /* storage blocked */ }
}

export const isArray = (d: unknown): d is unknown[] => Array.isArray(d)
export const isRecord = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null && !Array.isArray(d)
