'use client'

import { useMemo } from 'react'
import type { ClusterWithRelations, StoryWithRelations, Source } from '@/lib/types'
import { SoloCard } from './SoloCard'
import { ClusteredCard } from './ClusteredCard'
import { SkeletonCard } from './SkeletonCard'
import { CATEGORY_LABELS, CATEGORY_PILL_COLORS } from '@/lib/constants'
import { rankItems } from '@/lib/ranking'
import type { RankedItem } from '@/lib/ranking'

interface Props {
  clusters: ClusterWithRelations[]
  stories: StoryWithRelations[]
  sources: Record<string, Source>
  readIds: Set<string>
  sourceWeights?: Record<string, number>
  topicWeights?: Record<string, number>
  onMarkRead: (storyId?: string, clusterId?: string) => void
  onEngagement: (signal: string, storyId?: string, clusterId?: string) => void
  onDwellStart: (id: string) => void
  onDwellEnd: (id: string, storyId?: string, clusterId?: string) => void
  onMuteTopic?: (keywords: string[]) => void
  loading: boolean
}

export function TodayFeed({
  clusters,
  stories,
  sources,
  readIds,
  sourceWeights = {},
  topicWeights = {},
  onMarkRead,
  onEngagement,
  onDwellStart,
  onDwellEnd,
  onMuteTopic,
  loading,
}: Props) {
  const ranked = useMemo(
    () => rankItems(clusters, stories, readIds, sourceWeights, topicWeights),
    [clusters, stories, readIds, sourceWeights, topicWeights],
  )

  const unreadCount = ranked.filter(item =>
    item.type === 'cluster'
      ? !(readIds.has(item.data.id) || (item.data.stories?.every(s => readIds.has(s.id)) ?? false))
      : !readIds.has(item.data.id)
  ).length

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
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
      {ranked.map((item: RankedItem) => {
        if (item.type === 'cluster') {
          const cluster = item.data as ClusterWithRelations
          return (
            <div key={cluster.id} className="relative">
              {/* Category chip overlay */}
              <div className="absolute top-3 right-3 z-10">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_PILL_COLORS[cluster.category]}`}>
                  {CATEGORY_LABELS[cluster.category]}
                </span>
              </div>
              <ClusteredCard
                cluster={cluster}
                isRead={
                  readIds.has(cluster.id) ||
                  (!!cluster.stories?.length && cluster.stories.every(s => readIds.has(s.id)))
                }
                readStoryIds={readIds}
                onRead={() => onMarkRead(undefined, cluster.id)}
                onEngagement={(signal) => onEngagement(signal, undefined, cluster.id)}
                onDwellStart={() => onDwellStart(cluster.id)}
                onDwellEnd={() => onDwellEnd(cluster.id, undefined, cluster.id)}
                onMuteTopic={onMuteTopic ? () => onMuteTopic(
                  Array.from(new Set((cluster.stories ?? []).flatMap(s => s.matched_topics ?? [])))
                ) : undefined}
              />
            </div>
          )
        }

        const story = item.data as StoryWithRelations
        return (
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
        )
      })}
    </div>
  )
}
