import { useSyncExternalStore } from 'react'

/** The `desk:` breakpoint in globals.css (--breakpoint-desk). */
const QUERY = '(min-width: 1180px)'

function subscribe(onChange: () => void) {
  const m = window.matchMedia(QUERY)
  m.addEventListener('change', onChange)
  return () => m.removeEventListener('change', onChange)
}

/** True on a desktop-width window (the rail + list + reading pane layout). The server
 *  and the first client render say false, so hydration matches the phone layout and the
 *  desktop one follows straight after; the layout shell itself is CSS (`desk:`), so
 *  only the list-versus-card choice waits for this. */
export function useDesk(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
