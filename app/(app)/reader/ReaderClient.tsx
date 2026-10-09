'use client'

import { useEffect, useLayoutEffect } from 'react'
import { useReader } from '@/lib/reader/ReaderProvider'
import { usePullToRefresh } from '@/lib/reader/usePullToRefresh'
import { isSection } from '@/lib/reader/types'
import { TopicsPanel } from '@/components/TopicsPanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { InstallPrompt } from '@/components/InstallPrompt'
import { TopBar } from '@/components/shell/TopBar'
import { SectionsBar } from '@/components/reader/SectionsBar'
import { FeedToolbar } from '@/components/reader/FeedToolbar'
import { SinceVisitNotice } from '@/components/reader/SinceVisitNotice'
import { FeedList } from '@/components/reader/FeedList'
import { TodayFeed } from '@/components/reader/TodayFeed'

/** The Reader screen: a thin view over the state held by <ReaderProvider>
 *  (lib/reader). Today, Sections and Topics are three views of this one route,
 *  picked by the bottom nav (and, inside Sections, the chip row). */
export default function ReaderClient() {
  const r = useReader()
  const { activate, setViewActive } = r

  // First mount starts the loads; later mounts (back from Search etc.) resume.
  useEffect(() => { activate() }, [activate])

  // Tells the provider whether this screen is showing, so cards torn down because
  // the user left (not because they switched tabs) don't report dwell.
  useLayoutEffect(() => {
    setViewActive(true)
    return () => setViewActive(false)
  }, [setViewActive])

  usePullToRefresh({ loading: r.loading, onRefresh: r.refresh })

  const { activeTab } = r
  const inSections = isSection(activeTab)
  const showNotice = !r.loading && !r.loadError && r.newSinceVisit > 0 && r.prevVisit !== null && !r.dismissedSinceNotice
    && activeTab !== 'topics'

  return (
    <div className="min-h-screen">
      <TopBar>{inSections && <SectionsBar />}</TopBar>

      <main className="mx-auto max-w-2xl px-gutter pb-[calc(var(--spacing-navbar)+env(safe-area-inset-bottom,0px)+1.5rem)]">
        {inSections && (
          <FeedToolbar
            showUnreadOnly={r.showUnreadOnly}
            unreadCount={r.unreadCount}
            onToggleUnread={r.toggleUnreadOnly}
            onMarkAllRead={r.markAllVisibleRead}
          />
        )}
        {showNotice && r.prevVisit !== null && (
          <SinceVisitNotice count={r.newSinceVisit} since={r.prevVisit} onDismiss={r.dismissSinceNotice} />
        )}

        {activeTab === 'today' && <ErrorBoundary><TodayFeed /></ErrorBoundary>}
        {activeTab === 'topics' && <TopicsPanel />}
        {inSections && <FeedList />}
      </main>
      <InstallPrompt />
    </div>
  )
}
