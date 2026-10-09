import { useEffect, useState } from 'react'
import type { Supabase } from './types'

/** Personal ranking weights (per source, per topic), loaded once. */
export function useRankingWeights(supabase: Supabase, userId: string, enabled: boolean) {
  const [sourceWeights, setSourceWeights] = useState<Record<string, number>>({})
  const [topicWeights, setTopicWeights] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!enabled) return
    supabase
      .from('source_weights')
      .select('source_id, weight')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, number> = {}
          data.forEach(r => { map[r.source_id] = r.weight })
          setSourceWeights(map)
        }
      })
    supabase
      .from('topic_weights')
      .select('kw, weight')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, number> = {}
          data.forEach(r => { map[r.kw] = r.weight })
          setTopicWeights(map)
        }
      })
  }, [enabled, supabase, userId])

  return { sourceWeights, topicWeights, setSourceWeights }
}
