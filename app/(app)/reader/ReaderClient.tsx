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
import { SavedFeedNotice } from '@/components/reader/SavedFeedNotice'
import { FeedList } from '@/components/reader/FeedList'
import { TodayFeed } from '@/components/reader/TodayFeed'
import { TodayMasthead } from '@/components/reader/TodayMasthead'
import { CatchUpFeed } from '@/components/catchup/CatchUpFeed'
import { CatchUpToggle } from '@/components/catchup/CatchUpToggle'
import { ReadingPane, ReadingPaneProvider } from '@/components/reader/ReadingPane'
import { useDesk } from '@/lib/useDesk'

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
  // The catch-up has its own notice; the plain "N new since you left" is for the normal feed.
  const showNotice = !r.loading && !r.loadError && r.newSinceVisit > 0 && r.prevVisit !== null && !r.dismissedSinceNotice
    && activeTab !== 'topics' && !r.catchUp.on
  const catchUp = r.catchUp.on
  const settled = !r.catchUp.pending   // the toggle and toolbar wait for the automatic decision
  const desk = useDesk()

  return (
    <ReadingPaneProvider enabled={desk} scope={`${activeTab}:${catchUp}`}>
    {/* From 1180 px: this is the list column (440 px, beside the rail); the story opens in the pane. */}
    <div className="min-h-screen desk:w-list desk:border-r desk:border-hairline">
      <TopBar>{inSections && <SectionsBar />}</TopBar>

      <main className="mx-auto max-w-2xl px-gutter pb-[calc(var(--spacing-navbar)+env(safe-area-inset-bottom,0px)+1.5rem+var(--player-h,0px))] desk:max-w-none desk:pb-[calc(2.5rem+var(--player-h,0px))]">
        {inSections && settled && <CatchUpToggle feedLabel="Feed" className="mt-3" />}
        {inSections && settled && !catchUp && (
          <FeedToolbar
            showUnreadOnly={r.showUnreadOnly}
            unreadCount={r.unreadCount}
            onToggleUnread={r.toggleUnreadOnly}
            onMarkAllRead={r.markAllVisibleRead}
          />
        )}
        {activeTab !== 'topics' && <SavedFeedNotice />}
        {showNotice && r.prevVisit !== null && (
          <SinceVisitNotice count={r.newSinceVisit} since={r.prevVisit} onDismiss={r.dismissSinceNotice} />
        )}

        {activeTab === 'today' && !catchUp && <ErrorBoundary><TodayFeed /></ErrorBoundary>}
        {activeTab === 'today' && catchUp && <ErrorBoundary><TodayMasthead /><CatchUpFeed /></ErrorBoundary>}
        {activeTab === 'topics' && <TopicsPanel />}
        {inSections && !catchUp && <FeedList />}
        {inSections && catchUp && <ErrorBoundary><CatchUpFeed /></ErrorBoundary>}
      </main>
      <InstallPrompt />
    </div>
    {desk && <ReadingPane />}
    </ReadingPaneProvider>
  )
}
