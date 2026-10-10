import { useSyncExternalStore } from 'react'

/** Feed density (roadmap session 7): `comfortable` = the short cards; `compact` = headline
 *  rows (88 px thumbnail, no dek) that open to the short card on tap. A setting on the
 *  device, kept in localStorage. */
export type Density = 'comfortable' | 'compact'

const KEY = 'newsbrief_density'
const listeners = new Set<() => void>()

export function getDensity(): Density {
  try {
    return localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'   // storage blocked
  }
}

export function setDensity(d: Density): void {
  try { localStorage.setItem(KEY, d) } catch { /* the choice just isn't remembered */ }
  listeners.forEach(l => l())
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)   // another tab changed it
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** The current density. `comfortable` on the server and the first client render
 *  (so hydration matches), the stored choice straight after. */
export function useDensity(): Density {
  return useSyncExternalStore(subscribe, getDensity, () => 'comfortable')
}
