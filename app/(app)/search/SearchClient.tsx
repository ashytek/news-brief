'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, Hash, Search, SearchX, TriangleAlert, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { StoryWithRelations, Source, Category } from '@/lib/types'
import { Chip, OptionSheet, StateMessage, cx } from '@/components/ui'
import { StoryListItem } from '@/components/story/StoryListItem'
import { StorySkeleton } from '@/components/story/StorySkeleton'
import { useStoryActions } from '@/components/story/useStoryActions'
import { CATEGORIES } from '@/lib/categories'

const DEBOUNCE_MS = 450

type DateFilter = '7d' | '30d' | 'all'
type CategoryFilter = 'all' | Category

const DATE_OPTIONS: { label: string; value: DateFilter }[] = [
  { label: 'Any time', value: 'all' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
]
const DATE_CHIP: Record<DateFilter, string> = { all: 'Any time', '7d': '7 days', '30d': '30 days' }

const CATEGORY_OPTIONS: { label: string; value: CategoryFilter }[] = [
  { label: 'All sections', value: 'all' },
  ...CATEGORIES.map(c => ({ label: c.label, value: c.key as CategoryFilter })),
]

const EXAMPLES = ['Strait of Hormuz', 'Jonathan Cahn', 'India currency', 'Gaza ceasefire']

interface SearchResult {
  results: StoryWithRelations[]
  mode?: 'hybrid' | 'semantic' | 'text'
}

export default function SearchClient() {
  const supabase = createClient()
  const actionsFor = useStoryActions()

  const [query,       setQuery]       = useState('')
  const [category,    setCategory]    = useState<CategoryFilter>('all')
  const [dateFilter,  setDateFilter]  = useState<DateFilter>('all')
  const [results,     setResults]     = useState<StoryWithRelations[] | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [searchMode,  setSearchMode]  = useState<string | null>(null)
  const [sources,     setSources]     = useState<Record<string, Source>>({})
  const [topics,      setTopics]      = useState<string[]>([])
  const [searchError, setSearchError] = useState(false)
  const [sheet,       setSheet]       = useState<'date' | 'category' | null>(null)

  const inputRef    = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cancels the in-flight request when a newer search supersedes it — without
  // this, a slow earlier query (e.g. "gaza") can resolve after a faster later
  // one (e.g. "gaza ceasefire") and overwrite its results.
  const abortRef    = useRef<AbortController | null>(null)

  // Autofocus the search box on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Sources (for the row kicker) and the watchlist (for the empty state), once
  useEffect(() => {
    supabase.from('sources').select('id, name, category, source_type, is_active').then(({ data }) => {
      if (data) {
        const map: Record<string, Source> = {}
        data.forEach(s => { map[s.id] = s as unknown as Source })
        setSources(map)
      }
    })
    supabase.from('topic_keywords').select('keyword').eq('is_active', true).order('keyword').limit(6)
      .then(({ data }) => { if (data) setTopics(data.map(k => k.keyword as string)) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = useCallback(async (q: string, cat: CategoryFilter, date: DateFilter) => {
    if (q.length < 2) {
      abortRef.current?.abort()
      setResults(null)
      setSearchMode(null)
      setSearchError(false)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setSearchError(false)
    try {
      const body: Record<string, unknown> = { query: q }
      if (cat  !== 'all') body.category = cat
      if (date !== 'all') body.daysBack  = date === '7d' ? 7 : 30

      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (res.ok) {
        const data: SearchResult = await res.json()
        setResults(data.results)
        setSearchMode(data.mode ?? null)
      } else {
        console.error('search request failed', res.status)
        setSearchError(true)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('search request errored', err)
        setSearchError(true)
      }
    } finally {
      // Guard: only the most recent request may clear loading — an aborted
      // superseded request's finally must not stomp on the newer one's state.
      if (abortRef.current === controller) {
        setLoading(false)
      }
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

  const hasResults  = results !== null && results.length > 0
  const emptySearch = results !== null && results.length === 0
  const categoryLabel = CATEGORY_OPTIONS.find(o => o.value === category)?.label ?? 'All sections'

  return (
    <div className="min-h-screen">
      {/* Field + filters: stuck to the top while results scroll */}
      <div className="sticky top-0 z-40 border-b border-hairline bg-canvas">
        <div className="mx-auto max-w-2xl px-gutter pb-2 pt-3">
          <label className="flex h-12 items-center gap-2.5 rounded-panel bg-surface-2 pl-3.5 pr-1 focus-within:bg-surface-1 focus-within:ring-1 focus-within:ring-accent">
            <Search className="size-5 flex-none text-fg-3" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              placeholder="Search 30 days of briefs"
              aria-label="Search stories"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="h-full min-w-0 flex-1 bg-transparent text-base text-fg-1 placeholder:text-fg-3 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); inputRef.current?.focus() }}
                aria-label="Clear search"
                className="grid size-11 flex-none place-items-center rounded-full text-fg-2 active:bg-surface-3"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            )}
          </label>
          <div className="mt-2 flex gap-2">
            <Chip selected={dateFilter !== 'all'} onClick={() => setSheet('date')} aria-haspopup="dialog" aria-pressed={undefined}>
              {DATE_CHIP[dateFilter]}<ChevronDown className="size-4" aria-hidden="true" />
            </Chip>
            <Chip selected={category !== 'all'} onClick={() => setSheet('category')} aria-haspopup="dialog" aria-pressed={undefined}>
              {categoryLabel}<ChevronDown className="size-4" aria-hidden="true" />
            </Chip>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-2xl px-gutter pb-[calc(var(--spacing-navbar)+env(safe-area-inset-bottom,0px)+1.5rem+var(--player-h,0px))]">
        {loading && <StorySkeleton count={3} />}

        {/* No query yet */}
        {!loading && results === null && !searchError && (
          <div className="pt-6">
            <p className="t-overline">Try</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map(ex => (
                <Chip key={ex} onClick={() => setQuery(ex)}>{ex}</Chip>
              ))}
            </div>
            {topics.length > 0 && (
              <>
                <p className="t-overline mt-8">Search by topic</p>
                <ul className="mt-3 overflow-hidden rounded-panel bg-surface-1">
                  {topics.map(t => (
                    <li key={t} className="border-b border-hairline last:border-b-0">
                      <button
                        type="button"
                        onClick={() => setQuery(t)}
                        className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] font-medium text-fg-1 active:bg-surface-2"
                      >
                        <Hash className="size-[18px] flex-none text-fg-3" aria-hidden="true" />
                        {t}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* Search failed — distinct from "no results" so a network/server
            error doesn't read as "nothing matched" */}
        {!loading && searchError && (
          <StateMessage tone="error" icon={TriangleAlert} title="Search failed">
            Check your connection and try again.
          </StateMessage>
        )}

        {!loading && !searchError && emptySearch && (
          <StateMessage icon={SearchX} title={`No stories found for "${query}"`}>
            Try broader terms or a different date range.
          </StateMessage>
        )}

        {!loading && hasResults && (
          <>
            <p className="t-meta py-3" aria-live="polite">
              {results.length} result{results.length !== 1 ? 's' : ''}
              {searchMode === 'hybrid' && ' · semantic + text'}
              {searchMode === 'semantic' && ' · semantic'}
              {searchMode === 'text' && ' · text match'}
            </p>
            <div className={cx('border-t border-hairline')}>
              {results.map(story => (
                <StoryListItem
                  key={story.id}
                  story={story}
                  sourceName={sources[story.source_id]?.name}
                  showCategory
                  highlight={query}
                  actions={actionsFor(story)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      <OptionSheet open={sheet === 'date'} onClose={() => setSheet(null)} title="Date" value={dateFilter} onChange={setDateFilter} options={DATE_OPTIONS} />
      <OptionSheet open={sheet === 'category'} onClose={() => setSheet(null)} title="Section" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
    </div>
  )
}
