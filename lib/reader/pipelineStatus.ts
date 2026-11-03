import { msSince } from '@/lib/format'

export type PipelineTone = 'ok' | 'warn' | 'bad'

export interface PipelineStatusInfo {
  tone: PipelineTone
  /** The top-bar chip: "3h", "45m", "2d". */
  short: string
  /** The full sentence, for the status sheet and screen readers. */
  label: string
}

/** What pipeline/run_pipeline.py writes to pipeline_runs.error_log when Gemini
 *  refuses every call because the prepaid credit is used up (pipeline/llm.py
 *  CREDIT_DEPLETED_MARKER). 27 Oct-3 Nov 2026 that went unseen for a week. */
export const CREDIT_DEPLETED_MARKER = 'GEMINI_CREDIT_DEPLETED'

/** Did this run stop because the Gemini prepaid credit ran out? Reads
 *  error_log whatever shape it arrives in (a list of strings today). */
export function isCreditDepleted(run: { status?: string | null; error_log?: unknown } | null | undefined): boolean {
  if (!run || run.status !== 'failed' || run.error_log == null) return false
  return JSON.stringify(run.error_log).includes(CREDIT_DEPLETED_MARKER)
}

/** Pipeline health from the last finished run. Three explicit states so silence
 *  is never ambiguous: ok (checked within 8 h), stale (8-24 h), down (over 24 h,
 *  or the last three runs found videos but made no stories). Null until a run
 *  has been seen. (Same thresholds as the old header line.) A last run that
 *  stopped for Gemini credit says so, ahead of everything else. */
export function describePipeline(lastRun: Date | null, struggling: boolean, creditOut = false): PipelineStatusInfo | null {
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
  if (creditOut) return { tone: 'bad', short, label: `Gemini credit ran out · top up in AI Studio · last run ${ago}` }
  if (struggling) return { tone: 'bad', short, label: `Sources failing · last check ${ago}` }
  if (down) return { tone: 'bad', short, label: `Pipeline down · last check ${ago}` }
  if (stale) return { tone: 'warn', short, label: `Checked ${ago}` }
  return { tone: 'ok', short, label: `Checked ${ago}` }
}
