import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActiveTab } from '@/components/CategoryNav'
import type { StoryWithRelations } from '@/lib/types'
import { STORY_SELECT } from '@/lib/constants'
import type { Supabase } from './types'

/** Loads the stories for the active tab. Today (last 24 h, 60) and each
 *  category (newest 100) keep separate collections; Topics loads its own. */
export function useFeedContent(
  supabase: Supabase,
  { activeTab, tabReady, clearHeld }: { activeTab: ActiveTab; tabReady: boolean; clearHeld: () => void },
) {
  const [soloStories, setSoloStories] = useState<StoryWithRelations[]>([])
  const [todayStories, setTodayStories] = useState<StoryWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
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
   *  fresh ones load — used when coming back to a feed that was kept in memory. */
  const loadContent = useCallback(async (opts?: { background?: boolean }) => {
    clearHeld()   // a fresh load is the moment held cards may drop off
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

    if (!opts?.background) setLoading(true)
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
        lastLoadedAt.current = Date.now()
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
      lastLoadedAt.current = Date.now()
    }
    setLastUpdated(new Date())
    setLoading(false)
  }, [activeTab, supabase, clearHeld])

  useEffect(() => {
    // fetch-on-change: loadContent raises the loading flag, then awaits the query
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tabReady) loadContent()
  }, [tabReady, activeTab, loadContent])

  return { soloStories, todayStories, loading, loadError, lastUpdated, lastLoadedAt, loadContent }
}
