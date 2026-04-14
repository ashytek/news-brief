'use client'

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

export default function SourcesClient({ sources, recentRuns }: Props) {
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
              {cat.sources.map((source, i) => (
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
