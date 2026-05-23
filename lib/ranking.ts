/**
 * Client-side ranking logic for the Today feed.
 *
 * Score formula:
 *   base  = recency_score + cluster_breadth_bonus
 *   score = base × source_weight × topic_boost
 *
 * source_weight: from source_weights table; default 1.0; range 0.5–1.5.
 *   Bumped by likes (+0.1) and dislikes (−0.15) via adjust_source_weight RPC.
 *
 * topic_boost:   derived from matched_topics × topic_weights; default 1.0; capped at 1.5×.
 *   Updated nightly by update_weights.py from dwell/like/dislike/mute signals.
 *
 * Read items always sink to the bottom regardless of score.
 */
import type { ClusterWithRelations, StoryWithRelations } from '@/lib/types'
import { isClusterFullyRead } from '@/lib/constants'

export type RankedItem =
  | { type: 'cluster'; data: ClusterWithRelations; score: number }
  | { type: 'story';   data: StoryWithRelations;   score: number }

/**
 * Recency decay: score halves every ~6 h.
 * Using max(0.25) so very-recent items (< 15 min) don't get an absurdly huge boost.
 */
function recencyScore(date: Date): number {
  const hoursAgo = (Date.now() - date.getTime()) / (1000 * 3600)
  return 1 / Math.max(0.25, hoursAgo)
}

function getSourceWeight(sourceId: string, weights: Record<string, number>): number {
  return weights[sourceId] ?? 1.0
}

/**
 * Topic boost: each matched keyword above 1.0 weight adds to the multiplier.
 * Capped at 1.5× so a very popular topic can at most boost 50%.
 * Topics with weight < 1.0 reduce the score proportionally.
 */
function getTopicBoost(
  topics: string[] | null | undefined,
  weights: Record<string, number>,
): number {
  if (!topics || topics.length === 0) return 1.0
  // Weighted average of topic weight contributions, with cap
  const extra = topics.reduce((sum, t) => sum + (weights[t] ?? 1.0) - 1.0, 0)
  // Scale down by topic count so many low-weight tags don't stack unreasonably
  const normalized = extra / Math.max(1, topics.length)
  return Math.min(1.5, Math.max(0.5, 1.0 + normalized))
}

/**
 * Rank a mixed set of clusters and solo stories.
 * @param clusters   - cluster items for the today feed
 * @param solos      - unclustered story items
 * @param readIds    - set of read story/cluster IDs (read items sink to bottom)
 * @param sourceWeights - map of source_id → weight (empty = all neutral)
 * @param topicWeights  - map of keyword → weight  (empty = all neutral)
 * @param limit      - max items to return (default 12)
 */
export function rankItems(
  clusters: ClusterWithRelations[],
  solos: StoryWithRelations[],
  readIds: Set<string>,
  sourceWeights: Record<string, number> = {},
  topicWeights: Record<string, number> = {},
  limit = 12,
): RankedItem[] {
  const items: RankedItem[] = [
    ...clusters.map(c => {
      const stories = c.stories ?? []
      // Source weight: average across all contributing sources in the cluster
      const avgSourceW = stories.length > 0
        ? stories.reduce((sum, s) => sum + getSourceWeight(s.source_id, sourceWeights), 0) / stories.length
        : 1.0
      const allTopics = Array.from(new Set(stories.flatMap(s => s.matched_topics ?? [])))
      const base = recencyScore(new Date(c.last_updated_at)) + c.story_count * 1.5
      return {
        type: 'cluster' as const,
        data: c,
        score: base * avgSourceW * getTopicBoost(allTopics, topicWeights),
      }
    }),
    ...solos.map(s => {
      const base = recencyScore(new Date(s.videos?.published_at ?? s.created_at)) + 1
      return {
        type: 'story' as const,
        data: s,
        score: base * getSourceWeight(s.source_id, sourceWeights) * getTopicBoost(s.matched_topics, topicWeights),
      }
    }),
  ]

  return items
    .sort((a, b) => {
      // Read items always sink to the bottom
      const aRead = a.type === 'cluster'
        ? isClusterFullyRead(a.data, readIds)
        : readIds.has(a.data.id)
      const bRead = b.type === 'cluster'
        ? isClusterFullyRead(b.data, readIds)
        : readIds.has(b.data.id)
      if (aRead !== bRead) return aRead ? 1 : -1
      return b.score - a.score
    })
    .slice(0, limit)
}
