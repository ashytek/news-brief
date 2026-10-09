import { useCallback, useEffect, useRef, useState } from 'react'
import type { Supabase } from './types'

export type Reaction = 'like' | 'dislike'

/** The user's like/dislike on each story, so a card shows what was chosen even
 *  after a reload or a trip to another screen (it used to be component state and
 *  reset every time). Loaded from the `engagement` rows already written by the
 *  buttons: the newest like/dislike per story wins. `react` is optimistic and
 *  hands the write to `sendEngagement` (which also moves the source weight). */
export function useReactions(
  supabase: Supabase,
  userId: string,
  enabled: boolean,
  sendEngagement: (signal: string, storyId?: string) => Promise<void>,
) {
  const [reactions, setReactions] = useState<Map<string, Reaction>>(new Map())
  const current = useRef(reactions)
  useEffect(() => { current.current = reactions }, [reactions])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    supabase
      .from('engagement')
      .select('story_id, signal')
      .eq('user_id', userId)
      .in('signal', ['like', 'dislike'])
      .not('story_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2000)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { console.error('load reactions failed', error); return }
        // Newest first, so the first row seen for a story is its current reaction.
        const next = new Map<string, Reaction>()
        for (const r of data ?? []) if (r.story_id && !next.has(r.story_id)) next.set(r.story_id, r.signal as Reaction)
        // Keep anything chosen while this was loading.
        setReactions(prev => new Map([...next, ...prev]))
      })
    return () => { cancelled = true }
  }, [enabled, supabase, userId])

  const react = useCallback((storyId: string, signal: Reaction) => {
    if (current.current.get(storyId) === signal) return   // already chosen: no second signal
    setReactions(prev => new Map(prev).set(storyId, signal))
    void sendEngagement(signal, storyId)
  }, [sendEngagement])

  return { reactions, react }
}
