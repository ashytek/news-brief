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

// Pill / chip backgrounds (used inside cards) — slightly higher saturation
// for better contrast against the slate background.
export const CATEGORY_PILL_COLORS: Record<Category, string> = {
  prophetic:    'bg-violet-500/25 text-violet-200 ring-1 ring-violet-500/30',
  israel:       'bg-blue-500/25   text-blue-200   ring-1 ring-blue-500/30',
  india_global: 'bg-amber-500/25  text-amber-200  ring-1 ring-amber-500/30',
  tech_ai:      'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-500/30',
}

// Plain text colour (used for filter pills, list headers)
export const CATEGORY_TEXT_COLORS: Record<Category, string> = {
  prophetic:    'text-violet-300',
  israel:       'text-blue-300',
  india_global: 'text-amber-300',
  tech_ai:      'text-emerald-300',
}

// Border + text used by CategoryNav tabs
export const CATEGORY_NAV_COLORS: Record<Category, string> = {
  prophetic:    'text-violet-300 border-violet-500',
  israel:       'text-blue-300   border-blue-500',
  india_global: 'text-amber-300  border-amber-500',
  tech_ai:      'text-emerald-300 border-emerald-500',
}

// Left accent bar colour per category — used as a vertical bar on cards
// so the user can identify a story's category at a glance.
export const CATEGORY_ACCENT_BAR: Record<Category, string> = {
  prophetic:    'bg-gradient-to-b from-violet-400 to-violet-600',
  israel:       'bg-gradient-to-b from-blue-400   to-blue-600',
  india_global: 'bg-gradient-to-b from-amber-400  to-amber-600',
  tech_ai:      'bg-gradient-to-b from-emerald-400 to-emerald-600',
}

// Hover-glow class per category — pairs with `.card-rise` in globals.css
export const CATEGORY_GLOW_CLASS: Record<Category, string> = {
  prophetic:    'card-glow-violet',
  israel:       'card-glow-blue',
  india_global: 'card-glow-amber',
  tech_ai:      'card-glow-emerald',
}

// Bullet marker colour per category — used as small dot before each bullet
export const CATEGORY_BULLET_COLOR: Record<Category, string> = {
  prophetic:    'bg-violet-400',
  israel:       'bg-blue-400',
  india_global: 'bg-amber-400',
  tech_ai:      'bg-emerald-400',
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
