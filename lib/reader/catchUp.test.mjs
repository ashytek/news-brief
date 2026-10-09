// Run: node --experimental-strip-types lib/reader/catchUp.test.mjs   (Node >= 22.6). Roadmap session 5.
// Offline checks of the catch-up rules (lib/reader/catchUp.ts): no React, no network.
process.env.TZ = 'Europe/London'
import {
  decideCatchUp, awayLabel, localDayKey, dayHeading, dateRange, recapDate, readRecap,
  shortSourceName, sourceCounts, buildCatchUp,
} from './catchUp.ts'

let n = 0, bad = 0
const eq = (name, got, want) => {
  n++
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { bad++; console.log('FAIL', name, '\n  got ', g, '\n  want', w) }
}

// ── trigger ──────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-10-04T18:00:00Z')
const H = 3_600_000
eq('away 25h', decideCatchUp({ prevVisit: NOW - 25 * H, now: NOW, unreadCount: 0 }), { on: true, reason: 'away' })
eq('away exactly 24h', decideCatchUp({ prevVisit: NOW - 24 * H, now: NOW, unreadCount: 0 }), { on: true, reason: 'away' })
eq('23h, 39 unread', decideCatchUp({ prevVisit: NOW - 23 * H, now: NOW, unreadCount: 39 }), { on: false, reason: null })
eq('23h, 40 unread', decideCatchUp({ prevVisit: NOW - 23 * H, now: NOW, unreadCount: 40 }), { on: true, reason: 'unread' })
eq('away beats unread', decideCatchUp({ prevVisit: NOW - 30 * H, now: NOW, unreadCount: 90 }), { on: true, reason: 'away' })
eq('first ever visit, count unknown', decideCatchUp({ prevVisit: null, now: NOW, unreadCount: null }), { on: false, reason: null })
eq('first ever visit, 41 unread', decideCatchUp({ prevVisit: null, now: NOW, unreadCount: 41 }), { on: true, reason: 'unread' })
eq('away label 25h', awayLabel(NOW - 25 * H, NOW), '1 day')
eq('away label 5d', awayLabel(NOW - 5 * 24 * H, NOW), '5 days')
eq('away label 2d', awayLabel(NOW - 48 * H, NOW), '2 days')

// ── dates ────────────────────────────────────────────────────────────────────
const now = new Date('2026-10-04T18:00:00Z')   // Sun 4 Oct, 19:00 BST
eq('day key local (BST past midnight)', localDayKey('2026-10-03T23:30:00Z'), '2026-10-04')
eq('heading today', dayHeading('2026-10-04', now), 'Today')
eq('heading yesterday', dayHeading('2026-10-03', now), 'Yesterday')
eq('heading older', dayHeading('2026-10-02', now), 'Fri 2 Oct')
eq('heading across month', dayHeading('2026-09-30', now), 'Wed 30 Sep')
eq('range', dateRange('2026-09-29T09:00:00Z', '2026-10-02T09:00:00Z'), '29 Sep – 2 Oct')
eq('range same day', dateRange('2026-10-02T06:00:00Z', '2026-10-02T09:00:00Z'), '2 Oct')
eq('range same local day across UTC midnight', dateRange('2026-10-01T23:30:00Z', '2026-10-02T09:00:00Z'), '2 Oct')
eq('range empty', dateRange(null, null), '')
eq('recap date', recapDate('2026-09-30'), '30 Sep')
eq('recap date raw', recapDate('soon'), 'soon')

// ── recap ────────────────────────────────────────────────────────────────────
eq('recap null', readRecap(null), null)
eq('recap empty object', readRecap({}), null)
eq('recap full', readRecap({
  so_far: [{ date: '2026-09-30', text: ' a ' }, { date: 5, text: 'bad' }, { date: '2026-10-01', text: '  ' }],
  latest: { date: '2026-10-02', text: 'b' },
  differ: ['people on board: 174 vs 180', '', 7],
}), { soFar: [{ date: '2026-09-30', text: 'a' }], latest: { date: '2026-10-02', text: 'b' }, differ: ['people on board: 174 vs 180'] })
eq('recap latest only (single-day storyline)', readRecap({ so_far: [], latest: { date: '2026-10-02', text: 'b' } }), { soFar: [], latest: { date: '2026-10-02', text: 'b' }, differ: [] })
eq('recap so_far only', readRecap({ so_far: [{ date: '2026-09-30', text: 'a' }] }), { soFar: [{ date: '2026-09-30', text: 'a' }], latest: null, differ: [] })

