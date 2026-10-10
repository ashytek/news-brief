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

/** "Saturday 3 October": the Today masthead's overline. Kept here so the clock
 *  is read outside the component body. */
export function mastheadDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** The current time as a Date, for derivations that group by day ("Today",
 *  "Yesterday"). Like `msSince`, it keeps the clock read out of component bodies. */
export function nowDate(): Date {
  return new Date()
}

/** A headline as shown. The pipeline writes sentence-case headlines, but a prophetic
 *  channel's occasional ALL-CAPS one (60 %+ of its letters upper-case) shouts across a
 *  phone screen and is hard to read; those become Title Case. Everything else is returned
 *  untouched. Display only: search, sharing and the database keep the original. */
export function displayHeadline(headline: string): string {
  const letters = headline.replace(/[^A-Za-z]/g, '')
  if (letters.length < 8) return headline
  const upper = letters.replace(/[^A-Z]/g, '').length
  if (upper / letters.length <= 0.6) return headline
  return headline.toLowerCase().replace(/(^|[\s"(\[\u201c\u2018\u2014\u2013-])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase())
}

// ── Reading time, the round-up flag, share text (roadmap session 8) ─────────────

type Readable = { short?: ShortVersion | null; summary: string }

/** Minutes to read what the card shows by default (the short version, else the long
 *  overview): the same number as the card's "N min read". */
export function storyMinutes(s: Readable): number {
  const short = readShort(s.short)
  return estimateReadMinutes(short ? [short.lead, ...short.keyPoints] : [s.summary])
}

/** A round-up video covers several unrelated stories under one headline; the pipeline
 *  marks it by opening the short lead with "Round-up" (it never joins a storyline). */
export function isRoundUp(s: { short?: ShortVersion | null }): boolean {
  return /^round-?up\b/i.test(readShort(s.short)?.lead ?? '')
}

/** Stories from the front of `items`, in order, until their reading times add up to
 *  `budgetMin`; always at least the first one (a 20-minute read is still the next thing
 *  to read when you have 5). */
export function trimToBudget<T>(items: T[], minutesOf: (t: T) => number, budgetMin: number): T[] {
  const out: T[] = []
  let used = 0
  for (const it of items) {
    const m = minutesOf(it)
    if (out.length > 0 && used + m > budgetMin) break
    out.push(it)
    used += m
  }
  return out
}

type Shareable = { headline: string; summary: string; short?: ShortVersion | null; videos?: { url?: string | null } | null }

/** The story as plain text for sharing or pasting elsewhere: headline, channel, the short
 *  version (lead and key points; the long overview if there is none), and the video link. */
export function storySummaryText(story: Shareable, sourceName?: string): { body: string; url: string | null } {
  const short = readShort(story.short)
  const lines = [story.headline, `${sourceName ? `${sourceName} · ` : ''}AI summary of the video`, '']
  if (short) {
    lines.push(short.lead)
    for (const p of short.keyPoints) lines.push(`• ${p}`)
  } else {
    lines.push(story.summary)
  }
  return { body: lines.join('\n'), url: story.videos?.url ?? null }
}

/** One paste into Gemini to cross-check a summary against the video. */
export function geminiPrompt(story: Shareable, sourceName?: string): string {
  const { body, url } = storySummaryText(story, sourceName)
  return [
    'Cross-check this AI summary of a YouTube video. Go through the video itself and tell me anything the summary gets wrong, leaves out or overstates, quoting the video where it matters.',
    '',
    body,
    ...(url ? ['', `Video: ${url}`] : []),
  ].join('\n')
}

/** The most characters in one spoken piece. Chrome's speech engine can stop in the middle of
 *  a long utterance (a known fault, around 15 s of speech), and short pieces also give
 *  pause/skip somewhere clean to land. */
export const LISTEN_CHUNK_MAX = 200

/**
 * What Listen reads for a story, as spoken pieces in order: the headline, then the short
 * version's lead and key points (the long overview if there is no short version). Each is
 * a sentence or two, ends in a full stop so the voice falls, and none is longer than
 * `LISTEN_CHUNK_MAX`; a longer sentence is cut at its last comma or space under the limit.
 */
export function listenChunks(story: { headline: string; summary: string; short?: ShortVersion | null }): string[] {
  const short = readShort(story.short)
  const parts = [story.headline, ...(short ? [short.lead, ...short.keyPoints] : [story.summary])]
  const out: string[] = []
  for (const raw of parts) {
    const text = raw.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    // sentences, each kept with its own ending
    const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text]
    let cur = ''
    for (const sentence of sentences.map(x => x.trim()).filter(Boolean)) {
      if (cur && cur.length + 1 + sentence.length <= LISTEN_CHUNK_MAX) { cur += ` ${sentence}`; continue }
      if (cur) out.push(cur)
      cur = sentence
      while (cur.length > LISTEN_CHUNK_MAX) {
        const window = cur.slice(0, LISTEN_CHUNK_MAX)
        const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf(' '))
        const at = cut > 40 ? cut + 1 : LISTEN_CHUNK_MAX
        out.push(cur.slice(0, at).trim())
        cur = cur.slice(at).trim()
      }
    }
    if (cur) out.push(cur)
  }
  // the voice should fall at the end of every piece
  return out.map(c => (/[.!?]["')\]]*$/.test(c) ? c : `${c}.`))
}
