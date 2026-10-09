'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { StoryWithRelations } from '@/lib/types'
import { Button, IconButton, cx } from '@/components/ui'
import { StoryListItem } from '@/components/story/StoryListItem'
import type { StoryActions } from '@/components/story/types'
import { useReader } from '@/lib/reader/ReaderProvider'
import { recapDate, sourceCounts, type StorylineEntry } from '@/lib/reader/catchUp'
import { useDwellVisibility } from '@/lib/useDwellVisibility'

/** A developing story, open: kicker, title, who reported it, the recap (So far, by
 *  day; New on <latest day>; where the reports differ), then "See all N reports"
 *  and "Mark all read". The one boxed element of the catch-up.
 *
 *  Reading the recap reads the reports (Ash, 3 Oct 2026): the same dwell rule as a
 *  card, on the whole box (see `endStorylineDwell`). The explicit button is the other
 *  way. A storyline with no recap yet shows its reports straight away and is not
 *  read by dwell, because there was nothing to read. */
export function StorylineCard({ entry, actionsFor, showCategory, onCollapse }: {
  entry: StorylineEntry
  actionsFor: (story: StoryWithRelations) => StoryActions
  showCategory: boolean
  onCollapse: () => void
}) {
  const r = useReader()
  const { storyline, members, unreadIds, recap, range } = entry
  const [listOpen, setListOpen] = useState(!recap)
  const [fullDays, setFullDays] = useState<Set<string>>(new Set())
  const allRead = unreadIds.length === 0
  const counts = sourceCounts(members, id => r.sources[id]?.name)

  // The dwell hook binds its callbacks once, so what to mark is read through a ref.
  const live = useRef({ unreadIds, newestId: members[0]?.id })
  useEffect(() => { live.current = { unreadIds, newestId: members[0]?.id } })
  const dwellRef = useDwellVisibility<HTMLElement>(
    () => { if (recap) r.startStorylineDwell(storyline.id) },
    () => r.endStorylineDwell(storyline.id, live.current.unreadIds, live.current.newestId),
  )

  const toggleDay = (date: string) =>
    setFullDays(prev => { const n = new Set(prev); if (n.has(date)) n.delete(date); else n.add(date); return n })

  const covers = recap && storyline.recap_story_count > 0 && storyline.recap_story_count < storyline.story_count

  return (
    <article
      ref={dwellRef}
      data-storyline-id={storyline.id}
      className="my-2 flex flex-col rounded-panel bg-surface-1 p-4"
    >
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="size-2 flex-none rounded-full bg-warn" />
        <span className="t-kicker flex-none text-warn">Developing</span>
        <span className="t-meta min-w-0 flex-1 truncate">· {members.length} reports · {range}</span>
        <IconButton label="Collapse this story" icon={ChevronUp} onClick={onCollapse} className="-my-3 -mr-3 size-11" />
      </div>
      <h3 className={cx('font-serif text-xl font-semibold leading-[26px] text-balance', allRead ? 'font-medium text-fg-3' : 'text-fg-1')}>
        {storyline.title}
      </h3>
      {counts.length > 0 && (
        <p className="t-meta mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
          {counts.map((c, i) => (
            <span key={c.name}>
              {i > 0 && <span aria-hidden="true" className="mr-1.5">·</span>}
              {c.name} <span className="font-semibold text-fg-2">{c.count}</span>
            </span>
          ))}
        </p>
      )}

      {recap && recap.soFar.length > 0 && (
        <>
          <p className="t-overline mb-2 mt-[18px]">So far</p>
          <ul className="flex flex-col gap-1">
            {recap.soFar.map(day => {
              const full = fullDays.has(day.date)
              return (
                <li key={day.date}>
                  <button
                    type="button"
                    aria-expanded={full}
                    onClick={() => toggleDay(day.date)}
                    className="grid min-h-11 w-full grid-cols-[52px_minmax(0,1fr)] items-start text-left active:opacity-70"
                  >
                    <span className="pt-px text-[13px] font-medium leading-[21px] tabular-nums text-fg-3">{recapDate(day.date)}</span>
                    <span className={cx('text-sm leading-[21px] text-fg-2', !full && 'line-clamp-2')}>{day.text}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {recap?.latest && (
        <>
          <p className="mb-2 mt-[18px] text-xs font-semibold uppercase leading-4 tracking-[0.06em] text-accent">New on {recapDate(recap.latest.date)}</p>
          <p className={cx('text-base leading-[25px] text-pretty', allRead ? 'text-fg-3' : 'text-fg-1')}>{recap.latest.text}</p>
        </>
      )}
      {recap && recap.differ.length > 0 && (
        <p className="t-meta mt-3"><span className="font-semibold text-warn">Reports differ:</span> {recap.differ.join(' · ')}</p>
      )}
      {covers && (
        <p className="t-meta mt-3">This summary covers {storyline.recap_story_count} of {storyline.story_count} reports; it updates with the next refresh.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1">
        <Button
          variant="tonal"
          aria-expanded={listOpen}
          onClick={() => setListOpen(v => !v)}
          className="bg-surface-3! pl-[18px] pr-4"
        >
          See all {members.length} reports
          {listOpen ? <ChevronUp className="size-[18px]" aria-hidden="true" /> : <ChevronDown className="size-[18px]" aria-hidden="true" />}
        </Button>
        {allRead ? (
          <span className="t-meta ml-2 inline-flex items-center gap-1 text-fg-2"><Check className="size-3.5" aria-hidden="true" />All read</span>
        ) : (
          <Button variant="text" onClick={() => { void r.markManyReadUndoable(unreadIds) }}>Mark all read</Button>
        )}
      </div>

      {listOpen && (
        <div className="mt-3 border-t border-hairline">
          {members.map(m => (
            <StoryListItem
              key={m.id}
              story={m}
              compact
              sourceName={r.sources[m.source_id]?.name}
              showCategory={showCategory}
              actions={actionsFor(m)}
            />
          ))}
        </div>
      )}
    </article>
  )
}
