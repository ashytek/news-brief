'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { Source, StoryWithRelations } from '@/lib/types'
import { CategoryMark, StoryThumb, cx } from '@/components/ui'
import { useDwellVisibility } from '@/lib/useDwellVisibility'
import { estimateReadMinutes, formatRelativeDate, minutesSince, readShort } from '@/lib/format'
import { ShortBody } from './ShortBody'
import type { StoryActions } from './types'

/** The story card of the feeds: headline-first, short version by default.
 *  `lead` (the first story of Today) has the full-width image; `standard` has the
 *  104 px thumbnail beside a serif headline. Cards are separated by hairlines,
 *  not boxes. The dwell timer (40 s on the short version, 120 s once the sections
 *  have been opened) runs on the whole article, as before. */
export function StoryCard({
  story, source, variant = 'standard', showCategory = false, actions, onDwellStart, onDwellEnd,
}: {
  story: StoryWithRelations
  source?: Source
  variant?: 'lead' | 'standard'
  /** Show the category as a dot + name in the kicker (Today mixes them). */
  showCategory?: boolean
  actions: StoryActions
  onDwellStart: () => void
  /** `longForm` is true when the card showed its sections or the long summary
   *  while it was on screen, so the caller uses the longer threshold. */
  onDwellEnd: (opts: { longForm: boolean }) => void
}) {
  const video = story.videos
  const videoUrl = video?.url ?? null
  const isRead = actions.isRead
  const [sectionsOpen, setSectionsOpen] = useState(false)

  const short = useMemo(() => readShort(story.short), [story.short])
  const sections = useMemo(() => story.bullets ?? [], [story.bullets])

  // Read time, stable: the first number is the short version (or the long summary
  // when there is none) and never changes; opening the sections adds the second.
  const base = useMemo(() => (short ? [short.lead, ...short.keyPoints] : [story.summary]), [short, story.summary])
  const baseMins = estimateReadMinutes(base)
  const fullMins = useMemo(
    () => estimateReadMinutes([...base, ...sections.map(b => b.text)]),
    [base, sections],
  )
  const withSections = sectionsOpen && sections.length > 0 && fullMins > baseMins

  // The dwell hook binds its callbacks once, so read live state through refs.
  const latest = useRef({ hasShort: false, expanded: false })
  const expandedSeen = useRef(false)
  useEffect(() => {
    latest.current = { hasShort: !!short, expanded: sectionsOpen }
    if (sectionsOpen) expandedSeen.current = true
  }, [short, sectionsOpen])
  const dwellRef = useDwellVisibility<HTMLElement>(
    () => { expandedSeen.current = latest.current.expanded; onDwellStart() },
    () => onDwellEnd({ longForm: !latest.current.hasShort || expandedSeen.current }),
  )

  const isLead = variant === 'lead'
  const isNew = minutesSince(video?.published_at) < 60

  const kicker = (
    <div className="flex min-w-0 items-center gap-2">
      {showCategory && <CategoryMark category={story.category} />}
      <span className="truncate text-xs font-medium leading-4 text-fg-3">{source?.name ?? 'Unknown'}</span>
      {isNew && <span className="t-kicker flex-none text-accent">New</span>}
    </div>
  )

  const meta = (
    <p className="t-meta flex flex-wrap items-center gap-x-1.5">
      {isRead ? (
        <span className="inline-flex items-center gap-1 text-fg-2">
          <Check className="size-3.5" aria-hidden="true" />Read
        </span>
      ) : (
        <>
          <span aria-hidden="true" className="size-2 flex-none rounded-full bg-accent" />
          <span className="sr-only">Unread</span>
        </>
      )}
      {video?.published_at && (
        <>
          {isRead && <span aria-hidden="true">·</span>}
          <time dateTime={video.published_at}>{formatRelativeDate(video.published_at)}</time>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span>{baseMins} min read</span>
      {withSections && (
        <>
          <span aria-hidden="true">·</span>
          <span>{fullMins} min with sections</span>
        </>
      )}
    </p>
  )

  const headline = videoUrl ? (
    <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="active:opacity-70">{story.headline}</a>
  ) : story.headline

  return (
    <article
      ref={dwellRef}
      data-story-id={story.id}
      className={cx('story-card card-cv flex flex-col border-b border-hairline py-5', isLead && 'pt-1')}
    >
      {isLead ? (
        <>
          <StoryThumb story={story} isRead={isRead} size="lead" className="mb-3.5" />
          <div className="mb-2">{kicker}</div>
          <h2 className={cx('t-lead mb-2', isRead ? 'font-medium text-fg-3' : 'text-fg-1')}>{headline}</h2>
          {meta}
        </>
      ) : (
        <>
          <div className="mb-2">{kicker}</div>
          <div className={cx('grid items-start gap-3.5', video?.thumbnail_url ? 'grid-cols-[minmax(0,1fr)_104px]' : 'grid-cols-1')}>
            <div className="flex min-w-0 flex-col gap-2">
              <h2 className={cx('font-serif text-[19px] font-semibold leading-[25px] text-pretty', isRead ? 'font-medium text-fg-3' : 'text-fg-1')}>
                {headline}
              </h2>
              {meta}
            </div>
            <StoryThumb story={story} isRead={isRead} className="mt-[3px]" />
          </div>
        </>
      )}

      <ShortBody
        story={story}
        actions={actions}
        sectionsOpen={sectionsOpen}
        onToggleSections={() => setSectionsOpen(v => !v)}
      />
    </article>
  )
}
