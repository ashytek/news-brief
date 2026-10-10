import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PostgrestError } from '@supabase/supabase-js'
import type { Supabase } from './types'
import { loadFeed, saveFeed } from './feedCache'

const isStringArray = (d: unknown): d is string[] => Array.isArray(d) && d.every(x => typeof x === 'string')

/** Ids per DELETE when taking read marks back (keeps the request URL short). */
const UNDO_CHUNK = 100

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
  // True once the read marks have been fetched at least once. Anything that counts
  // unread stories (the catch-up trigger) must wait for it: before then every
  // story looks unread.
  const [loaded, setLoaded] = useState(false)

  const clearHeld = useCallback(() => setHeldIds(new Set()), [])

  // Load read item IDs once on mount — independent of active tab
  const loadReadIds = useCallback(async () => {
    // Ordered + capped: Supabase enforces a server-side row cap regardless
    // of .limit(), and an unordered query returns a nondeterministic subset
    // once past it. Ordering by most-recent-first means old reads are what
    // silently drop off (they may resurface as unread), not a random slice.
    const { data, status } = await supabase
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
      setLoaded(true)
      saveFeed('read_ids', Array.from(ids))
    } else if (status === 0) {
      // No answer at all (no signal): use the copy from the last time it worked, so a
      // saved feed doesn't show every story as unread. Never over what is already known.
      const saved = loadFeed('read_ids', isStringArray)
      if (saved) {
        setReadIds(prev => (prev.size > 0 ? prev : new Set(saved.data)))
        setLoaded(true)
      }
    }
  }, [supabase, userId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the query resolves
    if (enabled) loadReadIds()
  }, [enabled, loadReadIds])

  /** Resolves true if the story is now saved as read, false if the write failed
   *  (and was rolled back) or there was nothing to do. */
  const markRead = useCallback(async (storyId?: string, opts?: { hold?: boolean }): Promise<boolean> => {
    if (!storyId) return false
    if (readIds.has(storyId)) return false

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
      return false
    }
    return true
  }, [supabase, userId, readIds])

  // Batched version for "mark all as read" — the old implementation fired
  // one insert per item (up to ~200 concurrent requests on a full category).
  // Resolves the ids that were newly marked by this call (exactly what an Undo
  // needs to take back): empty when there was nothing to do, `null` when the
  // write failed and was rolled back.
  //
  // A multi-row insert is all-or-nothing, so one row that was already read
  // somewhere else (another tab, the phone) used to fail the whole batch with
  // 23505 and roll everything back (roadmap session 5). Now that error is
  // answered by asking which of the rows exist and inserting only the rest.
  // Rows that were already read stay read, and are not "newly marked", so an
  // Undo never takes back a mark this call did not make.
  const markManyRead = useCallback(async (storyIds: string[], opts?: { hold?: boolean }): Promise<string[] | null> => {
    const newStoryIds = [...new Set(storyIds)].filter(id => !readIds.has(id))
    if (newStoryIds.length === 0) return []

    setReadIds(prev => {
      const next = new Set(prev)
      newStoryIds.forEach(id => next.add(id))
      return next
    })
    if (opts?.hold) {
      setHeldIds(prev => {
        const next = new Set(prev)
        newStoryIds.forEach(id => next.add(id))
        return next
      })
    }
    const rollBack = (ids: string[]) => {
      if (ids.length === 0) return
      const drop = (set: Set<string>) => { const n = new Set(set); ids.forEach(id => n.delete(id)); return n }
      setReadIds(drop)
      if (opts?.hold) setHeldIds(drop)
    }

    const insert = (ids: string[]) => supabase.from('read_items').insert(ids.map(id => ({ user_id: userId, story_id: id })))
    let error: PostgrestError | null = (await insert(newStoryIds)).error
    let saved = newStoryIds
    if (error?.code === '23505') {
      // The ids travel in the URL, so ask in chunks (as the Undo does).
      const already = new Set<string>()
      let lookupError: PostgrestError | null = null
      for (let i = 0; i < newStoryIds.length && !lookupError; i += UNDO_CHUNK) {
        const { data, error: e } = await supabase
          .from('read_items')
          .select('story_id')
          .eq('user_id', userId)
          .in('story_id', newStoryIds.slice(i, i + UNDO_CHUNK))
        lookupError = e
        for (const r of data ?? []) already.add(r.story_id as string)
      }
      if (lookupError) {
        error = lookupError
      } else {
        saved = newStoryIds.filter(id => !already.has(id))
        error = saved.length === 0 ? null : (await insert(saved)).error
      }
    }
    if (error) {
      console.error('markManyRead failed', { count: newStoryIds.length, error })
      rollBack(newStoryIds)
      return null
    }
    return saved
  }, [supabase, userId, readIds])

  // Undo, and the card menu's "Mark unread": delete the rows. The RLS policy on
  // read_items covers all commands for the owner, so no migration is needed.
  // Resolves true when the rows are gone; on failure the read marks are restored.
  const markUnread = useCallback(async (storyIds: string[]): Promise<boolean> => {
    // No filtering on `readIds`: an Undo callback is created in the same render as
    // the mark itself, so its copy of `readIds` doesn't hold the new marks yet.
    // Deleting a row that isn't there is harmless.
    const ids = storyIds
    if (ids.length === 0) return true
    const drop = (set: Set<string>) => { const n = new Set(set); ids.forEach(id => n.delete(id)); return n }
    setReadIds(drop)
    setHeldIds(drop)
    // The ids travel in the URL (`story_id=in.(…)`), so a very long list goes in chunks.
    let failed = false
    for (let i = 0; i < ids.length; i += UNDO_CHUNK) {
      const { error } = await supabase.from('read_items').delete().eq('user_id', userId).in('story_id', ids.slice(i, i + UNDO_CHUNK))
      if (error) {
        console.error('markUnread failed', { count: ids.length, error })
        failed = true
        break
      }
    }
    if (failed) {
      setReadIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n })
      return false
    }
    return true
  }, [supabase, userId])

  // Read set for layout decisions only (filtering, sorting). Held cards are
  // treated as unread here so they stay put; `readIds` remains the truth for
  // isRead styling and counts.
  const layoutReadIds = useMemo(() => {
    if (heldIds.size === 0) return readIds
    const next = new Set(readIds)
    heldIds.forEach(id => next.delete(id))
    return next
  }, [readIds, heldIds])

  return { readIds, loaded, heldIds, layoutReadIds, clearHeld, loadReadIds, markRead, markManyRead, markUnread }
}
