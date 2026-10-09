import { useEffect, useState } from 'react'
import { CATEGORIES } from '@/lib/categories'
import type { Source } from '@/lib/types'
import type { Supabase } from './types'

/** Reference data the feed needs once per visit: the sources lookup, the
 *  7-day topic-match count, and which categories have recent content. */
export function useFeedMeta(supabase: Supabase, enabled: boolean) {
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [topicCount, setTopicCount] = useState(0)
  // Categories with at least one story in the last 7 days — hide dead tabs
  const [activeCategoryKeys, setActiveCategoryKeys] = useState<Set<string>>(
    new Set(CATEGORIES.map(c => c.key))  // show all until we know
  )

  useEffect(() => {
    if (!enabled) return

    // Load sources into a lookup map
    supabase.from('sources').select('id, name, category, source_type, is_active').then(({ data }) => {
      if (data) {
        const map: Record<string, Source> = {}
        data.forEach(s => { map[s.id] = s as unknown as Source })
        setSources(map)
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

    // Detect which categories have recent content (last 7 days) — hides dead tabs
    Promise.all(
      CATEGORIES.map(cat =>
        supabase
          .from('stories')
          .select('id', { count: 'exact', head: true })
          .eq('category', cat.key)
          .gte('created_at', sevenDaysAgo)
          .then(({ count }) => ({ key: cat.key, hasContent: (count ?? 0) > 0 }))
      )
    ).then(results => {
      setActiveCategoryKeys(new Set(results.filter(r => r.hasContent).map(r => r.key)))
    })
  }, [enabled, supabase])

  return { sources, topicCount, activeCategoryKeys }
}
