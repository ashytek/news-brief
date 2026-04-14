'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Source } from '@/lib/types'

const CATEGORY_LABELS: Record<string, string> = {
  prophetic:    'Prophetic',
  israel:       'Israel',
  india_global: 'India & Global',
  tech_ai:      'Tech & AI',
}

const CATEGORY_COLORS: Record<string, string> = {
  prophetic:    'text-violet-400 bg-violet-500/10 border-violet-500/20',
  israel:       'text-blue-400 bg-blue-500/10 border-blue-500/20',
  india_global: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  tech_ai:      'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
}

const LOOKBACK_OPTIONS = [
  { label: '24h', value: 24 },
  { label: '48h', value: 48 },
  { label: '72h', value: 72 },
  { label: '1 week', value: 168 },
]

interface PipelineRun {
  id: string
  started_at: string
  finished_at: string | null
  status: string
  sources_checked: number
  videos_found: number
  transcripts_fetched: number
  stories_created: number
}

interface Props {
  sources: Source[]
  recentRuns: PipelineRun[]
}

function HealthDot({ failures }: { failures: number }) {
  if (failures === 0) return <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
  if (failures < 3)   return <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
  return                     <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
}

/** Parse a YouTube channel URL into a channel identifier for the DB. */
function parseYouTubeInput(raw: string): { channelId: string; suggestedName: string } | null {
  const s = raw.trim()
  if (!s) return null

  // Match handle from URL: youtube.com/@Handle or just @Handle
  const handleMatch = s.match(/(?:youtube\.com\/)?@([\w.-]+)/)
  if (handleMatch) {
    const handle = handleMatch[1]
    return { channelId: `HANDLE:@${handle}`, suggestedName: handle }
  }

  // Match /channel/UCxxxxxx
  const channelMatch = s.match(/\/channel\/(UC[\w-]+)/)
  if (channelMatch) {
    const id = channelMatch[1]
    return { channelId: id, suggestedName: id.slice(0, 12) }
  }

  // If it looks like a bare UC... ID
  if (/^UC[\w-]{18,}$/.test(s)) {
    return { channelId: s, suggestedName: s.slice(0, 12) }
  }

  // Treat as a handle if no URL prefix
  if (/^[\w.-]+$/.test(s)) {
    return { channelId: `HANDLE:@${s}`, suggestedName: s }
  }

  return null
}

function AddSourceForm({ onAdded }: { onAdded: () => void }) {
  const supabase = createClient()

  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>('tech_ai')
  const [lookback, setLookback] = useState(24)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const parsed = parseYouTubeInput(url)

  const handleUrlChange = (v: string) => {
    setUrl(v)
    setError(null)
    setSuccess(false)
    const p = parseYouTubeInput(v)
    if (p && !name) setName(p.suggestedName)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!parsed) { setError('Paste a YouTube channel URL or @handle'); return }
    if (!name.trim()) { setError('Name is required'); return }

    setSaving(true)
    const { error: err } = await supabase.from('sources').insert({
      name: name.trim(),
      category,
      source_type: 'youtube_channel',
      youtube_channel_id: parsed.channelId,
      lookback_hours: lookback,
      is_active: true,
    })
    setSaving(false)

    if (err) {
      setError(err.message)
    } else {
      setSuccess(true)
      setUrl('')
      setName('')
      setCategory('tech_ai')
      setLookback(24)
      onAdded()
    }
  }

  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add YouTube Channel</h2>
      <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        {/* URL input */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Channel URL or @handle</label>
          <input
            type="text"
            value={url}
            onChange={e => handleUrlChange(e.target.value)}
            placeholder="https://youtube.com/@FirstpostVantage"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500"
          />
          {parsed && (
            <p className="text-xs text-emerald-400 mt-1">
              ✓ Detected: <code className="font-mono">{parsed.channelId}</code>
            </p>
          )}
          {url && !parsed && (
            <p className="text-xs text-amber-400 mt-1">Couldn't parse — try pasting a youtube.com/@handle URL</p>
          )}
        </div>

        {/* Name + category row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Display name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Channel name"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Lookback */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Lookback window</label>
          <div className="flex gap-2">
            {LOOKBACK_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLookback(opt.value)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  lookback === opt.value
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-1">
            {lookback === 168
              ? 'Good for weekly channels (e.g. Prophetic)'
              : lookback >= 48
              ? 'Good for daily/frequent channels'
              : 'Standard — checks last 24 hours'}
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            ✓ Source added! It will be picked up on the next pipeline run.
          </p>
        )}

        <button
          type="submit"
          disabled={saving || !url || !name.trim()}
          className="w-full py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-xl transition-all"
        >
          {saving ? 'Adding…' : 'Add source'}
        </button>
      </form>
    </section>
  )
}

export default function SourcesClient({ sources: initialSources, recentRuns }: Props) {
  const [sources, setSources] = useState(initialSources)
  const supabase = createClient()

  const refreshSources = async () => {
    const { data } = await supabase.from('sources').select('*').order('category').order('name')
    if (data) setSources(data as Source[])
  }

  const byCategory = Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
    key,
    label,
    sources: sources.filter(s => s.category === key),
  }))

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
            <h1 className="text-sm font-bold text-white">Sources</h1>
            <p className="text-xs text-gray-500">{sources.length} monitored feeds</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        {/* Add source form */}
        <AddSourceForm onAdded={refreshSources} />

        {/* Pipeline health */}
        {recentRuns.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Pipeline Runs</h2>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {recentRuns.map((run, i) => (
                <div key={run.id} className={`flex items-center gap-3 px-4 py-3 ${i < recentRuns.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    run.status === 'success' ? 'bg-emerald-500' :
                    run.status === 'partial' ? 'bg-amber-500' :
                    run.status === 'failed'  ? 'bg-red-500' :
                    'bg-gray-500 animate-pulse'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-medium">
                      {new Date(run.started_at).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
                    </p>
                    <p className="text-xs text-gray-500">
                      {run.videos_found} videos · {run.stories_created} stories
                    </p>
                  </div>
                  <span className={`text-xs font-medium capitalize ${
                    run.status === 'success' ? 'text-emerald-400' :
                    run.status === 'partial' ? 'text-amber-400' :
                    run.status === 'failed'  ? 'text-red-400' :
                    'text-gray-400'
                  }`}>
                    {run.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Sources by category */}
        {byCategory.map(cat => (
          <section key={cat.key}>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {cat.label} <span className="text-gray-700">· {cat.sources.length}</span>
            </h2>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {cat.sources.length === 0 ? (
                <div className="px-4 py-3 text-xs text-gray-600">No sources yet</div>
              ) : cat.sources.map((source, i) => (
                <div key={source.id} className={`flex items-center gap-3 px-4 py-3 ${i < cat.sources.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                  <HealthDot failures={source.consecutive_failures} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{source.name}</p>
                    <p className="text-xs text-gray-600 capitalize">
                      {source.source_type.replace(/_/g, ' ')}
                      {source.last_success_at && (
                        <> · Last ok {new Date(source.last_success_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</>
                      )}
                      {!source.last_success_at && ' · Not yet checked'}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[cat.key]}`}>
                    {source.consecutive_failures > 0 ? `${source.consecutive_failures} fail${source.consecutive_failures > 1 ? 's' : ''}` : 'OK'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
