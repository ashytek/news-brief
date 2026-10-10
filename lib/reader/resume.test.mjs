// Run: node --experimental-strip-types lib/reader/resume.test.mjs   (Node >= 22.6). Roadmap session 7.
// Offline checks of the resume rules (lib/reader/resume.ts): no React, no network.
import { decideResume, RESUME_REFRESH_AFTER_MS } from './resume.ts'

let n = 0, bad = 0
const eq = (name, got, want) => {
  n++
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { bad++; console.log('FAIL', name, '\n  got ', g, '\n  want', w) }
}

const MIN = 60_000, H = 3_600_000
const REOPEN = 24 * H
const d = (awayMs, catchUpOn) => decideResume({ awayMs, catchUpOn, reopenAfterMs: REOPEN })
const none = { refresh: false, newVisit: false, redecide: false }

eq('threshold is 10 min', RESUME_REFRESH_AFTER_MS, 10 * MIN)
eq('30 s away: nothing', d(30_000, false), none)
eq('9 min 59 s away: nothing', d(10 * MIN - 1000, false), none)
eq('under 10 min, catch-up on: nothing', d(5 * MIN, true), none)
eq('exactly 10 min: refresh + new visit', d(10 * MIN, false), { refresh: true, newVisit: true, redecide: false })
eq('3 h away: refresh + new visit', d(3 * H, false), { refresh: true, newVisit: true, redecide: false })
eq('23 h 59 min away: refresh + new visit', d(24 * H - MIN, false), { refresh: true, newVisit: true, redecide: false })
eq('3 h away in catch-up: refresh, visit not moved', d(3 * H, true), { refresh: true, newVisit: false, redecide: false })
eq('exactly 24 h: reopen (decide afresh)', d(24 * H, false), { refresh: false, newVisit: true, redecide: true })
eq('3 days away: reopen', d(72 * H, false), { refresh: false, newVisit: true, redecide: true })
eq('3 days away already in catch-up: reopen too', d(72 * H, true), { refresh: false, newVisit: true, redecide: true })
eq('negative (clock moved back): nothing', d(-5 * MIN, false), none)

console.log(bad === 0 ? `ok: ${n} checks` : `${bad} of ${n} FAILED`)
process.exit(bad === 0 ? 0 : 1)
