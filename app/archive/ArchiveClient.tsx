'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { StoryWithRelations, Source } from '@/lib/types'
import { SoloCard } from '@/components/SoloCard'
import {
  CATEGORY_LABELS,
  CATEGORY_TEXT_COLORS,
  STORY_SELECT,
} from '@/lib/constants'

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function toDateStart(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`
}

function toDateEnd(dateStr: string): string {
  return `${dateStr}T23:59:59.999Z`
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return formatDate(d)
}

interface Props {
  userId: string
}

export default function ArchiveClient({ userId }: Props) {
  const supabase = createClient()

  const today = formatDate(new Date())
  const yesterday = shiftDate(today, -1)

  const [selectedDate, setSelectedDate] = useState(yesterday)
  const [stories, setStories] = useState<StoryWithRelations[]>([])
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
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
    supabase.from('read_items').select('story_id').eq('user_id', userId).then(({ data }) => {
      if (data) {
        const ids = new Set<string>()
        data.forEach(r => { if (r.story_id) ids.add(r.story_id) })
        setReadIds(ids)
      }
    })
  }, [userId])

  const loadStories = useCallback(async (date: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('stories')
      .select(STORY_SELECT)
      .gte('created_at', toDateStart(date))
      .lte('created_at', toDateEnd(date))
      .order('created_at', { ascending: false })
      .limit(100)

    setStories((data as unknown as StoryWithRelations[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    loadStories(selectedDate)
  }, [selectedDate, loadStories])

  const markRead = async (storyId?: string) => {
    if (!storyId || readIds.has(storyId)) return
    // Optimistic update
    setReadIds(prev => { const n = new Set(prev); n.add(storyId); return n })
    const { error } = await supabase.from('read_items').insert({
      user_id: userId,
      story_id: storyId,
      cluster_id: null,
    })
    if (error && error.code !== '23505') {
      console.error('archive markRead failed', { storyId, error })
    }
  }

  // Quick date buttons
  const quickDates = [
    { label: 'Yesterday', date: yesterday },
    { label: '2 days ago', date: shiftDate(today, -2) },
    { label: '3 days ago', date: shiftDate(today, -3) },
    { label: '1 week ago', date: shiftDate(today, -7) },
  ]

  // Group by category
  const categories = ['all', 'prophetic', 'israel', 'india_global', 'tech_ai']
  const filtered = filterCategory === 'all'
    ? stories
    : stories.filter(s => s.category === filterCategory)

  const grouped = Object.entries(CATEGORY_LABELS).reduce<Record<string, StoryWithRelations[]>>((acc, [key]) => {
    acc[key] = stories.filter(s => s.category === key)
    return acc
  }, {})

  const displayStories = filterCategory === 'all' ? stories : filtered

  const dateLabel = selectedDate === yesterday
    ? 'Yesterday'
    : selectedDate === shiftDate(today, -2)
    ? '2 days ago'
    : selectedDate === shiftDate(today, -3)
    ? '3 days ago'
    : new Date(selectedDate + 'T12:00:00Z').toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long'
      })

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur border-b border-gray-800/60">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <a
            href="/reader"
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </a>
          <div>
            <h1 className="text-sm font-bold text-white">Archive</h1>
            <p className="text-xs text-gray-500">{dateLabel} · {stories.length} stories</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Date controls */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
          {/* Quick buttons */}
          <div className="flex flex-wrap gap-2">
            {quickDates.map(({ label, date }) => (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedDate === date
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Date picker */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 flex-shrink-0">Or pick a date:</label>
            <input
              type="date"
              value={selectedDate}
              max={yesterday}
              onChange={e => setSelectedDate(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500"
            />
          </div>
        </div>

        {/* Category filter pills */}
        {stories.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => {
              const count = cat === 'all' ? stories.length : (grouped[cat]?.length ?? 0)
              if (cat !== 'all' && count === 0) return null
              return (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                    filterCategory === cat
                      ? cat === 'all'
                        ? 'bg-gray-700 text-white border-gray-600'
                        : `bg-gray-800 border-gray-700 ${CATEGORY_TEXT_COLORS[cat as keyof typeof CATEGORY_TEXT_COLORS] ?? ''}`
                      : 'bg-transparent border-gray-800 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {cat === 'all' ? 'All' : CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS]} ({count})
                </button>
              )
            })}
          </div>
        )}

        {/* Stories */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : displayStories.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-gray-400 font-medium">No stories on this date</p>
            <p className="text-gray-600 text-sm mt-1">
              Try a different date — the pipeline only stores stories from the selected lookback window
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayStories.map(story => (
              <SoloCard
                key={story.id}
                story={story}
                source={sources[story.source_id]}
                isRead={readIds.has(story.id)}
                onRead={() => markRead(story.id)}
                onEngagement={() => {}}
                onDwellStart={() => {}}
                onDwellEnd={() => {}}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
