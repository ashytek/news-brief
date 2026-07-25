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
      ([entry]) => {
        if (entry.isIntersecting && !visibleRef.current) {
          visibleRef.current = true
          onDwellStart()
        } else if (!entry.isIntersecting && visibleRef.current) {
          visibleRef.current = false
          onDwellEnd()
        }
      },
      { threshold: 0.5 },
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
