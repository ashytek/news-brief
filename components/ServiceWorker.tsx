'use client'

import { useEffect } from 'react'

/** The pages the worker keeps a copy of (the same list as public/sw.js). */
const PAGES = ['/reader', '/search', '/archive', '/sources']

/** Registers the offline-shell service worker (public/sw.js) for the signed-in
 *  screens. Production only: in `next dev` a worker caching pages would hide your own
 *  edits. Renders nothing.
 *
 *  First visit: the page that registered the worker loaded before the worker controlled
 *  it, so neither its files nor the page itself went through the worker's cache. Once the
 *  worker has taken control, this page asks again for the files it already loaded (the
 *  worker caches them on the way through) and stores its own HTML, so the very next cold
 *  start without signal already works. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    let cancelled = false

    async function warm() {
      // Controlled now? If not, wait for the worker's `clients.claim()`.
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
      }
      if (cancelled) return
      const files = performance.getEntriesByType('resource')
        .map(e => e.name)
        .filter(u => u.startsWith(`${location.origin}/_next/static/`))
      await Promise.all(files.map(u => fetch(u).catch(() => undefined)))   // through the worker: cached
      if (PAGES.includes(location.pathname)) {
        const res = await fetch(location.pathname, { headers: { Accept: 'text/html' } })
        if (res.ok && !res.redirected) await (await caches.open('nb-shell-v1')).put(location.pathname, res)
      }
    }

    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(() => {
        // Only the very first install needs warming: a worker that already controls
        // the page has been caching every request since.
        if (!navigator.serviceWorker.controller) return warm().catch(() => undefined)
      })
      .catch(err => { console.warn('service worker registration failed', err) })
    return () => { cancelled = true }
  }, [])
  return null
}
