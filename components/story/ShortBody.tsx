'use client'

import { useMemo } from 'react'
import { BellOff, Bookmark, BookmarkCheck, Check, ChevronDown, ChevronUp, Headphones, Share2, Square, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { StoryWithRelations } from '@/lib/types'
import { isRoundUp, readShort } from '@/lib/format'
import { formatDuration } from '@/lib/constants'
import { Button, cx } from '@/components/ui'
import { StoryMenu } from './StoryMenu'
import { TimestampChip } from './TimestampChip'
import type { StoryActions } from './types'

/** Bullets shown before "More" on a legacy dot-bullet story with no short
 *  version. Long prophetic broadcasts used to run 15-25 bullets. */
const BULLET_PREVIEW_COUNT = 5

const POINT = 'relative pl-[17px] text-[15px] leading-[23px] text-pretty before:absolute before:left-px before:top-[9px] before:size-[5px] before:rounded-full before:bg-fg-3 before:content-[""]'

/** The card body, shared by the feed cards and the rows that expand in Search,
 *  Archive and Topics: the short version (lead + key points), the footer
 *  (More · N sections / Mark read / ⋯), and, once opened, the chapters and the
 *  labelled actions. Stories without a short version fall back to the long
 *  overview. The parent owns `sectionsOpen` because the dwell timer needs it. */
export function ShortBody({ story, actions, sectionsOpen, onToggleSections }: {
  story: StoryWithRelations
  actions: StoryActions
  sectionsOpen: boolean
  onToggleSections: () => void
}) {
  const short = useMemo(() => readShort(story.short), [story.short])
  const sections = story.bullets ?? []
  const titled = !!sections[0]?.title
  const videoUrl = story.videos?.url ?? null
  const read = actions.isRead
  const roundUp = isRoundUp(story)
  const dur = story.videos?.duration_seconds
  const duration = dur ? (dur >= 3600 ? formatDuration(dur) : `${Math.max(1, Math.round(dur / 60))} min`) : null

  // Titled sections (the post-July-2026 walkthrough format) and legacy bullets
  // behind a short version stay behind "More"; a legacy story with no short version
  // shows its first few bullets and "More" holds the rest.
  const legacyPreview = !titled && !short
  const needsMore = sections.length > 0 && (titled || !!short || sections.length > BULLET_PREVIEW_COUNT + 1)
  const noun = titled
    ? (sections.some(b => b.timestamp_seconds !== null) ? 'timestamped section' : 'section') + (sections.length === 1 ? '' : 's')
    : sections.length === 1 ? 'bullet' : 'bullets'
  const moreLabel = `More · ${sections.length} ${noun}`

  const text = cx('text-pretty', read ? 'text-fg-3' : 'text-fg-1')
  const bullets = legacyPreview && !sectionsOpen ? sections.slice(0, BULLET_PREVIEW_COUNT) : sections
  const topics = story.matched_topics ?? []

  return (
    <div>
      {short ? (
        <>
          <p className={cx('mt-3 text-base leading-[25px]', text)}>{short.lead}</p>
          {short.keyPoints.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {short.keyPoints.map((point, i) => (
                <li key={i} className={cx(POINT, read ? 'text-fg-3' : 'text-fg-2')}>{point}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className={cx('mt-3 text-base leading-[25px]', text)}>{story.summary}</p>
      )}

      {/* Legacy dot bullets (stories summarised before July 2026) */}
      {!titled && sections.length > 0 && (legacyPreview || sectionsOpen) && (
        <ul className="mt-3 flex flex-col gap-2">
          {bullets.map((b, i) => (
            <li key={i} className={cx(POINT, read ? 'text-fg-3' : 'text-fg-2')}>
              {b.text}
              {b.timestamp_seconds !== null && videoUrl && (
                <> <a
                  href={`${videoUrl}${videoUrl.includes('?') ? '&' : '?'}t=${Math.floor(b.timestamp_seconds)}s`}
                  target="_blank" rel="noopener noreferrer" className="font-medium text-accent"
                >[{Math.floor(b.timestamp_seconds / 60)}:{String(Math.floor(b.timestamp_seconds) % 60).padStart(2, '0')}]</a></>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Chapters: the timestamped walkthrough sections */}
      {titled && sectionsOpen && (
        <div className="mt-5 border-t border-hairline pt-5">
          <p className="t-overline">Chapters · {sections.length}</p>
          <ol className="mt-3.5 flex flex-col gap-[18px]">
            {sections.map((b, i) => (
              <li key={i} className="flex flex-col gap-2">
                <div className="flex items-start gap-3">
                  {b.timestamp_seconds !== null && videoUrl && <TimestampChip videoUrl={videoUrl} seconds={b.timestamp_seconds} />}
                  <h4 className="t-h3 min-w-0 text-fg-1">{b.title}</h4>
                </div>
                <p className="t-body text-pretty text-fg-1">{b.text}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Labelled actions, once the card is open */}
      {sectionsOpen && (
        <div className="mt-6">
          {/* What this is, said plainly (roadmap session 8). Every story's transcript is the
              video's captions (transcript_status is "fetched" for all of them), so there is no
              status to badge; this is the honest label, plus the length and the round-up note. */}
          <p className="t-meta mb-3">
            AI summary of the video&apos;s captions{duration ? ` · ${duration} video` : ''}. Check the video for exact names and figures.
            {roundUp && ' A round-up: it covers several stories, and the headline names only the first.'}
          </p>
          {topics.length > 0 && <p className="t-meta mb-3">Matches your topics: {topics.join(', ')}</p>}
          <div className="flex flex-wrap gap-2">
            <ActionButton icon={ThumbsUp} pressed={actions.reaction === 'like'} onClick={() => actions.onReact('like')}>More like this</ActionButton>
            <ActionButton icon={ThumbsDown} pressed={actions.reaction === 'dislike'} onClick={() => actions.onReact('dislike')}>Less like this</ActionButton>
            {actions.onMute && <ActionButton icon={BellOff} onClick={actions.onMute}>Mute topic</ActionButton>}
            {actions.onListen && (
              <ActionButton icon={actions.listening ? Square : Headphones} active={actions.listening} onClick={actions.onListen}>
                {actions.listening ? 'Stop listening' : 'Listen'}
              </ActionButton>
            )}
            {actions.onSave && (
              <ActionButton icon={actions.saved ? BookmarkCheck : Bookmark} active={actions.saved} onClick={actions.onSave}>
                {actions.saved ? 'Saved' : 'Save for later'}
              </ActionButton>
            )}
            <ActionButton icon={Share2} onClick={actions.onShare}>Share</ActionButton>
          </div>
        </div>
      )}

      {/* Footer: More on the left; Mark read and the ⋯ menu on the right */}
      <div
        className={cx(
          '-mr-3 mt-2 flex items-center justify-between',
          sectionsOpen && 'mt-3 border-t border-hairline pt-1',
        )}
      >
        {needsMore ? (
          <button
            type="button"
            onClick={onToggleSections}
            aria-expanded={sectionsOpen}
            className="inline-flex min-h-12 items-center gap-1.5 whitespace-nowrap text-left text-sm font-medium text-fg-2 active:opacity-70"
          >
            {sectionsOpen ? <ChevronUp className="size-[18px] flex-none" aria-hidden="true" /> : <ChevronDown className="size-[18px] flex-none" aria-hidden="true" />}
            <span>
              {sectionsOpen ? 'Show less' : titled && sections.some(b => b.timestamp_seconds !== null)
                ? <>More · {sections.length} <span className="max-[404px]:hidden">timestamped </span>{sections.length === 1 ? 'section' : 'sections'}</>
                : moreLabel}
            </span>
          </button>
        ) : <span />}
        <div className="flex items-center">
          {!read && (
            <button
              type="button"
              onClick={actions.onRead}
              className="inline-flex min-h-12 items-center gap-1.5 whitespace-nowrap px-2 text-sm font-semibold text-accent active:opacity-70"
            >
              <Check className="size-[18px] flex-none" aria-hidden="true" />
              Mark read
            </button>
          )}
          <StoryMenu actions={actions} />
        </div>
      </div>
    </div>
  )
}

/** `pressed` is a real toggle (More/Less like this): announced as pressed. `active` only
 *  highlights a button whose label already says its state ("Saved", "Stop listening"). */
function ActionButton({ icon, pressed, active, onClick, children }: {
  icon: typeof ThumbsUp
  pressed?: boolean
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      variant="tonal"
      icon={icon}
      aria-pressed={pressed ?? undefined}
      onClick={onClick}
      className={cx('px-3.5', (pressed || active) && 'bg-accent-soft text-accent')}
    >
      {children}
    </Button>
  )
}
