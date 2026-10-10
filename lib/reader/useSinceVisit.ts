import { useCallback, useEffect, useRef, useState } from 'react'

/** Previous visit time, for the "N new since you left" notice and the
 *  "Before you left" divider (F012). Read before this visit overwrites it.
 *  Read in an effect, for the same hydration reason as the saved tab. */
export function useSinceVisit(enabled: boolean) {
  const [prevVisit, setPrevVisit] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)
  // True once the previous visit has been read (null then means "none on record").
  const [visitReady, setVisitReady] = useState(false)

  // Read the previous visit, then record this one. Guarded so a re-run of the
  // effect (React strict mode in dev) can't read the timestamp it just wrote.
  const visitRecorded = useRef(false)
  /* eslint-disable react-hooks/set-state-in-effect -- previous visit is read from
     localStorage after hydration (UI-041) */
  useEffect(() => {
    if (!enabled || visitRecorded.current) return
    visitRecorded.current = true
    try {
      const t = Date.parse(localStorage.getItem('newsbrief_lastVisit') ?? '')
      setPrevVisit(Number.isNaN(t) ? null : t)
      localStorage.setItem('newsbrief_lastVisit', new Date().toISOString())
    } catch { /* storage blocked: no banner */ }
    setVisitReady(true)
  }, [enabled])
  /* eslint-enable react-hooks/set-state-in-effect */

  /** The app came back from the background after a while (see resume.ts): the
   *  visit that just ended is when it was hidden, and this one starts now. */
  const reopen = useCallback((leftAt: number) => {
    setPrevVisit(leftAt)
    setDismissed(false)
    try { localStorage.setItem('newsbrief_lastVisit', new Date().toISOString()) } catch { /* storage blocked */ }
  }, [])

  return { prevVisit, visitReady, dismissedSinceNotice: dismissed, dismissSinceNotice: () => setDismissed(true), reopen }
}
