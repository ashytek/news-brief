'use client'

import { useState, useEffect } from 'react'
import type { ClusterWithRelations } from '@/lib/types'
import { TsLink } from './TsLink'
import { EngagementBar } from './EngagementBar'
import {
  formatTime,
  CATEGORY_ACCENT_BAR,
  CATEGORY_GLOW_CLASS,
  CATEGORY_BULLET_COLOR,
} from '@/lib/constants'

interface Props {
  cluster: ClusterWithRelations
  isRead: boolean
  readStoryIds?: Set<string>
  onRead: () => void
  onEngagement: (signal: string) => void
  onDwellStart: () => void
  onDwellEnd: () => void
  onMuteTopic?: () => void
}

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

export function ClusteredCard({ cluster, isRead, readStoryIds, onRead, onEngagement, onDwellStart, onDwellEnd, onMuteTopic }: Props) {
  const clusterTopics = Array.from(
    new Set((cluster.stories ?? []).flatMap(s => s.matched_topics ?? []))
  )
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

  // Pick the freshest unread story's headline as the primary title.
  const sortedByDate = [...stories].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
  const freshUnread = sortedByDate.find(s => !readStoryIds?.has(s.id))
  const primaryStory = freshUnread ?? sortedByDate[0] ?? null
  const primaryHeadline = primaryStory?.headline ?? null
  const hasFreshContent = freshUnread != null && sortedByDate.length > 1

  // Native Android/iOS share sheet; clipboard fallback on desktop
  const handleShare = () => {
    const shareUrl = primaryStory?.videos?.url ?? window.location.href
    const title = primaryHeadline ?? 'News Brief story'
    if (navigator.share) {
      navigator.share({ title, text: title, url: shareUrl }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(`${title}\n${shareUrl}`).catch(() => {})
    }
    onEngagement('share')
  }

  const accentBar = CATEGORY_ACCENT_BAR[cluster.category]
  const glow = CATEGORY_GLOW_CLASS[cluster.category]
  const bulletColor = CATEGORY_BULLET_COLOR[cluster.category]

  return (
    <article
      className={`group relative rounded-2xl overflow-hidden transition-all card-rise card-cv ${glow} ${
        isRead
          ? 'bg-slate-900/40 ring-1 ring-slate-800/40'
          : 'bg-slate-900/80 ring-1 ring-slate-800'
      }`}
    >
      {/* Wider accent bar for clusters — signals "richer story" */}
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${accentBar} ${isRead ? 'opacity-30' : ''}`} aria-hidden="true" />

      <div className="pl-5 pr-4 py-4">
        {/* Multi-source badge row */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-violet-200 bg-violet-500/20 ring-1 ring-violet-500/30 px-2.5 py-0.5 rounded-full">
            <svg className="w-3 h-3" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {cluster.story_count} sources
          </span>
          {hasFreshContent && (
            <span className="text-[10px] font-bold tracking-wider text-emerald-200 bg-emerald-500/25 ring-1 ring-emerald-500/40 px-2 py-0.5 rounded-full uppercase shadow-[0_0_12px_rgba(52,211,153,0.3)]">
              ✨ Updated
            </span>
          )}
          <span className="text-xs text-slate-400 ml-auto">
            {formatRelativeDate(cluster.last_updated_at)}
          </span>
        </div>

        {/* Primary headline */}
        {primaryHeadline && (
          <h2 className={`text-lg md:text-xl font-bold leading-tight tracking-tight mb-2.5 ${
            isRead ? 'text-slate-400 line-through decoration-slate-700 decoration-2' : 'text-white'
          }`}>
            {primaryHeadline}
          </h2>
        )}

        {/* Core fact */}
        {cluster.core_fact && cluster.core_fact !== primaryHeadline && (
          <p className={`text-sm leading-relaxed mb-3 ${isRead ? 'text-slate-500' : 'text-slate-300'}`}>
            {cluster.core_fact}
          </p>
        )}

        {/* Consensus block — quote-card treatment */}
        {cluster.consensus && (
          <div className={`mb-4 pl-3.5 py-1.5 border-l-2 ${
            isRead
              ? 'border-slate-700 bg-slate-800/20'
              : 'border-violet-500/60 bg-violet-500/5'
          } rounded-r-lg`}>
            <p className="text-[10px] font-bold text-violet-300/80 mb-1 uppercase tracking-widest">
              Consensus
            </p>
            <p className={`text-sm leading-relaxed italic ${isRead ? 'text-slate-500' : 'text-slate-200'}`}>
              {cluster.consensus}
            </p>
          </div>
        )}

        {/* Per-source story rows */}
        {stories.length > 0 && (
          <div className="space-y-3 mb-3">
            {stories.map(story => {
              const video = story.videos
              const videoUrl = video?.url ?? null
              const thumbnail = video?.thumbnail_url ?? null
              const sourceName = story.sources?.name ?? null
              const storyRead = readStoryIds?.has(story.id) ?? false
              return (
                <div key={story.id} className={`flex gap-3 transition-opacity ${storyRead ? 'opacity-40' : ''}`}>
                  {thumbnail && (
                    <div className="flex-shrink-0 w-24 h-[54px] rounded-lg overflow-hidden bg-slate-800 ring-1 ring-slate-700/60">
                      {videoUrl ? (
                        <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
                          <img src={thumbnail} alt="" aria-hidden="true" className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" loading="lazy" />
                        </a>
                      ) : (
                        <img src={thumbnail} alt="" aria-hidden="true" className="w-full h-full object-cover" loading="lazy" />
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    {sourceName && (
                      <p className="text-[11px] font-semibold text-slate-300 mb-1 uppercase tracking-wide">{sourceName}</p>
                    )}
                    {story.bullets?.slice(0, 3).map((b, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm mb-1">
                        <span className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${bulletColor}`} aria-hidden="true" />
                        <span className="text-slate-200 leading-relaxed">
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
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
              aria-expanded={showPerspectives}
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform duration-200 ${showPerspectives ? 'rotate-90' : ''}`}
                aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {showPerspectives ? 'Hide' : 'See'} how each source framed it ({cluster.perspectives.length})
            </button>

            {showPerspectives && (
              <div className="mt-3 space-y-2.5 animate-fade-in-up">
                {cluster.perspectives.map((p, i) => (
                  <div key={i} className="pl-3.5 border-l-2 border-violet-500/40 py-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-violet-200">{p.source}</span>
                      {p.timestamp_link && (
                        <a
                          href={p.timestamp_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-300 hover:text-blue-200 transition-colors"
                        >
                          Watch ↗
                        </a>
                      )}
                    </div>
                    <p className="text-sm text-slate-200 leading-relaxed">{p.angle}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <EngagementBar
          isRead={isRead}
          onRead={onRead}
          onEngagement={onEngagement}
          onMuteTopic={onMuteTopic}
          canMute={!!onMuteTopic && clusterTopics.length > 0}
          onShare={handleShare}
        />
      </div>
    </article>
  )
}
