/**
 * Catch-up view: the rules, as plain functions (no React, no Supabase), so they
 * can be tested offline: `node --experimental-strip-types lib/reader/catchUp.test.mjs`.
 * SPEC.md "Frontend" and the redesign addendum are the source; Ash's decisions of
 * 3 and 9 Oct 2026 are the numbers below.
 *
 * Only `import type` here: Node's type stripping must be able to load this file.
 */
import type { Storyline, StorylineRecap, StoryWithRelations } from '../types'

/** Switches itself on after this long away, or with this many unread stories. */
export const CATCHUP_AWAY_HOURS = 24
export const CATCHUP_UNREAD_THRESHOLD = 40
/** Catch-up never reaches back further than this, and loads at most this many stories. */
export const CATCHUP_WINDOW_DAYS = 7
export const CATCHUP_POOL_LIMIT = 400
/** Fewer reports than this is not a storyline on screen (the pipeline stores pairs, and
 *  only writes a recap from three). */
export const MIN_STORYLINE_REPORTS = 3

const HOUR = 3_600_000

/** Why catch-up is on. `manual` = the user flipped the toggle. */
export type CatchUpReason = 'away' | 'unread' | 'manual'

/** The automatic decision, made once per app open (never re-made while reading:
 *  marking stories read must not flip the view away under you). */
export function decideCatchUp({ prevVisit, now, unreadCount }: {
  prevVisit: number | null
  now: number
  /** Unread stories, or null while that is not known yet. */
  unreadCount: number | null
}): { on: boolean; reason: 'away' | 'unread' | null } {
  if (prevVisit !== null && now - prevVisit >= CATCHUP_AWAY_HOURS * HOUR) return { on: true, reason: 'away' }
  if (unreadCount !== null && unreadCount >= CATCHUP_UNREAD_THRESHOLD) return { on: true, reason: 'unread' }
  return { on: false, reason: null }
}

/** "1 day", "3 days" for the "Away 3 days" notice (24 h and over, so never "0 days"). */
export function awayLabel(prevVisit: number, now: number): string {
  const days = Math.max(1, Math.round((now - prevVisit) / (24 * HOUR)))
  return days === 1 ? '1 day' : `${days} days`
}

// ── Dates (local time: the phone's day, which is Ash's day) ──────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (n: number) => String(n).padStart(2, '0')

