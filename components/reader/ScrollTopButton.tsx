'use client'

import { useEffect, useState } from 'react'

/** Scroll-to-top FAB — sits above the bottom nav, safe-area aware. Appears after 600 px. */
export function ScrollTopButton() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!show) return null
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-24 md:bottom-8 right-4 z-40 w-12 h-12 rounded-full bg-slate-800 ring-1 ring-slate-600/80 shadow-[0_4px_20px_rgba(0,0,0,0.5)] flex items-center justify-center text-slate-200 hover:bg-slate-700 active:scale-90 transition-all animate-fade-in-up"
      aria-label="Scroll to top"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
    </button>
  )
}
