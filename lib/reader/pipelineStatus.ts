import { msSince } from '@/lib/format'

export type PipelineTone = 'ok' | 'warn' | 'bad'

export interface PipelineStatusInfo {
  tone: PipelineTone
  /** The top-bar chip: "3h", "45m", "2d". */
  short: string
  /** The full sentence, for the status sheet and screen readers. */
  label: string
}

/** Pipeline health from the last finished run. Three explicit states so silence
 *  is never ambiguous: ok (checked within 8 h), stale (8-24 h), down (over 24 h,
 *  or the last three runs found videos but made no stories). Null until a run
 *  has been seen. (Same thresholds as the old header line.) */
export function describePipeline(lastRun: Date | null, struggling: boolean): PipelineStatusInfo | null {
  if (!lastRun) return null
  const ageMs = msSince(lastRun)
  const mins = Math.round(ageMs / 60000)
  const short = mins < 60 ? `${mins}m` : mins < 24 * 60 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / (24 * 60))}d`
  const ago =
    mins < 60 ? `${mins}m ago`
    : mins < 24 * 60 ? `${Math.round(mins / 60)}h ago`
    : lastRun.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const down = ageMs > 24 * 3600 * 1000
  const stale = ageMs > 8 * 3600 * 1000
  if (struggling) return { tone: 'bad', short, label: `Sources failing · last check ${ago}` }
  if (down) return { tone: 'bad', short, label: `Pipeline down · last check ${ago}` }
  if (stale) return { tone: 'warn', short, label: `Checked ${ago}` }
  return { tone: 'ok', short, label: `Checked ${ago}` }
}
