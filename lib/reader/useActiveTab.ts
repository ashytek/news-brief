import { useCallback, useEffect, useState } from 'react'
import type { ActiveTab } from '@/components/CategoryNav'

const STORAGE_KEY = 'newsbrief_activeTab'

/** Last-used tab, persisted; defaults to Today. localStorage is read in an
 *  effect, not in the initialiser: the server render can't see it, and a
 *  different first client render is a hydration mismatch (UI-041). Nothing
 *  loads until the saved tab is known (`tabReady`), so there is no wasted
 *  Today fetch. */
export function useActiveTab(enabled: boolean) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('today')
  const [tabReady, setTabReady] = useState(false)

  /* eslint-disable react-hooks/set-state-in-effect -- reading localStorage must wait
     until after hydration (UI-041); this is the one place the saved tab is applied */
  useEffect(() => {
    if (!enabled) return
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ActiveTab | null
      if (saved) setActiveTab(saved)
    } catch { /* storage blocked: stay on Today */ }
    setTabReady(true)
  }, [enabled])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab)
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, tab)
    }
  }, [])

  return { activeTab, tabReady, handleTabChange }
}
