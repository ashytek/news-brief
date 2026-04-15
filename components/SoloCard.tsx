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
  const video    = (story as any).videos
  const videoUrl = video?.url ?? null
  const thumbnail = video?.thumbnail_url ?? null

  useEffect(() => {
    onDwellStart()
    return () => onDwellEnd()
  }, [])

  return (
    <article
      className={`rounded-2xl border overflow-hidden transition-all ${
        isRead
          ? 'bg-gray-900/40 border-gray-800/40 opacity-60'
          : 'bg-gray-900 border-gray-800 hover:border-gray-700'
      }`}
    >
      {/* Thumbnail */}
      {thumbnail && (
        <div className="relative w-full aspect-video bg-gray-800 overflow-hidden">
          {videoUrl ? (
            <a href={videoUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={thumbnail}
                alt={story.headline}
                className="w-full h-full object-cover transition-opacity hover:opacity-90"
                loading="lazy"
              />
              {/* Play button overlay */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/20">
                <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            </a>
          ) : (
            <img
              src={thumbnail}
              alt={story.headline}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          )}
        </div>
      )}

      <div className="p-4">
        {/* Source badge + date */}
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-xs font-medium text-gray-400 bg-gray-800 px-2 py-0.5 rounded-full">
            {source?.name ?? 'Unknown source'}
          </span>
          {video?.published_at && (
            <span className="text-xs text-gray-600">
              {new Date(video.published_at).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short'
              })}
            </span>
          )}
          {story.matched_topics && story.matched_topics.length > 0 && (
            <div className="flex gap-1 ml-auto">
              {story.matched_topics.slice(0, 2).map(t => (
                <span key={t} className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded-full">
                  {t}
                </span>
              ))}
            </div>
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
          <ul className="space-y-1.5 mb-1">
            {story.bullets.map((bullet, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-gray-600 mt-0.5 flex-shrink-0">•</span>
                <span className="text-gray-300 leading-snug">
                  {bullet.text}
                  {bullet.timestamp_seconds !== null && videoUrl && (
                    <>{' '}
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
      </div>
    </article>
  )
}
