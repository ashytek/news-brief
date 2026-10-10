import { useEffect, useState } from 'react'
import type { Supabase } from './types'
import { summariseSourceStats, type SourceStat } from './sourceStats'

const WINDOW_DAYS = 30

/** The Sources page's numbers: three small read-only queries (stories of the last 30 days as
 *  id + source, your like/dislike rows, your ranking weights), summarised against the read
 *  marks the provider already holds. Fail-soft: if a query fails the page simply shows no line. */
export function useSourceStats(supabase: Supabase, userId: string, readIds: ReadonlySet<string>, readLoaded: boolean) {
  const [raw, setRaw] = useState<{ stories: { id: string; source_id: string }[]; reactions: { story_id: string | null; signal: string }[] } | null>(null)
  const [weights, setWeights] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    Promise.all([
      supabase.from('stories').select('id, source_id').gte('created_at', since).order('created_at', { ascending: false }).limit(3000),
      supabase.from('engagement').select('story_id, signal').eq('user_id', userId).in('signal', ['like', 'dislike']).not('story_id', 'is', null).order('created_at', { ascending: false }).limit(2000),
      supabase.from('source_weights').select('source_id, weight').eq('user_id', userId),
    ]).then(([st, en, sw]) => {
      if (cancelled) return
      if (st.error || !st.data) { console.warn('source stats unavailable', st.error?.message); return }
      setRaw({ stories: st.data as { id: string; source_id: string }[], reactions: (en.data ?? []) as { story_id: string | null; signal: string }[] })
      const w: Record<string, number> = {}
      for (const r of sw.data ?? []) w[r.source_id] = r.weight
      setWeights(w)
    })
    return () => { cancelled = true }
  }, [supabase, userId])

  // Not shown until the read marks are in: before then every story would look unread.
  const stats: Record<string, SourceStat> | null = raw && readLoaded ? summariseSourceStats(raw.stories, readIds, raw.reactions) : null
  return { stats, weights }
}
