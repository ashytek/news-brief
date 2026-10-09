import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import type { StoryWithRelations } from '@/lib/types'
import { DWELL_LONG_SECONDS, DWELL_SHORT_SECONDS } from '@/lib/constants'
import type { Supabase } from './types'

/** Likes/dislikes/shares and their effect on source weights. */
export function useEngagement(
  supabase: Supabase,
  userId: string,
  storyById: Map<string, StoryWithRelations>,
  setSourceWeights: Dispatch<SetStateAction<Record<string, number>>>,
) {
  return useCallback(async (signal: string, storyId?: string) => {
    const { error } = await supabase.from('engagement').insert({
      user_id: userId,
      story_id: storyId ?? null,
      signal,
    })
    if (error) {
      console.error('sendEngagement failed', { storyId, signal, error })
    }
    if (storyId) {
      const story = storyById.get(storyId)
      if (story) {
        const delta = signal === 'like' ? 0.1 : signal === 'dislike' ? -0.15 : 0
        if (delta !== 0) {
          const { error: rpcError } = await supabase.rpc('adjust_source_weight', {
            p_user_id: userId,
            p_source_id: story.source_id,
            p_delta: delta
          }).maybeSingle()
          if (rpcError) {
            // Don't nudge local ranking for a weight the DB never stored.
            console.error('adjust_source_weight failed', { storyId, delta, error: rpcError })
            return
          }
          // Reflect the saved weight immediately in ranking
          setSourceWeights(prev => {
            const current = prev[story.source_id] ?? 1.0
            const next = Math.min(1.5, Math.max(0.5, current + delta))
            return { ...prev, [story.source_id]: next }
          })
        }
      }
    }
  }, [supabase, userId, storyById, setSourceWeights])
}

/** Dwell time tracking — auto-mark-read after 40 s on screen for a short
 *  card, 120 s once its sections were opened (or when only the long summary
 *  is shown). */
export function useDwellTracking(
  sendEngagement: (signal: string, storyId?: string) => Promise<void>,
  markRead: (storyId?: string, opts?: { hold?: boolean }) => Promise<boolean>,
  /** False once the Reader screen itself is being left. */
  viewActive: { current: boolean },
  /** Is this story read by now? A card taken out of the list because it was just
   *  marked read (Mark all read) is not one the reader glanced at and left. */
  isRead: (storyId: string) => boolean = () => false,
) {
  const dwellTimers = useRef<Map<string, number>>(new Map())

  const startDwell = useCallback((id: string) => {
    dwellTimers.current.set(id, Date.now())
  }, [])

  const endDwell = useCallback((id: string, storyId?: string, longForm = false) => {
    const start = dwellTimers.current.get(id)
    if (!start) return
    const elapsed = (Date.now() - start) / 1000
    dwellTimers.current.delete(id)
    // Leaving the Reader for another screen unmounts every card, and each card's
    // teardown reports "still on screen". A full page load never sent those, and
    // they would skew ranking (a quick tap to Search = dwell_short on whatever
    // was visible), so only teardowns *inside* the Reader (tab switch, refresh)
    // count. See setViewActive.
    if (!viewActive.current) return
    // Measured as time on screen, not time reading — so the card is held in
    // place (see heldIds) rather than dropped from under the reader.
    if (elapsed > (longForm ? DWELL_LONG_SECONDS : DWELL_SHORT_SECONDS)) {
      sendEngagement('dwell_long', storyId)
      markRead(storyId, { hold: true }) // auto-mark-read after sufficient reading time
    } else if (elapsed < 3 && !(storyId && isRead(storyId))) {
      sendEngagement('dwell_short', storyId)
    }
  }, [sendEngagement, markRead, viewActive, isRead])

  return { startDwell, endDwell }
}
