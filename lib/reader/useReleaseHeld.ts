import { useEffect, useLayoutEffect, useRef } from 'react'
import { anchorView, scrolledPastIds } from './flow'

/** How long the page must have been still before a scrolled-past card is released. */
const IDLE_MS = 150

/**
 * Lets go of dwell-read cards once you have scrolled right past them (roadmap session 11).
 * A card the dwell timer marked read is held in place, dimmed, so it never vanishes while it
 * is being read (Sept 2026). Once it is entirely above the visible area it is no longer being
 * read, so it is released: it stops being shown, like a card you tapped Mark read on.
 *
 * - Checked when the page has stopped moving for 150 ms and no finger is on it, so it never
 *   interrupts a fling (on iOS a programmatic scroll stops the momentum).
 * - Taking a card out from above the screen shifts everything below it up. The page is
 *   scrolled by the same amount in the commit that removes it, before paint (`anchorView`),
 *   so the reader sees no jump, with or without the browser's own scroll anchoring.
 * - It sends nothing: the card had already left the screen, which ended its dwell window.
 */
export function useReleaseHeld(heldIds: Set<string>, release: (ids: string[]) => string[]) {
  const pending = useRef<{ ids: string[]; fix: () => void } | null>(null)
  const active = heldIds.size > 0

  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let touching = false
    const check = () => {
      timer = undefined
      if (touching) return
      const ids = scrolledPastIds()
      if (ids.length === 0) return
      const fix = anchorView()
      const gone = release(ids)
      if (gone.length > 0) pending.current = { ids: gone, fix }
    }
    const later = () => { clearTimeout(timer); timer = setTimeout(check, IDLE_MS) }
    const down = () => { touching = true }
    const up = () => { touching = false; later() }
    window.addEventListener('scroll', later, { passive: true })
    window.addEventListener('touchstart', down, { passive: true })
    window.addEventListener('touchend', up, { passive: true })
    window.addEventListener('touchcancel', up, { passive: true })
    later()
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', later)
      window.removeEventListener('touchstart', down)
      window.removeEventListener('touchend', up)
      window.removeEventListener('touchcancel', up)
    }
  }, [active, release])

  // In the commit that dropped the cards (not an earlier one that happens to land first),
  // before the browser paints.
  useLayoutEffect(() => {
    const p = pending.current
    if (!p || p.ids.some(id => heldIds.has(id))) return
    pending.current = null
    p.fix()
  }, [heldIds])
}
