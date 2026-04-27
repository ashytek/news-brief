/**
 * Shared UI constants — single source of truth for category labels, colour
 * palette, and Supabase select strings used across the reader, archive,
 * topics panel, and today feed.
 */
import type { Category } from './types'

export const CATEGORY_LABELS: Record<Category, string> = {
  prophetic:    'Prophetic',
  israel:       'Israel',
  india_global: 'India & Global',
  tech_ai:      'Tech & AI',
}

// Pill / chip backgrounds (used inside cards)
export const CATEGORY_PILL_COLORS: Record<Category, string> = {
  prophetic:    'bg-violet-500/20 text-violet-300',
  israel:       'bg-blue-500/20 text-blue-300',
  india_global: 'bg-amber-500/20 text-amber-300',
  tech_ai:      'bg-emerald-500/20 text-emerald-300',
}

// Plain text colour (used for filter pills, list headers)
export const CATEGORY_TEXT_COLORS: Record<Category, string> = {
  prophetic:    'text-violet-400',
  israel:       'text-blue-400',
  india_global: 'text-amber-400',
  tech_ai:      'text-emerald-400',
}

// Border + text used by CategoryNav tabs
export const CATEGORY_NAV_COLORS: Record<Category, string> = {
  prophetic:    'text-violet-400 border-violet-500',
  israel:       'text-blue-400 border-blue-500',
  india_global: 'text-amber-400 border-amber-500',
  tech_ai:      'text-emerald-400 border-emerald-500',
}

// Supabase select strings — keep in sync with lib/types.
// Explicitly omits transcript_text/embedding blobs so payloads stay slim.
export const STORY_SELECT =
  'id, source_id, video_id, category, headline, summary, bullets, cluster_id, matched_topics, created_at, ' +
  'videos(id, url, published_at, thumbnail_url), sources(id, name)'

export const CLUSTER_SELECT =
  'id, category, core_fact, consensus, perspectives, story_count, first_seen_at, last_updated_at, synthesised_at, ' +
  'stories(id, source_id, headline, summary, bullets, created_at, matched_topics, ' +
  'videos(id, url, published_at, thumbnail_url), sources(id, name))'

/** mm:ss formatting for video timestamps */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** True if every story in a cluster is in the read set (or the cluster id itself is). */
export function isClusterFullyRead(
  cluster: { id: string; stories?: { id: string }[] | null },
  readIds: Set<string>,
): boolean {
  if (readIds.has(cluster.id)) return true
  const stories = cluster.stories ?? []
  if (stories.length === 0) return false
  return stories.every(s => readIds.has(s.id))
}
