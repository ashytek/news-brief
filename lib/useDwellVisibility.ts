'use client'

import { useEffect, useRef } from 'react'

/**
 * Starts/stops dwell tracking based on actual viewport visibility, not
 * mount/unmount. Mounting a card doesn't mean it was seen (it may be
 * scrolled off-screen in a long feed), and unmounting doesn't mean it was
 * read (tab switches and pull-to-refresh unmount every card at once) — the
 * previous mount/unmount-based tracking mass-fired "dwelled 20s+" for every
 * card whenever a feed was torn down, silently marking unseen stories read.
 */
// Fine-grained thresholds so the callback also fires while a card taller than
// the viewport scrolls through: its intersection ratio never reaches 0.5 (a
// card 3 screens tall tops out near 0.33), so a single 0.5 threshold was never
// crossed and the dwell timer never started (audit F029).
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20)

/** On screen enough to count as being read: half the card, or — for a card
 *  taller than the screen — half the screen. */
function isMostlyVisible(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false
  const viewportH = entry.rootBounds?.height ?? window.innerHeight
  return entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= 0.5 * viewportH
}

export function useDwellVisibility<T extends HTMLElement>(
  onDwellStart: () => void,
  onDwellEnd: () => void,
) {
  const ref = useRef<T | null>(null)
  const visibleRef = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[entries.length - 1]
        const visible = isMostlyVisible(entry)
        if (visible && !visibleRef.current) {
          visibleRef.current = true
          onDwellStart()
        } else if (!visible && visibleRef.current) {
          visibleRef.current = false
          onDwellEnd()
        }
      },
      { threshold: THRESHOLDS },
    )
    observer.observe(el)

    return () => {
      observer.disconnect()
      // Still visible at teardown (tab switch, refresh) — close out the
      // dwell window with whatever time actually elapsed while it was on
      // screen, same as a normal scroll-away.
      if (visibleRef.current) {
        visibleRef.current = false
        onDwellEnd()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return ref
}
