'use client'

import { useMemo, type ReactNode } from 'react'
import { Check, Play } from 'lucide-react'
import type { StoryWithRelations } from '@/lib/types'
import { estimateReadMinutes, formatRelativeDate, minutesSince, readShort } from '@/lib/format'
import { CategoryMark } from './CategoryMark'
import { cx } from './cx'

/** A story as one compact row: kicker, serif headline, two-line dek, meta (led by
 *  the unread dot or a "Read" tag), and a 104 px thumbnail. Used wherever a list of stories should scan quickly
 *  (Search, Archive, the catch-up headline list). Give it `onToggle` and the
 *  headline becomes a disclosure button — the whole row is its hit area — that
 *  reveals `children` (the short card) below the row. */
export function StoryRow({ story, sourceName, isRead = false, showCategory = false, expanded, onToggle, children }: {
  story: StoryWithRelations
  sourceName?: string
  isRead?: boolean
  showCategory?: boolean
  /** Only meaningful with `onToggle`. */
  expanded?: boolean
  onToggle?: () => void
  /** Expanded content; rendered only while `expanded`. */
  children?: ReactNode
}) {
  const video = story.videos
  const short = useMemo(() => readShort(story.short), [story.short])
  const dek = short?.lead ?? story.summary
  const readMins = useMemo(
    () => estimateReadMinutes(short ? [short.lead, ...short.keyPoints] : [story.summary]),
    [short, story.summary],
  )
  const sections = story.bullets?.[0]?.title ? story.bullets.length : 0
  const isNew = minutesSince(video?.published_at) < 60
  // mqdefault is a true 16:9 image; hqdefault carries letterbox bars at 104 px.
  const thumb = video?.thumbnail_url?.replace('/hqdefault.', '/mqdefault.') ?? null

  return (
    <article
      className={cx(
        'relative grid gap-x-3.5 gap-y-1.5 border-b border-hairline py-4 last:border-b-0 [overflow-wrap:anywhere]',
        thumb ? 'grid-cols-[minmax(0,1fr)_104px]' : 'grid-cols-1',
      )}
    >
      {/* Kicker: category, source, "New" */}
      <div className="col-span-full flex min-w-0 items-center gap-2">
        {showCategory && <CategoryMark category={story.category} />}
        {sourceName && (
          <span className="truncate text-xs font-medium leading-4 text-fg-3">{sourceName}</span>
        )}
        {isNew && <span className="t-kicker flex-none text-accent">New</span>}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className={cx('t-head', isRead ? 'font-medium text-fg-3' : 'text-fg-1')}>
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!!expanded}
              className="text-left after:absolute after:inset-0 after:content-['']"
            >
              {story.headline}
            </button>
          ) : story.headline}
        </h3>
        {dek && <p className="line-clamp-2 text-sm leading-[21px] text-fg-2">{dek}</p>}
        <p className="t-meta flex flex-wrap items-center gap-x-1.5">
          {isRead ? (
            <>
              <span className="inline-flex items-center gap-1 text-fg-2">
                <Check className="size-3.5" aria-hidden="true" />Read
              </span>
              <span aria-hidden="true">·</span>
            </>
          ) : (
            <>
              <span aria-hidden="true" className="size-2 flex-none rounded-full bg-accent" />
              <span className="sr-only">Unread</span>
            </>
          )}
          {video?.published_at && <time dateTime={video.published_at}>{formatRelativeDate(video.published_at)}</time>}
          <span aria-hidden="true">·</span>
          <span>{readMins} min read</span>
          {sections > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{sections} sections</span>
            </>
          )}
        </p>
      </div>

      {thumb && (
        <div className="relative z-10 mt-0.5 aspect-video w-[104px] self-start overflow-hidden rounded-control bg-surface-2">
          {video?.url ? (
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Watch on YouTube: ${story.headline}`}
              className="block size-full"
            >
              {/* decorative: the headline sits right beside it */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb} alt="" loading="lazy" className={cx('size-full object-cover', isRead && 'opacity-55')} />
              <PlayBadge />
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" loading="lazy" className={cx('size-full object-cover', isRead && 'opacity-55')} />
          )}
        </div>
      )}

      {expanded && children && <div className="col-span-full pt-2">{children}</div>}
    </article>
  )
}

/** Always visible (not hover-only): the thumbnail is a link to the video. */
function PlayBadge() {
  return (
    <span className="absolute bottom-1.5 left-1.5 grid size-[22px] place-items-center rounded-full bg-black/60 text-white">
      <Play className="ml-px size-[11px] fill-current" aria-hidden="true" />
    </span>
  )
}
