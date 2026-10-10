'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { StoryWithRelations } from '@/lib/types'
import { StoryRow } from '@/components/ui'
import { useReadingPane } from '@/components/reader/ReadingPane'
import { afterPaint, flowItemOf, toTop } from '@/lib/reader/flow'
import { ShortBody } from './ShortBody'
import type { StoryActions } from './types'

/** A headline row that opens into the short card: the row for Search, Archive,
 *  Topics, the catch-up headline list and (compact density) the feeds. Two levels of
 *  "more": tap the row for the short version, then "More · N sections" inside it for
 *  the chapters. In the Reader on a desktop window (the reading pane) the row picks the
 *  story for the pane instead of opening in place; `paneFallback` marks the list's first
 *  story, which the pane shows until one is picked. */
export function StoryListItem({ story, sourceName, showCategory, compact, highlight, kickerExtra, actions, paneFallback, collapseToTop }: {
  story: StoryWithRelations
  sourceName?: string
  showCategory?: boolean
  compact?: boolean
  highlight?: string
  kickerExtra?: ReactNode
  actions: StoryActions
  paneFallback?: boolean
  /** Closing the row puts it at the top of the screen (the catch-up, Ash 10 Oct 2026). */
  collapseToTop?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [sectionsOpen, setSectionsOpen] = useState(false)
  const pane = useReadingPane()
  const register = pane?.register
  const setFallback = pane?.setFallback
  const clearFallback = pane?.clearFallback

  useEffect(() => register?.(story), [register, story])
  useEffect(() => {
    if (!paneFallback || !setFallback || !clearFallback) return
    setFallback(story)
    return () => clearFallback(story.id)
  }, [paneFallback, setFallback, clearFallback, story])

  if (pane) {
    return (
      <StoryRow
        story={story}
        sourceName={sourceName}
        showCategory={showCategory}
        compact={compact}
        highlight={highlight}
        kickerExtra={kickerExtra}
        isRead={actions.isRead}
        saved={actions.saved}
        selected={pane.currentId === story.id}
        onSelect={() => pane.select(story)}
      />
    )
  }

  return (
    <StoryRow
      story={story}
      sourceName={sourceName}
      showCategory={showCategory}
      compact={compact}
      highlight={highlight}
      kickerExtra={kickerExtra}
      isRead={actions.isRead}
      saved={actions.saved}
      expanded={open}
      onToggle={() => {
        setOpen(!open)
        if (open && collapseToTop) afterPaint(() => { const el = flowItemOf(story.id); if (el) toTop(el) })
      }}
    >
      <ShortBody
        story={story}
        actions={actions}
        sectionsOpen={sectionsOpen}
        onToggleSections={() => setSectionsOpen(v => !v)}
      />
    </StoryRow>
  )
}
