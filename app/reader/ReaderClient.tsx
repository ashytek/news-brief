'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Category, Source } from '@/lib/types'
import type { StoryWithRelations, ClusterWithRelations } from '@/lib/types'
import { SoloCard } from '@/components/SoloCard'
import { ClusteredCard } from '@/components/ClusteredCard'
import { CategoryNav, type ActiveTab } from '@/components/CategoryNav'
import { TopicsPanel } from '@/components/TopicsPanel'
import { TodayFeed } from '@/components/TodayFeed'
import { SkeletonCard } from '@/components/SkeletonCard'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const CATEGORIES: { key: Category; label: string; color: string }[] = [
  { key: 'prophetic',    label: 'Prophetic',      color: 'violet' },
  { key: 'israel',       label: 'Israel',          color: 'blue'   },
  { key: 'india_global', label: 'India & Global',  color: 'amber'  },
  { key: 'tech_ai',      label: 'Tech & AI',       color: 'emerald'},
]

// Explicit column selects — omits transcript_text/embedding blobs from payload
const STORY_SELECT = `id, source_id, video_id, category, headline, summary, bullets, cluster_id, matched_topics, created_at, videos(id, url, published_at, thumbnail_url), sources(id, name)`
const CLUSTER_SELECT = `id, category, core_fact, consensus, perspectives, story_count, first_seen_at, last_updated_at, synthesised_at, stories(id, source_id, headline, summary, bullets, created_at, matched_topics, videos(id, url, published_at, thumbnail_url), sources(id, name))`

