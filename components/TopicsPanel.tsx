'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Source } from '@/lib/types'
import type { StoryWithRelations } from '@/lib/types'
import { SoloCard } from './SoloCard'
import { CATEGORY_LABELS, STORY_SELECT } from '@/lib/constants'

interface Props {
  userId: string
  readIds: Set<string>
  onMarkRead: (storyId?: string, clusterId?: string) => Promise<void>
  onEngagement: (signal: string, storyId?: string, clusterId?: string) => Promise<void>
}

export function TopicsPanel({ userId, readIds, onMarkRead, onEngagement }: Props) {
  const supabase = createClient()

  const [keywords, setKeywords] = useState<{ id: string; keyword: string; is_active: boolean }[]>([])
  const [stories, setStories] = useState<StoryWithRelations[]>([])
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [loading, setLoading] = useState(true)
  const [newKeyword, setNewKeyword] = useState('')
  const [adding, setAdding] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)

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
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const addKeyword = async () => {
    const kw = newKeyword.trim()
    if (!kw) return
    setAdding(true)
    await supabase.from('topic_keywords').insert({ keyword: kw, is_active: true })
    setNewKeyword('')
    await loadData()
    setAdding(false)
  }

  const toggleKeyword = async (id: string, is_active: boolean) => {
    await supabase.from('topic_keywords').update({ is_active: !is_active }).eq('id', id)
    setKeywords(prev => prev.map(k => k.id === id ? { ...k, is_active: !is_active } : k))
  }

  const deleteKeyword = async (id: string) => {
    await supabase.from('topic_keywords').delete().eq('id', id)
    setKeywords(prev => prev.filter(k => k.id !== id))
  }

  const activeKeywords = keywords.filter(k => k.is_active)
  const inactiveKeywords = keywords.filter(k => !k.is_active)

  return (
    <div className="space-y-4">
      {/* Keyword management */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/60">
          <h2 className="text-sm font-semibold text-white">Topic Watchlist</h2>
          <p className="text-xs text-gray-500 mt-0.5">Keywords flagged across all sources</p>
        </div>

        {/* Add keyword */}
        <div className="px-4 py-3 border-b border-gray-800/40">
          <div className="flex gap-2">
            <input
              type="text"
              value={newKeyword}
              onChange={e => setNewKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addKeyword()}
              placeholder="Add keyword… e.g. Gaza, GPT-5, RFK"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500"
            />
            <button
              onClick={addKeyword}
              disabled={adding || !newKeyword.trim()}
              className="px-3 py-2 bg-rose-600 hover:bg-rose-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {adding ? '…' : 'Add'}
            </button>
          </div>
        </div>

        {/* Active keywords */}
        {activeKeywords.length > 0 && (
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {activeKeywords.map(kw => (
              <span key={kw.id} className="flex items-center gap-1 bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs rounded-full px-2.5 py-1">
                {kw.keyword}
                <button
                  onClick={() => toggleKeyword(kw.id, kw.is_active)}
                  className="ml-0.5 text-rose-400 hover:text-rose-200 transition-colors"
                  title="Pause"
                >
                  ⏸
                </button>
                <button
                  onClick={() => deleteKeyword(kw.id)}
                  className="text-rose-500/60 hover:text-rose-400 transition-colors"
                  title="Remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Paused keywords */}
        {inactiveKeywords.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            <span className="text-xs text-gray-600 w-full">Paused:</span>
            {inactiveKeywords.map(kw => (
              <span key={kw.id} className="flex items-center gap-1 bg-gray-800 border border-gray-700 text-gray-500 text-xs rounded-full px-2.5 py-1">
                {kw.keyword}
                <button
                  onClick={() => toggleKeyword(kw.id, kw.is_active)}
                  className="ml-0.5 text-gray-500 hover:text-gray-300 transition-colors"
                  title="Resume"
                >
                  ▶
                </button>
                <button
                  onClick={() => deleteKeyword(kw.id)}
                  className="text-gray-600 hover:text-gray-400 transition-colors"
                  title="Remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {keywords.length === 0 && (
          <div className="px-4 pb-4 pt-1 text-xs text-gray-600">
            No keywords yet. Add one above to start tracking topics across all your sources.
          </div>
        )}
      </div>

      {/* Matched stories */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-5 h-5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : stories.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-3xl mb-3">🔍</div>
          <p className="text-gray-400 font-medium text-sm">No topic matches yet</p>
          <p className="text-gray-600 text-xs mt-1">
            Stories matching your keywords will appear here after the next pipeline run
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-600 px-1">{stories.length} matched stories</p>
          {stories.map(story => (
            <div key={story.id}>
              {/* Topic badges */}
              {story.matched_topics && story.matched_topics.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1 px-1">
                  <span className="text-xs text-gray-600">
                    {CATEGORY_LABELS[story.category] ?? story.category} ·
                  </span>
                  {story.matched_topics.map(t => (
                    <span key={t} className="text-xs bg-rose-500/15 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <SoloCard
                story={story}
                source={sources[story.source_id]}
                isRead={readIds.has(story.id)}
                onRead={() => onMarkRead(story.id)}
                onEngagement={(signal) => onEngagement(signal, story.id)}
                onDwellStart={() => {}}
                onDwellEnd={() => {}}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
