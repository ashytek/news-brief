'use client'

import { useMemo } from 'react'
import type { ClusterWithRelations, StoryWithRelations, Source, Category } from '@/lib/types'
import { SoloCard } from './SoloCard'
import { ClusteredCard } from './ClusteredCard'
import { SkeletonCard } from './SkeletonCard'

const CATEGORY_LABELS: Record<Category, string> = {
  prophetic:    'Prophetic',
  israel:       'Israel',
  india_global: 'India & Global',
  tech_ai:      'Tech & AI',
}

const CATEGORY_COLORS: Record<Category, string> = {
  prophetic:    'bg-violet-500/20 text-violet-300',
  israel:       'bg-blue-500/20 text-blue-300',
  india_global: 'bg-amber-500/20 text-amber-300',
  tech_ai:      'bg-emerald-500/20 text-emerald-300',
}

type RankedItem =
  | { type: 'cluster'; data: ClusterWithRelations; score: number }
  | { type: 'story';   data: StoryWithRelations;   score: number }

function isClusterFullyRead(c: ClusterWithRelations, readIds: Set<string>): boolean {
  if (readIds.has(c.id)) return true
  const stories = c.stories ?? []
  if (stories.length === 0) return false
  return stories.every(s => readIds.has(s.id))
}

function rankItems(
  clusters: ClusterWithRelations[],
  solos: StoryWithRelations[],
  readIds: Set<string>,
): RankedItem[] {
  const now = Date.now()

  const calcScore = (date: Date, storyCount: number) => {
    const hoursAgo = (now - date.getTime()) / (1000 * 3600)
    const recency = 1 / Math.max(0.25, hoursAgo)
    const breadth = storyCount * 1.5
    return recency + breadth
  }

  const ranked: RankedItem[] = [
    ...clusters.map(c => ({
      type: 'cluster' as const,
      data: c,
      score: calcScore(new Date(c.last_updated_at), c.story_count),
    })),
    ...solos.map(s => ({
      type: 'story' as const,
      data: s,
      score: calcScore(new Date(s.videos?.published_at ?? s.created_at), 1),
    })),
  ]

  return ranked
    .sort((a, b) => {
      const aRead = a.type === 'cluster'
        ? isClusterFullyRead(a.data, readIds)
        : readIds.has(a.data.id)
      const bRead = b.type === 'cluster'
        ? isClusterFullyRead(b.data, readIds)
        : readIds.has(b.data.id)
      if (aRead !== bRead) return aRead ? 1 : -1
      return b.score - a.score
    })
    .slice(0, 10)
}

interface Props {
  clusters: ClusterWithRelations[]
  stories: StoryWithRelations[]
  sources: Record<string, Source>
  readIds: Set<string>
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
  onMarkRead,
  onEngagement,
  onDwellStart,
  onDwellEnd,
  onMuteTopic,
  loading,
}: Props) {
  const ranked = useMemo(
    () => rankItems(clusters, stories, readIds),
    [clusters, stories, readIds],
  )

  const unreadCount = ranked.filter(item =>
    item.type === 'cluster'
      ? !isClusterFullyRead(item.data, readIds)
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
      <div className="text-center py-20">
        <div className="text-4xl mb-3">✓</div>
        <p className="text-gray-400 font-medium">All caught up</p>
        <p className="text-gray-600 text-sm mt-1">Nothing new in the last 24 hours</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Digest header */}
      <div className="flex items-center justify-between py-1">
        <div>
          <h2 className="text-sm font-semibold text-white">Today&apos;s Brief</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Top {ranked.length} items across all categories
            {unreadCount > 0 && ` · ${unreadCount} unread`}
          </p>
        </div>
      </div>

      {/* Ranked feed */}
      {ranked.map(item => {
        if (item.type === 'cluster') {
          const cluster = item.data as ClusterWithRelations
          return (
            <div key={cluster.id} className="relative">
              {/* Category chip overlay */}
              <div className="absolute top-3 right-3 z-10">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[cluster.category]}`}>
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
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[story.category]}`}>
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
