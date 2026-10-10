'use client'

import { useMemo, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { StoryWithRelations } from '@/lib/types'
import { displayHeadline, estimateReadMinutes, formatRelativeDate, minutesSince, readShort } from '@/lib/format'
import { CategoryMark } from './CategoryMark'
import { StoryThumb } from './StoryThumb'
import { Highlight } from './Highlight'
import { cx } from './cx'

/** A story as one compact row: kicker, serif headline, two-line dek, meta (led by
 *  the unread dot or a "Read" tag), and a 104 px thumbnail. Used wherever a list of stories should scan quickly
 *  (Search, Archive, Topics, the catch-up headline list). Give it `onToggle` and the
 *  headline becomes a disclosure button — the whole row is its hit area — that
 *  reveals `children` (the short card) below the row; while open the dek is
 *  dropped, because the short card's lead says the same thing. */
export function StoryRow({
  story, sourceName, isRead = false, showCategory = false, compact = false, kickerExtra, highlight, expanded, onToggle, selected, onSelect, children,
}: {
  story: StoryWithRelations
  sourceName?: string
  isRead?: boolean
  showCategory?: boolean
  /** The catch-up headline list: no two-line dek and an 88 px thumbnail, so a long
   *  list scans quickly. Tapping still opens the short card. */
  compact?: boolean
  /** Extra kicker text after the source ("Matched: war · middle east"). */
  kickerExtra?: ReactNode
  /** Search words to mark in the headline and dek. */
  highlight?: string
  /** Only meaningful with `onToggle`. */
  expanded?: boolean
  onToggle?: () => void
  /** Desktop reading pane: the row picks the story for the pane instead of opening in
   *  place (`onToggle` is ignored), and `selected` marks the one the pane is showing. */
  selected?: boolean
  onSelect?: () => void
  /** Expanded content; rendered only while `expanded`. */
  children?: ReactNode
}) {
  const video = story.videos
  const title = displayHeadline(story.headline)
  const short = useMemo(() => readShort(story.short), [story.short])
  const dek = short?.lead ?? story.summary
  const readMins = useMemo(
    () => estimateReadMinutes(short ? [short.lead, ...short.keyPoints] : [story.summary]),
    [short, story.summary],
  )
  const sections = story.bullets?.[0]?.title ? story.bullets.length : 0
  const isNew = minutesSince(video?.published_at) < 60
  const hasThumb = !!video?.thumbnail_url

  return (
    <article
      {...(onSelect ? { 'data-pane-row': '', 'data-story-id': story.id } : {})}
      className={cx(
        'relative grid gap-x-3.5 gap-y-1.5 border-b border-hairline py-4 last:border-b-0 [overflow-wrap:anywhere]',
        hasThumb ? (compact ? 'grid-cols-[minmax(0,1fr)_88px]' : 'grid-cols-[minmax(0,1fr)_104px]') : 'grid-cols-1',
        // A pane row is a button-like tile: padded so the selected background has room.
        onSelect && '-mx-3 rounded-panel px-3 transition-colors hover:bg-surface-1',
        onSelect && selected && 'bg-surface-2 hover:bg-surface-2',
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
      {kickerExtra && <div className="col-span-full -mt-0.5 text-xs leading-4 text-fg-3">{kickerExtra}</div>}

      <div className="flex min-w-0 flex-col gap-1.5">
        {/* Three lines in a list; the whole headline once the row is open (or in the pane). */}
        <h3 className={cx('t-head', !expanded && !selected && 'line-clamp-3', isRead ? 'font-medium text-fg-3' : 'text-fg-1')}>
          {onSelect ? (
            <button
              type="button"
              onClick={onSelect}
              aria-current={selected ? 'true' : undefined}
              className="text-left after:absolute after:inset-0 after:content-['']"
            >
              <Highlight text={title} query={highlight} />
            </button>
          ) : onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!!expanded}
              className="text-left after:absolute after:inset-0 after:content-['']"
            >
              <Highlight text={title} query={highlight} />
            </button>
          ) : <Highlight text={title} query={highlight} />}
        </h3>
        {dek && !expanded && !compact && (
          <p className="line-clamp-2 text-sm leading-[21px] text-fg-2"><Highlight text={dek} query={highlight} /></p>
        )}
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

      {hasThumb && <StoryThumb story={story} isRead={isRead} size={compact ? 'compact' : 'row'} className="relative z-10 mt-0.5 self-start" />}

      {expanded && children && <div className="col-span-full pt-2">{children}</div>}
    </article>
  )
}
