'use client'

import { useState, useEffect, useCallback } from 'react'
import { Hash, Pencil, Plus, TriangleAlert, Check, Inbox } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Source } from '@/lib/types'
import type { StoryWithRelations } from '@/lib/types'
import { STORY_SELECT } from '@/lib/constants'
import { Button, DividerLabel, StateMessage, cx } from '@/components/ui'
import { PageHead } from '@/components/shell/PageHead'
import { StoryListItem } from '@/components/story/StoryListItem'
import { StorySkeleton } from '@/components/story/StorySkeleton'
import { useStoryActions } from '@/components/story/useStoryActions'
import { useReader } from '@/lib/reader/ReaderProvider'

interface Keyword { id: string; keyword: string; is_active: boolean }

/** "Matched: war · middle east +2": the first two, then how many more. */
const matchedLabel = (topics: string[]) =>
  `Matched: ${topics.slice(0, 2).join(' · ')}${topics.length > 2 ? ` +${topics.length - 2}` : ''}`

/** The Topics tab: the watchlist as chips (Edit reveals pause/remove), an add
 *  field, and the latest stories that matched, as headline rows that open into
 *  the short card. */
export function TopicsPanel() {
  const supabase = createClient()
  const r = useReader()
  const actionsFor = useStoryActions()

  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [stories, setStories] = useState<StoryWithRelations[]>([])
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [loading, setLoading] = useState(true)
  const [newKeyword, setNewKeyword] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(false)

    const [kwRes, storyRes, sourceRes] = await Promise.all([
      supabase.from('topic_keywords').select('*').order('keyword'),
      supabase
        .from('stories')
        .select(STORY_SELECT)
        .not('matched_topics', 'is', null)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase.from('sources').select('*'),
    ])

    // A failed query used to fall through to "No topic matches yet", which
    // reads as a quiet week rather than a broken load.
    if (kwRes.error || storyRes.error || sourceRes.error) {
      console.error('TopicsPanel load failed', { kw: kwRes.error, stories: storyRes.error, sources: sourceRes.error })
      setLoadError(true)
    }

    if (kwRes.data) setKeywords(kwRes.data)

    if (storyRes.data) {
      const filtered = (storyRes.data as unknown as StoryWithRelations[]).filter(
        s => s.matched_topics && s.matched_topics.length > 0
      )
      setStories(filtered)
    }

    if (sourceRes.data) {
      const map: Record<string, Source> = {}
      sourceRes.data.forEach(s => { map[s.id] = s })
      setSources(map)
    }

    setLoading(false)
  }, [supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: loadData raises the loading flag, then awaits the queries
  useEffect(() => { loadData() }, [loadData])

  const addKeyword = async () => {
    const kw = newKeyword.trim()
    if (!kw) return
    setAdding(true)
    setErrorMsg(null)
    const { error } = await supabase.from('topic_keywords').insert({ keyword: kw, is_active: true })
    if (error) {
      console.error('addKeyword failed', { kw, error })
      setErrorMsg(error.code === '23505' ? `"${kw}" is already tracked` : 'Could not add the keyword. Try again.')
    } else {
      setNewKeyword('')
      await loadData()
    }
    setAdding(false)
  }

  // Optimistic update, reverted on failure — without this a failed write
  // (RLS denial, network error) left the UI showing a state that never
  // actually persisted, silently reappearing/disappearing on next load.
  const toggleKeyword = async (id: string, is_active: boolean) => {
    setErrorMsg(null)
    setKeywords(prev => prev.map(k => k.id === id ? { ...k, is_active: !is_active } : k))
    const { error } = await supabase.from('topic_keywords').update({ is_active: !is_active }).eq('id', id)
    if (error) {
      console.error('toggleKeyword failed', { id, error })
      setKeywords(prev => prev.map(k => k.id === id ? { ...k, is_active } : k))
      setErrorMsg('Could not update the keyword. Try again.')
    }
  }

  const deleteKeyword = async (id: string) => {
    setErrorMsg(null)
    const removed = keywords.find(k => k.id === id)
    setKeywords(prev => prev.filter(k => k.id !== id))
    const { error } = await supabase.from('topic_keywords').delete().eq('id', id)
    if (error) {
      console.error('deleteKeyword failed', { id, error })
      if (removed) setKeywords(prev => [...prev, removed].sort((a, b) => a.keyword.localeCompare(b.keyword)))
      setErrorMsg('Could not remove the keyword. Try again.')
    }
  }

  const active = keywords.filter(k => k.is_active)
  const paused = keywords.filter(k => !k.is_active)

  const keywordChip = (kw: Keyword) => (
    <li key={kw.id} className={cx('flex items-center rounded-control border border-hairline-strong', !kw.is_active && 'opacity-70')}>
      <span className={cx('px-3.5 text-sm font-medium leading-[34px]', kw.is_active ? 'text-fg-1' : 'text-fg-2')}>{kw.keyword}</span>
      {editing && (
        <>
          <button
            type="button"
            onClick={() => toggleKeyword(kw.id, kw.is_active)}
            className="min-h-11 px-2.5 text-sm font-semibold text-accent active:opacity-70"
            aria-label={`${kw.is_active ? 'Pause' : 'Resume'} ${kw.keyword}`}
          >
            {kw.is_active ? 'Pause' : 'Resume'}
          </button>
          <button
            type="button"
            onClick={() => deleteKeyword(kw.id)}
            className="min-h-11 pl-1 pr-3 text-sm font-semibold text-bad active:opacity-70"
            aria-label={`Remove ${kw.keyword}`}
          >
            Remove
          </button>
        </>
      )}
    </li>
  )

  return (
    <div>
      <PageHead
        title="Topics"
        meta={`${active.length} watching${r.topicCount > 0 ? ` · ${r.topicCount} matched stories this week` : ''}`}
      />

      {/* Add keyword */}
      <form
        onSubmit={e => { e.preventDefault(); void addKeyword() }}
        className="mt-3 flex items-center gap-2"
      >
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-panel bg-surface-2 px-3.5 focus-within:bg-surface-1 focus-within:ring-1 focus-within:ring-accent">
          <Hash className="size-5 flex-none text-fg-3" aria-hidden="true" />
          <input
            type="text"
            value={newKeyword}
            onChange={e => setNewKeyword(e.target.value)}
            placeholder="Add a topic to watch"
            aria-label="Add a topic to watch"
            className="min-w-0 flex-1 bg-transparent text-base text-fg-1 placeholder:text-fg-3 focus:outline-none"
          />
        </label>
        <Button type="submit" icon={Plus} loading={adding} disabled={!newKeyword.trim()}>Add</Button>
      </form>
      {errorMsg && <p role="alert" className="mt-2 text-sm text-bad">{errorMsg}</p>}

      {/* Watchlist */}
      {keywords.length > 0 && (
        <>
          <DividerLabel
            className="pt-6"
            action={
              <Button variant="text" icon={editing ? Check : Pencil} onClick={() => setEditing(v => !v)} aria-pressed={editing}>
                {editing ? 'Done' : 'Edit'}
              </Button>
            }
          >
            Watching
          </DividerLabel>
          <ul className="mt-2 flex flex-wrap gap-2">{active.map(keywordChip)}</ul>
          {paused.length > 0 && (
            <>
              <p className="t-overline mt-5">Paused</p>
              <ul className="mt-2 flex flex-wrap gap-2">{paused.map(keywordChip)}</ul>
            </>
          )}
        </>
      )}
      {!loading && keywords.length === 0 && (
        <p className="t-meta mt-4">No topics yet. Add one above to track it across all your sources.</p>
      )}

      {/* Matched stories */}
      <DividerLabel className="pt-6">Latest matches</DividerLabel>
      {loading ? (
        <StorySkeleton count={2} />
      ) : loadError ? (
        <StateMessage tone="error" icon={TriangleAlert} title="Couldn't load topics" action={{ label: 'Try again', onClick: loadData }}>
          Something went wrong fetching your watchlist and matches.
        </StateMessage>
      ) : stories.length === 0 ? (
        <StateMessage icon={Inbox} title="No topic matches yet">
          Stories matching your topics appear here after the next pipeline run.
        </StateMessage>
      ) : (
        <div>
          {stories.map(story => (
            <StoryListItem
              key={story.id}
              story={story}
              sourceName={sources[story.source_id]?.name}
              showCategory
              kickerExtra={matchedLabel(story.matched_topics ?? [])}
              actions={actionsFor(story)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
