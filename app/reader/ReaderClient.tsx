'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Category, Source } from '@/lib/types'
import type { StoryWithRelations } from '@/lib/types'
import { SoloCard } from '@/components/SoloCard'
import { CategoryNav, type ActiveTab } from '@/components/CategoryNav'
import { TopicsPanel } from '@/components/TopicsPanel'
import { TodayFeed } from '@/components/TodayFeed'
import { SkeletonCard } from '@/components/SkeletonCard'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { InstallPrompt } from '@/components/InstallPrompt'
import { STORY_SELECT } from '@/lib/constants'

const CATEGORIES: { key: Category; label: string; color: string }[] = [
  { key: 'prophetic',    label: 'Prophetic',      color: 'violet' },
  { key: 'israel',       label: 'Israel',          color: 'blue'   },
  { key: 'india_global', label: 'India & Global',  color: 'amber'  },
  { key: 'tech_ai',      label: 'Tech & AI',       color: 'emerald'},
]

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
  const [soloStories, setSoloStories] = useState<StoryWithRelations[]>([])
  const [todayStories, setTodayStories] = useState<StoryWithRelations[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [mutedKeywords, setMutedKeywords] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [topicCount, setTopicCount] = useState(0)
  const [sourceWeights, setSourceWeights] = useState<Record<string, number>>({})
  const [topicWeights, setTopicWeights] = useState<Record<string, number>>({})
  // Categories with at least one story in the last 7 days — hide dead tabs
  const [activeCategoryKeys, setActiveCategoryKeys] = useState<Set<string>>(
    new Set(CATEGORIES.map(c => c.key))  // show all until we know
  )
  const [lastPipelineRun, setLastPipelineRun] = useState<Date | null>(null)
  const [pipelineStruggling, setPipelineStruggling] = useState(false)
  // Manual "Run now" trigger — see handleTriggerPipeline below.
  const [triggerState, setTriggerState] = useState<'idle' | 'triggering' | 'waiting' | 'running'>('idle')
  const [triggerError, setTriggerError] = useState<string | null>(null)
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null)
  const triggerPollRef = useRef<{
    timeoutId: ReturnType<typeof setTimeout> | null
    baselineId: string | null
    phase: 'waiting' | 'running'
    deadline: number
  }>({ timeoutId: null, baselineId: null, phase: 'waiting', deadline: 0 })
  const [isOffline, setIsOffline] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const pullStartY = useRef<number | null>(null)
  const [pullRefreshing, setPullRefreshing] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const dwellTimers = useRef<Map<string, number>>(new Map())
  // Bumped on every loadContent() call; a response only commits state if it's
  // still the latest in-flight request — otherwise rapid tab switching can
  // let an older, slower response land after a newer one and show the wrong
  // category's stories.
  const loadReqId = useRef(0)

  // Record last-visit timestamp on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('newsbrief_lastVisit', new Date().toISOString())
    }
  }, [])

  // Load personal ranking weights on mount
  useEffect(() => {
    supabase
      .from('source_weights')
      .select('source_id, weight')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, number> = {}
          data.forEach(r => { map[r.source_id] = r.weight })
          setSourceWeights(map)
        }
      })
    supabase
      .from('topic_weights')
      .select('kw, weight')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, number> = {}
          data.forEach(r => { map[r.kw] = r.weight })
          setTopicWeights(map)
        }
      })
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps — load once on mount

  // Pipeline health — last completed run of ANY status (a success-only
  // query hides outages: the dot stayed green while runs were failing).
  // "Struggling" = the last 3 runs found videos but produced 0 stories.
  // Extracted as a callback so it can also be re-run after a manually
  // triggered run finishes (see pollTriggerStatus below).
  const refreshPipelineHealth = useCallback(async () => {
    const { data } = await supabase
      .from('pipeline_runs')
      .select('finished_at, status, stories_created, videos_found')
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(3)
    if (!data || data.length === 0) return
    setLastPipelineRun(new Date(data[0].finished_at))
    const struggling =
      data.length >= 3 &&
      data.every(r => (r.stories_created ?? 0) === 0) &&
      data.some(r => (r.videos_found ?? 0) > 0)
    setPipelineStruggling(struggling)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load sources into a lookup map
  useEffect(() => {
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

    refreshPipelineHealth()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps — load once on mount

  // Close the header "More" menu on an outside tap. Deliberately NOT using a
  // fixed inset-0 catcher element: backdrop-filter/filter/transform on any
  // ancestor (the header has carried backdrop-blur in the past) creates a new
  // containing block for position:fixed descendants — a fixed catcher nested
  // inside would only cover the header's own bounds, not the full screen, so
  // taps on the feed below wouldn't close the menu. Ref-based is immune.
  useEffect(() => {
    if (!showMoreMenu) return
    const onPointerDown = (e: PointerEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showMoreMenu])

  // Offline awareness + scroll-to-top visibility (mobile ergonomics)
  useEffect(() => {
    setIsOffline(!navigator.onLine)
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)
    const onScroll = () => setShowScrollTop(window.scrollY > 600)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  // Load read item IDs once on mount — independent of active tab
  const loadReadIds = useCallback(async () => {
    // Ordered + capped: Supabase enforces a server-side row cap regardless
    // of .limit(), and an unordered query returns a nondeterministic subset
    // once past it. Ordering by most-recent-first means old reads are what
    // silently drop off (they may resurface as unread), not a random slice.
    const { data } = await supabase
      .from('read_items')
      .select('story_id, cluster_id')
      .eq('user_id', userId)
      .order('read_at', { ascending: false })
      .limit(2000)
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

    // Optimistic UI first — keep the in-memory mute set responsive
    setMutedKeywords(prev => {
      const next = new Set(prev)
      keywords.forEach(k => next.add(k))
      return next
    })

    // Re-muting a keyword should refresh expires_at, not error. Try upsert; if
    // the constraint name doesn't resolve we fall back to per-row insert that
    // tolerates 23505 duplicate-key errors.
    const { error } = await supabase.from('muted_topics').upsert(rows, {
      onConflict: 'user_id,keyword',
      ignoreDuplicates: false,
    })
    if (error) {
      // Per-row insert fallback (mirrors markRead pattern)
      for (const row of rows) {
        const { error: rowErr } = await supabase.from('muted_topics').insert(row)
        if (rowErr && rowErr.code !== '23505') {
          console.error('muteTopics failed for keyword', row.keyword, rowErr)
        }
      }
    }
  }, [userId])

  // Load content when active tab changes
  const loadContent = useCallback(async () => {
    if (activeTab === 'topics') {
      setLoading(false)
      return
    }

    // Rapid tab switching fires overlapping requests; only the response
    // matching the most recently issued request is allowed to commit state —
    // otherwise an older, slower response can land after a newer one and
    // show the wrong category's stories.
    const reqId = ++loadReqId.current
    const isStale = () => reqId !== loadReqId.current

    setLoading(true)
    setLoadError(false)

    if (activeTab === 'today') {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const storyRes = await supabase
        .from('stories')
        .select(STORY_SELECT)
        .gte('created_at', yesterday)
        .order('created_at', { ascending: false })
        .limit(60)
      if (isStale()) return
      if (storyRes.error) {
        console.error('loadContent (today) failed', storyRes.error)
        setLoadError(true)
      } else if (storyRes.data) {
        setTodayStories(storyRes.data as unknown as StoryWithRelations[])
      }
      setLastUpdated(new Date())
      setLoading(false)
      return
    }

    const storyRes = await supabase
      .from('stories')
      .select(STORY_SELECT)
      .eq('category', activeTab)
      .order('created_at', { ascending: false })
      .limit(100)

    if (isStale()) return
    if (storyRes.error) {
      console.error('loadContent failed', storyRes.error)
      setLoadError(true)
    } else if (storyRes.data) {
      setSoloStories(storyRes.data as unknown as StoryWithRelations[])
    }
    setLastUpdated(new Date())
    setLoading(false)
  }, [activeTab])

  useEffect(() => {
    loadContent()
  }, [activeTab, loadContent])

  // ── Manual pipeline trigger ────────────────────────────────────────────
  // workflow_dispatch returns no run ID, so there's no way to directly
  // correlate this trigger with the resulting Actions run — we can only
  // watch pipeline_runs for a new row to appear (id differs from the
  // baseline captured at trigger time) and then track it to completion.
  const POLL_INTERVAL_WAITING_MS = 15_000
  const POLL_INTERVAL_RUNNING_MS = 45_000
  const MAX_WAITING_MS = 10 * 60_000  // GitHub queue + checkout + pip install
  const MAX_RUNNING_MS = 45 * 60_000  // matches the workflow's own timeout

  const pollTriggerStatus = useCallback(async () => {
    const ref = triggerPollRef.current
    const { data } = await supabase
      .from('pipeline_runs')
      .select('id, status, started_at, finished_at, stories_created')
      .order('started_at', { ascending: false })
      .limit(1)
    const row = data?.[0]
    const isNewRow = row && row.id !== ref.baselineId

    if (!isNewRow) {
      if (Date.now() > ref.deadline) {
        setTriggerMessage('Still waiting on GitHub — check back shortly.')
        setTriggerState('idle')
        return
      }
      ref.timeoutId = setTimeout(pollTriggerStatus, POLL_INTERVAL_WAITING_MS)
      return
    }

    // A new row exists — switch to the "running" phase bookkeeping the
    // first time we see it (fresh deadline, slower poll cadence).
    if (ref.phase !== 'running') {
      ref.phase = 'running'
      ref.deadline = Date.now() + MAX_RUNNING_MS
      setTriggerState('running')
    }

    if (row.finished_at) {
      setTriggerState('idle')
      setTriggerMessage(
        row.status === 'success' ? `✓ Done — ${row.stories_created ?? 0} new stories.`
        : row.status === 'partial' ? 'Finished with some issues — see status below.'
        : 'Run failed — see status below.'
      )
      // The whole point of the button is fresh content — completion alone
      // doesn't update what's on screen.
      loadContent()
      loadReadIds()
      refreshPipelineHealth()
      return
    }

    setTriggerMessage('Pipeline is running…')
    if (Date.now() > ref.deadline) {
      setTriggerMessage('Still running — check back shortly.')
      setTriggerState('idle')
      return
    }
    ref.timeoutId = setTimeout(pollTriggerStatus, POLL_INTERVAL_RUNNING_MS)
  }, [loadContent, loadReadIds, refreshPipelineHealth]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTriggerPipeline = useCallback(async () => {
    if (triggerState !== 'idle') return
    setTriggerError(null)
    setTriggerMessage(null)
    setTriggerState('triggering')
    try {
      const res = await fetch('/api/pipeline/trigger', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTriggerError(
          res.status === 401 ? 'Please sign in again.'
          : res.status === 409 ? 'A pipeline run is already in progress.'
          : res.status === 429 ? `Triggered recently — wait ${Math.ceil((body.retryAfterSeconds ?? 60) / 60)} min.`
          : "Couldn't trigger the pipeline — try again shortly."
        )
        setTriggerState('idle')
        return
      }
      triggerPollRef.current = {
        timeoutId: null,
        baselineId: body.latestRunId ?? null,
        phase: 'waiting',
        deadline: Date.now() + MAX_WAITING_MS,
      }
      setTriggerState('waiting')
      setTriggerMessage('Triggered — waiting for it to start…')
      triggerPollRef.current.timeoutId = setTimeout(pollTriggerStatus, POLL_INTERVAL_WAITING_MS)
    } catch (e) {
      console.error('trigger pipeline failed', e)
      setTriggerError("Couldn't trigger the pipeline — try again shortly.")
      setTriggerState('idle')
    }
  }, [triggerState, pollTriggerStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stop any in-flight poll on unmount
  useEffect(() => {
    return () => {
      if (triggerPollRef.current.timeoutId) clearTimeout(triggerPollRef.current.timeoutId)
    }
  }, [])

  // Pull-to-refresh: drag down ≥90px from the very top of the feed.
  // Window-level listeners so it works regardless of which card is under
  // the thumb; passive handlers keep scrolling at 60fps.
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      pullStartY.current = window.scrollY <= 0 ? e.touches[0].clientY : null
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (pullStartY.current == null) return
      const dy = e.changedTouches[0].clientY - pullStartY.current
      pullStartY.current = null
      if (dy > 90 && window.scrollY <= 0 && !loading && !pullRefreshing) {
        setPullRefreshing(true)
        Promise.all([loadContent(), loadReadIds()]).finally(() => setPullRefreshing(false))
      }
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [loadContent, loadReadIds, loading, pullRefreshing])

  const markRead = useCallback(async (storyId?: string) => {
    if (!storyId) return
    if (readIds.has(storyId)) return

    // Optimistic update first so the UI reacts even if the network is slow
    setReadIds(prev => new Set(prev).add(storyId))

    // Plain insert — Postgres unique index (user_id,story_id) prevents real
    // duplicates. PostgREST's `upsert(... onConflict)` was failing silently
    // because the constraint name lookup didn't resolve, so writes were
    // being lost. We tolerate the 23505 duplicate-key error explicitly
    // (which only happens in rare cross-tab races).
    const { error } = await supabase.from('read_items').insert({
      user_id: userId,
      story_id: storyId,
    })
    if (error && error.code !== '23505') {
      console.error('markRead failed', { storyId, error })
    }
  }, [userId, readIds])

  // Batched version for "mark all as read" — the old implementation fired
  // one insert per item (up to ~200 concurrent requests on a full category).
  const markManyRead = useCallback(async (storyIds: string[]) => {
    const newStoryIds = storyIds.filter(id => !readIds.has(id))
    if (newStoryIds.length === 0) return

    setReadIds(prev => {
      const next = new Set(prev)
      newStoryIds.forEach(id => next.add(id))
      return next
    })

    const rows = newStoryIds.map(id => ({ user_id: userId, story_id: id }))
    const { error } = await supabase.from('read_items').insert(rows)
    if (error) {
      console.error('markManyRead failed', { count: rows.length, error })
    }
  }, [userId, readIds])

  // storyId -> story, across both collections currently in memory (category
  // tab + Today) — used so a like/dislike can look up the story's source_id.
  const storyById = useMemo(() => {
    const map = new Map<string, StoryWithRelations>()
    for (const s of soloStories) map.set(s.id, s)
    for (const s of todayStories) map.set(s.id, s)
    return map
  }, [soloStories, todayStories])

  const sendEngagement = useCallback(async (signal: string, storyId?: string) => {
    await supabase.from('engagement').insert({
      user_id: userId,
      story_id: storyId ?? null,
      signal,
    })
    if (storyId) {
      const story = storyById.get(storyId)
      if (story) {
        const delta = signal === 'like' ? 0.1 : signal === 'dislike' ? -0.15 : 0
        if (delta !== 0) {
          await supabase.rpc('adjust_source_weight', {
            p_user_id: userId,
            p_source_id: story.source_id,
            p_delta: delta
          }).maybeSingle()
          // Optimistic update: reflect new weight immediately in ranking
          setSourceWeights(prev => {
            const current = prev[story.source_id] ?? 1.0
            const next = Math.min(1.5, Math.max(0.5, current + delta))
            return { ...prev, [story.source_id]: next }
          })
        }
      }
    }
  }, [userId, storyById])

  // Dwell time tracking — auto-mark-read when user dwells >20s
  const startDwell = useCallback((id: string) => {
    dwellTimers.current.set(id, Date.now())
  }, [])

  const endDwell = useCallback((id: string, storyId?: string) => {
    const start = dwellTimers.current.get(id)
    if (!start) return
    const elapsed = (Date.now() - start) / 1000
    dwellTimers.current.delete(id)
    if (elapsed > 20) {
      sendEngagement('dwell_long', storyId)
      markRead(storyId) // auto-mark-read after sufficient reading time
    } else if (elapsed < 3) {
      sendEngagement('dwell_short', storyId)
    }
  }, [sendEngagement, markRead])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/auth'
  }

  // Returns true if any of the given topic keywords are currently muted
  const hasMutedTopic = useCallback((topics: string[] | null | undefined) => {
    if (!topics || topics.length === 0) return false
    return topics.some(t => mutedKeywords.has(t))
  }, [mutedKeywords])

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
    () => mutedAndActiveSolos.filter(s => showUnreadOnly ? !readIds.has(s.id) : true),
    [mutedAndActiveSolos, readIds, showUnreadOnly]
  )

  const unreadCount = useMemo(
    () => mutedAndActiveSolos.filter(s => !readIds.has(s.id)).length,
    [mutedAndActiveSolos, readIds]
  )

  // One-tap "clear the deck" for the current category view
  const markAllVisibleRead = useCallback(() => {
    const storyIds = visibleSolos.filter(s => !readIds.has(s.id)).map(s => s.id)
    markManyRead(storyIds)
  }, [visibleSolos, readIds, markManyRead])

  // Today tab — filter to active sources and muted topics before passing to
  // TodayFeed.
  const activeTodayStories = useMemo(
    () => todayStories
      .filter(s => isActiveSource(s.source_id))
      .filter(s => !hasMutedTopic(s.matched_topics)),
    [todayStories, isActiveSource, hasMutedTopic]
  )

  const todayUnread = useMemo(
    () => activeTodayStories.filter(s => !readIds.has(s.id)).length,
    [activeTodayStories, readIds]
  )

  const isEmpty = visibleSolos.length === 0

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

  // Feed sorted latest→oldest, with read items sunk below unread in "Show All" mode
  const mergedFeed = useMemo(
    () => visibleSolos
      .filter(s => !isVantage(s))
      .sort((a, b) => {
        const aRead = readIds.has(a.id)
        const bRead = readIds.has(b.id)
        if (aRead !== bRead) return aRead ? 1 : -1
        const da = new Date(a.videos?.published_at ?? a.created_at).getTime()
        const db = new Date(b.videos?.published_at ?? b.created_at).getTime()
        return db - da
      }),
    [visibleSolos, isVantage, readIds]
  )

  return (
    <div className="min-h-screen text-slate-100">
      {/* Top bar */}
      {/* No backdrop-blur here: a sticky element's backdrop-filter re-samples
          the content scrolling beneath it on every frame — one of the last
          remaining per-frame costs on mid-range Android GPUs. Near-opaque
          solid is visually equivalent on this dark theme. */}
      <header className="sticky top-0 z-50 bg-slate-950/95 border-b border-slate-800/60">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-[0_0_16px_rgba(139,92,246,0.35)]">
              <svg className="w-4 h-4 text-white" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 12h6m-6-4h2" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-white leading-none tracking-tight">News Brief</h1>
              {lastPipelineRun ? (
                (() => {
                  const ageMs = Date.now() - lastPipelineRun.getTime()
                  const mins = Math.round(ageMs / 60000)
                  const ago =
                    mins < 60 ? `${mins}m ago`
                    : mins < 24 * 60 ? `${Math.round(mins / 60)}h ago`
                    : lastPipelineRun.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  // Three explicit states so silence is never ambiguous:
                  // rose  = pipeline down (>24h) or finding-but-failing
                  // amber = stale (8–24h since last check)
                  // green = checked recently
                  const down = ageMs > 24 * 3600 * 1000
                  const stale = ageMs > 8 * 3600 * 1000
                  const dot = down || pipelineStruggling
                    ? 'bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.6)]'
                    : stale ? 'bg-amber-400' : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                  const label = pipelineStruggling
                    ? `Sources failing · last check ${ago}`
                    : down ? `Pipeline down · last check ${ago}`
                    : `Checked ${ago}`
                  return (
                    <p className={`text-xs mt-1 inline-flex items-center gap-1 ${
                      down || pipelineStruggling ? 'text-rose-300' : 'text-slate-400'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                      {label}
                      {/* Build stamp — confirms which deploy this instance runs */}
                      <span className="text-[9px] text-slate-600 font-mono ml-0.5">
                        {process.env.NEXT_PUBLIC_BUILD_SHA}
                      </span>
                    </p>
                  )
                })()
              ) : lastUpdated && activeTab !== 'topics' ? (
                <p className="text-xs text-slate-400 mt-1">
                  Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </p>
              ) : null}

              {/* Manual pipeline trigger — deliberately a labelled text
                  pill, not another icon in the crowded action row, so it
                  can't be confused with the cosmetic "Refresh feed" button
                  (which only re-fetches already-loaded data) and doesn't
                  reintroduce the overflow issues that row has a documented
                  history of on narrow Android widths. */}
              {triggerState === 'idle' && !triggerMessage && !triggerError && (
                <button
                  onClick={handleTriggerPipeline}
                  className="mt-1 text-[11px] font-semibold text-violet-300 hover:text-violet-200 transition-colors inline-flex items-center gap-1"
                >
                  ⚡ Run now
                </button>
              )}
              {(triggerState !== 'idle' || triggerMessage || triggerError) && (
                <p className={`mt-1 text-[11px] font-semibold inline-flex items-center gap-1 ${
                  triggerError ? 'text-rose-300' : 'text-violet-300'
                }`}>
                  {triggerState === 'triggering' && 'Triggering…'}
                  {triggerState === 'waiting' && triggerMessage}
                  {triggerState === 'running' && triggerMessage}
                  {triggerState === 'idle' && (triggerError || triggerMessage)}
                  {triggerState === 'idle' && (triggerError || triggerMessage) && (
                    <button
                      onClick={() => { setTriggerError(null); setTriggerMessage(null) }}
                      className="text-slate-500 hover:text-slate-300"
                      aria-label="Dismiss"
                    >
                      ×
                    </button>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Outer wrapper: the More button + its dropdown live OUTSIDE the
              overflow-x-auto row below on purpose. Per the CSS overflow
              spec, setting overflow-x to anything but visible forces the
              computed overflow-y to 'auto' too (same trap documented in
              globals.css for html/body) — the dropdown opens *downward*
              below the row's own bounds, so nesting it inside that row
              silently clipped it to nothing. Confirmed live: the button
              worked, the menu was just invisible. */}
          <div className="flex items-center gap-1.5 min-w-0">
          {/* overflow-x-auto: final defensive layer. The "More" menu below
              already keeps this row well within mobile widths in practice,
              but this guarantees that even in an edge case (very narrow
              device, browser zoom, extra-long "Unread · N" count) the row
              scrolls internally instead of ever forcing the page to pan
              sideways — same fix pattern as CategoryNav's bottom bar. */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide min-w-0">
            {activeTab !== 'topics' && activeTab !== 'today' && (
              <button
                onClick={() => setShowUnreadOnly(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] md:min-h-0 rounded-lg text-xs font-semibold transition-all active:scale-95 shrink-0 ${
                  showUnreadOnly
                    ? 'bg-violet-500/25 text-violet-200 ring-1 ring-violet-500/40'
                    : 'bg-slate-800/60 text-slate-300 ring-1 ring-slate-700/60 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {showUnreadOnly ? `Unread${unreadCount > 0 ? ` · ${unreadCount}` : ''}` : 'All'}
              </button>
            )}

            {activeTab !== 'topics' && activeTab !== 'today' && unreadCount > 0 && (
              <button
                onClick={markAllVisibleRead}
                className="w-11 h-11 md:w-9 md:h-9 shrink-0 rounded-lg bg-slate-800/60 hover:bg-emerald-500/20 ring-1 ring-slate-700/60 hover:ring-emerald-500/40 flex items-center justify-center transition-all active:scale-95 group/mar"
                title="Mark everything here as read"
                aria-label="Mark all as read"
              >
                <svg className="w-4 h-4 text-slate-300 group-hover/mar:text-emerald-300" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2 13l4 4L14 9m-3 4l4 4L23 7" />
                </svg>
              </button>
            )}

            {activeTab !== 'topics' && (
              <button
                onClick={() => { if (!loading) { loadContent(); loadReadIds() } }}
                className="w-11 h-11 md:w-9 md:h-9 shrink-0 rounded-lg bg-slate-800/60 hover:bg-slate-800 ring-1 ring-slate-700/60 hover:ring-slate-600 flex items-center justify-center transition-all active:scale-95"
                title="Refresh"
                aria-label="Refresh feed"
              >
                <svg
                  className={`w-4 h-4 text-slate-300 ${loading || pullRefreshing ? 'animate-spin' : ''}`}
                  aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}

            <a
              href="/search"
              className="w-11 h-11 md:w-9 md:h-9 shrink-0 rounded-lg bg-slate-800/60 hover:bg-slate-800 ring-1 ring-slate-700/60 hover:ring-slate-600 flex items-center justify-center transition-all"
              title="Search"
            >
              <svg className="w-4 h-4 text-slate-300" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
            </a>

            {/* Archive / Sources / Sign out — plenty of room on desktop, so
                they stay as individual icons there. On mobile they're the
                least-frequently-used actions in this row, so they're folded
                into one "More" button below — that's what actually fixed the
                header overflowing past the screen edge on narrow Android
                widths (was 7 fixed-width controls competing for ~330px). */}
            <a
              href="/archive"
              className="hidden md:flex w-9 h-9 rounded-lg bg-slate-800/60 hover:bg-slate-800 ring-1 ring-slate-700/60 hover:ring-slate-600 items-center justify-center transition-all"
              title="Archive"
            >
              <svg className="w-4 h-4 text-slate-300" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </a>

            <a
              href="/sources"
              className="hidden md:flex w-9 h-9 rounded-lg bg-slate-800/60 hover:bg-slate-800 ring-1 ring-slate-700/60 hover:ring-slate-600 items-center justify-center transition-all"
              title="Sources"
            >
              <svg className="w-4 h-4 text-slate-300" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
            </a>

            <button
              onClick={handleSignOut}
              className="hidden md:flex w-9 h-9 rounded-lg bg-slate-800/60 hover:bg-slate-800 ring-1 ring-slate-700/60 hover:ring-slate-600 items-center justify-center transition-all"
              title="Sign out"
            >
              <svg className="w-4 h-4 text-slate-300" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>

            {/* Mobile-only: Archive/Sources/Sign out collapse behind here.
                A bare ⋮ icon doesn't read as "Sources lives here" to anyone
                who isn't already familiar with the app — labelled so the
                place to add a YouTube channel is actually findable.
                Deliberately a sibling of the overflow-x-auto row above, not
                nested inside it — see the wrapper comment. */}
            <div ref={moreMenuRef} className="relative md:hidden shrink-0">
              <button
                onClick={() => setShowMoreMenu(v => !v)}
                className="flex items-center gap-1 px-2.5 h-11 rounded-lg bg-slate-800/60 hover:bg-slate-800 ring-1 ring-slate-700/60 hover:ring-slate-600 transition-all active:scale-95"
                title="More"
                aria-label="More options"
                aria-expanded={showMoreMenu}
              >
                <svg className="w-4 h-4 text-slate-300" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v.01M12 12v.01M12 18v.01" />
                </svg>
                <span className="text-xs font-semibold text-slate-300">More</span>
              </button>

              {showMoreMenu && (
                  <div className="absolute right-0 top-full mt-2 z-50 w-44 rounded-xl bg-slate-900 ring-1 ring-slate-700 shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden animate-fade-in-up">
                    <a
                      href="/archive"
                      className="flex items-center gap-2.5 px-4 min-h-[44px] text-sm text-slate-200 hover:bg-slate-800 active:bg-slate-800"
                      onClick={() => setShowMoreMenu(false)}
                    >
                      <svg className="w-4 h-4 text-slate-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Archive
                    </a>
                    <a
                      href="/sources"
                      className="flex items-center gap-2.5 px-4 min-h-[44px] text-sm text-slate-200 hover:bg-slate-800 active:bg-slate-800"
                      onClick={() => setShowMoreMenu(false)}
                    >
                      <svg className="w-4 h-4 text-slate-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                      </svg>
                      Sources
                    </a>
                    <button
                      onClick={() => { setShowMoreMenu(false); handleSignOut() }}
                      className="w-full flex items-center gap-2.5 px-4 min-h-[44px] text-sm text-slate-200 hover:bg-slate-800 active:bg-slate-800 border-t border-slate-800"
                    >
                      <svg className="w-4 h-4 text-slate-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Sign out
                    </button>
                  </div>
              )}
            </div>
          </div>
        </div>

        {/* Category + Today + Topics tabs — only show categories with recent content */}
        <CategoryNav
          categories={CATEGORIES.filter(c => activeCategoryKeys.has(c.key))}
          active={activeTab}
          onChange={handleTabChange}
          topicCount={topicCount}
          todayUnread={todayUnread}
        />
      </header>

      {/* Feed */}
      {/* Offline banner — stories already on screen stay readable */}
      {isOffline && (
        <div className="sticky top-0 z-40 bg-slate-900 border-b border-amber-500/30 px-4 py-2 text-center">
          <p className="text-xs font-semibold text-amber-200 inline-flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728m2.828 9.9a5 5 0 010-7.072m7.072 0a5 5 0 010 7.072M12 12h.01" />
            </svg>
            Offline — showing last loaded stories
          </p>
        </div>
      )}

      {/* Scroll-to-top FAB — sits above the bottom nav, safe-area aware */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-24 md:bottom-8 right-4 z-40 w-12 h-12 rounded-full bg-slate-800 ring-1 ring-slate-600/80 shadow-[0_4px_20px_rgba(0,0,0,0.5)] flex items-center justify-center text-slate-200 hover:bg-slate-700 active:scale-90 transition-all animate-fade-in-up"
          aria-label="Scroll to top"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-3 pb-24 md:pb-6">
        {/* Today tab */}
        {activeTab === 'today' && (
          <ErrorBoundary>
            <TodayFeed
              stories={activeTodayStories}
              sources={sources}
              readIds={readIds}
              sourceWeights={sourceWeights}
              topicWeights={topicWeights}
              onMarkRead={markRead}
              onEngagement={sendEngagement}
              onDwellStart={startDwell}
              onDwellEnd={endDwell}
              onMuteTopic={muteTopics}
              loading={loading}
              error={loadError}
              onRetry={() => { loadContent(); loadReadIds() }}
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

            {!loading && loadError && (
              <div className="text-center py-20 px-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-500/10 ring-1 ring-rose-500/30 mb-4">
                  <svg className="w-8 h-8 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <p className="text-base font-semibold text-rose-200">Couldn't load this feed</p>
                <p className="text-sm text-slate-400 mt-1.5 max-w-xs mx-auto">
                  Something went wrong fetching stories — check the pipeline status above, or try refreshing.
                </p>
                <button
                  onClick={() => { loadContent(); loadReadIds() }}
                  className="mt-5 text-sm font-semibold text-violet-300 hover:text-violet-200 transition-colors inline-flex items-center gap-1"
                >
                  Try again
                </button>
              </div>
            )}

            {!loading && !loadError && isEmpty && (
              <div className="text-center py-20 px-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800/60 ring-1 ring-slate-700/60 mb-4">
                  {showUnreadOnly ? (
                    <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  )}
                </div>
                <p className="text-base font-semibold text-slate-200">
                  {showUnreadOnly ? 'All caught up' : 'Nothing here yet'}
                </p>
                <p className="text-sm text-slate-400 mt-1.5 max-w-xs mx-auto">
                  {showUnreadOnly
                    ? "You've read everything in this category. New stories arrive every 6 hours."
                    : 'The pipeline will populate this category on its next run.'}
                </p>
                {showUnreadOnly && (
                  <button
                    onClick={() => setShowUnreadOnly(false)}
                    className="mt-5 text-sm font-semibold text-violet-300 hover:text-violet-200 transition-colors inline-flex items-center gap-1"
                  >
                    Show all stories
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* Vantage segments pinned to top */}
            {!loading && vantagePinned.length > 0 && (
              <>
                <div className="flex items-center gap-3 pt-1 pb-1">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-300 bg-amber-500/15 ring-1 ring-amber-500/30 px-2.5 py-1 rounded-full uppercase tracking-wider">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Vantage · Latest
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-amber-500/30 to-transparent" />
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
                  <div className="flex items-center gap-3 pt-3 pb-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">More stories</span>
                    <div className="flex-1 h-px bg-slate-800" />
                  </div>
                )}
              </>
            )}

            {/* Unified merged feed — non-Vantage solos sorted latest→oldest */}
            <ErrorBoundary>
              {!loading && mergedFeed.map(story => (
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
            </ErrorBoundary>
          </>
        )}
      </main>
      <InstallPrompt />
    </div>
  )
}