export default function ReaderClient({ userId }: { userId: string }) {
  const supabase = createClient()

  // Persist last-used tab; default to 'today'
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('newsbrief_activeTab') as ActiveTab) || 'today'
    }
    return 'today'
  })

  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab)
    if (typeof window !== 'undefined') {
      localStorage.setItem('newsbrief_activeTab', tab)
    }
  }, [])

  const [showUnreadOnly, setShowUnreadOnly] = useState(true)
  const [clusters, setClusters] = useState<ClusterWithRelations[]>([])
  const [soloStories, setSoloStories] = useState<StoryWithRelations[]>([])
  const [todayClusters, setTodayClusters] = useState<ClusterWithRelations[]>([])
  const [todayStories, setTodayStories] = useState<StoryWithRelations[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [mutedKeywords, setMutedKeywords] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [topicCount, setTopicCount] = useState(0)
  const dwellTimers = useRef<Map<string, number>>(new Map())

  // Record last-visit timestamp on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('newsbrief_lastVisit', new Date().toISOString())
    }
  }, [])

  // Load sources into a lookup map
  useEffect(() => {
    supabase.from('sources').select('id, name, category, source_type, is_active').then(({ data }) => {
      if (data) {
        const map: Record<string, Source> = {}
        data.forEach(s => { map[s.id] = s as unknown as Source })
        setSources(map)
      }
    })

    // Load topic count badge
    supabase
      .from('stories')
      .select('id', { count: 'exact', head: true })
      .not('matched_topics', 'is', null)
      .then(({ count }) => { if (count) setTopicCount(count) })
  }, [])

  // Load read item IDs once on mount — independent of active tab
  const loadReadIds = useCallback(async () => {
    const { data } = await supabase
      .from('read_items')
      .select('story_id, cluster_id')
      .eq('user_id', userId)
    if (data) {
      const ids = new Set<string>()
      data.forEach(r => {
        if (r.story_id) ids.add(r.story_id)
        if (r.cluster_id) ids.add(r.cluster_id)
      })
      setReadIds(ids)
    }
  }, [userId])

  useEffect(() => {
    loadReadIds()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps — intentionally load once

  // Load active muted topics (expires_at > now)
  useEffect(() => {
    supabase
      .from('muted_topics')
      .select('keyword')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .then(({ data }) => {
        if (data) setMutedKeywords(new Set(data.map(r => r.keyword)))
      })
  }, [userId])

  const muteTopics = useCallback(async (keywords: string[]) => {
    if (keywords.length === 0) return
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    const rows = keywords.map(keyword => ({ user_id: userId, keyword, expires_at: expiresAt }))
    await supabase.from('muted_topics').insert(rows)
    setMutedKeywords(prev => {
      const next = new Set(prev)
      keywords.forEach(k => next.add(k))
      return next
    })
  }, [userId])

  // Load content when active tab changes
  const loadContent = useCallback(async () => {
    if (activeTab === 'topics') {
      setLoading(false)
      return
    }

    setLoading(true)

    if (activeTab === 'today') {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [clusterRes, storyRes] = await Promise.all([
        supabase
          .from('clusters')
          .select(CLUSTER_SELECT)
          .gte('last_updated_at', yesterday)
          .order('last_updated_at', { ascending: false })
          .limit(60),
        supabase
          .from('stories')
          .select(STORY_SELECT)
          .is('cluster_id', null)
          .gte('created_at', yesterday)
          .order('created_at', { ascending: false })
          .limit(60),
      ])
      if (clusterRes.data) setTodayClusters(clusterRes.data as unknown as ClusterWithRelations[])
      if (storyRes.data) setTodayStories(storyRes.data as unknown as StoryWithRelations[])
      setLastUpdated(new Date())
      setLoading(false)
      return
    }

    const [clusterRes, storyRes] = await Promise.all([
      supabase
        .from('clusters')
        .select(CLUSTER_SELECT)
        .eq('category', activeTab)
        .order('last_updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('stories')
        .select(STORY_SELECT)
        .eq('category', activeTab)
        .is('cluster_id', null)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (clusterRes.data) setClusters(clusterRes.data as unknown as ClusterWithRelations[])
    if (storyRes.data) setSoloStories(storyRes.data as unknown as StoryWithRelations[])
    setLastUpdated(new Date())
    setLoading(false)
  }, [activeTab])

  useEffect(() => {
    loadContent()
  }, [activeTab, loadContent])

  const markRead = useCallback(async (storyId?: string, clusterId?: string) => {
    if (storyId && readIds.has(storyId)) return
    if (clusterId && readIds.has(clusterId)) return

    await supabase.from('read_items').upsert({
      user_id: userId,
      story_id: storyId ?? null,
      cluster_id: clusterId ?? null,
    }, { onConflict: storyId ? 'user_id,story_id' : 'user_id,cluster_id' })

    setReadIds(prev => {
      const next = new Set(prev)
      if (storyId) next.add(storyId)
      if (clusterId) next.add(clusterId)
      return next
    })
  }, [userId, readIds])

  const sendEngagement = useCallback(async (signal: string, storyId?: string, clusterId?: string) => {
    await supabase.from('engagement').insert({
      user_id: userId,
      story_id: storyId ?? null,
      cluster_id: clusterId ?? null,
      signal,
    })
    if (storyId) {
      const story = soloStories.find(s => s.id === storyId)
      if (story) {
        const delta = signal === 'like' ? 0.1 : signal === 'dislike' ? -0.15 : 0
        if (delta !== 0) {
          await supabase.rpc('adjust_source_weight', {
            p_user_id: userId,
            p_source_id: story.source_id,
            p_delta: delta
          }).maybeSingle()
        }
      }
    }
  }, [userId, soloStories])

  // Dwell time tracking — auto-mark-read when user dwells >20s
  const startDwell = useCallback((id: string) => {
    dwellTimers.current.set(id, Date.now())
  }, [])

  const endDwell = useCallback((id: string, storyId?: string, clusterId?: string) => {
    const start = dwellTimers.current.get(id)
    if (!start) return
    const elapsed = (Date.now() - start) / 1000
    dwellTimers.current.delete(id)
    if (elapsed > 20) {
      sendEngagement('dwell_long', storyId, clusterId)
      markRead(storyId, clusterId) // auto-mark-read after sufficient reading time
    } else if (elapsed < 3) {
      sendEngagement('dwell_short', storyId, clusterId)
    }
  }, [sendEngagement, markRead])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/auth'
  }

  // A cluster counts as "read" when the user marked it read OR every story
  // inside is read. When a new unread story lands in the cluster later, it
  // resurfaces automatically.
  const isClusterRead = useCallback((c: ClusterWithRelations) => {
    if (readIds.has(c.id)) return true
    const stories = c.stories ?? []
    if (stories.length === 0) return false
    return stories.every(s => readIds.has(s.id))
  }, [readIds])

  // Returns true if any of the given topic keywords are currently muted
  const hasMutedTopic = useCallback((topics: string[] | null | undefined) => {
    if (!topics || topics.length === 0) return false
    return topics.some(t => mutedKeywords.has(t))
  }, [mutedKeywords])

  const isClusterMuted = useCallback((c: ClusterWithRelations) => {
    const stories = c.stories ?? []
    if (stories.length === 0) return false
    // Mute the cluster only when every story has a muted topic — avoids
    // hiding a cluster where only one source mentioned a muted keyword.
    return stories.every(s => hasMutedTopic(s.matched_topics))
  }, [hasMutedTopic])

  const isActiveSource = useCallback((sourceId: string) =>
    sources[sourceId]?.is_active !== false,
  [sources])

  // Filter by unread (only applies to category tabs), mute, AND active source
  const visibleClusters = useMemo(
    () => clusters
      .filter(c => (c.stories ?? []).some(s => isActiveSource(s.source_id)))
      .filter(c => !isClusterMuted(c))
      .filter(c => showUnreadOnly ? !isClusterRead(c) : true),
    [clusters, isClusterRead, isClusterMuted, showUnreadOnly, isActiveSource]
  )
  const visibleSolos = useMemo(
    () => soloStories
      .filter(s => isActiveSource(s.source_id))
      .filter(s => !hasMutedTopic(s.matched_topics))
      .filter(s => showUnreadOnly ? !readIds.has(s.id) : true),
    [soloStories, readIds, hasMutedTopic, showUnreadOnly, isActiveSource]
  )

  const unreadCount = useMemo(
    () => clusters.filter(c => !isClusterRead(c)).length + soloStories.filter(s => !readIds.has(s.id)).length,
    [clusters, soloStories, isClusterRead, readIds]
  )

  // Today tab — filter to active sources before passing to TodayFeed
  const activeTodayClusters = useMemo(
    () => todayClusters.filter(c => (c.stories ?? []).some(s => isActiveSource(s.source_id))),
    [todayClusters, isActiveSource]
  )
  const activeTodayStories = useMemo(
    () => todayStories.filter(s => isActiveSource(s.source_id)),
    [todayStories, isActiveSource]
  )

  const todayUnread = useMemo(
    () => activeTodayClusters.filter(c => !isClusterRead(c)).length + activeTodayStories.filter(s => !readIds.has(s.id)).length,
    [activeTodayClusters, activeTodayStories, isClusterRead, readIds]
  )

  const isEmpty = visibleClusters.length === 0 && visibleSolos.length === 0

  // Build unified feed — memoised to avoid recomputing on every render
  type FeedItem =
    | { type: 'cluster'; data: ClusterWithRelations; date: Date }
    | { type: 'story';   data: StoryWithRelations;   date: Date }

  const isVantage = useCallback((story: StoryWithRelations) => {
    const src = sources[story.source_id]
    const name = (src?.name ?? '').toLowerCase()
    return name.includes('vantage') || name.includes('firstpost')
  }, [sources])

  const vantagePinned = useMemo(
    () => visibleSolos
      .filter(isVantage)
      .sort((a, b) => {
        const da = new Date(a.videos?.published_at ?? a.created_at)
        const db = new Date(b.videos?.published_at ?? b.created_at)
        return db.getTime() - da.getTime()
      }),
    [visibleSolos, isVantage]
  )

  const mergedFeed = useMemo(
    (): FeedItem[] => [
      ...visibleClusters.map(c => ({
        type: 'cluster' as const,
        data: c,
        date: new Date(c.last_updated_at),
      })),
      ...visibleSolos
        .filter(s => !isVantage(s))
        .map(s => ({
          type: 'story' as const,
          data: s,
          date: new Date(s.videos?.published_at ?? s.created_at),
        })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime()),
    [visibleClusters, visibleSolos, isVantage]
  )

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur border-b border-gray-800/60">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 12h6m-6-4h2" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-white leading-none">News Brief</h1>
              {lastUpdated && activeTab !== 'topics' && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeTab !== 'topics' && activeTab !== 'today' && (
              <button
                onClick={() => setShowUnreadOnly(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  showUnreadOnly
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {showUnreadOnly ? `Unread ${unreadCount > 0 ? `(${unreadCount})` : ''}` : 'All'}
              </button>
            )}

            <a
              href="/archive"
              className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors"
              title="Archive"
            >
              <svg className="w-4 h-4 text-gray-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </a>

            <a
              href="/sources"
              className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors"
              title="Sources"
            >
              <svg className="w-4 h-4 text-gray-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
            </a>

            <button
              onClick={handleSignOut}
              className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors"
              title="Sign out"
            >
              <svg className="w-4 h-4 text-gray-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>

        {/* Category + Today + Topics tabs */}
        <CategoryNav
          categories={CATEGORIES}
          active={activeTab}
          onChange={handleTabChange}
          readIds={readIds}
          clusters={clusters}
          soloStories={soloStories}
          topicCount={topicCount}
          todayUnread={todayUnread}
        />
      </header>

      {/* Feed */}
      <main className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        {/* Today tab */}
        {activeTab === 'today' && (
          <ErrorBoundary>
            <TodayFeed
              clusters={activeTodayClusters}
              stories={activeTodayStories}
              sources={sources}
              readIds={readIds}
              onMarkRead={markRead}
              onEngagement={sendEngagement}
              onDwellStart={startDwell}
              onDwellEnd={endDwell}
              onMuteTopic={muteTopics}
              loading={loading}
            />
          </ErrorBoundary>
        )}

        {/* Topics tab content */}
        {activeTab === 'topics' && (
          <TopicsPanel
            userId={userId}
            readIds={readIds}
            onMarkRead={markRead}
            onEngagement={sendEngagement}
          />
        )}

        {/* Category feed */}
        {activeTab !== 'topics' && activeTab !== 'today' && (
          <>
            {loading && (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            )}

            {!loading && isEmpty && (
              <div className="text-center py-20">
                <div className="text-4xl mb-3">
                  {showUnreadOnly ? '✓' : '📭'}
                </div>
                <p className="text-gray-400 font-medium">
                  {showUnreadOnly ? 'All caught up!' : 'No stories yet'}
                </p>
                <p className="text-gray-600 text-sm mt-1">
                  {showUnreadOnly
                    ? 'Nothing unread in this category'
                    : 'The pipeline will populate stories every ~90 minutes'}
                </p>
                {showUnreadOnly && (
                  <button
                    onClick={() => setShowUnreadOnly(false)}
                    className="mt-4 text-sm text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    Show all stories →
                  </button>
                )}
              </div>
            )}

            {/* Vantage segments pinned to top */}
            {!loading && vantagePinned.length > 0 && (
              <>
                <div className="flex items-center gap-2 pt-1 pb-0.5">
                  <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Vantage · Latest</span>
                  <div className="flex-1 h-px bg-amber-500/20" />
                </div>
                {vantagePinned.map(story => (
                  <SoloCard
                    key={story.id}
                    story={story}
                    source={sources[story.source_id]}
                    isRead={readIds.has(story.id)}
                    onRead={() => markRead(story.id)}
                    onEngagement={(signal) => sendEngagement(signal, story.id)}
                    onDwellStart={() => startDwell(story.id)}
                    onDwellEnd={() => endDwell(story.id, story.id)}
                    onMuteTopic={() => muteTopics(story.matched_topics ?? [])}
                  />
                ))}
                {mergedFeed.length > 0 && (
                  <div className="flex items-center gap-2 pt-1 pb-0.5">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Other stories</span>
                    <div className="flex-1 h-px bg-gray-800" />
                  </div>
                )}
              </>
            )}

            {/* Unified merged feed — clusters + non-Vantage solos sorted latest→oldest */}
            <ErrorBoundary>
              {!loading && mergedFeed.map(item =>
                item.type === 'cluster' ? (
                  <ClusteredCard
                    key={item.data.id}
                    cluster={item.data}
                    isRead={isClusterRead(item.data)}
                    readStoryIds={readIds}
                    onRead={() => markRead(undefined, item.data.id)}
                    onEngagement={(signal) => sendEngagement(signal, undefined, item.data.id)}
                    onDwellStart={() => startDwell(item.data.id)}
                    onDwellEnd={() => endDwell(item.data.id, undefined, item.data.id)}
                    onMuteTopic={() => muteTopics(
                      Array.from(new Set((item.data.stories ?? []).flatMap(s => s.matched_topics ?? [])))
                    )}
                  />
                ) : (
                  <SoloCard
                    key={item.data.id}
                    story={item.data}
                    source={sources[item.data.source_id]}
                    isRead={readIds.has(item.data.id)}
                    onRead={() => markRead(item.data.id)}
                    onEngagement={(signal) => sendEngagement(signal, item.data.id)}
                    onDwellStart={() => startDwell(item.data.id)}
                    onDwellEnd={() => endDwell(item.data.id, item.data.id)}
                    onMuteTopic={() => muteTopics(item.data.matched_topics ?? [])}
                  />
                )
              )}
            </ErrorBoundary>
          </>
        )}
      </main>
    </div>
  )
}
