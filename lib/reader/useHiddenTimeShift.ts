import { useEffect } from 'react'

/**
 * Time the page spends hidden (the phone locked, another app in front) is not time
 * spent reading. The dwell timers store a start time and are read against `Date.now()`
 * when the card leaves the screen, so without this a card that was on screen when the
 * screen turned off "dwelled" for the whole night: the first scroll after waking marked it
 * read and sent a `dwell_long` signal into the ranking weights. When the page comes back,
 * every running timer's start is moved forward by the time it was away.
 *
 * `timers` maps an id to its start time (ms), as in useDwellTracking and the storyline
 * dwell in ReaderProvider.
 */
export function useHiddenTimeShift(timers: { current: Map<string, number> }) {
  useEffect(() => {
    let hiddenAt: number | null = null
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt === null) return
      const away = Date.now() - hiddenAt
      hiddenAt = null
      for (const [id, start] of timers.current) timers.current.set(id, start + away)
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [timers])
}
