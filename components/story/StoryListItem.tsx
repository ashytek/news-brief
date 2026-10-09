'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { StoryWithRelations } from '@/lib/types'
import { StoryRow } from '@/components/ui'
import { ShortBody } from './ShortBody'
import type { StoryActions } from './types'

/** A headline row that opens into the short card: the row for Search, Archive,
 *  Topics and (later) the catch-up headline list. Two levels of "more": tap the
 *  row for the short version, then "More · N sections" inside it for the chapters. */
export function StoryListItem({ story, sourceName, showCategory, compact, highlight, kickerExtra, actions }: {
  story: StoryWithRelations
  sourceName?: string
  showCategory?: boolean
  compact?: boolean
  highlight?: string
  kickerExtra?: ReactNode
  actions: StoryActions
}) {
  const [open, setOpen] = useState(false)
  const [sectionsOpen, setSectionsOpen] = useState(false)
  return (
    <StoryRow
      story={story}
      sourceName={sourceName}
      showCategory={showCategory}
      compact={compact}
      highlight={highlight}
      kickerExtra={kickerExtra}
      isRead={actions.isRead}
      expanded={open}
      onToggle={() => setOpen(v => !v)}
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
