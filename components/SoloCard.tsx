'use client'

import { useEffect } from 'react'
import type { Story, Source } from '@/lib/types'
import { TsLink } from './TsLink'
import { EngagementBar } from './EngagementBar'

interface Props {
  story: Story
  source?: Source
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

export function SoloCard({ story, source, isRead, onRead, onEngagement, onDwellStart, onDwellEnd }: Props) {
  const videoUrl = (story as any).videos?.url ?? null

  useEffect(() => {
    onDwellStart()
    return () => onDwellEnd()
  }, [])

  return (
    <article
      className={`rounded-2xl border p-4 transition-all ${
        isRead
          ? 'bg-gray-900/40 border-gray-800/40 opacity-60'
          : 'bg-gray-900 border-gray-800 hover:border-gray-700'
      }`}
    >
      {/* Source badge */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-xs font-medium text-gray-400 bg-gray-800 px-2 py-0.5 rounded-full">
          {source?.name ?? 'Unknown source'}
        </span>
        {(story as any).videos?.published_at && (
          <span className="text-xs text-gray-600">
            {new Date((story as any).videos.published_at).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short'
            })}
          </span>
        )}
      </div>

      {/* Headline */}
      <h2 className="text-base font-semibold text-white leading-snug mb-2">
        {videoUrl ? (
          <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="hover:text-gray-200 transition-colors">
            {story.headline}
          </a>
        ) : story.headline}
      </h2>

      {/* Summary */}
      <p className="text-sm text-gray-400 leading-relaxed mb-3">{story.summary}</p>

      {/* Bullet points with timestamps */}
      {story.bullets && story.bullets.length > 0 && (
        <ul className="space-y-1.5">
          {story.bullets.map((bullet, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="text-gray-600 mt-0.5 flex-shrink-0">•</span>
              <span className="text-gray-300 leading-snug">
                {bullet.text}
                {bullet.timestamp_seconds !== null && videoUrl && (
                  <> {' '}
                    <TsLink videoUrl={videoUrl} timestampSeconds={bullet.timestamp_seconds}>
                      [{formatTime(bullet.timestamp_seconds)}]
                    </TsLink>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <EngagementBar isRead={isRead} onRead={onRead} onEngagement={onEngagement} />
    </article>
  )
}
