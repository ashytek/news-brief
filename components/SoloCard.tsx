'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ShortVersion, Source } from '@/lib/types'
import type { StoryWithRelations } from '@/lib/types'
import { TsLink } from './TsLink'
import { EngagementBar } from './EngagementBar'
import { useDwellVisibility } from '@/lib/useDwellVisibility'
import { formatTime, formatDuration } from '@/lib/constants'
import { getCategory } from '@/lib/categories'

interface Props {
  story: StoryWithRelations
  source?: Source
  isRead: boolean
  onRead: () => void
  onEngagement: (signal: string) => void
  onDwellStart: () => void
  /** `longForm` is true when the card showed its full sections or the long
   *  summary while it was on screen, so the caller uses the longer threshold. */
  onDwellEnd: (opts: { longForm: boolean }) => void
  onMuteTopic?: () => void
  /** Show the category as a dot + label in the meta row (Today mixes them). */
  showCategory?: boolean
}

const SIXTY_MINUTES = 60 * 60 * 1000

/** Rough words-per-minute reading estimate (250 wpm = average adult). */
function estimateReadMinutes(texts: string[]): number {
  const words = texts.reduce((sum, t) => sum + (t?.split(/\s+/).length ?? 0), 0)
  return Math.max(1, Math.round(words / 250))
}

/** The story's short version, or null when absent or malformed — the card then
 *  falls back to the long summary. `short` is untyped jsonb in the database. */
