import { useEffect, useState } from 'react'
import { CATEGORIES } from '@/lib/categories'
import type { Source } from '@/lib/types'
import type { Supabase } from './types'
import { isRecord, loadFeed, saveFeed } from './feedCache'

/** Just enough of a story to count it: what the unread numbers on the Sections
 *  chips need, without loading the stories themselves. */
export interface PoolStory {
  id: string
  source_id: string
  matched_topics: string[] | null
  created_at: string
}

/** How many of the newest stories a Sections feed loads (a category, or All). */
export const FEED_SIZE = 100

/** Reference data the feed needs once per visit: the sources lookup, the
 *  7-day topic-match count, which categories have recent content, and each
 *  category's newest stories (ids only) for the Sections chip counts. */
export function useFeedMeta(supabase: Supabase, enabled: boolean) {
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [topicCount, setTopicCount] = useState(0)
  // Categories with at least one story in the last 7 days — hide dead chips
  const [activeCategoryKeys, setActiveCategoryKeys] = useState<Set<string>>(
    new Set(CATEGORIES.map(c => c.key))  // show all until we know
  )
  // Newest POOL_SIZE stories per category, ids and filter fields only. null until loaded.
  const [categoryPool, setCategoryPool] = useState<Record<string, PoolStory[]> | null>(null)

  useEffect(() => {
    if (!enabled) return

    // Load sources into a lookup map
    supabase.from('sources').select('id, name, category, source_type, is_active').then(({ data, status }) => {
      if (data) {
        const map: Record<string, Source> = {}
        data.forEach(s => { map[s.id] = s as unknown as Source })
        setSources(map)
        saveFeed('sources', map)
      } else if (status === 0) {
        // No signal: the channel names and flags from the last time it worked (a saved
        // feed would otherwise show every channel as "Unknown").
        const saved = loadFeed('sources', isRecord)
        if (saved) setSources(saved.data as Record<string, Source>)
      }
    })

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // Load topic count badge — scoped to the last 7 days, not all-time.
    // An unscoped count only ever grows and renders as a permanently
    // pinned "99+" in the same badge style as an unread count, conveying
    // nothing useful.
    supabase
      .from('stories')
      .select('id', { count: 'exact', head: true })
      .not('matched_topics', 'is', null)
      .gte('created_at', sevenDaysAgo)
      .then(({ count }) => { if (count) setTopicCount(count) })

    // One small query per category: its newest stories, ids only. Gives both
    // "has content in the last 7 days" (hides dead chips) and the unread count
    // for the chip, computed in the browser against the read marks and mutes so
    // it always agrees with the feed it opens.
    Promise.all(
      CATEGORIES.map(cat =>
        supabase
          .from('stories')
          .select('id, source_id, matched_topics, created_at')
          .eq('category', cat.key)
          .order('created_at', { ascending: false })
          .limit(FEED_SIZE)
          .then(({ data }) => ({ key: cat.key, rows: (data ?? []) as PoolStory[] }))
      )
    ).then(results => {
      setActiveCategoryKeys(new Set(
        results.filter(r => r.rows.some(s => s.created_at >= sevenDaysAgo)).map(r => r.key),
      ))
      setCategoryPool(Object.fromEntries(results.map(r => [r.key, r.rows])))
    })
  }, [enabled, supabase])

  return { sources, topicCount, activeCategoryKeys, categoryPool }
}