// ── sources line ─────────────────────────────────────────────────────────────
eq('short names', ['India Global Review', 'Firstpost Vantage', 'Career 247'].map(shortSourceName), ['IGR', 'Vantage', 'Career 247'])
const names = { a: 'Firstpost Vantage', b: 'India Global Review', c: 'Career 247' }
eq('source counts', sourceCounts([{ source_id: 'a' }, { source_id: 'a' }, { source_id: 'b' }, { source_id: 'c' }, { source_id: 'zz' }], id => names[id]),
  [{ name: 'Vantage', count: 2 }, { name: 'Career 247', count: 1 }, { name: 'IGR', count: 1 }, { name: 'Unknown', count: 1 }])

// ── buildCatchUp ─────────────────────────────────────────────────────────────
let k = 0
const story = (id, o = {}) => ({
  id, source_id: o.source ?? 'a', category: o.category ?? 'india_global', headline: o.headline ?? `H ${id}`, summary: 's', bullets: [],
  storyline_id: o.sl ?? null, cluster_id: null, matched_topics: o.topics ?? null,
  created_at: o.at ?? new Date(NOW - (++k) * H).toISOString(),
  videos: { id: 'v' + id, url: 'u', published_at: o.at ?? new Date(NOW - k * H).toISOString(), thumbnail_url: null, duration_seconds: null },
})
const sl = (id, count, last) => ({ id, category: 'india_global', title: `Title ${id}`, recap: { so_far: [], latest: { date: '2026-10-04', text: 'x' } },
  story_count: count, recap_story_count: count, first_report_at: '2026-10-01T10:00:00Z', last_report_at: last, recap_updated_at: null })

const mk = (over = {}) => ({
  pool: [], members: [], storylines: [], readIds: new Set(), layoutReadIds: new Set(),
  keep: () => true, isIGR: s => s.source_id === 'b', now, prevVisit: NOW - 3 * 24 * H, ...over,
})

{ // a normal storyline, a pair, an all-read one, a held one
  const S = ['s1', 's2', 's3', 's4'].map((id, i) => story(id, { sl: 'S', at: new Date(NOW - (i + 1) * H).toISOString() }))
  S[3].created_at = new Date(NOW - 10 * 24 * H).toISOString()            // an old report, outside the window
  S[3].videos.published_at = S[3].created_at
  const P = ['p1', 'p2'].map(id => story(id, { sl: 'P' }))
  const Q = ['q1', 'q2', 'q3'].map(id => story(id, { sl: 'Q' }))
  const R = ['r1', 'r2', 'r3'].map(id => story(id, { sl: 'R' }))
  const lone = story('lone'), orphan = story('orphan', { sl: 'GONE' })
  const pool = [...S.slice(0, 3), ...P, ...Q, ...R, lone, orphan]
  const readIds = new Set(['s4', 'q1', 'q2', 'q3', 'r1', 'r2', 'r3'])
  const layoutReadIds = new Set(['s4', 'q1', 'q2', 'q3', 'r2', 'r3'])   // r1 was just auto-marked: held in place
  const v = buildCatchUp(mk({
    pool, members: [...S, ...P, ...Q, ...R], readIds, layoutReadIds,
    storylines: [sl('P', 2, '2026-10-04T10:00:00Z'), sl('Q', 3, '2026-10-04T11:00:00Z'), sl('R', 3, '2026-10-02T09:00:00Z'), sl('S', 4, '2026-10-04T12:00:00Z')],
  }))
  eq('cards: S then R (newest report first); P is a pair, Q is all read', v.storylines.map(e => e.storyline.id), ['S', 'R'])
  eq('S lists all 4 reports, newest first', v.storylines[0].members.map(m => m.id), ['s1', 's2', 's3', 's4'])
  eq('S unread = 3 (the old one is read)', v.storylines[0].unreadIds, ['s1', 's2', 's3'])
  eq('R stays while held, nothing left to mark', [v.storylines[1].storyline.id, v.storylines[1].unreadIds], ['R', []])
  eq('range comes from the storyline', v.storylines[0].range, '1 Oct – 4 Oct')
  eq('recap read', v.storylines[0].recap?.latest?.text, 'x')
  const singles = v.days.flatMap(d => d.stories.map(s => s.id)).sort()
  eq('singles: the pair, the lone one, the orphan; none of Q/R/S', singles, ['lone', 'orphan', 'p1', 'p2'])
  eq('unread count = S 3 + 4 singles', v.unreadCount, 7)
  eq('new since last visit (all within 3 days)', v.newCount, 7)
}

