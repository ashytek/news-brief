import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Supabase } from './types'

/** Which stories are read, plus the "held" subset (see below) and the writes
 *  that change them. */
export function useReadState(supabase: Supabase, userId: string, enabled: boolean) {
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  // Stories the dwell timer auto-marked read while they were on screen.
  // They count as read (card greys out, unread count drops) but are held in
  // place — not filtered out or re-sorted to the bottom — until the next
  // content load or Unread/All toggle. Without this, a card being read
  // past the dwell threshold was unmounted the moment it scrolled below
  // half-visible, pulling everything under it up (Ash, 3 & 14 Sep 2026).
  const [heldIds, setHeldIds] = useState<Set<string>>(new Set())

  const clearHeld = useCallback(() => setHeldIds(new Set()), [])

  // Load read item IDs once on mount — independent of active tab
  const loadReadIds = useCallback(async () => {
    // Ordered + capped: Supabase enforces a server-side row cap regardless
    // of .limit(), and an unordered query returns a nondeterministic subset
    // once past it. Ordering by most-recent-first means old reads are what
    // silently drop off (they may resurface as unread), not a random slice.
    const { data } = await supabase
      .from('read_items')
      .select('story_id, cluster_id')
      .eq('user_id', userId)
      .order('read_at', { ascending: false })
      .limit(2000)
    if (data) {
      const ids = new Set<string>()
      data.forEach(r => {
        if (r.story_id) ids.add(r.story_id)
        if (r.cluster_id) ids.add(r.cluster_id)
      })
      setReadIds(ids)
    }
  }, [supabase, userId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the query resolves
    if (enabled) loadReadIds()
  }, [enabled, loadReadIds])

  const markRead = useCallback(async (storyId?: string, opts?: { hold?: boolean }) => {
    if (!storyId) return
    if (readIds.has(storyId)) return

    // Optimistic update first so the UI reacts even if the network is slow
    setReadIds(prev => new Set(prev).add(storyId))
    if (opts?.hold) setHeldIds(prev => new Set(prev).add(storyId))

    // Plain insert — Postgres unique index (user_id,story_id) prevents real
    // duplicates. PostgREST's `upsert(... onConflict)` was failing silently
    // because the constraint name lookup didn't resolve, so writes were
    // being lost. We tolerate the 23505 duplicate-key error explicitly
    // (which only happens in rare cross-tab races).
    const { error } = await supabase.from('read_items').insert({
      user_id: userId,
      story_id: storyId,
    })
    if (error && error.code !== '23505') {
      console.error('markRead failed', { storyId, error })
      // Roll back so the card isn't shown as read when the DB disagrees.
      setReadIds(prev => { const n = new Set(prev); n.delete(storyId); return n })
      if (opts?.hold) setHeldIds(prev => { const n = new Set(prev); n.delete(storyId); return n })
    }
  }, [supabase, userId, readIds])

  // Batched version for "mark all as read" — the old implementation fired
  // one insert per item (up to ~200 concurrent requests on a full category).
  const markManyRead = useCallback(async (storyIds: string[]) => {
    const newStoryIds = storyIds.filter(id => !readIds.has(id))
    if (newStoryIds.length === 0) return

    setReadIds(prev => {
      const next = new Set(prev)
      newStoryIds.forEach(id => next.add(id))
      return next
    })

    const rows = newStoryIds.map(id => ({ user_id: userId, story_id: id }))
    const { error } = await supabase.from('read_items').insert(rows)
    if (error) {
      // A multi-row insert is all-or-nothing, so any error means none of
      // these were saved — roll all of them back.
      console.error('markManyRead failed', { count: rows.length, error })
      setReadIds(prev => {
        const next = new Set(prev)
        newStoryIds.forEach(id => next.delete(id))
        return next
      })
    }
  }, [supabase, userId, readIds])

  // Read set for layout decisions only (filtering, sorting). Held cards are
  // treated as unread here so they stay put; `readIds` remains the truth for
  // isRead styling and counts.
  const layoutReadIds = useMemo(() => {
    if (heldIds.size === 0) return readIds
    const next = new Set(readIds)
    heldIds.forEach(id => next.delete(id))
    return next
  }, [readIds, heldIds])

  return { readIds, heldIds, layoutReadIds, clearHeld, loadReadIds, markRead, markManyRead }
}