/** `2026-10-03` for the local day of a timestamp. */
export function localDayKey(iso: string | number | Date): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A `YYYY-MM-DD` key (recap dates are Europe/London days, already without a time) as a local Date. */
export function parseDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** "3 Oct" */
export function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** "Sat 3 Oct", "Yesterday", "Today": the heading of a day in the headline list. */
export function dayHeading(key: string, now: Date): string {
  if (key === localDayKey(now)) return 'Today'
  if (key === localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday'
  const d = parseDayKey(key)
  return d ? `${WEEKDAYS[d.getDay()]} ${shortDate(d)}` : key
}

/** "29 Sep – 2 Oct", or "2 Oct" when it is one day. */
export function dateRange(first: string | null | undefined, last: string | null | undefined): string {
  const a = first ? new Date(first) : null
  const b = last ? new Date(last) : null
  if (!a && !b) return ''
  if (!a || !b) return shortDate((a ?? b)!)
  return localDayKey(a) === localDayKey(b) ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`
}

/** A recap's `YYYY-MM-DD` as "30 Sep" (falls back to the raw text). */
export function recapDate(key: string): string {
  const d = parseDayKey(key)
  return d ? shortDate(d) : key
}

// ── Recap (untyped jsonb: read defensively, like `readShort`) ────────────────

export interface ReadRecap {
  soFar: { date: string; text: string }[]
  latest: { date: string; text: string } | null
  differ: string[]
}

const isEntry = (e: unknown): e is { date: string; text: string } =>
  !!e && typeof (e as { date?: unknown }).date === 'string' && typeof (e as { text?: unknown }).text === 'string'
  && (e as { text: string }).text.trim().length > 0

/** The recap, or null when there is none worth showing (not written yet, or malformed). */
export function readRecap(r: StorylineRecap | null | undefined): ReadRecap | null {
  if (!r || typeof r !== 'object') return null
  const soFar = Array.isArray(r.so_far) ? r.so_far.filter(isEntry).map(e => ({ date: e.date, text: e.text.trim() })) : []
  const latest = isEntry(r.latest) ? { date: r.latest.date, text: r.latest.text.trim() } : null
  const differ = Array.isArray(r.differ) ? r.differ.filter(d => typeof d === 'string' && d.trim().length > 0).map(d => d.trim()) : []
  if (!latest && soFar.length === 0) return null
  return { soFar, latest, differ }
}

// ── Sources line of a storyline card ─────────────────────────────────────────

/** "IGR", "Vantage": the long channel names do not fit on a storyline card. */
export function shortSourceName(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('india global review')) return 'IGR'
  if (n.includes('vantage') || n.includes('firstpost')) return 'Vantage'
  return name
}

/** Reports per source, most first: "Vantage 12 · IGR 7 · Career 247 3". */
export function sourceCounts(members: StoryWithRelations[], nameOf: (sourceId: string) => string | undefined): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const m of members) {
    const name = shortSourceName(nameOf(m.source_id) ?? 'Unknown')
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

// ── Building the view ────────────────────────────────────────────────────────

const publishedAt = (s: StoryWithRelations) => Date.parse(s.videos?.published_at ?? s.created_at)
const newestFirst = (a: StoryWithRelations, b: StoryWithRelations) => publishedAt(b) - publishedAt(a)

export interface StorylineEntry {
  storyline: Storyline
  /** Every visible report of the storyline, newest first (read ones too: "See all N"). */
  members: StoryWithRelations[]
  /** Reports not yet read (what "Mark all read" will mark). */
  unreadIds: string[]
  recap: ReadRecap | null
  range: string
}

export interface DayGroup {
  key: string
  label: string
  stories: StoryWithRelations[]
  /** Unread stories of the day (what "Mark day read" will mark). */
  unreadIds: string[]
}

export interface CatchUpView {
  storylines: StorylineEntry[]
  days: DayGroup[]
  /** Unread stories on screen (storyline reports + headline rows). */
  unreadCount: number
  /** Of those, how many arrived after the last visit. */
  newCount: number
}

export interface CatchUpInput {
  /** The tab's stories from the last 7 days (newest first or not: order is re-made here). */
  pool: StoryWithRelations[]
  /** Every report of the storylines the pool points to (they can be older than the window). */
  members: StoryWithRelations[]
  storylines: Storyline[]
  readIds: Set<string>
  /** `readIds` minus the held (just auto-marked) ones: what decides what stays on screen. */
  layoutReadIds: Set<string>
  /** Active source and not muted. */
  keep: (s: StoryWithRelations) => boolean
  isIGR: (s: StoryWithRelations) => boolean
  /** Two lead per one rest (`interleaveLead`): IGR leads within a day, as everywhere else. */
  mix: (lead: StoryWithRelations[], rest: StoryWithRelations[]) => StoryWithRelations[]
  now: Date
  prevVisit: number | null
}

/**
 * What the catch-up shows for one tab: storylines first (3+ visible reports, at least
 * one of them unread and in this tab's window; newest report first), then every other
 * unread story as a headline list grouped by local day, IGR first within a day.
 *
 * A storyline that is all read, or has fewer than three visible reports, is not a card:
 * its unread stories fall through to the headline list. A report that was just
 * auto-marked read stays where it is (`layoutReadIds`), like in the normal feed.
 */
export function buildCatchUp(input: CatchUpInput): CatchUpView {
  const { readIds, layoutReadIds, keep, isIGR, mix, now, prevVisit } = input

  const poolVisible = input.pool.filter(keep)
  const inPool = new Set(poolVisible.map(s => s.id))

  // Every visible report of each storyline: the members query plus the pool (a story
  // can be in only one of them while a refresh is half-way).
  const byStoryline = new Map<string, Map<string, StoryWithRelations>>()
  for (const s of [...input.members, ...poolVisible]) {
    if (!s.storyline_id || !keep(s)) continue
    let m = byStoryline.get(s.storyline_id)
    if (!m) byStoryline.set(s.storyline_id, (m = new Map()))
    m.set(s.id, s)
  }

  const entries: StorylineEntry[] = []
  for (const sl of input.storylines) {
    const members = [...(byStoryline.get(sl.id)?.values() ?? [])].sort(newestFirst)
    if (members.length < MIN_STORYLINE_REPORTS) continue
    if (!members.some(m => inPool.has(m.id) && !layoutReadIds.has(m.id))) continue
    entries.push({
      storyline: sl,
      members,
      unreadIds: members.filter(m => !readIds.has(m.id)).map(m => m.id),
      recap: readRecap(sl.recap),
      range: dateRange(sl.first_report_at ?? new Date(publishedAt(members[members.length - 1])).toISOString(),
        sl.last_report_at ?? new Date(publishedAt(members[0])).toISOString()),
    })
  }
  const lastReport = (e: StorylineEntry) => Date.parse(e.storyline.last_report_at ?? '') || publishedAt(e.members[0])
  entries.sort((a, b) => lastReport(b) - lastReport(a))
  const shown = new Set(entries.map(e => e.storyline.id))

  // Headline list: everything else that is still unread.
  const singles = poolVisible.filter(s => !(s.storyline_id && shown.has(s.storyline_id)) && !layoutReadIds.has(s.id))
  const byDay = new Map<string, StoryWithRelations[]>()
  for (const s of singles) {
    const key = localDayKey(publishedAt(s))
    const list = byDay.get(key)
    if (list) list.push(s)
    else byDay.set(key, [s])
  }
  const days: DayGroup[] = [...byDay.keys()].sort().reverse().map(key => {
    const list = byDay.get(key)!.sort(newestFirst)
    const stories = mix(list.filter(isIGR), list.filter(s => !isIGR(s)))
    return { key, label: dayHeading(key, now), stories, unreadIds: stories.filter(s => !readIds.has(s.id)).map(s => s.id) }
  })

  const unreadStories = [
    ...entries.flatMap(e => e.members.filter(m => !readIds.has(m.id))),
    ...singles.filter(s => !readIds.has(s.id)),
  ]
  return {
    storylines: entries,
    days,
    unreadCount: unreadStories.length,
    newCount: prevVisit === null ? unreadStories.length : unreadStories.filter(s => Date.parse(s.created_at) > prevVisit).length,
  }
}