{ // a mute takes a report away: below three it stops being a card
  const m = ['m1', 'm2', 'm3'].map((id, i) => story(id, { sl: 'M', topics: i === 0 ? ['x'] : null }))
  const v = buildCatchUp(mk({ pool: m, members: m, storylines: [sl('M', 3, '2026-10-04T12:00:00Z')], keep: s => !(s.matched_topics ?? []).includes('x') }))
  eq('muted report drops the card below 3', [v.storylines.length, v.days.flatMap(d => d.stories.map(s => s.id)).sort()], [0, ['m2', 'm3']])
}

{ // a storyline whose only unread reports are outside this tab's pool is not shown here
  const a = ['a1', 'a2', 'a3'].map(id => story(id, { sl: 'A' }))
  const v = buildCatchUp(mk({ pool: [a[0]], members: a, storylines: [sl('A', 3, '2026-10-04T12:00:00Z')], readIds: new Set(['a1']), layoutReadIds: new Set(['a1']) }))
  eq('no unread report in the pool: no card', v.storylines.length, 0)
}

{ // days, order within a day, IGR first
  const at = (day, hh) => `2026-10-${day}T${hh}:00:00Z`
  const d4 = [story('o1', { at: at('04', '10') }), story('i1', { at: at('04', '09'), source: 'b' }), story('o2', { at: at('04', '08') }), story('i2', { at: at('04', '07'), source: 'b' }), story('i3', { at: at('04', '06'), source: 'b' }), story('o3', { at: at('04', '05') })]
  const d3 = [story('o4', { at: at('03', '12') })]
  const d1 = [story('o5', { at: at('01', '12') })]
  const v = buildCatchUp(mk({ pool: [...d1, ...d4, ...d3] }))
  eq('days newest first, labelled', v.days.map(d => [d.key, d.label]), [['2026-10-04', 'Today'], ['2026-10-03', 'Yesterday'], ['2026-10-01', 'Thu 1 Oct']])
  eq('IGR first within a day (all of it), then the rest, each newest first', v.days[0].stories.map(s => s.id), ['i1', 'i2', 'i3', 'o1', 'o2', 'o3'])
  eq('day unread ids follow the same order', v.days[0].unreadIds, ['i1', 'i2', 'i3', 'o1', 'o2', 'o3'])
}

{ // read stories leave the list; held ones stay but are not counted
  const a = [story('x1'), story('x2'), story('x3')]
  const v = buildCatchUp(mk({ pool: a, readIds: new Set(['x1', 'x2']), layoutReadIds: new Set(['x1']) }))
  eq('x1 read is gone; x2 held stays', v.days.flatMap(d => d.stories.map(s => s.id)).sort(), ['x2', 'x3'])
  eq('only x3 counts as unread', [v.unreadCount, v.days[0].unreadIds], [1, ['x3']])
}

{ // first visit: no "since", everything unread is new
  const a = [story('f1'), story('f2')]
  eq('no previous visit', buildCatchUp(mk({ pool: a, prevVisit: null })).newCount, 2)
  const old = story('old', { at: new Date(NOW - 5 * 24 * H).toISOString() })
  eq('older than the last visit is unread but not new', buildCatchUp(mk({ pool: [old, ...a] })).newCount, 2)
}

console.log(bad ? `${bad} of ${n} failed` : `${n} catch-up checks passed`)
process.exit(bad ? 1 : 0)
