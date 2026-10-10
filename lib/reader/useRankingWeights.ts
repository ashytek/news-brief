import { useEffect, useState } from 'react'
import type { Supabase } from './types'
import { isRecord, loadFeed, saveFeed } from './feedCache'

const isNumberMap = (d: unknown): d is Record<string, number> => isRecord(d) && Object.values(d).every(v => typeof v === 'number')

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
          saveFeed('source_weights', map)
        } else {
          const saved = loadFeed('source_weights', isNumberMap)   // no signal: the last weights, so the order matches
          if (saved) setSourceWeights(saved.data)
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
          saveFeed('topic_weights', map)
        } else {
          const saved = loadFeed('topic_weights', isNumberMap)
          if (saved) setTopicWeights(saved.data)
        }
      })
  }, [enabled, supabase, userId])

  return { sourceWeights, topicWeights, setSourceWeights }
}
