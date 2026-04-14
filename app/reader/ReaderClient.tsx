'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Category, Story, Cluster, Source } from '@/lib/types'
import { SoloCard } from '@/components/SoloCard'
import { ClusteredCard } from '@/components/ClusteredCard'
import { CategoryNav } from '@/components/CategoryNav'

const CATEGORIES: { key: Category; label: string; color: string }[] = [
  { key: 'prophetic',    label: 'Prophetic',      color: 'violet' },
  { key: 'israel',       label: 'Israel',          color: 'blue'   },
  { key: 'india_global', label: 'India & Global',  color: 'amber'  },
  { key: 'tech_ai',      label: 'Tech & AI',       color: 'emerald'},
]

export default function ReaderClient({ userId }: { userId: string }) {
  const supabase = createClient()

  const [activeCategory, setActiveCategory] = useState<Category>('prophetic')
  const [showUnreadOnly, setShowUnreadOnly] = useState(true)
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [soloStories, setSoloStories] = useState<Story[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [sources, setSources] = useState<Record<string, Source>>({})
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

  // Load content for active category
  const loadContent = useCallback(async () => {
    setLoading(true)

    // Clusters with their stories
    const { data: clusterData } = await supabase
      .from('clusters')
      .select(`*, stories(*, videos(*))`)
      .eq('category', activeCategory)
      .order('last_updated_at', { ascending: false })
      .limit(30)

    // Solo stories (not in any cluster)
    const { data: storyData } = await supabase
      .from('stories')
      .select(`*, videos(*), sources(*)`)
      .eq('category', activeCategory)
      .is('cluster_id', null)
      .order('created_at', { ascending: false })
      .limit(30)

    if (clusterData) setClusters(clusterData as Cluster[])
    if (storyData) setSoloStories(storyData as Story[])
    setLastUpdated(new Date())
    setLoading(false)
  }, [activeCategory])

  useEffect(() => {
    loadReadIds()
    loadContent()
  }, [activeCategory, loadReadIds, loadContent])

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
    // Also update source weight slightly
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

  // Filter by unread
  const visibleClusters = showUnreadOnly
    ? clusters.filter(c => !readIds.has(c.id))
    : clusters
  const visibleSolos = showUnreadOnly
    ? soloStories.filter(s => !readIds.has(s.id))
    : soloStories

  const unreadCount = clusters.filter(c => !readIds.has(c.id)).length
    + soloStories.filter(s => !readIds.has(s.id)).length

  const isEmpty = visibleClusters.length === 0 && visibleSolos.length === 0

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
              {lastUpdated && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
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

        {/* Category tabs */}
        <CategoryNav
          categories={CATEGORIES}
          active={activeCategory}
          onChange={setActiveCategory}
          readIds={readIds}
          clusters={clusters}
          soloStories={soloStories}
        />
      </header>

      {/* Feed */}
      <main className="max-w-2xl mx-auto px-4 py-4 space-y-3">
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

        {!loading && visibleClusters.map(cluster => (
          <ClusteredCard
            key={cluster.id}
            cluster={cluster}
            isRead={readIds.has(cluster.id)}
            onRead={() => markRead(undefined, cluster.id)}
            onEngagement={(signal) => sendEngagement(signal, undefined, cluster.id)}
            onDwellStart={() => startDwell(cluster.id)}
            onDwellEnd={() => endDwell(cluster.id, undefined, cluster.id)}
          />
        ))}

        {!loading && visibleSolos.map(story => (
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
      </main>
    </div>
  )
}
