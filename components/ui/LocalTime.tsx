'use client'

import { useSyncExternalStore } from 'react'

const noSubscribe = () => () => {}

const FORMAT = {
  datetime: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
  date: { day: 'numeric', month: 'short' },
} as const

/** A timestamp in the VIEWER's time zone. The server (UTC on Netlify) can't know it, so a
 *  server-rendered date differs from what the browser would print and React logs hydration
 *  error #418. This prints nothing on the server and during hydration, then the local time
 *  straight after (`useSyncExternalStore` hands React the server snapshot while hydrating, so
 *  the first client render matches the server's HTML). `suppressHydrationWarning` is the wrong
 *  tool here: it would keep the server's UTC text on screen. */
export function LocalTime({ iso, variant = 'datetime' }: { iso: string; variant?: keyof typeof FORMAT }) {
  const client = useSyncExternalStore(noSubscribe, () => true, () => false)
  return (
    <time dateTime={iso}>
      {client ? new Date(iso).toLocaleString('en-GB', FORMAT[variant]) : ''}
    </time>
  )
}
