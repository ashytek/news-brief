'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { StoryWithRelations, Source } from '@/lib/types'
import { SoloCard } from '@/components/SoloCard'
import {
  CATEGORY_LABELS,
  CATEGORY_TEXT_COLORS,
  CATEGORY_PILL_COLORS,
} from '@/lib/constants'

const DEBOUNCE_MS = 450

type DateFilter = '7d' | '30d' | 'all'
type CategoryFilter = 'all' | keyof typeof CATEGORY_LABELS

const DATE_OPTIONS: { label: string; value: DateFilter }[] = [
  { label: '7 days',  value: '7d'  },
  { label: '30 days', value: '30d' },
  { label: 'All time', value: 'all' },
]

const CATEGORY_OPTIONS: { label: string; value: CategoryFilter }[] = [
  { label: 'All',          value: 'all'          },
  { label: 'Prophetic',    value: 'prophetic'    },
  { label: 'Israel',       value: 'israel'       },
  { label: 'India/Global', value: 'india_global' },
  { label: 'Tech & AI',    value: 'tech_ai'      },
]

interface SearchResult {
  results: StoryWithRelations[]
  mode?: 'hybrid' | 'semantic' | 'text'
}

export default function SearchClient({ userId }: { userId: string }) {
  const supabase = createClient()

  const [query,       setQuery]       = useState('')
  const [category,    setCategory]    = useState<CategoryFilter>('all')
  const [dateFilter,  setDateFilter]  = useState<DateFilter>('all')
  const [results,     setResults]     = useState<StoryWithRelations[] | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [searchMode,  setSearchMode]  = useState<string | null>(null)
  const [readIds,     setReadIds]     = useState<Set<string>>(new Set())
  const [sources,     setSources]     = useState<Record<string, Source>>({})

  const inputRef    = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Autofocus the search box on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Load sources + read ids once
  useEffect(() => {
    supabase.from('sources').select('id, name, category, source_type, is_active').then(({ data }) => {
      if (data) {
        const map: Record<string, Source> = {}
        data.forEach(s => { map[s.id] = s as unknown as Source })
        setSources(map)
      }
    })
    supabase.from('read_items').select('story_id').eq('user_id', userId).then(({ data }) => {
      if (data) {
        const ids = new Set<string>()
        data.forEach(r => { if (r.story_id) ids.add(r.story_id) })
        setReadIds(ids)
      }
    })
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = useCallback(async (q: string, cat: CategoryFilter, date: DateFilter) => {
    if (q.length < 2) {
      setResults(null)
      setSearchMode(null)
      return
    }

    setLoading(true)
    try {
      const body: Record<string, unknown> = { query: q }
      if (cat  !== 'all') body.category = cat
      if (date !== 'all') body.daysBack  = date === '7d' ? 7 : 30

      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data: SearchResult = await res.json()
        setResults(data.results)
        setSearchMode(data.mode ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced search — fires when query or filters change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doSearch(query, category, dateFilter)
    }, DEBOUNCE_MS)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, category, dateFilter, doSearch])

  const markRead = useCallback(async (storyId: string) => {
    setReadIds(prev => new Set([...prev, storyId]))
    await supabase.from('read_items').upsert(
      { user_id: userId, story_id: storyId },
      { onConflict: 'user_id,story_id', ignoreDuplicates: true }
    )
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendEngagement = useCallback(async (storyId: string, signal: string) => {
    await supabase.from('engagement_events').insert({
      user_id: userId, story_id: storyId, signal,
    })
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasResults  = results !== null && results.length > 0
  const emptySearch = results !== null && results.length === 0

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur border-b border-gray-800/60">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* Back */}
          <a
            href="/reader"
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors flex-shrink-0"
            title="Back to feed"
          >
            <svg className="w-4 h-4 text-gray-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </a>

          {/* Search input */}
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              placeholder="Search stories…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-xl pl-9 pr-10 py-2.5 text-sm border border-gray-700 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); inputRef.current?.focus() }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-gray-600 hover:bg-gray-500 transition-colors"
                aria-label="Clear search"
              >
                <svg className="w-3 h-3 text-white" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Filter row */}
        <div className="max-w-2xl mx-auto px-4 pb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {/* Date filter */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {DATE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setDateFilter(opt.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  dateFilter === opt.value
                    ? 'bg-gray-600 text-white'
                    : 'bg-gray-800/60 text-gray-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-gray-700 flex-shrink-0" />

          {/* Category filter */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {CATEGORY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setCategory(opt.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  category === opt.value
                    ? opt.value === 'all'
                      ? 'bg-gray-600 text-white'
                      : `${CATEGORY_PILL_COLORS[opt.value as keyof typeof CATEGORY_PILL_COLORS]} border border-current/20`
                    : 'bg-gray-800/60 text-gray-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Results */}
      <main className="max-w-2xl mx-auto px-4 py-4 pb-24 md:pb-6 space-y-3">

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-2xl border border-gray-800 bg-gray-900 p-4 animate-pulse">
                <div className="h-3 w-1/4 bg-gray-800 rounded mb-3" />
                <div className="h-4 w-3/4 bg-gray-800 rounded mb-2" />
                <div className="h-3 w-full bg-gray-800 rounded mb-1" />
                <div className="h-3 w-5/6 bg-gray-800 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state — no query */}
        {!loading && results === null && (
          <div className="flex flex-col items-center justify-center pt-16 text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-500" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-400 font-medium">Search your story history</p>
              <p className="text-xs text-gray-600 mt-1">Names, countries, topics, events…</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {['Strait of Hormuz', 'Jonathan Cahn', 'India currency', 'Gaza ceasefire'].map(ex => (
                <button
                  key={ex}
                  onClick={() => setQuery(ex)}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* No results */}
        {!loading && emptySearch && (
          <div className="flex flex-col items-center justify-center pt-16 text-center gap-2">
            <p className="text-sm text-gray-400">No stories found for <span className="text-white">"{query}"</span></p>
            <p className="text-xs text-gray-600">Try broader terms or a different date range</p>
          </div>
        )}

        {/* Results list */}
        {!loading && hasResults && (
          <>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-gray-500">
                {results.length} result{results.length !== 1 ? 's' : ''}
                {searchMode === 'hybrid'   && <span className="ml-1 text-violet-500">· semantic+FTS</span>}
                {searchMode === 'semantic' && <span className="ml-1 text-violet-500">· semantic</span>}
                {searchMode === 'text'     && <span className="ml-1 text-gray-600">· text match</span>}
              </p>
            </div>

            {results.map(story => {
              const source = sources[story.source_id]
              const catKey = story.category as keyof typeof CATEGORY_TEXT_COLORS
              return (
                <div key={story.id}>
                  {/* Category badge above card */}
                  <p className={`text-xs font-medium mb-1 ${CATEGORY_TEXT_COLORS[catKey] ?? 'text-gray-400'}`}>
                    {CATEGORY_LABELS[catKey] ?? story.category}
                  </p>
                  <SoloCard
                    story={story}
                    source={source}
                    isRead={readIds.has(story.id)}
                    onRead={() => markRead(story.id)}
                    onEngagement={(sig) => sendEngagement(story.id, sig)}
                    onDwellStart={() => {}}
                    onDwellEnd={() => {}}
                  />
                </div>
              )
            })}
          </>
        )}
      </main>
    </div>
  )
}
