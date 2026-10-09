'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { CategoryNav, type ActiveTab } from '@/components/CategoryNav'
import { CATEGORIES } from '@/lib/categories'
import { msSince } from '@/lib/format'

type TriggerState = 'idle' | 'triggering' | 'waiting' | 'running'

/** Pipeline health line under the title. Three explicit states so silence is
 *  never ambiguous. */
function PipelineStatus({ lastPipelineRun, pipelineStruggling, lastUpdated, showUpdated }: {
  lastPipelineRun: Date | null
  pipelineStruggling: boolean
  lastUpdated: Date | null
  showUpdated: boolean
}) {
  if (lastPipelineRun) {
    const ageMs = msSince(lastPipelineRun)
    const mins = Math.round(ageMs / 60000)
    const ago =
      mins < 60 ? `${mins}m ago`
      : mins < 24 * 60 ? `${Math.round(mins / 60)}h ago`
      : lastPipelineRun.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    // rose  = pipeline down (>24h) or finding-but-failing
    // amber = stale (8–24h since last check)
    // green = checked recently
    const down = ageMs > 24 * 3600 * 1000
    const stale = ageMs > 8 * 3600 * 1000
    const dot = down || pipelineStruggling
      ? 'bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.6)]'
      : stale ? 'bg-amber-400' : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
    const label = pipelineStruggling
      ? `Sources failing · last check ${ago}`
      : down ? `Pipeline down · last check ${ago}`
      : `Checked ${ago}`
    return (
      <p className={`text-xs mt-1 inline-flex items-center gap-1 ${
        down || pipelineStruggling ? 'text-rose-300' : 'text-slate-400'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
        {label}
      </p>
    )
  }
  if (lastUpdated && showUpdated) {
    return (
      <p className="text-xs text-slate-400 mt-1">
        Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </p>
    )
  }
  return null
}

/** Manual pipeline trigger — deliberately a labelled text pill, not another icon
 *  in the action row, so it can't be confused with the cosmetic "Refresh feed"
 *  button (which only re-fetches already-loaded data). */
function RunNow({ state, message, error, onTrigger, onDismiss }: {
  state: TriggerState
  message: string | null
  error: string | null
  onTrigger: () => void
  onDismiss: () => void
}) {
  return (
    <>
      {state === 'idle' && !message && !error && (
        <button
          onClick={onTrigger}
          className="min-h-11 -my-3 pr-3 text-xs font-semibold text-violet-300 hover:text-violet-200 active:opacity-70 transition-colors inline-flex items-center gap-1"
        >
          ⚡ Run now
        </button>
      )}
      {(state !== 'idle' || message || error) && (
        <p role="status" className={`mt-1 text-xs font-semibold inline-flex items-center gap-1 ${
          error ? 'text-rose-300' : 'text-violet-300'
        }`}>
          {state === 'triggering' && 'Triggering…'}
          {state === 'waiting' && message}
          {state === 'running' && message}
          {state === 'idle' && (error || message)}
          {state === 'idle' && (error || message) && (
            <button
              onClick={onDismiss}
              className="min-w-11 min-h-11 -my-3 flex items-center justify-center text-slate-400 hover:text-slate-200"
              aria-label="Dismiss message"
            >
              ×
            </button>
          )}
        </p>
      )}
    </>
  )
}

export function AppHeader({
  lastPipelineRun, pipelineStruggling, lastUpdated, activeTab, loading, refreshing, onRefresh,
  activeCategoryKeys, onTabChange, topicCount, todayUnread,
  triggerState, triggerMessage, triggerError, onTrigger, onDismissTrigger,
}: {
  lastPipelineRun: Date | null
  pipelineStruggling: boolean
  lastUpdated: Date | null
  activeTab: ActiveTab
  loading: boolean
  /** A pull-to-refresh is in flight (spins the refresh icon too). */
  refreshing: boolean
  onRefresh: () => void
  activeCategoryKeys: Set<string>
  onTabChange: (tab: ActiveTab) => void
  topicCount: number
  todayUnread: number
  triggerState: TriggerState
  triggerMessage: string | null
  triggerError: string | null
  onTrigger: () => void
  onDismissTrigger: () => void
}) {
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const [isOffline, setIsOffline] = useState(false)

  // Close the header "More" menu on an outside tap. Deliberately NOT using a
  // fixed inset-0 catcher element: backdrop-filter/filter/transform on any
  // ancestor (the header has carried backdrop-blur in the past) creates a new
  // containing block for position:fixed descendants — a fixed catcher nested
  // inside would only cover the header's own bounds, not the full screen, so
  // taps on the feed below wouldn't close the menu. Ref-based is immune.
  useEffect(() => {
    if (!showMoreMenu) return
    const onPointerDown = (e: PointerEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showMoreMenu])

  // Offline awareness (mobile ergonomics)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator.onLine is unknown during SSR
    setIsOffline(!navigator.onLine)
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  const handleSignOut = async () => {
    await createClient().auth.signOut()
    // A full page load on purpose: it drops all in-memory feed state with the session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/auth'
  }

  return (
    // No backdrop-blur here: a sticky element's backdrop-filter re-samples
    // the content scrolling beneath it on every frame — one of the last
    // remaining per-frame costs on mid-range Android GPUs. Near-opaque
    // solid is visually equivalent on this dark theme.
    <header className="sticky top-0 z-50 bg-slate-950/95 border-b border-slate-800/60">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-[0_0_16px_rgba(139,92,246,0.35)]">
            <svg className="w-4 h-4 text-white" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 12h6m-6-4h2" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-white leading-none tracking-tight">News Brief</h1>
            <PipelineStatus
              lastPipelineRun={lastPipelineRun}
              pipelineStruggling={pipelineStruggling}
              lastUpdated={lastUpdated}
              showUpdated={activeTab !== 'topics'}
            />
            <RunNow
              state={triggerState}
              message={triggerMessage}
              error={triggerError}
              onTrigger={onTrigger}
              onDismiss={onDismissTrigger}
            />
          </div>
        </div>

        {/* Three controls at every width: Search, Refresh, More. (Seven
            fixed-width controls used to be squeezed into a hidden horizontal
            scroller, which pushed Search and Refresh off-screen at 412 px.)
            The More menu is a sibling of nothing scrollable on purpose: any
            overflow-x ancestor would clip its dropdown. */}
        <div className="flex items-center gap-1.5 shrink-0">
          {activeTab !== 'topics' && (
            <button
              onClick={() => { if (!loading) onRefresh() }}
              className="w-11 h-11 shrink-0 rounded-lg bg-slate-800/60 hover:bg-slate-800 ring-1 ring-slate-700/60 hover:ring-slate-600 flex items-center justify-center transition-all active:scale-95"
              title="Refresh"
              aria-label="Refresh feed"
            >
              <svg
                className={`w-4 h-4 text-slate-300 ${loading || refreshing ? 'animate-spin' : ''}`}
                aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}

          <Link
            href="/search"
            prefetch={false}
            className="w-11 h-11 shrink-0 rounded-lg bg-slate-800/60 hover:bg-slate-800 ring-1 ring-slate-700/60 hover:ring-slate-600 flex items-center justify-center transition-all active:scale-95"
            title="Search"
            aria-label="Search"
          >
            <svg className="w-4 h-4 text-slate-300" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
          </Link>

          {/* Archive / Sources / Sign out, labelled so the place to add a
              YouTube channel is findable. */}
          <div ref={moreMenuRef} className="relative shrink-0">
            <button
              onClick={() => setShowMoreMenu(v => !v)}
              className="flex items-center gap-1 px-2.5 h-11 rounded-lg bg-slate-800/60 hover:bg-slate-800 ring-1 ring-slate-700/60 hover:ring-slate-600 transition-all active:scale-95"
              title="More"
              aria-label="More options"
              aria-expanded={showMoreMenu}
            >
              <svg className="w-4 h-4 text-slate-300" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v.01M12 12v.01M12 18v.01" />
              </svg>
              <span className="text-xs font-semibold text-slate-300">More</span>
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 top-full mt-2 z-50 w-48 rounded-xl bg-slate-900 ring-1 ring-slate-700 shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden animate-fade-in-up">
                <Link
                  href="/archive"
                  prefetch={false}
                  className="flex items-center gap-2.5 px-4 min-h-[44px] text-sm text-slate-200 hover:bg-slate-800 active:bg-slate-800"
                  onClick={() => setShowMoreMenu(false)}
                >
                  <svg className="w-4 h-4 text-slate-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Archive
                </Link>
                <Link
                  href="/sources"
                  prefetch={false}
                  className="flex items-center gap-2.5 px-4 min-h-[44px] text-sm text-slate-200 hover:bg-slate-800 active:bg-slate-800"
                  onClick={() => setShowMoreMenu(false)}
                >
                  <svg className="w-4 h-4 text-slate-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  Sources
                </Link>
                <button
                  onClick={() => { setShowMoreMenu(false); handleSignOut() }}
                  className="w-full flex items-center gap-2.5 px-4 min-h-[44px] text-sm text-slate-200 hover:bg-slate-800 active:bg-slate-800 border-t border-slate-800"
                >
                  <svg className="w-4 h-4 text-slate-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign out
                </button>
                {/* Build stamp — confirms which deploy this instance runs */}
                <p className="px-4 py-2 text-xs text-slate-400 font-mono border-t border-slate-800">
                  Build {process.env.NEXT_PUBLIC_BUILD_SHA}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Offline banner — inside the sticky header so it sits below the bar
          and moves with it (it used to be its own sticky top-0 element, which
          slid underneath the header). Stories on screen stay readable. */}
      {isOffline && (
        <div role="status" className="bg-slate-900 border-t border-amber-500/30 px-4 py-2 text-center">
          <p className="text-xs font-semibold text-amber-200 inline-flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728m2.828 9.9a5 5 0 010-7.072m7.072 0a5 5 0 010 7.072M12 12h.01" />
            </svg>
            Offline — showing last loaded stories
          </p>
        </div>
      )}

      {/* Category + Today + Topics tabs — only show categories with recent content */}
      <CategoryNav
        categories={CATEGORIES.filter(c => activeCategoryKeys.has(c.key))}
        active={activeTab}
        onChange={onTabChange}
        topicCount={topicCount}
        todayUnread={todayUnread}
      />
    </header>
  )
}
