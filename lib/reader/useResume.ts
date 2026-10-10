import { useEffect, useLayoutEffect, useRef } from 'react'

/** Calls `onResume(awayMs, hiddenAt)` when the page becomes visible again after it
 *  was hidden (switching apps, locking the phone, another browser tab). What to do
 *  about it is decided by `decideResume` (resume.ts). Dormant until `enabled`. */
export function useResume({ enabled, onResume }: {
  enabled: boolean
  onResume: (awayMs: number, hiddenAt: number) => void
}) {
  const hiddenAt = useRef<number | null>(null)
  // The listener is bound once; it calls whatever the latest callback is.
  const latest = useRef(onResume)
  useLayoutEffect(() => { latest.current = onResume })

  useEffect(() => {
    if (!enabled) return
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
        return
      }
      const t = hiddenAt.current
      hiddenAt.current = null
      if (t !== null) latest.current(Date.now() - t, t)
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [enabled])
}
