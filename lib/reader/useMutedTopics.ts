import { useCallback, useEffect, useState } from 'react'
import type { Supabase } from './types'
import { loadFeed, saveFeed } from './feedCache'

const isStringArray = (d: unknown): d is string[] => Array.isArray(d) && d.every(x => typeof x === 'string')

/** Topics the user muted (14-day expiry) and the write that adds them. */
export function useMutedTopics(supabase: Supabase, userId: string, enabled: boolean) {
  const [mutedKeywords, setMutedKeywords] = useState<Set<string>>(new Set())
  // True once the list has been asked for (even if the read failed), so a count of
  // visible stories (the catch-up trigger) is not made before mutes are known.
  const [loaded, setLoaded] = useState(false)

  // Load active muted topics (expires_at > now)
  useEffect(() => {
    if (!enabled) return
    supabase
      .from('muted_topics')
      .select('keyword')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .then(({ data, status }) => {
        if (data) {
          setMutedKeywords(new Set(data.map(r => r.keyword)))
          saveFeed('muted', data.map(r => r.keyword))
        } else if (status === 0) {
          const saved = loadFeed('muted', isStringArray)   // no signal: the last list, so a saved feed hides what you muted
          if (saved) setMutedKeywords(new Set(saved.data))
        }
        setLoaded(true)
      })
  }, [enabled, supabase, userId])

  const muteTopics = useCallback(async (keywords: string[]) => {
    if (keywords.length === 0) return
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    const rows = keywords.map(keyword => ({ user_id: userId, keyword, expires_at: expiresAt }))

    // Optimistic UI first — keep the in-memory mute set responsive
    setMutedKeywords(prev => {
      const next = new Set(prev)
      keywords.forEach(k => next.add(k))
      return next
    })

    // Re-muting a keyword should refresh expires_at, not error. Try upsert; if
    // the constraint name doesn't resolve we fall back to per-row insert that
    // tolerates 23505 duplicate-key errors.
    const { error } = await supabase.from('muted_topics').upsert(rows, {
      onConflict: 'user_id,keyword',
      ignoreDuplicates: false,
    })
    if (error) {
      // Per-row insert fallback (mirrors markRead pattern)
      for (const row of rows) {
        const { error: rowErr } = await supabase.from('muted_topics').insert(row)
        if (rowErr && rowErr.code !== '23505') {
          console.error('muteTopics failed for keyword', row.keyword, rowErr)
        }
      }
    }
  }, [supabase, userId])

  // Returns true if any of the given topic keywords are currently muted
  const hasMutedTopic = useCallback((topics: string[] | null | undefined) => {
    if (!topics || topics.length === 0) return false
    return topics.some(t => mutedKeywords.has(t))
  }, [mutedKeywords])

  return { mutedKeywords, loaded, muteTopics, hasMutedTopic }
}
