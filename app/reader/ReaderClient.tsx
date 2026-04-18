'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Category, Story, Cluster, Source } from '@/lib/types'
import { SoloCard } from '@/components/SoloCard'
import { ClusteredCard } from '@/components/ClusteredCard'
import { CategoryNav, type ActiveTab } from '@/components/CategoryNav'
import { TopicsPanel } from '@/components/TopicsPanel'

const CATEGORIES: { key: Category; label: string; color: string }[] = [
  { key: 'prophetic',    label: 'Prophetic',      color: 'violet' },
  { key: 'israel',       label: 'Israel',          color: 'blue'   },
  { key: 'india_global', label: 'India & Global',  color: 'amber'  },
  { key: 'tech_ai',      label: 'Tech & AI',       color: 'emerald'},
]

export default function ReaderClient({ userId }: { userId: string }) {
  const supabase = createClient()

  const [activeTab, setActiveTab] = useState<ActiveTab>('prophetic')
  const [showUnreadOnly, setShowUnreadOnly] = useState(true)
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [soloStories, setSoloStories] = useState<Story[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [topicCount, setTopicCount] = useState(0)
  const dwellTimers = useRef<Map<string, number>>(new Map())

  // Load sources into a lookup map
  useEffect(() => {
    supabase.from('sources').select('*').then(({ data }) => {
      if (data) {
        const map: Record<string, Source> = {}
        data.forEach(s => { map[s.id] = s })
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

  // Load read item IDs for this user
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

  // Load content for active category (not used when Topics tab is active)
  const loadContent = useCallback(async () => {
    if (activeTab === 'topics') {
      setLoading(false)
      return
    }
    setLoading(true)

    const [clusterRes, storyRes] = await Promise.all([
      supabase
        .from('clusters')
        .select(`*, stories(*, videos(*))`)
        .eq('category', activeTab)
        .order('last_updated_at', { ascending: false })
        .limit(30),
      supabase
        .from('stories')
        .select(`*, videos(*), sources(*)`)
        .eq('category', activeTab)
        .is('cluster_id', null)
        .order('created_at', { ascending: false })
        .limit(30),
    ])

    if (clusterRes.data) setClusters(clusterRes.data as Cluster[])
    if (storyRes.data) setSoloStories(storyRes.data as Story[])
    setLastUpdated(new Date())
    setLoading(false)
  }, [activeTab])

  useEffect(() => {
    loadReadIds()
    loadContent()
  }, [activeTab, loadReadIds, loadContent])

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

  // Dwell time tracking
  const startDwell = useCallback((id: string) => {
    dwellTimers.current.set(id, Date.now())
  }, [])

  const endDwell = useCallback((id: string, storyId?: string, clusterId?: string) => {
    const start = dwellTimers.current.get(id)
    if (!start) return
    const elapsed = (Date.now() - start) / 1000
    dwellTimers.current.delete(id)
    if (elapsed > 20) sendEngagement('dwell_long', storyId, clusterId)
    else if (elapsed < 3) sendEngagement('dwell_short', storyId, clusterId)
  }, [sendEngagement])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/auth'
  }

  // Filter by unread (only applies to category tabs)
  const visibleClusters = showUnreadOnly
    ? clusters.filter(c => !readIds.has(c.id))
    : clusters
  const visibleSolos = showUnreadOnly
    ? soloStories.filter(s => !readIds.has(s.id))
    : soloStories

  const unreadCount = clusters.filter(c => !readIds.has(c.id)).length
    + soloStories.filter(s => !readIds.has(s.id)).length

  const isEmpty = visibleClusters.length === 0 && visibleSolos.length === 0

  // Build unified feed: Vantage pinned to top, then clusters + other solos merged by date DESC
  type FeedItem =
    | { type: 'cluster'; data: Cluster; date: Date }
    | { type: 'story';   data: Story;   date: Date }

  const isVantage = (story: Story) => {
    const src = sources[story.source_id]
    const name = (src?.name ?? '').toLowerCase()
    return name.includes('vantage') || name.includes('firstpost')
  }

  const vantagePinned = visibleSolos
    .filter(isVantage)
    .sort((a, b) => {
      const da = new Date((a as any).videos?.published_at ?? a.created_at)
      const db = new Date((b as any).videos?.published_at ?? b.created_at)
      return db.getTime() - da.getTime()
    })

  const mergedFeed: FeedItem[] = [
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
        date: new Date((s as any).videos?.published_at ?? s.created_at),
      })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime())

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur border-b border-gray-800/60">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
            {activeTab !== 'topics' && (
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
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </a>

            <a
              href="/sources"
              className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors"
              title="Sources"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
            </a>

            <button
              onClick={handleSignOut}
              className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors"
              title="Sign out"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>

        {/* Category + Topics tabs */}
        <CategoryNav
          categories={CATEGORIES}
          active={activeTab}
          onChange={setActiveTab}
          readIds={readIds}
          clusters={clusters}
          soloStories={soloStories}
          topicCount={topicCount}
        />
      </header>

      {/* Feed */}
      <main className="max-w-2xl mx-auto px-4 py-4 space-y-3">
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
        {activeTab !== 'topics' && (
          <>
            {loading && (
              <div className="flex justify-center py-16">
                <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
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
            {!loading && mergedFeed.map(item =>
              item.type === 'cluster' ? (
                <ClusteredCard
                  key={item.data.id}
                  cluster={item.data}
                  isRead={readIds.has(item.data.id)}
                  onRead={() => markRead(undefined, item.data.id)}
                  onEngagement={(signal) => sendEngagement(signal, undefined, item.data.id)}
                  onDwellStart={() => startDwell(item.data.id)}
                  onDwellEnd={() => endDwell(item.data.id, undefined, item.data.id)}
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
                />
              )
            )}
          </>
        )}
      </main>
    </div>
  )
}
