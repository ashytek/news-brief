import { Check } from 'lucide-react'

/** The "Mark read" layer a swiped item uncovers (see `useSwipeToRead`). It hangs off the
 *  item's right edge, so as the item slides left the layer is exactly the strip it leaves
 *  behind; its width is set by `swipeApply`. Hidden and decorative otherwise: the Mark read
 *  button is still there for everyone who does not swipe. */
export function SwipeLayer() {
  return (
    <span
      aria-hidden="true"
      data-swipe-layer=""
      className="group absolute inset-y-0 left-full hidden items-center justify-end overflow-hidden whitespace-nowrap bg-accent-fill pr-4 text-sm font-semibold text-on-accent"
    >
      <span className="inline-flex items-center gap-1.5 opacity-70 transition-opacity group-data-[armed=true]:opacity-100">
        <Check className="size-[18px] flex-none" aria-hidden="true" />
        Mark read
      </span>
    </span>
  )
}
