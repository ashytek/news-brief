'use client'

import type { ComponentProps } from 'react'
import { useDensity } from '@/lib/density'
import { useReadingPane } from '@/components/reader/ReadingPane'
import { StoryCard } from './StoryCard'
import { StoryListItem } from './StoryListItem'

/** One story in the Today and Sections feeds. Which shape it takes is a setting of the
 *  window and the device, not of the data:
 *  - the desktop reading pane is on: a row that picks the story for the pane (the pane runs
 *    the dwell timer for the one story it shows);
 *  - Compact density: a headline row that opens to the short card (no dwell timer: with
 *    many rows on screen at once, a timer would read them all);
 *  - otherwise the short card, as ever. */
export function FeedStory({ first, ...card }: ComponentProps<typeof StoryCard> & {
  /** The first story of the list: the pane shows it until one is picked. */
  first?: boolean
}) {
  const pane = useReadingPane()
  const density = useDensity()

  if (pane || density === 'compact') {
    return (
      <StoryListItem
        story={card.story}
        sourceName={card.source?.name}
        showCategory={card.showCategory}
        compact={density === 'compact'}
        actions={card.actions}
        paneFallback={first}
      />
    )
  }
  return <StoryCard {...card} />
}
