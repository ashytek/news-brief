'use client'

import { useState, useEffect } from 'react'
import type { Cluster } from '@/lib/types'
import { TsLink } from './TsLink'
import { EngagementBar } from './EngagementBar'

interface Props {
  cluster: Cluster
  isRead: boolean
  onRead: () => void
  onEngagement: (signal: string) => void
  onDwellStart: () => void
  onDwellEnd: () => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function ClusteredCard({ cluster, isRead, onRead, onEngagement, onDwellStart, onDwellEnd }: Props) {
  const [showPerspectives, setShowPerspectives] = useState(false)

  useEffect(() => {
    onDwellStart()
    return () => onDwellEnd()
  }, [])

  const handleExpandPerspectives = () => {
    setShowPerspectives(v => !v)
    if (!showPerspectives) onEngagement('expand_perspectives')
  }

  const stories = cluster.stories ?? []

  return (
    <article
      className={`rounded-2xl border p-4 transition-all ${
        isRead
          ? 'bg-gray-900/40 border-gray-800/40 opacity-60'
          : 'bg-gray-900 border-gray-800 hover:border-gray-700'
      }`}
    >
      {/* Multi-source badge */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="flex items-center gap-1 text-xs font-medium text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {cluster.story_count} sources
        </span>
        <span className="text-xs text-gray-600">
          {new Date(cluster.last_updated_at).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short'
          })}
        </span>
      </div>

      {/* Core fact */}
      {cluster.core_fact && (
        <h2 className="text-base font-semibold text-white leading-snug mb-2">
          {cluster.core_fact}
        </h2>
      )}

      {/* Consensus */}
      {cluster.consensus && (
        <div className="mb-3 pl-3 border-l-2 border-gray-700">
          <p className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Consensus</p>
          <p className="text-sm text-gray-300 leading-relaxed">{cluster.consensus}</p>
        </div>
      )}

      {/* Per-story bullets with thumbnails */}
      {stories.length > 0 && (
        <div className="space-y-3 mb-3">
          {stories.map(story => {
            const video     = (story as any).videos
            const videoUrl  = video?.url ?? null
            const thumbnail = video?.thumbnail_url ?? null
            const sourceName = (story as any).source?.name ?? null
            return (
              <div key={story.id} className="flex gap-2.5">
                {/* Thumbnail */}
                {thumbnail && (
                  <div className="flex-shrink-0 w-20 h-[45px] rounded-lg overflow-hidden bg-gray-800">
                    {videoUrl ? (
                      <a href={videoUrl} target="_blank" rel="noopener noreferrer">
                        <img src={thumbnail} alt="" className="w-full h-full object-cover hover:opacity-80 transition-opacity" loading="lazy" />
                      </a>
                    ) : (
                      <img src={thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                    )}
                  </div>
                )}
                {/* Bullets */}
                <div className="flex-1 min-w-0">
                  {sourceName && (
                    <p className="text-xs font-medium text-gray-500 mb-1">{sourceName}</p>
                  )}
                  {story.bullets?.slice(0, 3).map((b, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-sm mb-1">
                      <span className="text-gray-600 mt-0.5 flex-shrink-0">•</span>
                      <span className="text-gray-300 leading-snug">
                        {b.text}
                        {b.timestamp_seconds !== null && videoUrl && (
                          <>{' '}
                            <TsLink videoUrl={videoUrl} timestampSeconds={b.timestamp_seconds}>
                              [{formatTime(b.timestamp_seconds)}]
                            </TsLink>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Perspectives toggle */}
      {cluster.perspectives && cluster.perspectives.length > 0 && (
        <div className="mt-3">
          <button
            onClick={handleExpandPerspectives}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${showPerspectives ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {showPerspectives ? 'Hide' : 'Show'} perspectives ({cluster.perspectives.length})
          </button>

          {showPerspectives && (
            <div className="mt-2 space-y-2">
              {cluster.perspectives.map((p, i) => (
                <div key={i} className="pl-3 border-l-2 border-gray-700 py-0.5">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-gray-400">{p.source}</span>
                    {p.timestamp_link && (
                      <a
                        href={p.timestamp_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        Watch ↗
                      </a>
                    )}
                  </div>
                  <p className="text-sm text-gray-300 leading-snug">{p.angle}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <EngagementBar isRead={isRead} onRead={onRead} onEngagement={onEngagement} />
    </article>
  )
}
