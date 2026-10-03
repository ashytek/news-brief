/**
 * Client-side ranking logic for the Today feed.
 *
 * Score formula:
 *   base  = recency_score + 1
 *   score = base × source_weight × topic_boost
 *
 * source_weight: from source_weights table; default 1.0; range 0.5–1.5.
 *   Bumped by likes (+0.1) and dislikes (−0.15) via adjust_source_weight RPC.
 *
 * topic_boost:   derived from matched_topics × topic_weights; default 1.0; capped at 1.5×.
 *   Updated nightly by update_weights.py from dwell/like/dislike/mute signals.
 *
 * Read items always sink to the bottom regardless of score.
 *
 * Priority source (IGR, per Ash Oct 2026): unread items are then mixed two
 * priority per one other (interleaveLead), each side keeping its score order.
 * A plain score multiplier was tried first on real data — even ×1.15 pushed
 * every other source out of the top 12, because base scores sit close together.
 */
import type { StoryWithRelations } from '@/lib/types'

export interface RankedItem {
  type: 'story'
  data: StoryWithRelations
  score: number
}

/**
 * Recency decay: score halves every ~6 h.
 * Using max(0.25) so very-recent items (< 15 min) don't get an absurdly huge boost.
 */
function recencyScore(date: Date): number {
  const hoursAgo = (Date.now() - date.getTime()) / (1000 * 3600)
  return 1 / Math.max(0.25, hoursAgo)
}

/** India Global Review — matched by source name, like isVantage in ReaderClient. */
export function isIGRSource(source?: { name?: string | null }): boolean {
  return (source?.name ?? '').toLowerCase().includes('india global review')
}

/**
 * Two (`ratio`) from `lead`, then one from `rest`, repeating. Each list keeps
 * its own order; whichever runs out first, the other fills the remainder.
 */
export function interleaveLead<T>(lead: T[], rest: T[], ratio = 2): T[] {
  const out: T[] = []
  let i = 0
  let j = 0
  while (i < lead.length || j < rest.length) {
    for (let k = 0; k < ratio && i < lead.length; k++) out.push(lead[i++])
    if (j < rest.length) out.push(rest[j++])
  }
  return out
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
 * Rank a set of solo stories.
 * @param solos      - story items for the today feed
 * @param readIds    - set of read story IDs (read items sink to bottom)
 * @param sourceWeights - map of source_id → weight (empty = all neutral)
 * @param topicWeights  - map of keyword → weight  (empty = all neutral)
 * @param limit      - max items to return (default 12)
 * @param isPriority - optional; unread priority items lead 2:1 (see top)
 */
export function rankItems(
  solos: StoryWithRelations[],
  readIds: Set<string>,
  sourceWeights: Record<string, number> = {},
  topicWeights: Record<string, number> = {},
  limit = 12,
  isPriority?: (s: StoryWithRelations) => boolean,
): RankedItem[] {
  const items: RankedItem[] = solos.map(s => {
    const base = recencyScore(new Date(s.videos?.published_at ?? s.created_at)) + 1
    return {
      type: 'story' as const,
      data: s,
      score: base * getSourceWeight(s.source_id, sourceWeights) * getTopicBoost(s.matched_topics, topicWeights),
    }
  })

  const sorted = items.sort((a, b) => {
    // Read items always sink to the bottom
    const aRead = readIds.has(a.data.id)
    const bRead = readIds.has(b.data.id)
    if (aRead !== bRead) return aRead ? 1 : -1
    return b.score - a.score
  })
  if (!isPriority) return sorted.slice(0, limit)

  const unread = sorted.filter(i => !readIds.has(i.data.id))
  const read = sorted.filter(i => readIds.has(i.data.id))
  const mixed = interleaveLead(
    unread.filter(i => isPriority(i.data)),
    unread.filter(i => !isPriority(i.data)),
  )
  return [...mixed, ...read].slice(0, limit)
}
