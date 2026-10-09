'use client'

import { useState, useEffect, useCallback } from 'react'
import { CalendarDays, Inbox, TriangleAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { StoryWithRelations, Source } from '@/lib/types'
import { STORY_SELECT } from '@/lib/constants'
import { Chip, StateMessage, cx } from '@/components/ui'
import { PageHead } from '@/components/shell/PageHead'
import { TopBar } from '@/components/shell/TopBar'
import { StoryListItem } from '@/components/story/StoryListItem'
import { StorySkeleton } from '@/components/story/StorySkeleton'
import { useStoryActions } from '@/components/story/useStoryActions'
import { CATEGORIES } from '@/lib/categories'

// Local-time date math, not UTC — toISOString()/'Z' boundaries bucket by UTC
// days, which during BST (UTC+1) misclassifies stories published 00:00-01:00
// local time into the wrong day, and "yesterday" resolves one day further
// back than intended when opened between local midnight and 1am.
function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toDateStart(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString()
}

function toDateEnd(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return formatDate(d)
}

/** Noon UTC on a local calendar day: formatting it can't slip into the next/previous day. */
const noon = (dateStr: string) => new Date(dateStr + 'T12:00:00Z')

const STRIP_DAYS = 6

export default function ArchiveClient() {
  const supabase = createClient()
  const actionsFor = useStoryActions()

  const today = formatDate(new Date())
  const yesterday = shiftDate(today, -1)

  const [selectedDate, setSelectedDate] = useState(yesterday)
  const [stories, setStories] = useState<StoryWithRelations[]>([])
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [filterCategory, setFilterCategory] = useState<string>('all')

  // Load sources
  useEffect(() => {
    supabase.from('sources').select('*').then(({ data }) => {
      if (data) {
        const map: Record<string, Source> = {}
        data.forEach(s => { map[s.id] = s })
        setSources(map)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadStories = useCallback(async (date: string) => {
    setLoading(true)
    setLoadError(false)
    const { data, error } = await supabase
      .from('stories')
      .select(STORY_SELECT)
      .gte('created_at', toDateStart(date))
      .lte('created_at', toDateEnd(date))
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      // Distinct from an empty day — otherwise a failed fetch reads as
      // "No stories on this date".
      console.error('archive loadStories failed', { date, error })
      setStories([])
      setLoadError(true)
    } else {
      setStories((data as unknown as StoryWithRelations[]) ?? [])
    }
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-change: loadStories raises the loading flag, then awaits the query
    loadStories(selectedDate)
  }, [selectedDate, loadStories])

  // The last six days, newest first: yesterday and back (today is the Today tab).
  const strip = Array.from({ length: STRIP_DAYS }, (_, i) => shiftDate(today, -1 - i))

  const grouped = CATEGORIES.reduce<Record<string, number>>((acc, { key }) => {
    acc[key] = stories.filter(s => s.category === key).length
    return acc
  }, {})
  const filtered = filterCategory === 'all' ? stories : stories.filter(s => s.category === filterCategory)

  const dayLabel = noon(selectedDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

  return (
    <div className="min-h-screen">
      <TopBar />

      <main className="mx-auto max-w-2xl px-gutter pb-[calc(var(--spacing-navbar)+env(safe-area-inset-bottom,0px)+1.5rem)]">
        <PageHead title="Archive" meta={`${dayLabel} · ${loading ? '…' : stories.length} stories`} />

        {/* Day strip */}
        <div role="group" aria-label="Day" className="mt-3 grid grid-cols-7 gap-1.5">
          {strip.map(date => {
            const d = noon(date)
            const on = date === selectedDate
            return (
              <button
                key={date}
                type="button"
                aria-pressed={on}
                aria-label={d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
                onClick={() => { setSelectedDate(date); setFilterCategory('all') }}
                className={cx(
                  'flex h-16 min-w-0 flex-col items-center justify-center gap-0.5 rounded-panel border',
                  on ? 'border-transparent bg-accent-soft' : 'border-hairline-strong',
                )}
              >
                <span className={cx('text-xs font-medium leading-4', on ? 'text-accent' : 'text-fg-2')}>
                  {d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}
                </span>
                <span className="text-lg font-semibold leading-6 tabular-nums text-fg-1">{d.getUTCDate()}</span>
              </button>
            )
          })}
          {/* Any other day: the native date picker, laid invisibly over the button */}
          <label className="relative grid h-16 min-w-0 cursor-pointer place-items-center rounded-panel border border-hairline-strong text-fg-2 focus-within:outline-2 focus-within:outline-accent">
            <CalendarDays className="size-6" aria-hidden="true" />
            <input
              type="date"
              value={selectedDate}
              max={yesterday}
              aria-label="Pick a date"
              onChange={e => { if (e.target.value) { setSelectedDate(e.target.value); setFilterCategory('all') } }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>

        {/* Category filter chips */}
        {stories.length > 0 && (
          <div role="group" aria-label="Section" className="scrollbar-hide -mx-gutter flex gap-2 overflow-x-auto px-gutter py-3">
            <Chip selected={filterCategory === 'all'} count={stories.length} onClick={() => setFilterCategory('all')}>All</Chip>
            {CATEGORIES.filter(c => grouped[c.key] > 0).map(c => (
              <Chip key={c.key} selected={filterCategory === c.key} count={grouped[c.key]} onClick={() => setFilterCategory(c.key)}>
                {c.label}
              </Chip>
            ))}
          </div>
        )}

        {loading ? (
          <StorySkeleton count={3} />
        ) : loadError ? (
          <StateMessage tone="error" icon={TriangleAlert} title="Couldn't load this date" action={{ label: 'Try again', onClick: () => loadStories(selectedDate) }}>
            Something went wrong fetching stories. Check your connection and try again.
          </StateMessage>
        ) : filtered.length === 0 ? (
          <StateMessage icon={Inbox} title="No stories on this date">
            Try a different day. The pipeline only keeps stories from its lookback window.
          </StateMessage>
        ) : (
          <div className="border-t border-hairline">
            {filtered.map(story => (
              <StoryListItem
                key={story.id}
                story={story}
                sourceName={sources[story.source_id]?.name}
                showCategory
                actions={actionsFor(story)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
