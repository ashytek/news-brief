import { useCallback, useEffect, useState } from 'react'
import type { Supabase } from './types'

/** Pipeline health — last completed run of ANY status (a success-only
 *  query hides outages: the dot stayed green while runs were failing).
 *  "Struggling" = the last 3 runs found videos but produced 0 stories.
 *  `refreshPipelineHealth` is also re-run after a manually triggered run
 *  finishes (see usePipelineTrigger). */
export function usePipelineHealth(supabase: Supabase, enabled: boolean) {
  const [lastPipelineRun, setLastPipelineRun] = useState<Date | null>(null)
  const [pipelineStruggling, setPipelineStruggling] = useState(false)

  const refreshPipelineHealth = useCallback(async () => {
    const { data } = await supabase
      .from('pipeline_runs')
      .select('finished_at, status, stories_created, videos_found')
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(3)
    if (!data || data.length === 0) return
    setLastPipelineRun(new Date(data[0].finished_at))
    const struggling =
      data.length >= 3 &&
      data.every(r => (r.stories_created ?? 0) === 0) &&
      data.some(r => (r.videos_found ?? 0) > 0)
    setPipelineStruggling(struggling)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the query resolves
    if (enabled) refreshPipelineHealth()
  }, [enabled, refreshPipelineHealth])

  return { lastPipelineRun, pipelineStruggling, refreshPipelineHealth }
}
