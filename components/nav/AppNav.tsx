'use client'

import { createContext, useContext, useEffect, useMemo, useRef, type ComponentProps, type MouseEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

interface AppNavApi {
  /** The screen the user was on before the current one (in this session), or null. */
  previousPath: () => string | null
}

const Ctx = createContext<AppNavApi | null>(null)

/** Remembers the previous in-app screen so a "back" arrow can really go back
 *  (restoring scroll) instead of pushing a fresh copy of the page. */
export function AppNavProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const current = useRef(pathname)
  const previous = useRef<string | null>(null)

  useEffect(() => {
    if (current.current !== pathname) {
      previous.current = current.current
      current.current = pathname
    }
  }, [pathname])

  const api = useMemo<AppNavApi>(() => ({ previousPath: () => previous.current }), [])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

/** A link to `href` that behaves as Back when `href` is where the user just
 *  came from: `router.back()` returns to the same history entry, so the feed
 *  keeps its scroll position. On a cold start (e.g. the screen was opened
 *  directly) it is an ordinary link. Modified clicks (new tab) are left alone. */
export function BackLink({ href = '/reader', onClick, ...rest }: Omit<ComponentProps<typeof Link>, 'href'> & { href?: string }) {
  const router = useRouter()
  const nav = useContext(Ctx)

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    if (nav?.previousPath() === href) {
      e.preventDefault()
      router.back()
    }
  }

  // prefetch off: these links used to be plain <a>, which made no request until clicked
  return <Link href={href} prefetch={false} onClick={handleClick} {...rest} />
}