function readShort(s: ShortVersion | null | undefined): { lead: string; keyPoints: string[] } | null {
  if (!s || typeof s.lead !== 'string' || !s.lead.trim()) return null
  const keyPoints = Array.isArray(s.key_points)
    ? s.key_points.filter(p => typeof p === 'string' && p.trim().length > 0)
    : []
  return { lead: s.lead.trim(), keyPoints }
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

export function SoloCard({ story, source, isRead, onRead, onEngagement, onDwellStart, onDwellEnd, onMuteTopic, showCategory }: Props) {
  const video = story.videos
  const videoUrl = video?.url ?? null
  const thumbnail = video?.thumbnail_url ?? null

  // Walkthrough stories: "More" reveals the timestamped sections. Legacy
  // dot-bullet stories: expands past BULLET_PREVIEW_COUNT, as before.
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

  const short = useMemo(() => readShort(story.short), [story.short])
  // Titled sections are the post-July-2026 walkthrough format; they stay behind
  // "More" so the default card is the short version only.
  const isWalkthrough = !!story.bullets?.[0]?.title

  // Read time reflects what is shown: the short version (or the long summary
  // when there isn't one), plus the sections once revealed.
  const readMins = useMemo(
    () => estimateReadMinutes([
      ...(short ? [short.lead, ...short.keyPoints] : [story.summary]),
      ...(!isWalkthrough || showAllBullets ? (story.bullets ?? []).map(b => b.text) : []),
    ]),
    [short, story.summary, story.bullets, isWalkthrough, showAllBullets],
  )

  // The dwell hook binds its callbacks once, so read live state through refs.
  const latest = useRef({ hasShort: false, expanded: false })
  const expandedSeen = useRef(false)
  useEffect(() => {
    latest.current = { hasShort: !!short, expanded: showAllBullets }
    if (showAllBullets) expandedSeen.current = true
  }, [short, showAllBullets])
  const dwellRef = useDwellVisibility<HTMLElement>(
    () => { expandedSeen.current = latest.current.expanded; onDwellStart() },
    () => onDwellEnd({ longForm: !latest.current.hasShort || expandedSeen.current }),
  )

  const category = getCategory(story.category)
  const { accentBar, glow, bullet: bulletColor } = category.legacy

  return (
    <article
      ref={dwellRef}
      className={`group relative rounded-2xl overflow-hidden transition-all card-rise card-cv ${glow} ${
        isRead
          ? 'bg-slate-900/40 ring-1 ring-slate-800/40'
          : 'bg-slate-900/80 ring-1 ring-slate-800'
      }`}
    >
      {/* Category accent bar — instant visual ID */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentBar} ${isRead ? 'opacity-30' : ''}`} aria-hidden="true" />

      {/* Thumbnail. The headline sits right below, so the image is decorative
          (alt=""); the play badge is always visible, with the video length. */}
      {thumbnail && (
        <div className="relative w-full aspect-video bg-slate-800 overflow-hidden">
          {videoUrl ? (
            <a
              href={videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full h-full active:opacity-80"
              aria-label={`Watch on YouTube: ${story.headline}`}
            >
              <img
                src={thumbnail}
                alt=""
                className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${isRead ? 'opacity-60' : ''}`}
                loading="lazy"
              />
              <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/80 px-2 py-1 text-xs font-semibold text-white">
                <svg className="w-3 h-3" aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                {video?.duration_seconds ? formatDuration(video.duration_seconds) : 'Watch'}
              </span>
            </a>
          ) : (
            <img
              src={thumbnail}
              alt=""
              className={`w-full h-full object-cover ${isRead ? 'opacity-60' : ''}`}
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
              role="img"
              className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 animate-fresh-pulse shadow-[0_0_8px_rgba(52,211,153,0.7)]"
              title="Published in the last hour"
              aria-label="Fresh"
            />
          )}
          {showCategory && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <span className={`w-2 h-2 rounded-full ${bulletColor}`} aria-hidden="true" />
              {category.label}
            </span>
          )}
          <span className="text-xs font-semibold text-slate-200 bg-slate-800/80 ring-1 ring-slate-700 px-2 py-0.5 rounded-full">
            {source?.name ?? 'Unknown'}
          </span>
          {video?.published_at && (
            <time dateTime={video.published_at} className="text-xs text-slate-400">
              {formatRelativeDate(video.published_at)}
            </time>
          )}
          <span className="text-xs text-slate-400 inline-flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {readMins} min read
          </span>
          {isRead && (
            <span className="text-xs font-semibold text-slate-400 inline-flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Read
            </span>
          )}
          {story.matched_topics && story.matched_topics.length > 0 && (
            <div className="flex gap-1 ml-auto">
              {story.matched_topics.slice(0, 2).map(t => (
                <span key={t} className="text-xs font-medium text-rose-300 bg-rose-500/15 ring-1 ring-rose-500/25 px-2 py-0.5 rounded-full">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Headline — bigger, more confident */}
        <h2 className={`text-lg md:text-xl font-bold leading-tight tracking-tight mb-2.5 ${
          isRead ? 'text-slate-400' : 'text-white'
        }`}>
          {videoUrl ? (
            <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="hover:text-slate-100 active:opacity-70 transition-colors">
              {story.headline}
            </a>
          ) : story.headline}
        </h2>

        {/* Short version — the default card. Stories without one yet (older
            than the backfill window) fall back to the long overview. */}
        {short ? (
          <>
            <p className={`text-base leading-[1.55] ${short.keyPoints.length > 0 ? 'mb-3' : 'mb-4'} ${isRead ? 'text-slate-400' : 'text-slate-100'}`}>
              {short.lead}
            </p>
            {short.keyPoints.length > 0 && (
              <ul className="space-y-2 mb-4">
                {short.keyPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-base">
                    <span
                      className={`mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0 ${bulletColor} ${isRead ? 'opacity-40' : ''}`}
                      aria-hidden="true"
                    />
                    <span className={`leading-[1.55] ${isRead ? 'text-slate-400' : 'text-slate-200'}`}>
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className={`text-base leading-[1.55] mb-4 ${isRead ? 'text-slate-400' : 'text-slate-200'}`}>
            {story.summary}
          </p>
        )}

        {/* Sections. Walkthrough stories keep them behind "More · N timestamped
            sections". Legacy dot-bullet stories (before July 2026) keep the old
            preview, collapsed past BULLET_PREVIEW_COUNT — prophetic carried
            15-25 bullets and made endless cards on mobile. */}
        {story.bullets && story.bullets.length > 0 && (() => {
          const needsCollapse = isWalkthrough || story.bullets.length > BULLET_PREVIEW_COUNT + 1
          const visibleBullets = !needsCollapse || showAllBullets
            ? story.bullets
            : story.bullets.slice(0, isWalkthrough ? 0 : BULLET_PREVIEW_COUNT)
          // Article-sourced stories carry no timestamps.
          const sectionNoun =
            (story.bullets.some(b => b.timestamp_seconds !== null) ? 'timestamped section' : 'section') +
            (story.bullets.length === 1 ? '' : 's')
          return (
            <>
              {visibleBullets.length > 0 && (
                <ul className={`${visibleBullets[0]?.title ? 'space-y-3.5' : 'space-y-2'} mb-1`}>
                  {visibleBullets.map((bullet, i) =>
                    bullet.title ? (
                      /* Walkthrough section: [MM:SS] — Title, prose beneath */
                      <li key={i} className="text-[15px]">
                        <p className="leading-snug mb-1">
                          {bullet.timestamp_seconds !== null && videoUrl && (
                            <>
                              <TsLink videoUrl={videoUrl} timestampSeconds={bullet.timestamp_seconds}>
                                [{formatTime(bullet.timestamp_seconds)}]
                              </TsLink>
                              {' '}
                            </>
                          )}
                          <span className={`font-semibold ${isRead ? 'text-slate-400' : 'text-white'}`}>
                            {bullet.title}
                          </span>
                        </p>
                        <p className={`leading-[1.6] ${isRead ? 'text-slate-400' : 'text-slate-300'}`}>
                          {bullet.text}
                        </p>
                      </li>
                    ) : (
                      /* Legacy dot bullet (stories summarised before July 2026) */
                      <li key={i} className="flex items-start gap-2.5 text-[15px]">
                        <span
                          className={`mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0 ${bulletColor} ${isRead ? 'opacity-40' : ''}`}
                          aria-hidden="true"
                        />
                        <span className={`leading-[1.6] ${isRead ? 'text-slate-400' : 'text-slate-200'}`}>
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
              )}
              {needsCollapse && (
                <button
                  onClick={() => setShowAllBullets(v => !v)}
                  className="w-full min-h-[44px] mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-300 hover:text-slate-100 active:scale-[0.98] active:bg-slate-800 rounded-lg bg-slate-800/40 ring-1 ring-slate-800 transition-all"
                  aria-expanded={showAllBullets}
                >
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${showAllBullets ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                  {showAllBullets
                    ? 'Show less'
                    : isWalkthrough
                      ? `More · ${story.bullets.length} ${sectionNoun}`
                      : `Show all ${story.bullets.length} bullets`}
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
