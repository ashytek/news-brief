import { ChevronRight } from 'lucide-react'
import { cx } from '@/components/ui'
import type { StorylineEntry } from '@/lib/reader/catchUp'

/** A storyline folded to one row: kicker (Developing · N reports · dates), serif
 *  title, chevron. Tap to open it as a card. */
export function StorylineRow({ entry, onOpen }: { entry: StorylineEntry; onOpen: () => void }) {
  const read = entry.unreadIds.length === 0
  return (
    <button
      type="button"
      aria-expanded={false}
      onClick={onOpen}
      data-storyline-id={entry.storyline.id}
      data-flow
      className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_24px] items-center gap-3 border-b border-hairline py-3.5 text-left active:opacity-70"
    >
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="size-2 flex-none rounded-full bg-warn" />
          <span className="t-kicker flex-none text-warn">Developing</span>
          <span className="t-meta truncate">· {entry.members.length} reports · {entry.range}</span>
        </span>
        <span className={cx('line-clamp-2 font-serif text-[17px] font-semibold leading-[23px] text-pretty', read ? 'font-medium text-fg-3' : 'text-fg-1')}>
          {entry.storyline.title}
        </span>
      </span>
      <ChevronRight className="size-5 flex-none justify-self-end text-fg-3" aria-hidden="true" />
    </button>
  )
}
