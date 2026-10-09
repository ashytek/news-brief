import type { Storyline, StoryWithRelations } from '@/lib/types'
import { STORY_SELECT, STORYLINE_SELECT } from '@/lib/constants'
import { CATCHUP_POOL_LIMIT, CATCHUP_WINDOW_DAYS } from './catchUp'
import type { SectionKey, Supabase } from './types'

export interface CatchUpData {
  /** The tab's stories from the last 7 days, newest first. */
  pool: StoryWithRelations[]
  /** Every report of the storylines the pool points to (some are older than the window). */
  members: StoryWithRelations[]
  storylines: Storyline[]
}

/** Storyline ids go in the URL (`in.(…)`), so ask in chunks. */
const ID_CHUNK = 50

/**
 * What the catch-up needs for one tab: its stories from the last 7 days (Today and
 * All = every category; a Sections chip = that category), then the storylines those
 * stories belong to and all their reports.
 *
 * Fail-soft like the pipeline: if the storylines can't be read (table missing, a
 * network blip on the second request) the headline list still works, so that part
 * logs and carries on. Only the stories query is fatal (`ok: false`).
 */
export async function fetchCatchUp(
  supabase: Supabase,
  tab: 'today' | SectionKey,
): Promise<{ ok: true; data: CatchUpData } | { ok: false; error: unknown }> {
  const since = new Date(Date.now() - CATCHUP_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let query = supabase.from('stories').select(STORY_SELECT).gte('created_at', since)
  if (tab !== 'today' && tab !== 'all') query = query.eq('category', tab)
  const poolRes = await query.order('created_at', { ascending: false }).limit(CATCHUP_POOL_LIMIT)
  if (poolRes.error) return { ok: false, error: poolRes.error }
  const pool = (poolRes.data ?? []) as unknown as StoryWithRelations[]

  const ids = [...new Set(pool.map(s => s.storyline_id).filter((id): id is string => !!id))]
  if (ids.length === 0) return { ok: true, data: { pool, members: [], storylines: [] } }

  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK))
  const results = await Promise.all(chunks.map(chunk => Promise.all([
    supabase.from('storylines').select(STORYLINE_SELECT).in('id', chunk),
    supabase.from('stories').select(STORY_SELECT).in('storyline_id', chunk).order('created_at', { ascending: false }).limit(CATCHUP_POOL_LIMIT),
  ])))
  const failed = results.flat().find(r => r.error)
  if (failed?.error) {
    console.error('catch-up storylines failed; showing headlines only', failed.error)
    return { ok: true, data: { pool, members: [], storylines: [] } }
  }
  return {
    ok: true,
    data: {
      pool,
      storylines: results.flatMap(([sl]) => (sl.data ?? []) as unknown as Storyline[]),
      members: results.flatMap(([, m]) => (m.data ?? []) as unknown as StoryWithRelations[]),
    },
  }
}
