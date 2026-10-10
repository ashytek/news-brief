'use client'

import { useState } from 'react'
import { CircleCheck, CircleX, LoaderCircle, Plus, TriangleAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Source } from '@/lib/types'
import { BackLink } from '@/components/nav/AppNav'
import { CATEGORIES } from '@/lib/categories'
import { Button, IconButton, LocalTime, Sheet, cx } from '@/components/ui'
import { RunNow } from '@/components/shell/StatusSheet'
import { useReader } from '@/lib/reader/ReaderProvider'
import { describePipeline } from '@/lib/reader/pipelineStatus'
import { useSourceStats } from '@/lib/reader/useSourceStats'
import { describeSourceStat, type SourceStat } from '@/lib/reader/sourceStats'


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

/** Health as a dot plus words for the screen reader: never colour alone. */
function HealthDot({ failures }: { failures: number }) {
  const [tone, label] = failures === 0 ? ['bg-ok', 'Healthy'] : failures < 3 ? ['bg-warn', 'Some failures'] : ['bg-bad', 'Failing']
  return (
    <>
      <span aria-hidden="true" className={cx('size-2 flex-none rounded-full', tone)} />
      <span className="sr-only">{label}</span>
    </>
  )
}

const FIELD = 'h-12 w-full rounded-panel bg-surface-2 px-3.5 text-base text-fg-1 placeholder:text-fg-3 focus:bg-surface-1 focus:outline-none focus:ring-1 focus:ring-accent'
const LABEL = 't-label mb-1.5 block text-fg-2'

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
    <form onSubmit={handleSubmit} className="space-y-4 pb-2 pt-3">
      {/* URL input */}
      <div>
        <label htmlFor="src-url" className={LABEL}>Channel URL or @handle</label>
        <input
          id="src-url"
          type="text"
          value={url}
          onChange={e => handleUrlChange(e.target.value)}
          placeholder="https://youtube.com/@FirstpostVantage"
          className={FIELD}
        />
        {parsed && (
          <p className="t-meta mt-1.5 text-ok">
            Detected: <code className="font-mono">{parsed.channelId}</code>
          </p>
        )}
        {url && !parsed && (
          <p className="t-meta mt-1.5 text-warn">Couldn&apos;t parse. Try pasting a youtube.com/@handle URL.</p>
        )}
      </div>

      {/* Name + category */}
      <div>
        <label htmlFor="src-name" className={LABEL}>Display name</label>
        <input
          id="src-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Channel name"
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor="src-cat" className={LABEL}>Category</label>
        <select id="src-cat" value={category} onChange={e => setCategory(e.target.value)} className={FIELD}>
          {CATEGORIES.map(c => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Lookback */}
      <div>
        <p className={LABEL} id="src-lookback">Lookback window</p>
        <div role="group" aria-labelledby="src-lookback" className="grid grid-cols-4 gap-2">
          {LOOKBACK_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={lookback === opt.value}
              onClick={() => setLookback(opt.value)}
              className={cx(
                'min-h-11 rounded-control text-sm font-medium',
                lookback === opt.value ? 'bg-accent-soft text-fg-1' : 'border border-hairline-strong text-fg-2',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="t-meta mt-1.5">
          {lookback === 168
            ? 'Good for weekly channels (e.g. Prophetic)'
            : lookback >= 48
            ? 'Good for daily/frequent channels'
            : 'Standard: checks the last 24 hours'}
        </p>
      </div>

      {error && <p role="alert" className="rounded-control bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {success && (
        <p role="status" className="rounded-control bg-ok/10 px-3 py-2 text-sm text-ok">
          Source added. It will be picked up on the next pipeline run.
        </p>
      )}

      <Button type="submit" block loading={saving} disabled={!url || !name.trim()}>
        {saving ? 'Adding…' : 'Add source'}
      </Button>
    </form>
  )
}

const NO_STORIES: SourceStat = { stories: 0, read: 0, likes: 0, dislikes: 0 }

/** "18 of 40 read · 3 liked · weight 1.2": what the source is worth to you (nothing while loading). */
function StatLine({ stat, weight }: { stat?: SourceStat; weight?: number }) {
  const text = describeSourceStat(stat, weight)
  return text ? <p className="t-meta">{text}</p> : null
}

const SOURCE_TYPE: Record<string, string> = {
  youtube_channel: 'YouTube channel',
  google_news_rss: 'News feed',
  website_scrape: 'Website',
}

const STATUS: Record<string, { word: string; tone: string; icon: typeof CircleCheck }> = {
  success: { word: 'Success', tone: 'text-ok', icon: CircleCheck },
  partial: { word: 'Partial', tone: 'text-warn', icon: TriangleAlert },
  failed: { word: 'Failed', tone: 'text-bad', icon: CircleX },
}

export default function SourcesClient({ sources: initialSources, recentRuns }: Props) {
  const [sources, setSources] = useState(initialSources)
  const [adding, setAdding] = useState(false)
  const supabase = createClient()
  const r = useReader()
  // What each source is worth to you: read rate, likes, ranking weight (last 30 days).
  const { stats, weights } = useSourceStats(supabase, r.userId, r.readIds, r.readLoaded)
  const last = recentRuns[0]
  // The provider's health loads a moment after a cold open; the server already
  // sent the recent runs, so the card never has to say "no run seen" meanwhile.
  const lastFinished = recentRuns.find(run => run.finished_at)
  const info = describePipeline(
    r.lastPipelineRun ?? (lastFinished?.finished_at ? new Date(lastFinished.finished_at) : null),
    r.pipelineStruggling,
  )

  const refreshSources = async () => {
    const { data } = await supabase.from('sources').select('*').order('category').order('name')
    if (data) setSources(data as Source[])
  }

  const byCategory = CATEGORIES.map(({ key, label }) => ({
    key,
    label,
    sources: sources.filter(s => s.category === key),
  }))

  return (
    <div className="min-h-screen">
      {/* Sub-screen header: back, title, add */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas">
        <div className="mx-auto flex h-topbar max-w-2xl items-center gap-1 pl-1 pr-1">
          <BackLink
            href="/reader"
            aria-label="Back to feed"
            className="grid size-12 flex-none place-items-center rounded-full text-fg-2 active:bg-surface-2"
          >
            <svg className="size-6" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </BackLink>
          <h1 className="t-h3 flex-1 pl-1 text-[17px]">Sources</h1>
          <IconButton label="Add a channel" icon={Plus} onClick={() => setAdding(true)} />
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-gutter pb-10 pt-4">
        {/* Status card: health, Run now, build stamp */}
        <section aria-label="Pipeline status" className="rounded-panel bg-surface-1 p-4">
          <p className="flex items-center gap-2.5 text-base font-semibold text-fg-1">
            <span
              aria-hidden="true"
              className={cx('size-2.5 flex-none rounded-full', info ? { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }[info.tone] : 'bg-fg-3')}
            />
            {info ? (info.tone === 'ok' ? 'Pipeline healthy' : info.tone === 'warn' ? 'Pipeline slow' : info.label) : 'No pipeline run seen yet'}
          </p>
          {last && (
            <p className="t-meta mt-1">
              Last run <LocalTime iso={last.started_at} /> · {last.videos_found} videos → {last.stories_created} {last.stories_created === 1 ? 'story' : 'stories'}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <RunNow size="compact" />
            {recentRuns.length > 0 && (
              <a href="#recent-runs" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-accent">View runs</a>
            )}
          </div>
          <p className="t-meta mt-4 border-t border-hairline pt-3 font-mono">Build {process.env.NEXT_PUBLIC_BUILD_SHA}</p>
        </section>

        {/* Recent runs */}
        {recentRuns.length > 0 && (
          <section id="recent-runs" className="scroll-mt-16">
            <h2 className="t-overline mb-2">Recent runs</h2>
            <ul className="overflow-hidden rounded-panel bg-surface-1">
              {recentRuns.map(run => {
                const st = STATUS[run.status]
                const Icon = st?.icon ?? LoaderCircle
                return (
                  <li key={run.id} className="flex min-h-14 items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium leading-5 text-fg-1"><LocalTime iso={run.started_at} /></p>
                      <p className="t-meta">{run.videos_found} videos · {run.stories_created} {run.stories_created === 1 ? 'story' : 'stories'}</p>
                    </div>
                    <span className={cx('inline-flex items-center gap-1.5 text-sm font-medium', st?.tone ?? 'text-fg-3')}>
                      <Icon className={cx('size-[18px]', !st && 'animate-spin')} aria-hidden="true" />
                      {st?.word ?? run.status}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* Sources by category */}
        {byCategory.map(cat => (
          <section key={cat.key}>
            <h2 className="t-overline mb-2">{cat.label} · {cat.sources.length}</h2>
            <ul className="overflow-hidden rounded-panel bg-surface-1">
              {cat.sources.length === 0 ? (
                <li className="px-4 py-3 text-sm text-fg-3">No sources yet</li>
              ) : cat.sources.map(source => (
                <li key={source.id} className="flex min-h-14 items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0">
                  <HealthDot failures={source.consecutive_failures} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium leading-5 text-fg-1">{source.name}</p>
                    <p className="t-meta">
                      {SOURCE_TYPE[source.source_type] ?? source.source_type.replace(/_/g, ' ')}
                      {source.last_success_at
                        ? <> · Last OK <LocalTime iso={source.last_success_at} variant="date" /></>
                        : ' · Not yet checked'}
                    </p>
                    <StatLine stat={stats ? (stats[source.id] ?? NO_STORIES) : undefined} weight={weights[source.id]} />
                  </div>
                  {source.consecutive_failures > 0 && (
                    <span className="flex-none text-sm font-medium text-warn">
                      {source.consecutive_failures} fail{source.consecutive_failures > 1 ? 's' : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      {adding && (
        <Sheet open onClose={() => setAdding(false)} title="Add a YouTube channel">
          <AddSourceForm onAdded={refreshSources} />
        </Sheet>
      )}
    </div>
  )
}
