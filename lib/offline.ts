import { clearFeeds } from '@/lib/reader/feedCache'

/** Everything the app keeps on this device so it can open offline: the saved feeds
 *  (localStorage) and the service worker's caches ("nb-*": the signed-in pages and
 *  the hashed JS/CSS). Called on sign-out, so a signed-out phone doesn't open to a
 *  copy of your pages. Never throws. */
export async function clearDeviceCopy(): Promise<void> {
  clearFeeds()
  try {
    if (typeof caches === 'undefined') return
    const names = await caches.keys()
    await Promise.all(names.filter(n => n.startsWith('nb-')).map(n => caches.delete(n)))
  } catch { /* nothing to clear, or blocked */ }
}
