import { useCallback, useEffect, useRef, useState } from 'react'
import type { Supabase } from './types'

// workflow_dispatch returns no run ID, so there's no way to directly
// correlate a trigger with the resulting Actions run — we can only watch
// pipeline_runs for a new row to appear (id differs from the baseline
// captured at trigger time) and then track it to completion.
const POLL_INTERVAL_WAITING_MS = 15_000
const POLL_INTERVAL_RUNNING_MS = 45_000
const MAX_WAITING_MS = 10 * 60_000  // GitHub queue + checkout + pip install
const MAX_RUNNING_MS = 45 * 60_000  // matches the workflow's own timeout

/** Manual "Run now": POST the trigger route, then poll pipeline_runs until the
 *  run starts and finishes; on completion refresh what's on screen. Moved out
 *  of ReaderClient unchanged — polling behaviour is deliberately identical. */
export function usePipelineTrigger(
  supabase: Supabase,
  { loadContent, loadReadIds, refreshPipelineHealth }: {
    loadContent: () => Promise<void>
    loadReadIds: () => Promise<void>
    refreshPipelineHealth: () => Promise<void>
  },
) {
  const [triggerState, setTriggerState] = useState<'idle' | 'triggering' | 'waiting' | 'running'>('idle')
  const [triggerError, setTriggerError] = useState<string | null>(null)
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null)
  const triggerPollRef = useRef<{
    timeoutId: ReturnType<typeof setTimeout> | null
    baselineId: string | null
    phase: 'waiting' | 'running'
    deadline: number
  }>({ timeoutId: null, baselineId: null, phase: 'waiting', deadline: 0 })

  const pollTriggerStatus = useCallback(async () => {
    const ref = triggerPollRef.current
    const { data } = await supabase
      .from('pipeline_runs')
      .select('id, status, started_at, finished_at, stories_created')
      .order('started_at', { ascending: false })
      .limit(1)
    const row = data?.[0]
    const isNewRow = row && row.id !== ref.baselineId

    if (!isNewRow) {
      if (Date.now() > ref.deadline) {
        setTriggerMessage('Still waiting on GitHub — check back shortly.')
        setTriggerState('idle')
        return
      }
      // The poll re-schedules itself: each scheduled run keeps the closure it was
      // created with (unchanged behaviour, moved verbatim from ReaderClient).
      // eslint-disable-next-line react-hooks/immutability
      ref.timeoutId = setTimeout(pollTriggerStatus, POLL_INTERVAL_WAITING_MS)
      return
    }

    // A new row exists — switch to the "running" phase bookkeeping the
    // first time we see it (fresh deadline, slower poll cadence).
    if (ref.phase !== 'running') {
      ref.phase = 'running'
      ref.deadline = Date.now() + MAX_RUNNING_MS
      setTriggerState('running')
    }

    if (row.finished_at) {
      setTriggerState('idle')
      setTriggerMessage(
        row.status === 'success' ? `✓ Done — ${row.stories_created ?? 0} new stories.`
        : row.status === 'partial' ? 'Finished with some issues — see status below.'
        : 'Run failed — see status below.'
      )
      // The whole point of the button is fresh content — completion alone
      // doesn't update what's on screen.
      loadContent()
      loadReadIds()
      refreshPipelineHealth()
      return
    }

    setTriggerMessage('Pipeline is running…')
    if (Date.now() > ref.deadline) {
      setTriggerMessage('Still running — check back shortly.')
      setTriggerState('idle')
      return
    }
    ref.timeoutId = setTimeout(pollTriggerStatus, POLL_INTERVAL_RUNNING_MS)
  }, [supabase, loadContent, loadReadIds, refreshPipelineHealth])

  const handleTriggerPipeline = useCallback(async () => {
    if (triggerState !== 'idle') return
    setTriggerError(null)
    setTriggerMessage(null)
    setTriggerState('triggering')
    try {
      const res = await fetch('/api/pipeline/trigger', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTriggerError(
          res.status === 401 ? 'Please sign in again.'
          : res.status === 409 ? 'A pipeline run is already in progress.'
          : res.status === 429 ? `Triggered recently — wait ${Math.ceil((body.retryAfterSeconds ?? 60) / 60)} min.`
          : "Couldn't trigger the pipeline — try again shortly."
        )
        setTriggerState('idle')
        return
      }
      triggerPollRef.current = {
        timeoutId: null,
        baselineId: body.latestRunId ?? null,
        phase: 'waiting',
        deadline: Date.now() + MAX_WAITING_MS,
      }
      setTriggerState('waiting')
      setTriggerMessage('Triggered — waiting for it to start…')
      triggerPollRef.current.timeoutId = setTimeout(pollTriggerStatus, POLL_INTERVAL_WAITING_MS)
    } catch (e) {
      console.error('trigger pipeline failed', e)
      setTriggerError("Couldn't trigger the pipeline — try again shortly.")
      setTriggerState('idle')
    }
  }, [triggerState, pollTriggerStatus])

  // Stop any in-flight poll on unmount
  useEffect(() => {
    return () => {
      if (triggerPollRef.current.timeoutId) clearTimeout(triggerPollRef.current.timeoutId)
    }
  }, [])

  const dismissTriggerMessage = useCallback(() => {
    setTriggerError(null)
    setTriggerMessage(null)
  }, [])

  return { triggerState, triggerError, triggerMessage, handleTriggerPipeline, dismissTriggerMessage }
}
