'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Source } from '@/lib/types'
import type { StoryWithRelations } from '@/lib/types'
import { TsLink } from './TsLink'
import { EngagementBar } from './EngagementBar'
import {
  formatTime,
  CATEGORY_ACCENT_BAR,
  CATEGORY_GLOW_CLASS,
  CATEGORY_BULLET_COLOR,
} from '@/lib/constants'

interface Props {
  story: StoryWithRelations
  source?: Source
  isRead: boolean
  onRead: () => void
  onEngagement: (signal: string) => void
  onDwellStart: () => void
  onDwellEnd: () => void
  onMuteTopic?: () => void
}

const SIXTY_MINUTES = 60 * 60 * 1000

/** Rough words-per-minute reading estimate (250 wpm = average adult). */
function estimateReadMinutes(summary: string, bullets: { text: string }[]): number {
  const words =
    (summary?.split(/\s+/).length ?? 0) +
    bullets.reduce((sum, b) => sum + (b.text?.split(/\s+/).length ?? 0), 0)
  return Math.max(1, Math.round(words / 250))
}

/** Friendly relative-time string: "2h ago", "Yesterday", "3 May". */
function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  if (hrs < 48) return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Bullets shown before the "Show all" expander kicks in. Long prophetic
 * broadcasts run 15-25 bullets — collapsing keeps mobile cards scannable. */
const BULLET_PREVIEW_COUNT = 5

