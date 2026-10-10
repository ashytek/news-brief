/**
 * What each source is worth to you (roadmap session 8, F057): of the stories it produced in
 * the last 30 days, how many you read, which you liked or disliked, and the weight the ranking
 * has settled on. Plain functions (no React, no Supabase), tested offline:
 * `node --experimental-strip-types lib/reader/sourceStats.test.mjs`.
 */

export interface SourceStat {
  /** Stories from this source in the window. */
  stories: number
  /** Of those, how many are read. */
  read: number
  likes: number
  dislikes: number
}

/**
 * `stories`: id and source of every story in the window. `reactions`: like/dislike rows,
 * **newest first**, so the first row seen for a story is its current reaction (the same rule
 * as useReactions). A reaction to a story outside the window is not counted.
 */
export function summariseSourceStats(
  stories: { id: string; source_id: string }[],
  readIds: ReadonlySet<string>,
  reactions: { story_id: string | null; signal: string }[],
): Record<string, SourceStat> {
  const out: Record<string, SourceStat> = {}
  const sourceOf = new Map<string, string>()
  for (const s of stories) {
    sourceOf.set(s.id, s.source_id)
    const e = (out[s.source_id] ??= { stories: 0, read: 0, likes: 0, dislikes: 0 })
    e.stories++
    if (readIds.has(s.id)) e.read++
  }
  const seen = new Set<string>()
  for (const r of reactions) {
    if (!r.story_id || seen.has(r.story_id)) continue
    seen.add(r.story_id)
    const src = sourceOf.get(r.story_id)
    if (!src) continue
    if (r.signal === 'like') out[src].likes++
    else if (r.signal === 'dislike') out[src].dislikes++
  }
  return out
}

/** The line under a source on the Sources page, or null when there is nothing to say
 *  yet (the numbers are still loading). */
export function describeSourceStat(stat: SourceStat | undefined, weight: number | undefined): string | null {
  if (!stat) return null
  if (stat.stories === 0) return 'No stories in the last 30 days'
  const parts = [`${stat.read} of ${stat.stories} read`]
  if (stat.likes > 0) parts.push(`${stat.likes} liked`)
  if (stat.dislikes > 0) parts.push(`${stat.dislikes} disliked`)
  if (stat.stories >= 10 && stat.read / stat.stories < 0.2) parts.push('rarely read')
  if (weight !== undefined && Math.abs(weight - 1) >= 0.05) parts.push(`weight ${weight.toFixed(1)}`)
  return parts.join(' · ')
}
