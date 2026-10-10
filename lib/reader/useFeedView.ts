import { useCallback, useMemo } from 'react'
import { interleaveLead, isIGRSource, rankItems } from '@/lib/ranking'
import { storyMinutes, trimToBudget } from '@/lib/format'
import type { SortMode } from '@/lib/sortMode'
import type { Source, StoryWithRelations } from '@/lib/types'
import type { ActiveTab } from './types'

/** Everything the feed screens derive from the loaded stories: mute/active
 *  filters, the Unread/All view, the IGR+Vantage pinned block, the merged
 *  feed and the "since you left" counts. Pure derivation — ranking order,
 *  filtering and counts are exactly what ReaderClient computed inline. */
export function useFeedView({
  activeTab, soloStories, todayStories, sources, readIds, layoutReadIds, briefReadIds, showUnreadOnly,
  hasMutedTopic, prevVisit, sourceWeights, topicWeights, sortMode, timeBudget,
}: {
  activeTab: ActiveTab
  soloStories: StoryWithRelations[]
  todayStories: StoryWithRelations[]
  sources: Record<string, Source>
  readIds: Set<string>
  layoutReadIds: Set<string>
  /** `layoutReadIds` with the tapped-read stories kept as unread: Today's slots only. */
  briefReadIds: Set<string>
  showUnreadOnly: boolean
  hasMutedTopic: (topics: string[] | null | undefined) => boolean
  prevVisit: number | null
  sourceWeights: Record<string, number>
  topicWeights: Record<string, number>
  /** Sections order: newest first, or ranked by your weights ("For you"). */
  sortMode: SortMode
  /** "I have N minutes": show only the first unread stories that fit, or null for all. */
  timeBudget: number | null
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

  // The brief itself: the top 12 by ranking. Held (dwell-read) and tapped-read cards
  // still rank as unread so the 12 stay put; the count and the progress bar use the
  // real read set.
  const todayRanked = useMemo(
    () => rankItems(activeTodayStories, briefReadIds, sourceWeights, topicWeights, 12,
      s => isIGRSource(sources[s.source_id])),
    [activeTodayStories, briefReadIds, sourceWeights, topicWeights, sources],
  )
  // What the brief shows: the unread stories and the held ones (dimmed, auto-read while
  // on screen). A story you are done with is not shown (Ash, 10 Oct 2026).
  const todayShown = useMemo(
    () => todayRanked.filter(item => !layoutReadIds.has(item.data.id)),
    [todayRanked, layoutReadIds],
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
  const pinnedMixAll = useMemo(() => {
    const newestFirst = (a: StoryWithRelations, b: StoryWithRelations) =>
      new Date(b.videos?.published_at ?? b.created_at).getTime() -
      new Date(a.videos?.published_at ?? a.created_at).getTime()
    return interleaveLead(
      visibleSolos.filter(isIGR).sort(newestFirst),
      visibleSolos.filter(isVantage).sort(newestFirst),
    )
  }, [visibleSolos, isIGR, isVantage])

  // Feed sorted latest→oldest, with read items sunk below unread in "Show All" mode.
  // "For you" (roadmap session 8) orders the same stories by rankItems instead: recency
  // × your source weight × your topic weights, read ones still at the bottom.
  const mergedFeedAll = useMemo(() => {
    const rest = visibleSolos.filter(s => !isVantage(s) && !isIGR(s))
    if (sortMode === 'foryou') {
      return rankItems(rest, layoutReadIds, sourceWeights, topicWeights, rest.length).map(i => i.data)
    }
    return rest.sort((a, b) => {
      const aRead = layoutReadIds.has(a.id)
      const bRead = layoutReadIds.has(b.id)
      if (aRead !== bRead) return aRead ? 1 : -1
      const da = new Date(a.videos?.published_at ?? a.created_at).getTime()
      const db = new Date(b.videos?.published_at ?? b.created_at).getTime()
      return db - da
    })
  }, [visibleSolos, isVantage, isIGR, layoutReadIds, sortMode, sourceWeights, topicWeights])

  // Reading time (roadmap session 8): what is still unread in this feed adds up to this
  // many minutes, and "I have N minutes" keeps the first unread stories, in the order
  // shown, that fit (always at least the first one). Read stories drop out while it is on.
  const unreadOrder = useMemo(
    () => [...pinnedMixAll, ...mergedFeedAll].filter(s => !layoutReadIds.has(s.id)),
    [pinnedMixAll, mergedFeedAll, layoutReadIds],
  )
  const unreadMinutes = useMemo(() => unreadOrder.reduce((sum, s) => sum + storyMinutes(s), 0), [unreadOrder])
  const budgetShown = useMemo(
    () => (timeBudget === null ? null : new Set(trimToBudget(unreadOrder, storyMinutes, timeBudget).map(s => s.id))),
    [timeBudget, unreadOrder],
  )
  const pinnedMix = useMemo(() => (budgetShown ? pinnedMixAll.filter(s => budgetShown.has(s.id)) : pinnedMixAll), [pinnedMixAll, budgetShown])
  const mergedFeed = useMemo(() => (budgetShown ? mergedFeedAll.filter(s => budgetShown.has(s.id)) : mergedFeedAll), [mergedFeedAll, budgetShown])
  const budget = useMemo(
    () => (budgetShown ? { limit: timeBudget as number, shown: budgetShown.size, total: unreadOrder.length, minutes: unreadOrder.filter(s => budgetShown.has(s.id)).reduce((m, s) => m + storyMinutes(s), 0) } : null),
    [budgetShown, timeBudget, unreadOrder],
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
    visibleSolos, unreadCount, activeTodayStories, todayRanked, todayShown, todayUnread, isEmpty,
    pinnedMix, mergedFeed, newSinceVisit, newLeadCount, isActiveSource,
    unreadMinutes, budget,
  }
}
