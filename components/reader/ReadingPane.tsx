'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Newspaper } from 'lucide-react'
import type { StoryWithRelations } from '@/lib/types'
import { StoryCard } from '@/components/story/StoryCard'
import { useStoryActions } from '@/components/story/useStoryActions'
import { useReader } from '@/lib/reader/ReaderProvider'

/** What the rows of a list need from the reading pane (desktop, from 1180 px). `null`
 *  context = no pane (a phone, or Search/Archive): rows behave as they always have. */
export type PaneApi = {
  /** Id of the story the pane is showing (the picked one, else the list's first). */
  currentId: string | null
  /** Show this story in the pane. */
  select: (story: StoryWithRelations) => void
  /** The list's first story, shown until one is picked. */
  setFallback: (story: StoryWithRelations) => void
  clearFallback: (id: string) => void
  /** A row announces itself so j/k can step through the list; returns the cleanup. */
  register: (story: StoryWithRelations) => () => void
}

const Ctx = createContext<PaneApi | null>(null)
/** The story the pane itself shows (rows don't need it, so it is a separate context). */
const CurrentCtx = createContext<StoryWithRelations | null>(null)

export const useReadingPane = () => useContext(Ctx)

/** Holds which story the desktop reading pane shows, and the j / k keys that step
 *  through the list. `scope` names what the list is (the tab and whether it is the catch-up
 *  view); when it changes the pick is forgotten, so Sections never opens on a Today story.
 *  With `enabled` false the context is `null` and the tree is unchanged, so crossing the
 *  breakpoint doesn't remount the feed. */
export function ReadingPaneProvider({ enabled, scope, children }: { enabled: boolean; scope: string; children: ReactNode }) {
  const [picked, setPicked] = useState<StoryWithRelations | null>(null)
  const [fallback, setFallbackState] = useState<StoryWithRelations | null>(null)
  const [seenScope, setSeenScope] = useState(scope)
  if (scope !== seenScope) {   // derive-during-render: a different list starts with no pick
    setSeenScope(scope)
    setPicked(null)
  }

  const rows = useRef(new Map<string, StoryWithRelations>())
  const currentId = (picked ?? fallback)?.id ?? null
  const currentIdRef = useRef(currentId)
  useEffect(() => { currentIdRef.current = currentId })

  const select = useCallback((s: StoryWithRelations) => setPicked(s), [])
  const setFallback = useCallback((s: StoryWithRelations) => setFallbackState(s), [])
  const clearFallback = useCallback((id: string) => setFallbackState(f => (f?.id === id ? null : f)), [])
  const register = useCallback((s: StoryWithRelations) => {
    rows.current.set(s.id, s)
    return () => { if (rows.current.get(s.id) === s) rows.current.delete(s.id) }
  }, [])

  // j / k: next and previous story in the list, in the order they are on the page.
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'j' && e.key !== 'k')) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (document.querySelector('dialog[open]')) return
      const els = Array.from(document.querySelectorAll<HTMLElement>('[data-pane-row]'))
      if (els.length === 0) return
      const i = els.findIndex(el => el.dataset.storyId === currentIdRef.current)
      const next = e.key === 'j' ? Math.min(els.length - 1, i + 1) : Math.max(0, i - 1)
      const story = rows.current.get(els[next].dataset.storyId ?? '')
      if (!story) return
      e.preventDefault()
      setPicked(story)
      els[next].scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  const api = useMemo<PaneApi | null>(
    () => (enabled ? { currentId, select, setFallback, clearFallback, register } : null),
    [enabled, currentId, select, setFallback, clearFallback, register],
  )
  // The pane reads the story object itself.
  const current = picked ?? fallback
  return (
    <Ctx.Provider value={api}>
      <CurrentCtx.Provider value={enabled ? current : null}>{children}</CurrentCtx.Provider>
    </Ctx.Provider>
  )
}

/** The right-hand pane: the picked story as a full story view (image, headline, short
 *  version, then the chapters open), in a reading column of at most 680 px. Fixed to
 *  the window beside the list, with its own scroll. The story's own dwell timer runs
 *  on it, as on a card in the feed. */
export function ReadingPane() {
  const r = useReader()
  const story = useContext(CurrentCtx)
  const actionsFor = useStoryActions({ canMute: true })

  return (
    <section
      aria-label="Story"
      className="fixed bottom-0 right-0 top-0 left-[calc(var(--spacing-rail)+var(--spacing-list))] z-20 border-l border-hairline bg-canvas"
    >
      {story ? (
        // Keyed by story: opening another one starts at its top, with fresh sections state.
        <div key={story.id} className="h-full overflow-y-auto overscroll-contain">
          <div className="mx-auto max-w-[680px] px-8 pb-16 pt-6">
            <StoryCard
              variant="pane"
              defaultOpen
              story={story}
              source={r.sources[story.source_id]}
              showCategory
              actions={actionsFor(story)}
              onDwellStart={() => r.startDwell(story.id)}
              onDwellEnd={({ longForm }) => r.endDwell(story.id, story.id, longForm)}
            />
          </div>
        </div>
      ) : (
        <div className="grid h-full place-items-center px-8 text-center">
          <div className="max-w-xs">
            <span aria-hidden="true" className="mx-auto mb-3 grid size-12 place-items-center rounded-panel bg-surface-1 text-fg-3">
              <Newspaper className="size-6" />
            </span>
            <p className="t-h3">Pick a story</p>
            <p className="t-meta mt-1">It opens here. Use j and k to move down and up the list.</p>
          </div>
        </div>
      )}
    </section>
  )
}
