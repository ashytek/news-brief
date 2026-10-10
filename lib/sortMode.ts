import { useSyncExternalStore } from 'react'

/** How a Sections feed is ordered (roadmap session 8, F013/F102): `latest` = newest first, as it
 *  always was; `foryou` = ranked by your source and topic weights (the same score as the Today
 *  brief, rankItems), still with read stories at the bottom. A setting of this device. */
export type SortMode = 'latest' | 'foryou'

const KEY = 'newsbrief_sort'
const listeners = new Set<() => void>()

export function getSortMode(): SortMode {
  try {
    return localStorage.getItem(KEY) === 'foryou' ? 'foryou' : 'latest'
  } catch {
    return 'latest'   // storage blocked
  }
}

export function setSortMode(m: SortMode): void {
  try { localStorage.setItem(KEY, m) } catch { /* the choice just isn't remembered */ }
  listeners.forEach(l => l())
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** The current sort. `latest` on the server and the first client render, the stored choice straight after. */
export function useSortMode(): SortMode {
  return useSyncExternalStore(subscribe, getSortMode, () => 'latest')
}
