import { useCallback, useMemo } from 'react'
import { interleaveLead, isIGRSource, rankItems } from '@/lib/ranking'
import type { Source, StoryWithRelations } from '@/lib/types'
import type { ActiveTab } from './types'

/** Everything the feed screens derive from the loaded stories: mute/active
 *  filters, the Unread/All view, the IGR+Vantage pinned block, the merged
 *  feed and the "since you left" counts. Pure derivation — ranking order,
 *  filtering and counts are exactly what ReaderClient computed inline. */
export function useFeedView({
  activeTab, soloStories, todayStories, sources, readIds, layoutReadIds, showUnreadOnly,
  hasMutedTopic, prevVisit, sourceWeights, topicWeights,
}: {
  activeTab: ActiveTab
  soloStories: StoryWithRelations[]
  todayStories: StoryWithRelations[]
  sources: Record<string, Source>
  readIds: Set<string>
  layoutReadIds: Set<string>
  showUnreadOnly: boolean
  hasMutedTopic: (topics: string[] | null | undefined) => boolean
  prevVisit: number | null
  sourceWeights: Record<string, number>
  topicWeights: Record<string, number>
}) {
  const isActiveSource = useCallback((sourceId: string) =>
    sources[sourceId]?.is_active !== false,
  [sources])

  // Mute + active-source filters, independent of the unread-only toggle —
  // shared base for both the rendered feed and the unread count, so they
  // can't drift apart.
  const mutedAndActiveSolos = useMemo(
    () => soloStories
      .filter(s => isActiveSource(s.source_id))
      .filter(s => !hasMutedTopic(s.matched_topics)),
    [soloStories, hasMutedTopic, isActiveSource]
  )

  const visibleSolos = useMemo(
    () => mutedAndActiveSolos.filter(s => showUnreadOnly ? !layoutReadIds.has(s.id) : true),
    [mutedAndActiveSolos, layoutReadIds, showUnreadOnly]
  )

  const unreadCount = useMemo(
    () => mutedAndActiveSolos.filter(s => !readIds.has(s.id)).length,
    [mutedAndActiveSolos, readIds]
  )

  // Today tab — filter to active sources and muted topics before passing to
  // TodayFeed.
  const activeTodayStories = useMemo(
    () => todayStories
      .filter(s => isActiveSource(s.source_id))
      .filter(s => !hasMutedTopic(s.matched_topics)),
    [todayStories, isActiveSource, hasMutedTopic]
  )

  // The brief itself: the top 12 by ranking. Held (dwell-read) cards still rank as
  // unread so they stay put; the count and the progress bar use the real read set.
  const todayRanked = useMemo(
    () => rankItems(activeTodayStories, layoutReadIds, sourceWeights, topicWeights, 12,
      s => isIGRSource(sources[s.source_id])),
    [activeTodayStories, layoutReadIds, sourceWeights, topicWeights, sources],
  )

  // The Today badge counts what the brief shows (not every story from the last 24 h),
  // so "Today 12" and "0 of 12 read" agree.
  const todayUnread = useMemo(
    () => todayRanked.filter(item => !readIds.has(item.data.id)).length,
    [todayRanked, readIds]
  )

  const isEmpty = visibleSolos.length === 0

  const isVantage = useCallback((story: StoryWithRelations) => {
    const src = sources[story.source_id]
    const name = (src?.name ?? '').toLowerCase()
    return name.includes('vantage') || name.includes('firstpost')
  }, [sources])

  const isIGR = useCallback(
    (story: StoryWithRelations) => isIGRSource(sources[story.source_id]),
    [sources]
  )

  // IGR + Vantage pinned to the top, IGR-led: two IGR per Vantage, each
  // newest first (Ash, Oct 2026). A time-based head start for IGR was tried
  // on real data and came out as solid blocks, since both post in bursts.
  const pinnedMix = useMemo(() => {
    const newestFirst = (a: StoryWithRelations, b: StoryWithRelations) =>
      new Date(b.videos?.published_at ?? b.created_at).getTime() -
      new Date(a.videos?.published_at ?? a.created_at).getTime()
    return interleaveLead(
      visibleSolos.filter(isIGR).sort(newestFirst),
      visibleSolos.filter(isVantage).sort(newestFirst),
    )
  }, [visibleSolos, isIGR, isVantage])

  // Feed sorted latest→oldest, with read items sunk below unread in "Show All" mode
  const mergedFeed = useMemo(
    () => visibleSolos
      .filter(s => !isVantage(s) && !isIGR(s))
      .sort((a, b) => {
        const aRead = layoutReadIds.has(a.id)
        const bRead = layoutReadIds.has(b.id)
        if (aRead !== bRead) return aRead ? 1 : -1
        const da = new Date(a.videos?.published_at ?? a.created_at).getTime()
        const db = new Date(b.videos?.published_at ?? b.created_at).getTime()
        return db - da
      }),
    [visibleSolos, isVantage, isIGR, layoutReadIds]
  )

  // "Since you left": stories that arrived (created_at) after the previous
  // visit and are still unread, in whichever tab is showing.
  const isNewSinceVisit = useCallback(
    (s: StoryWithRelations) => prevVisit !== null && new Date(s.created_at).getTime() > prevVisit,
    [prevVisit]
  )
  const newSinceVisit = useMemo(() => {
    const pool = activeTab === 'today' ? activeTodayStories : visibleSolos
    return pool.filter(s => isNewSinceVisit(s) && !readIds.has(s.id)).length
  }, [activeTab, activeTodayStories, visibleSolos, isNewSinceVisit, readIds])
  // Divider goes after the leading run of new stories only — mergedFeed is
  // ordered by publish time, so a late-summarised old video can be "new"
  // further down; splitting there would mislabel the cards above it.
  const newLeadCount = useMemo(() => {
    const i = mergedFeed.findIndex(s => !isNewSinceVisit(s))
    return i === -1 ? mergedFeed.length : i
  }, [mergedFeed, isNewSinceVisit])

  return {
    visibleSolos, unreadCount, activeTodayStories, todayRanked, todayUnread, isEmpty,
    pinnedMix, mergedFeed, newSinceVisit, newLeadCount, isActiveSource,
  }
}
