import { useCallback, useEffect, useRef, useState } from 'react'
import type { StoryWithRelations } from '@/lib/types'
import { STORY_SELECT } from '@/lib/constants'
import { FEED_SIZE } from './useFeedMeta'
import { fetchCatchUp, type CatchUpData } from './catchUpQuery'
import type { CatchUpMode } from './useCatchUp'
import { isSection, type ActiveTab, type Supabase } from './types'

/** Loads the stories for the active tab. Today (last 24 h, 60) and the Sections
 *  feeds (newest 100 of one category, or of all of them) keep separate
 *  collections; Topics loads its own. In catch-up the Today and Sections tabs load
 *  the last 7 days instead (plus their storylines) into a third collection, and
 *  nothing loads while the automatic catch-up decision is still `pending`. */
export function useFeedContent(
  supabase: Supabase,
  { activeTab, tabReady, clearHeld, catchUpMode }: {
    activeTab: ActiveTab
    tabReady: boolean
    clearHeld: () => void
    catchUpMode: CatchUpMode
  },
) {
  const [soloStories, setSoloStories] = useState<StoryWithRelations[]>([])
  const [todayStories, setTodayStories] = useState<StoryWithRelations[]>([])
  const [catchUpData, setCatchUpData] = useState<CatchUpData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  // A background reload is in flight (stories stay on screen meanwhile).
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  // Bumped on every loadContent() call; a response only commits state if it's
  // still the latest in-flight request — otherwise rapid tab switching can
  // let an older, slower response land after a newer one and show the wrong
  // category's stories.
  const loadReqId = useRef(0)
  // When the feed last committed (ms), 0 until the first load lands. Lets the
  // reader decide whether a feed kept from before a trip to another screen is
  // old enough to revalidate.
  const lastLoadedAt = useRef(0)

  /** `background` keeps the current stories on screen (no skeleton) while the
   *  fresh ones load — used when coming back to a feed that was kept in memory,
   *  and for every manual refresh (button, pull-to-refresh, Run now finishing). */
  const loadContent = useCallback(async (opts?: { background?: boolean }) => {
    clearHeld()   // a fresh load is the moment held cards may drop off
    if (activeTab === 'topics') {
      setLoading(false)
      return
    }
    // The skeleton stays up until the catch-up decision is made, so the feed the
    // reader is about to leave is never flashed first.
    if (catchUpMode === 'pending') return

    // Rapid tab switching fires overlapping requests; only the response
    // matching the most recently issued request is allowed to commit state —
    // otherwise an older, slower response can land after a newer one and
    // show the wrong category's stories.
    const reqId = ++loadReqId.current
    const isStale = () => reqId !== loadReqId.current

    if (opts?.background) setRefreshing(true)
    else setLoading(true)
    setLoadError(false)

    if (catchUpMode === 'on' && (activeTab === 'today' || isSection(activeTab))) {
      const res = await fetchCatchUp(supabase, activeTab)
      if (isStale()) return
      if (!res.ok) {
        console.error('loadContent (catch-up) failed', res.error)
        if (!opts?.background) setLoadError(true)   // a failed background refresh keeps what is on screen
      } else {
        setCatchUpData(res.data)
        lastLoadedAt.current = Date.now()
      }
      setLastUpdated(new Date())
      setLoading(false)
      setRefreshing(false)
      return
    }

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
        if (!opts?.background) setLoadError(true)   // a failed background refresh keeps what is on screen
      } else if (storyRes.data) {
        setTodayStories(storyRes.data as unknown as StoryWithRelations[])
        lastLoadedAt.current = Date.now()
      }
      setLastUpdated(new Date())
      setLoading(false)
      setRefreshing(false)
      return
    }

    let query = supabase.from('stories').select(STORY_SELECT)
    if (activeTab !== 'all') query = query.eq('category', activeTab)
    const storyRes = await query
      .order('created_at', { ascending: false })
      .limit(FEED_SIZE)

    if (isStale()) return
    if (storyRes.error) {
      console.error('loadContent failed', storyRes.error)
      if (!opts?.background) setLoadError(true)   // a failed background refresh keeps what is on screen
    } else if (storyRes.data) {
      setSoloStories(storyRes.data as unknown as StoryWithRelations[])
      lastLoadedAt.current = Date.now()
    }
    setLastUpdated(new Date())
    setLoading(false)
    setRefreshing(false)
  }, [activeTab, supabase, clearHeld, catchUpMode])

  useEffect(() => {
    // fetch-on-change: loadContent raises the loading flag, then awaits the query
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tabReady) loadContent()
  }, [tabReady, activeTab, loadContent])

  return { soloStories, todayStories, catchUpData, loading, refreshing, loadError, lastUpdated, lastLoadedAt, loadContent }
}