export function SoloCard({ story, source, isRead, onRead, onEngagement, onDwellStart, onDwellEnd, onMuteTopic }: Props) {
  const video = story.videos
  const videoUrl = video?.url ?? null
  const thumbnail = video?.thumbnail_url ?? null

  const [showAllBullets, setShowAllBullets] = useState(false)

  // Native Android/iOS share sheet; clipboard fallback on desktop
  const handleShare = useCallback(() => {
    const shareUrl = videoUrl ?? window.location.href
    if (navigator.share) {
      navigator.share({ title: story.headline, text: story.headline, url: shareUrl }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(`${story.headline}\n${shareUrl}`).catch(() => {})
    }
    onEngagement('share')
  }, [videoUrl, story.headline, onEngagement])

  const isFresh = video?.published_at
    ? Date.now() - new Date(video.published_at).getTime() < SIXTY_MINUTES
    : false

  const readMins = useMemo(
    () => estimateReadMinutes(story.summary, story.bullets ?? []),
    [story.summary, story.bullets],
  )

  useEffect(() => {
    onDwellStart()
    return () => onDwellEnd()
  }, [])

  const accentBar = CATEGORY_ACCENT_BAR[story.category]
  const glow = CATEGORY_GLOW_CLASS[story.category]
  const bulletColor = CATEGORY_BULLET_COLOR[story.category]

  return (
    <article
      className={`group relative rounded-2xl overflow-hidden transition-all card-rise card-cv ${glow} ${
        isRead
          ? 'bg-slate-900/40 ring-1 ring-slate-800/40'
          : 'bg-slate-900/80 ring-1 ring-slate-800'
      }`}
    >
      {/* Category accent bar — instant visual ID */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentBar} ${isRead ? 'opacity-30' : ''}`} aria-hidden="true" />

      {/* Thumbnail */}
      {thumbnail && (
        <div className="relative w-full aspect-video bg-slate-800 overflow-hidden">
          {videoUrl ? (
            <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
              <img
                src={thumbnail}
                alt={story.headline}
                className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${isRead ? 'opacity-50' : ''}`}
                loading="lazy"
              />
              {/* Dark gradient at bottom for text legibility if we ever overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
              {/* Play button overlay */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="w-14 h-14 rounded-full bg-black/70 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/20">
                  <svg className="w-6 h-6 text-white ml-0.5" aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            </a>
          ) : (
            <img
              src={thumbnail}
              alt={story.headline}
              className={`w-full h-full object-cover ${isRead ? 'opacity-50' : ''}`}
              loading="lazy"
            />
          )}
        </div>
      )}

      <div className="pl-5 pr-4 py-4">
        {/* Meta row: source + time + read time + topics */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {isFresh && (
            <span
              className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 animate-fresh-pulse shadow-[0_0_8px_rgba(52,211,153,0.7)]"
              title="Published in the last hour"
              aria-label="Fresh"
            />
          )}
          <span className="text-xs font-semibold text-slate-200 bg-slate-800/80 ring-1 ring-slate-700 px-2 py-0.5 rounded-full">
            {source?.name ?? 'Unknown'}
          </span>
          {video?.published_at && (
            <span className="text-xs text-slate-400">
              {formatRelativeDate(video.published_at)}
            </span>
          )}
          <span className="text-xs text-slate-500 inline-flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {readMins} min
          </span>
          {story.matched_topics && story.matched_topics.length > 0 && (
            <div className="flex gap-1 ml-auto">
              {story.matched_topics.slice(0, 2).map(t => (
                <span key={t} className="text-[10px] font-medium uppercase tracking-wider text-rose-300 bg-rose-500/15 ring-1 ring-rose-500/25 px-2 py-0.5 rounded-full">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Headline — bigger, more confident */}
        <h2 className={`text-lg md:text-xl font-bold leading-tight tracking-tight mb-2.5 ${
          isRead ? 'text-slate-400 line-through decoration-slate-700 decoration-2' : 'text-white'
        }`}>
          {videoUrl ? (
            <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="hover:text-slate-100 transition-colors">
              {story.headline}
            </a>
          ) : story.headline}
        </h2>

        {/* Summary */}
        <p className={`text-sm leading-relaxed mb-4 ${isRead ? 'text-slate-500' : 'text-slate-300'}`}>
          {story.summary}
        </p>

        {/* Bullet points with category-coloured markers.
            Collapsed past BULLET_PREVIEW_COUNT — prophetic stories carry
            15-25 bullets and were producing endless cards on mobile. */}
        {story.bullets && story.bullets.length > 0 && (() => {
          const needsCollapse = story.bullets.length > BULLET_PREVIEW_COUNT + 1
          const visibleBullets = needsCollapse && !showAllBullets
            ? story.bullets.slice(0, BULLET_PREVIEW_COUNT)
            : story.bullets
          return (
            <>
              <ul className={`${visibleBullets[0]?.title ? 'space-y-3.5' : 'space-y-2'} mb-1`}>
                {visibleBullets.map((bullet, i) =>
                  bullet.title ? (
                    /* Walkthrough section: [MM:SS] — Title, prose beneath */
                    <li key={i} className="text-sm">
                      <p className="leading-snug mb-1">
                        {bullet.timestamp_seconds !== null && videoUrl && (
                          <>
                            <TsLink videoUrl={videoUrl} timestampSeconds={bullet.timestamp_seconds}>
                              [{formatTime(bullet.timestamp_seconds)}]
                            </TsLink>
                            <span className={isRead ? 'text-slate-600' : 'text-slate-500'}>{' — '}</span>
                          </>
                        )}
                        <span className={`font-semibold ${isRead ? 'text-slate-400' : 'text-white'}`}>
                          {bullet.title}
                        </span>
                      </p>
                      <p className={`leading-relaxed ${isRead ? 'text-slate-500' : 'text-slate-300'}`}>
                        {bullet.text}
                      </p>
                    </li>
                  ) : (
                    /* Legacy dot bullet (stories summarised before July 2026) */
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <span
                        className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${bulletColor} ${isRead ? 'opacity-40' : ''}`}
                        aria-hidden="true"
                      />
                      <span className={`leading-relaxed ${isRead ? 'text-slate-500' : 'text-slate-200'}`}>
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
                  )
                )}
              </ul>
              {needsCollapse && (
                <button
                  onClick={() => setShowAllBullets(v => !v)}
                  className="w-full min-h-[44px] mt-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 active:scale-[0.98] rounded-lg bg-slate-800/40 ring-1 ring-slate-800 transition-all"
                  aria-expanded={showAllBullets}
                >
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${showAllBullets ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                  {showAllBullets
                    ? 'Show fewer'
                    : `Show all ${story.bullets.length} ${story.bullets[0]?.title ? 'sections' : 'bullets'}`}
                </button>
              )}
            </>
          )
        })()}

        <EngagementBar
          isRead={isRead}
          onRead={onRead}
          onEngagement={onEngagement}
          onMuteTopic={onMuteTopic}
          canMute={!!onMuteTopic && (story.matched_topics?.length ?? 0) > 0}
          onShare={handleShare}
        />
      </div>
    </article>
  )
}
