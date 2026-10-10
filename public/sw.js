/* NewsBrief service worker (roadmap session 7): an offline shell, nothing more.
 *
 * What it does
 *  - /_next/static/* and /icons/*: cache-first. These files are content-hashed, so a
 *    cached copy is never stale; this is what lets the app's JavaScript and fonts load
 *    with no network.
 *  - Navigations to the four signed-in pages (/reader /search /archive /sources):
 *    network-first, falling back (offline, or no answer in 6 s) to the copy of that page
 *    last seen online, then to /reader, then to a one-line offline page. The stories
 *    themselves are not here: the app keeps its own copy of the last feed it loaded
 *    (lib/reader/feedCache.ts), so a cold start with no signal still shows them.
 *
 * What it never touches
 *  - Anything not same-origin GET (Supabase, YouTube thumbnails, every write).
 *  - /api/*, /auth, the manifest, and the RSC payloads of in-app navigation: they go to the
 *    network exactly as if there were no worker.
 *  - A redirect (a signed-out visitor sent to /auth) is never stored as a page.
 *
 * No version constant to forget: static files are hashed, pages are always fetched
 * fresh when there is a network. Sign-out deletes every cache whose name starts "nb-"
 * (lib/offline.ts). Changing this file's bytes is what triggers an update. */
'use strict'

const SHELL = 'nb-shell-v1'    // HTML of the signed-in pages
const STATIC = 'nb-static-v1'  // hashed JS/CSS/fonts and icons
const MAX_STATIC = 400         // oldest entries go first (insertion order)
const PAGES = ['/reader', '/search', '/archive', '/sources']
const NAVIGATE_TIMEOUT_MS = 6000

self.addEventListener('install', () => { self.skipWaiting() })

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Caches left by an older version of this file.
    for (const key of await caches.keys()) {
      if (key.startsWith('nb-') && key !== SHELL && key !== STATIC) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(req))
    return
  }
  if (req.mode === 'navigate' && PAGES.includes(url.pathname)) {
    event.respondWith(navigate(req, url.pathname))
  }
})

async function cacheFirst(req) {
  const cache = await caches.open(STATIC)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) {
    try {
      await cache.put(req, res.clone())
      await trim(cache)
    } catch { /* quota or an uncacheable response: serve it anyway */ }
  }
  return res
}

async function trim(cache) {
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - MAX_STATIC; i++) await cache.delete(keys[i])
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

async function navigate(req, pathname) {
  const cache = await caches.open(SHELL)
  try {
    const res = await withTimeout(fetch(req), NAVIGATE_TIMEOUT_MS)
    // Only a normal 200 for this very page is kept. A navigation's redirect comes back
    // as an opaque redirect (not ok), so a sign-in redirect is never stored.
    if (res.ok && !res.redirected && res.type === 'basic') {
      try { await cache.put(pathname, res.clone()) } catch { /* quota */ }
    }
    return res
  } catch {
    return (await cache.match(pathname)) || (await cache.match('/reader')) || offlinePage()
  }
}

function offlinePage() {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>NewsBrief</title>' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0f12;color:#ececf0;' +
    'font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}p{color:#b6b7c0;max-width:28ch;margin:8px auto 0}</style>' +
    '</head><body><div><h1 style="font:600 24px Georgia,serif;margin:0">You\'re offline</h1>' +
    '<p>NewsBrief needs a connection the first time it opens. Try again when you have signal.</p></div></body></html>'
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
