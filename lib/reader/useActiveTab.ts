import { useCallback, useEffect, useState } from 'react'
import { CATEGORY_KEYS } from '@/lib/categories'
import { isSection, type ActiveTab, type SectionKey } from './types'

const STORAGE_KEY = 'newsbrief_activeTab'
const SECTION_KEY = 'newsbrief_section'

const isSectionKey = (v: string | null): v is SectionKey =>
  v === 'all' || (v !== null && (CATEGORY_KEYS as readonly string[]).includes(v))
const isTab = (v: string | null): v is ActiveTab => v === 'today' || v === 'topics' || isSectionKey(v)

/** Last-used tab, persisted; defaults to Today. localStorage is read in an
 *  effect, not in the initialiser: the server render can't see it, and a
 *  different first client render is a hydration mismatch (UI-041). Nothing
 *  loads until the saved tab is known (`tabReady`), so there is no wasted
 *  Today fetch.
 *
 *  Sections remembers which feed was open last (`lastSection`), so the bottom-nav
 *  "Sections" button returns to it. Stored values from before the redesign
 *  (a bare category key) are still valid: they open Sections on that category. */
export function useActiveTab(enabled: boolean) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('today')
  const [lastSection, setLastSection] = useState<SectionKey>('all')
  const [tabReady, setTabReady] = useState(false)

  /* eslint-disable react-hooks/set-state-in-effect -- reading localStorage must wait
     until after hydration (UI-041); this is the one place the saved tab is applied */
  useEffect(() => {
    if (!enabled) return
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      const savedSection = localStorage.getItem(SECTION_KEY)
      if (isTab(saved)) setActiveTab(saved)
      if (isSectionKey(saved)) setLastSection(saved)
      else if (isSectionKey(savedSection)) setLastSection(savedSection)
    } catch { /* storage blocked: stay on Today */ }
    setTabReady(true)
  }, [enabled])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab)
    if (isSection(tab)) setLastSection(tab)
    try {
      localStorage.setItem(STORAGE_KEY, tab)
      if (isSection(tab)) localStorage.setItem(SECTION_KEY, tab)
    } catch { /* storage blocked: the choice just isn't remembered */ }
  }, [])

  /** The bottom-nav "Sections" button: the feed that was open last. */
  const openSections = useCallback(() => handleTabChange(lastSection), [handleTabChange, lastSection])

  return { activeTab, lastSection, tabReady, handleTabChange, openSections }
}
