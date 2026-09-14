'use client'

import { useMemo } from 'react'
import type { StoryWithRelations, Source } from '@/lib/types'
import { SoloCard } from './SoloCard'
import { SkeletonCard } from './SkeletonCard'
import { CATEGORY_LABELS, CATEGORY_PILL_COLORS } from '@/lib/constants'
import { rankItems } from '@/lib/ranking'

interface Props {
  stories: StoryWithRelations[]
  sources: Record<string, Source>
  readIds: Set<string>
  // Read set used for ranking only — lets the reader hold dwell-auto-read
  // cards in place instead of sinking them mid-read. Defaults to readIds.
  layoutReadIds?: Set<string>
  sourceWeights?: Record<string, number>
  topicWeights?: Record<string, number>
  onMarkRead: (storyId?: string) => void
  onEngagement: (signal: string, storyId?: string) => void
  onDwellStart: (id: string) => void
  onDwellEnd: (id: string, storyId?: string) => void
  onMuteTopic?: (keywords: string[]) => void
  loading: boolean
  error?: boolean
  onRetry?: () => void
}

export function TodayFeed({
  stories,
  sources,
  readIds,
  layoutReadIds,
  sourceWeights = {},
  topicWeights = {},
  onMarkRead,
  onEngagement,
  onDwellStart,
  onDwellEnd,
  onMuteTopic,
  loading,
  error = false,
  onRetry,
}: Props) {
  const rankReadIds = layoutReadIds ?? readIds
  const ranked = useMemo(
    () => rankItems(stories, rankReadIds, sourceWeights, topicWeights),
    [stories, rankReadIds, sourceWeights, topicWeights],
  )

  const unreadCount = ranked.filter(item => !readIds.has(item.data.id)).length

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20 px-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-500/10 ring-1 ring-rose-500/30 mb-4">
          <svg className="w-8 h-8 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-base font-semibold text-rose-200">Couldn&apos;t load today&apos;s brief</p>
        <p className="text-sm text-slate-400 mt-1.5">Something went wrong fetching stories — check the pipeline status above, or try refreshing.</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-5 text-sm font-semibold text-violet-300 hover:text-violet-200 transition-colors inline-flex items-center gap-1"
          >
            Try again
          </button>
        )}
      </div>
    )
  }

  if (ranked.length === 0) {
    return (
      <div className="text-center py-20 px-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30 mb-4 shadow-[0_0_24px_rgba(52,211,153,0.15)]">
          <svg className="w-8 h-8 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-base font-semibold text-slate-200">All caught up</p>
        <p className="text-sm text-slate-400 mt-1.5">Nothing new in the last 24 hours.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Digest header */}
      <div className="flex items-end justify-between py-1 mb-1">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Today&apos;s Brief</h2>
          <p className="text-xs text-slate-400 mt-1 inline-flex items-center gap-2">
            <span>Top {ranked.length} across all categories</span>
            {unreadCount > 0 && (
              <span className="inline-flex items-center gap-1 text-violet-300">
                <span className="w-1 h-1 rounded-full bg-violet-400" />
                {unreadCount} unread
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Ranked feed */}
      {ranked.map(({ data: story }) => (
        <div key={story.id} className="relative">
          {/* Category chip overlay */}
          <div className="absolute top-3 right-3 z-10">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_PILL_COLORS[story.category]}`}>
              {CATEGORY_LABELS[story.category]}
            </span>
          </div>
          <SoloCard
            story={story}
            source={sources[story.source_id]}
            isRead={readIds.has(story.id)}
            onRead={() => onMarkRead(story.id)}
            onEngagement={(signal) => onEngagement(signal, story.id)}
            onDwellStart={() => onDwellStart(story.id)}
            onDwellEnd={() => onDwellEnd(story.id, story.id)}
            onMuteTopic={onMuteTopic ? () => onMuteTopic(story.matched_topics ?? []) : undefined}
          />
        </div>
      ))}
    </div>
  )
}
