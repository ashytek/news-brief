/**
 * Small pure formatters shared by the cards, the story rows and the reader.
 * Moved out of SoloCard.tsx / ReaderClient.tsx unchanged so a second consumer
 * (StoryRow) doesn't grow a second copy.
 */
import type { ShortVersion } from './types'

/** Rough words-per-minute reading estimate (250 wpm = average adult). */
export function estimateReadMinutes(texts: string[]): number {
  const words = texts.reduce((sum, t) => sum + (t?.split(/\s+/).length ?? 0), 0)
  return Math.max(1, Math.round(words / 250))
}

/** The story's short version, or null when absent or malformed — the card then
 *  falls back to the long summary. `short` is untyped jsonb in the database. */
export function readShort(s: ShortVersion | null | undefined): { lead: string; keyPoints: string[] } | null {
  if (!s || typeof s.lead !== 'string' || !s.lead.trim()) return null
  const keyPoints = Array.isArray(s.key_points)
    ? s.key_points.filter(p => typeof p === 'string' && p.trim().length > 0)
    : []
  return { lead: s.lead.trim(), keyPoints }
}

/** Friendly relative-time string: "2h ago", "Yesterday", "3 May". */
export function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  if (hrs < 48) return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** "N min ago" / "Nh ago" / "Nd ago" since a timestamp — the "since you left" banner. */
export function formatSince(t: number): string {
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`
}

/** Whole minutes since an ISO timestamp (0 for a bad date). Lets a component
 *  ask "is this fresh?" without calling Date.now() inline in render. */
export function minutesSince(iso: string | null | undefined): number {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isNaN(t) ? Infinity : Math.floor((Date.now() - t) / 60000)
}

/** Milliseconds since a Date (Infinity for null). Same idea as minutesSince:
 *  keeps the clock read out of component bodies. */
export function msSince(d: Date | null): number {
  return d ? Date.now() - d.getTime() : Infinity
}
