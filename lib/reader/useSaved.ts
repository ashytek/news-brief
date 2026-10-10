import { useCallback, useEffect, useState } from 'react'
import type { StoryWithRelations } from '@/lib/types'
import type { Supabase } from './types'

/**
 * Save for later (roadmap session 8): the ids you have saved, and the write that toggles
 * one. The table (supabase/migrations/saved_items.sql) is created by Ash, so the feature
 * is **fail-soft**: until the first read succeeds `available` is false and no Save button
 * is shown anywhere, so the web app can be deployed before or after the migration.
 *
 * `say` shows a snackbar message (the provider passes its own).
 */
export function useSaved(supabase: Supabase, userId: string, enabled: boolean, say: (message: string) => void) {
  const [ids, setIds] = useState<Set<string>>(new Set())
  const [available, setAvailable] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('saved_items')
      .select('story_id')
      .eq('user_id', userId)
      .order('saved_at', { ascending: false })
      .limit(2000)
    if (error || !data) {
      // PGRST205 / 42P01: the table isn't there yet. Anything else (no signal): keep what we know.
      if (error && error.code !== 'PGRST205' && error.code !== '42P01' && error.message) console.warn('saved items unavailable', error.message)
      return
    }
    setIds(new Set(data.map(r => r.story_id as string)))
    setAvailable(true)
  }, [supabase, userId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the query resolves
    if (enabled) load()
  }, [enabled, load])

  /** Save the story, or take it off the list. Optimistic, rolled back (with a message) if the write fails. */
  const toggle = useCallback(async (story: StoryWithRelations): Promise<boolean> => {
    const was = ids.has(story.id)
    setIds(prev => { const n = new Set(prev); if (was) n.delete(story.id); else n.add(story.id); return n })
    const { error } = was
      ? await supabase.from('saved_items').delete().eq('user_id', userId).eq('story_id', story.id)
      : await supabase.from('saved_items').insert({ user_id: userId, story_id: story.id })
    if (error && error.code !== '23505') {
      console.error('toggle save failed', { storyId: story.id, error })
      setIds(prev => { const n = new Set(prev); if (was) n.add(story.id); else n.delete(story.id); return n })
      say(was ? "Couldn't remove it from saved. Try again." : "Couldn't save it. Try again.")
      return false
    }
    say(was ? 'Removed from saved' : 'Saved for later. Mark all read leaves it unread.')
    return true
  }, [ids, supabase, userId, say])

  return { ids, available, toggle, reload: load }
}
