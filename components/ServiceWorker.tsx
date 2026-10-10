'use client'

import { useEffect } from 'react'

/** Registers the offline-shell service worker (public/sw.js) for the signed-in
 *  screens. Production only: in `next dev` a worker caching pages would hide your own
 *  edits. Renders nothing. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
      console.warn('service worker registration failed', err)
    })
  }, [])
  return null
}
