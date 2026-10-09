'use client'

import { useCallback, useEffect } from 'react'
import { useReader } from '@/lib/reader/ReaderProvider'
import { usePullToRefresh } from '@/lib/reader/usePullToRefresh'
import { TopicsPanel } from '@/components/TopicsPanel'
import { TodayFeed } from '@/components/TodayFeed'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { InstallPrompt } from '@/components/InstallPrompt'
import { AppHeader } from '@/components/reader/AppHeader'
import { ScrollTopButton } from '@/components/reader/ScrollTopButton'
import { FeedToolbar } from '@/components/reader/FeedToolbar'
import { SinceVisitNotice } from '@/components/reader/SinceVisitNotice'
import { FeedList } from '@/components/reader/FeedList'

/** The Reader screen: a thin view over the state held by <ReaderProvider>
 *  (lib/reader). Data loading, read marks, ranking inputs, dwell, pipeline
 *  status and "Run now" all live in the hooks there. */
export default function ReaderClient() {
  const r = useReader()
  const { activate, loadContent, loadReadIds } = r

  // First mount starts the loads; later mounts (back from Search etc.) resume.
  useEffect(() => { activate() }, [activate])

  const refreshAll = useCallback(() => Promise.all([loadContent(), loadReadIds()]), [loadContent, loadReadIds])
  const pullRefreshing = usePullToRefresh({ loading: r.loading, onRefresh: refreshAll })

  const { activeTab } = r
  const isCategoryTab = activeTab !== 'topics' && activeTab !== 'today'

  return (
    <div className="min-h-screen text-slate-100">
      <AppHeader
        lastPipelineRun={r.lastPipelineRun}
        pipelineStruggling={r.pipelineStruggling}
        lastUpdated={r.lastUpdated}
        activeTab={activeTab}
        loading={r.loading}
        refreshing={pullRefreshing}
        onRefresh={() => { loadContent(); loadReadIds() }}
        activeCategoryKeys={r.activeCategoryKeys}
        onTabChange={r.handleTabChange}
        topicCount={r.topicCount}
        todayUnread={r.todayUnread}
        triggerState={r.triggerState}
        triggerMessage={r.triggerMessage}
        triggerError={r.triggerError}
        onTrigger={r.handleTriggerPipeline}
        onDismissTrigger={r.dismissTriggerMessage}
      />

      <ScrollTopButton />

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-3 pb-24 md:pb-6">
        {isCategoryTab && (
          <FeedToolbar
            showUnreadOnly={r.showUnreadOnly}
            unreadCount={r.unreadCount}
            onToggleUnread={r.toggleUnreadOnly}
            onMarkAllRead={r.markAllVisibleRead}
          />
        )}
        {!r.loading && !r.loadError && r.newSinceVisit > 0 && r.prevVisit !== null && !r.dismissedSinceNotice && (
          <SinceVisitNotice count={r.newSinceVisit} since={r.prevVisit} onDismiss={r.dismissSinceNotice} />
        )}

        {/* Today tab */}
        {activeTab === 'today' && (
          <ErrorBoundary>
            <TodayFeed
              stories={r.activeTodayStories}
              sources={r.sources}
              readIds={r.readIds}
              layoutReadIds={r.layoutReadIds}
              sourceWeights={r.sourceWeights}
              topicWeights={r.topicWeights}
              onMarkRead={r.markRead}
              onEngagement={r.sendEngagement}
              onDwellStart={r.startDwell}
              onDwellEnd={r.endDwell}
              onMuteTopic={r.muteTopics}
              loading={r.loading}
              error={r.loadError}
              onRetry={() => { loadContent(); loadReadIds() }}
            />
          </ErrorBoundary>
        )}

        {/* Topics tab */}
        {activeTab === 'topics' && (
          <TopicsPanel
            userId={r.userId}
            readIds={r.readIds}
            onMarkRead={(storyId) => r.markRead(storyId)}
            onEngagement={r.sendEngagement}
          />
        )}

        {/* Category feed */}
        {isCategoryTab && (
          <FeedList
            loading={r.loading}
            loadError={r.loadError}
            isEmpty={r.isEmpty}
            showUnreadOnly={r.showUnreadOnly}
            pinnedMix={r.pinnedMix}
            mergedFeed={r.mergedFeed}
            newLeadCount={r.newLeadCount}
            sources={r.sources}
            readIds={r.readIds}
            onMarkRead={r.markRead}
            onEngagement={(signal, storyId) => r.sendEngagement(signal, storyId)}
            onDwellStart={r.startDwell}
            onDwellEnd={r.endDwell}
            onMuteTopic={r.muteTopics}
            onRetry={() => { loadContent(); loadReadIds() }}
            onShowAll={r.showAllStories}
          />
        )}
      </main>
      <InstallPrompt />
    </div>
  )
}
