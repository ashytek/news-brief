import { Fragment } from 'react'
import type { Source, StoryWithRelations } from '@/lib/types'
import { SoloCard } from '@/components/SoloCard'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { FeedEmpty, FeedLoadError, FeedLoading } from './FeedStates'

/** A category tab's feed: state views, then the IGR + Vantage pinned block,
 *  then everything else newest-first with the "Before you left" divider.
 *  Order, grouping and markup are exactly what ReaderClient rendered inline;
 *  all the ranking/filtering has already happened (see useFeedView). */
export function FeedList({
  loading, loadError, isEmpty, showUnreadOnly, pinnedMix, mergedFeed, newLeadCount,
  sources, readIds, onMarkRead, onEngagement, onDwellStart, onDwellEnd, onMuteTopic, onRetry, onShowAll,
}: {
  loading: boolean
  loadError: boolean
  isEmpty: boolean
  showUnreadOnly: boolean
  pinnedMix: StoryWithRelations[]
  mergedFeed: StoryWithRelations[]
  /** Index in mergedFeed where the "Before you left" divider goes. */
  newLeadCount: number
  sources: Record<string, Source>
  readIds: Set<string>
  onMarkRead: (storyId: string) => void
  onEngagement: (signal: string, storyId: string) => void
  onDwellStart: (id: string) => void
  onDwellEnd: (id: string, storyId: string, longForm: boolean) => void
  onMuteTopic: (keywords: string[]) => void
  onRetry: () => void
  onShowAll: () => void
}) {
  const card = (story: StoryWithRelations) => (
    <SoloCard
      story={story}
      source={sources[story.source_id]}
      isRead={readIds.has(story.id)}
      onRead={() => onMarkRead(story.id)}
      onEngagement={(signal) => onEngagement(signal, story.id)}
      onDwellStart={() => onDwellStart(story.id)}
      onDwellEnd={({ longForm }) => onDwellEnd(story.id, story.id, longForm)}
      onMuteTopic={() => onMuteTopic(story.matched_topics ?? [])}
    />
  )

  return (
    <>
      {loading && <FeedLoading />}

      {!loading && loadError && <FeedLoadError onRetry={onRetry} />}

      {!loading && !loadError && isEmpty && <FeedEmpty showUnreadOnly={showUnreadOnly} onShowAll={onShowAll} />}

      {/* IGR + Vantage pinned to top (IGR-led mix) */}
      {!loading && pinnedMix.length > 0 && (
        <>
          <div className="flex items-center gap-3 pt-1 pb-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 bg-amber-500/15 ring-1 ring-amber-500/30 px-2.5 py-1 rounded-full uppercase tracking-wider">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              IGR + Vantage · Latest
            </span>
            <div className="flex-1 h-px bg-gradient-to-r from-amber-500/30 to-transparent" />
          </div>
          {pinnedMix.map(story => <Fragment key={story.id}>{card(story)}</Fragment>)}
          {mergedFeed.length > 0 && (
            <div className="flex items-center gap-3 pt-3 pb-1">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">More stories</span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>
          )}
        </>
      )}

      {/* Unified merged feed — non-Vantage solos sorted latest→oldest */}
      <ErrorBoundary>
        {!loading && mergedFeed.map((story, i) => (
          <Fragment key={story.id}>
            {i === newLeadCount && i > 0 && (
              <div className="flex items-center gap-3 pt-3 pb-1">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Before you left</span>
                <div className="flex-1 h-px bg-slate-800" />
              </div>
            )}
            {card(story)}
          </Fragment>
        ))}
      </ErrorBoundary>
    </>
  )
}
