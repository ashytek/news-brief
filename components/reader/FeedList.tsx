'use client'

import { Fragment } from 'react'
import { FeedStory } from '@/components/story/FeedStory'
import { useStoryActions } from '@/components/story/useStoryActions'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DividerLabel } from '@/components/ui'
import { useReader } from '@/lib/reader/ReaderProvider'
import { FeedEmpty, FeedLoadError, FeedLoading } from './FeedStates'

/** A Sections feed: state views, then the IGR + Vantage pinned block, then
 *  everything else newest-first with the "Before you left" divider. Order and
 *  grouping are exactly what the Reader had before the redesign; all the
 *  ranking and filtering has already happened (see useFeedView). */
export function FeedList() {
  const r = useReader()
  const actionsFor = useStoryActions({ canMute: true })

  const firstId = (r.pinnedMix[0] ?? r.mergedFeed[0])?.id   // what the desktop pane opens on
  const card = (story: (typeof r.mergedFeed)[number]) => (
    <FeedStory
      key={story.id}
      first={story.id === firstId}
      story={story}
      source={r.sources[story.source_id]}
      actions={actionsFor(story)}
      onDwellStart={() => r.startDwell(story.id)}
      onDwellEnd={({ longForm }) => r.endDwell(story.id, story.id, longForm)}
    />
  )

  const retry = () => { void r.refresh() }

  return (
    <>
      {r.loading && <FeedLoading />}

      {!r.loading && r.loadError && <FeedLoadError onRetry={retry} />}

      {!r.loading && !r.loadError && r.isEmpty && <FeedEmpty showUnreadOnly={r.showUnreadOnly} onShowAll={r.showAllStories} />}

      {/* IGR + Vantage pinned to top (IGR-led mix) */}
      {!r.loading && r.pinnedMix.length > 0 && (
        <>
          <DividerLabel>IGR + Vantage · Latest</DividerLabel>
          {r.pinnedMix.map(card)}
          {r.mergedFeed.length > 0 && <DividerLabel>More stories</DividerLabel>}
        </>
      )}

      {/* Unified merged feed — non-Vantage solos sorted latest→oldest */}
      <ErrorBoundary>
        {!r.loading && r.mergedFeed.map((story, i) => (
          <Fragment key={story.id}>
            {i === r.newLeadCount && i > 0 && <DividerLabel>Before you left</DividerLabel>}
            {card(story)}
          </Fragment>
        ))}
      </ErrorBoundary>
    </>
  )
}
