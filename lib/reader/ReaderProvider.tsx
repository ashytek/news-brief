'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSnackbar } from '@/components/ui'
import type { StoryWithRelations } from '@/lib/types'
import { useActiveTab } from './useActiveTab'
import { useReadState } from './useReadState'
import { useMutedTopics } from './useMutedTopics'
import { useRankingWeights } from './useRankingWeights'
import { useFeedMeta } from './useFeedMeta'
import { usePipelineHealth } from './usePipelineHealth'
import { useFeedContent } from './useFeedContent'
import { usePipelineTrigger } from './usePipelineTrigger'
import { useDwellTracking, useEngagement } from './useEngagement'
import { useSinceVisit } from './useSinceVisit'
import { useReactions } from './useReactions'
import { useFeedView } from './useFeedView'

/** A feed kept in memory from before a trip to Search/Archive/Sources is shown
 *  at once; if it is older than this when you come back it is revalidated in
 *  the background. */
const FEED_STALE_MS = 10 * 60_000

function useReaderValue(userId: string) {
  // The browser client is a singleton; memoised so hooks can list it as a dependency.
  const supabase = useMemo(() => createClient(), [])

  // The provider sits in the shared (app) layout, so it is mounted on every
  // signed-in screen — but only the Reader needs the feed. Nothing loads until
  // the Reader first mounts and calls `activate()`.
  const [active, setActive] = useState(false)
  const activated = useRef(false)

  const snackbar = useSnackbar()

  const { activeTab, lastSection, tabReady, handleTabChange, openSections } = useActiveTab(active)
  const [showUnreadOnly, setShowUnreadOnly] = useState(true)

  // Read marks and pipeline health are needed on every signed-in screen (the
  // top bar's status chip, the read dots in Search and Archive), so they load
  // as soon as the provider mounts. The feed itself still waits for the Reader.
  const read = useReadState(supabase, userId, true)
  const muted = useMutedTopics(supabase, userId, active)
  const weights = useRankingWeights(supabase, userId, active)
  const meta = useFeedMeta(supabase, active)
  const health = usePipelineHealth(supabase, true)
  const content = useFeedContent(supabase, { activeTab, tabReady, clearHeld: read.clearHeld })
  // A finished "Run now" reloads the feed in the background: no skeleton, no blank screen.
  const { loadContent } = content
  const reloadInBackground = useCallback(() => loadContent({ background: true }), [loadContent])
  const trigger = usePipelineTrigger(supabase, {
    loadContent: reloadInBackground,
    loadReadIds: read.loadReadIds,
    refreshPipelineHealth: health.refreshPipelineHealth,
  })

  // storyId -> story, across both collections currently in memory (category
  // tab + Today) — used so a like/dislike can look up the story's source_id.
  const storyById = useMemo(() => {
    const map = new Map<string, StoryWithRelations>()
    for (const s of content.soloStories) map.set(s.id, s)
    for (const s of content.todayStories) map.set(s.id, s)
    return map
  }, [content.soloStories, content.todayStories])

  const sendEngagement = useEngagement(supabase, userId, storyById, weights.setSourceWeights)
  const reactions = useReactions(supabase, userId, true, sendEngagement)
  // True while a Reader screen is mounted. Set from a layout effect, whose cleanup
  // always runs before the cards' (passive) teardown on the same commit — see
  // useDwellTracking for why that ordering matters.
  const viewActive = useRef(false)
  const setViewActive = useCallback((v: boolean) => { viewActive.current = v }, [])
  // The newest read set, for the dwell teardown (see useDwellTracking). A layout
  // effect: it runs before the passive cleanup of cards that vanished in the same commit.
  const readNow = useRef(read.readIds)
  useLayoutEffect(() => { readNow.current = read.readIds }, [read.readIds])
  const isRead = useCallback((id: string) => readNow.current.has(id), [])
  const { startDwell, endDwell } = useDwellTracking(sendEngagement, read.markRead, viewActive, isRead)
  const visit = useSinceVisit(active)

  const view = useFeedView({
    activeTab,
    soloStories: content.soloStories,
    todayStories: content.todayStories,
    sources: meta.sources,
    readIds: read.readIds,
    layoutReadIds: read.layoutReadIds,
    showUnreadOnly,
    hasMutedTopic: muted.hasMutedTopic,
    prevVisit: visit.prevVisit,
    categoryPool: meta.categoryPool,
    sourceWeights: weights.sourceWeights,
    topicWeights: weights.topicWeights,
  })

  // Explicit "Mark read" taps get an Undo (the dwell timer's auto-mark does not:
  // it happens while you are reading). Like the dwell mark, a tap *holds* the card
  // in place, dimmed, instead of pulling it out of an Unread list from under your
  // thumb; the next refresh or the Unread/All switch lets it go. (It also means the
  // card is not torn down, so no "glanced and left" signal is reported for it.)
  const markReadUndoable = useCallback(async (storyId: string) => {
    const ok = await read.markRead(storyId, { hold: true })
    if (!ok) return   // already read, or the write failed and was rolled back
    snackbar.show({
      message: 'Marked as read',
      actionLabel: 'Undo',
      onAction: () => {
        void read.markUnread([storyId]).then(done => { if (!done) snackbar.show({ message: "Couldn't undo. Try again." }) })
      },
    })
  }, [read, snackbar])

  const markManyReadUndoable = useCallback(async (storyIds: string[]) => {
    const wanted = storyIds.filter(id => !read.readIds.has(id)).length
    const done = await read.markManyRead(storyIds)
    if (done.length === 0) {
      if (wanted > 0) snackbar.show({ message: "Couldn't mark as read. Try again." })
      return
    }
    snackbar.show({
      message: done.length === 1 ? 'Marked as read' : `Marked ${done.length} as read`,
      actionLabel: 'Undo',
      onAction: () => {
        void read.markUnread(done).then(ok => { if (!ok) snackbar.show({ message: "Couldn't undo. Try again." }) })
      },
    })
  }, [read, snackbar])

  const markUnread = useCallback(async (storyId: string) => {
    const ok = await read.markUnread([storyId])
    snackbar.show({ message: ok ? 'Marked as unread' : "Couldn't mark as unread. Try again." })
  }, [read, snackbar])

  // One-tap "clear the deck" for the current Sections feed
  const markAllVisibleRead = useCallback(() => {
    const storyIds = view.visibleSolos.filter(s => !read.readIds.has(s.id)).map(s => s.id)
    return markManyReadUndoable(storyIds)
  }, [view.visibleSolos, read.readIds, markManyReadUndoable])

  // Refresh = reload what is on screen in the background (the feed stays put),
  // the read marks, and the pipeline status. Button, pull-to-refresh and the
  // status sheet all come here.
  const { loadReadIds } = read
  const { refreshPipelineHealth } = health
  const refresh = useCallback(
    () => Promise.all([loadContent({ background: true }), loadReadIds(), refreshPipelineHealth()]).then(() => undefined),
    [loadContent, loadReadIds, refreshPipelineHealth],
  )

  /** Unread / All toggle. Releases held (dwell-read) cards, as before. */
  const toggleUnreadOnly = useCallback(() => {
    read.clearHeld()
    setShowUnreadOnly(v => !v)
  }, [read])

  const showAllStories = useCallback(() => setShowUnreadOnly(false), [])

  // Called whenever a Reader view mounts. First time: start loading. Later
  // (coming back from another screen): the feed is still here, so refresh what
  // other screens may have changed — read marks — and revalidate the stories
  // only if they have gone stale.
  const resumeRef = useRef<() => void>(() => {})
  useEffect(() => {
    resumeRef.current = () => {
      if (content.lastLoadedAt.current === 0) return   // first load still in flight
      read.loadReadIds()
      if (Date.now() - content.lastLoadedAt.current > FEED_STALE_MS) content.loadContent({ background: true })
    }
  })
  const activate = useCallback(() => {
    if (!activated.current) {
      activated.current = true
      setActive(true)
      return
    }
    resumeRef.current()
  }, [])

  return {
    userId, activate, setViewActive,
    activeTab, lastSection, tabReady, handleTabChange, openSections,
    showUnreadOnly, toggleUnreadOnly, showAllStories,
    // data
    sources: meta.sources, topicCount: meta.topicCount, activeCategoryKeys: meta.activeCategoryKeys,
    sourceWeights: weights.sourceWeights, topicWeights: weights.topicWeights,
    soloStories: content.soloStories, todayStories: content.todayStories,
    loading: content.loading, refreshing: content.refreshing, loadError: content.loadError, lastUpdated: content.lastUpdated,
    loadContent: content.loadContent, refresh,
    // read state
    readIds: read.readIds, layoutReadIds: read.layoutReadIds, loadReadIds: read.loadReadIds,
    markRead: read.markRead, markReadUndoable, markManyReadUndoable, markUnread, markAllVisibleRead,
    reactions: reactions.reactions, react: reactions.react,
    muteTopics: muted.muteTopics,
    sendEngagement, startDwell, endDwell,
    // pipeline
    lastPipelineRun: health.lastPipelineRun, pipelineStruggling: health.pipelineStruggling,
    triggerState: trigger.triggerState, triggerError: trigger.triggerError, triggerMessage: trigger.triggerMessage,
    handleTriggerPipeline: trigger.handleTriggerPipeline, dismissTriggerMessage: trigger.dismissTriggerMessage,
    // since you left
    prevVisit: visit.prevVisit, dismissedSinceNotice: visit.dismissedSinceNotice, dismissSinceNotice: visit.dismissSinceNotice,
    // derived
    ...view,
  }
}

type ReaderValue = ReturnType<typeof useReaderValue>

const Ctx = createContext<ReaderValue | null>(null)

/** Holds the Reader's feed state above the individual screens (see the (app)
 *  layout), so going to Search or Archive and back finds the feed — and your
 *  place in it — exactly as you left it. */
export function ReaderProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <Ctx.Provider value={useReaderValue(userId)}>{children}</Ctx.Provider>
}

export function useReader(): ReaderValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useReader must be used inside <ReaderProvider>')
  return v
}
