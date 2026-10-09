import { useCallback, useMemo } from 'react'
import { CATEGORY_KEYS } from '@/lib/categories'
import type { Source } from '@/lib/types'
import { FEED_SIZE, type PoolStory } from './useFeedMeta'

/** Unread per Sections chip: the newest stories of each category, through the same
 *  mute / active-source filters and read marks as the feed itself. null until
 *  the pool has loaded, so a chip shows no number rather than a wrong one.
 *  "All" is the newest FEED_SIZE across every category (what the All feed loads),
 *  not the sum of the categories, so its number matches the list it opens. It is
 *  also the "40 unread" the catch-up trigger looks at, so the two always agree. */
export function useSectionUnread({ categoryPool, sources, hasMutedTopic, readIds }: {
  categoryPool: Record<string, PoolStory[]> | null
  sources: Record<string, Source>
  hasMutedTopic: (topics: string[] | null | undefined) => boolean
  readIds: Set<string>
}): Record<string, number> | null {
  const isActiveSource = useCallback((sourceId: string) => sources[sourceId]?.is_active !== false, [sources])
  return useMemo(() => {
    if (!categoryPool) return null
    const keep = (s: PoolStory) =>
      isActiveSource(s.source_id) && !hasMutedTopic(s.matched_topics) && !readIds.has(s.id)
    const counts: Record<string, number> = {}
    for (const key of CATEGORY_KEYS) counts[key] = (categoryPool[key] ?? []).filter(keep).length
    counts.all = CATEGORY_KEYS
      .flatMap(key => categoryPool[key] ?? [])
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, FEED_SIZE)
      .filter(keep).length
    return counts
  }, [categoryPool, isActiveSource, hasMutedTopic, readIds])
}
