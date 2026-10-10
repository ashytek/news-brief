'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSnackbar } from '@/components/ui'
import type { StoryWithRelations } from '@/lib/types'
import { DWELL_SHORT_SECONDS } from '@/lib/constants'
import { isIGRSource } from '@/lib/ranking'
import { nowDate } from '@/lib/format'
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
import { useResume } from './useResume'
import { useHiddenTimeShift } from './useHiddenTimeShift'
import { decideResume } from './resume'
import { useReactions } from './useReactions'
import { useSaved } from './useSaved'
import { useFeedView } from './useFeedView'
import { useSectionUnread } from './useSectionUnread'
import { useCatchUp } from './useCatchUp'
import { buildCatchUp, CATCHUP_AWAY_HOURS } from './catchUp'
import { setSortMode, useSortMode } from '@/lib/sortMode'
import { flowItemOf, revealAfterUndo } from './flow'

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
  // Sections: newest first or ranked for you (kept on the device), and "I have N minutes" (this visit only).
  const sortMode = useSortMode()
  const [timeBudget, setTimeBudget] = useState<number | null>(null)

  // Read marks and pipeline health are needed on every signed-in screen (the
  // top bar's status chip, the read dots in Search and Archive), so they load
  // as soon as the provider mounts. The feed itself still waits for the Reader.
  const read = useReadState(supabase, userId, true)
  // Save for later: loaded on every screen (the Archive's Saved view and the card buttons
  // need it); inert until the table exists. See useSaved.
  const saySaved = useCallback((message: string) => snackbar.show({ message }), [snackbar])
  const saved = useSaved(supabase, userId, true, saySaved)
  const muted = useMutedTopics(supabase, userId, active)
  const weights = useRankingWeights(supabase, userId, active)
  const meta = useFeedMeta(supabase, active)
  const health = usePipelineHealth(supabase, true)
  const sectionUnread = useSectionUnread({
    categoryPool: meta.categoryPool, sources: meta.sources, hasMutedTopic: muted.hasMutedTopic, readIds: read.readIds,
  })
  const visit = useSinceVisit(active)
  // Catch-up on/off: decided once from the last visit and the unread count (the same
  // number as the "All" chip), then the toggle overrides it. See useCatchUp.
  const catchUp = useCatchUp({
    enabled: active,
    visitReady: visit.visitReady,
    prevVisit: visit.prevVisit,
    ready: read.loaded && muted.loaded && sectionUnread !== null,
    unreadCount: sectionUnread?.all ?? null,
  })
  const content = useFeedContent(supabase, { activeTab, tabReady, clearHeld: read.clearHeld, catchUpMode: catchUp.mode })
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
    for (const s of content.catchUpData?.pool ?? []) map.set(s.id, s)
    for (const s of content.catchUpData?.members ?? []) map.set(s.id, s)
    return map
  }, [content.soloStories, content.todayStories, content.catchUpData])

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

  const view = useFeedView({
    activeTab,
    soloStories: content.soloStories,
    todayStories: content.todayStories,
    sources: meta.sources,
    readIds: read.readIds,
    layoutReadIds: read.layoutReadIds,
    briefReadIds: read.briefReadIds,
    showUnreadOnly,
    hasMutedTopic: muted.hasMutedTopic,
    prevVisit: visit.prevVisit,
    sourceWeights: weights.sourceWeights,
    topicWeights: weights.topicWeights,
    sortMode,
    timeBudget,
  })

  // Explicit "Mark read" taps get an Undo (the dwell timer's auto-mark does not:
  // it happens while you are reading). A tap means you are done with the story, so it
  // leaves the list (Ash, 10 Oct 2026; session 4 had held it in place, dimmed).
  // Bringing the next story to the top of the screen is the caller's job (see
  // useStoryActions and flow.ts); Undo brings the story back into view. The dwell
  // timer's own mark still holds the card: that one happens mid-read.
  const markReadUndoable = useCallback(async (storyId: string) => {
    const ok = await read.markRead(storyId, { done: true })
    if (!ok) {
      // Already read (nothing to say), or the write failed and the card came back.
      if (!read.readIds.has(storyId)) {
        snackbar.show({ message: "Couldn't mark as read. Try again." })
        revealAfterUndo(() => flowItemOf(storyId))
      }
      return
    }
    snackbar.show({
      message: 'Marked as read',
      actionLabel: 'Undo',
      onAction: () => {
        void read.markUnread([storyId]).then(done => { if (!done) snackbar.show({ message: "Couldn't undo. Try again." }) })
        revealAfterUndo(() => flowItemOf(storyId))
      },
    })
  }, [read, snackbar])

  /** `hold` keeps the cards in place, dimmed, like a dwell mark (a storyline read by
   *  its recap); without it they leave the list (Mark all read, Mark day read).
   *  `reveal` finds what an Undo brings back (a day, a storyline), to show it.
   *  Saved stories are exempt from every bulk mark (Ash, roadmap session 8): they stay
   *  unread, and the message says how many were kept. */
  const savedIds = saved.ids
  const markManyReadUndoable = useCallback(async (storyIds: string[], opts?: { hold?: boolean; reveal?: () => Element | null }) => {
    const keptSaved = storyIds.filter(id => savedIds.has(id) && !read.readIds.has(id)).length
    const ids = keptSaved > 0 ? storyIds.filter(id => !savedIds.has(id)) : storyIds
    const kept = keptSaved > 0 ? ` · ${keptSaved} saved kept` : ''
    const wanted = ids.filter(id => !read.readIds.has(id)).length
    const done = await read.markManyRead(ids, opts)
    if (done === null) {
      snackbar.show({ message: "Couldn't mark as read. Try again." })
      return
    }
    if (done.length === 0) {
      // Everything asked for was already read (in another tab, say): nothing to undo.
      if (wanted > 0) snackbar.show({ message: 'Already marked as read' })
      else if (keptSaved > 0) snackbar.show({ message: `Nothing to mark: ${keptSaved} saved ${keptSaved === 1 ? 'story' : 'stories'} kept unread` })
      return
    }
    snackbar.show({
      message: (done.length === 1 ? 'Marked as read' : `Marked ${done.length} as read`) + kept,
      actionLabel: 'Undo',
      onAction: () => {
        void read.markUnread(done).then(ok => { if (!ok) snackbar.show({ message: "Couldn't undo. Try again." }) })
        if (opts?.reveal) revealAfterUndo(opts.reveal)
      },
    })
  }, [read, snackbar, savedIds])

  const markUnread = useCallback(async (storyId: string) => {
    const ok = await read.markUnread([storyId])
    snackbar.show({ message: ok ? 'Marked as unread' : "Couldn't mark as unread. Try again." })
  }, [read, snackbar])

  // The catch-up view of the current tab (null when it is off or its data hasn't landed).
  const { catchUpData } = content
  const { hasMutedTopic } = muted
  const catchUpView = useMemo(() => {
    if (!catchUp.on || !catchUpData) return null
    return buildCatchUp({
      pool: catchUpData.pool,
      members: catchUpData.members,
      storylines: catchUpData.storylines,
      readIds: read.readIds,
      layoutReadIds: read.layoutReadIds,
      keep: s => meta.sources[s.source_id]?.is_active !== false && !hasMutedTopic(s.matched_topics),
      isIGR: s => isIGRSource(meta.sources[s.source_id]),
      now: nowDate(),
      prevVisit: visit.prevVisit,
    })
  }, [catchUp.on, catchUpData, read.readIds, read.layoutReadIds, meta.sources, hasMutedTopic, visit.prevVisit])

  // Reading a storyline's recap reads its reports (Ash, 3 Oct 2026): the same dwell
  // rule as a card (40 s on screen), applied to all the reports at once, held in
  // place and with an Undo, because it is many marks from one pause. One `dwell_long`
  // signal for the newest report, not one per report (that would count a single
  // reading 22 times towards the topic weights). Callbacks are bound once by the
  // dwell hook, so the current marking function is read through a ref.
  const storylineDwell = useRef<Map<string, number>>(new Map())
  useHiddenTimeShift(storylineDwell)
  const markManyRef = useRef(markManyReadUndoable)
  useLayoutEffect(() => { markManyRef.current = markManyReadUndoable })
  const startStorylineDwell = useCallback((id: string) => { storylineDwell.current.set(id, Date.now()) }, [])
  const endStorylineDwell = useCallback((id: string, unreadIds: string[], newestId?: string) => {
    const start = storylineDwell.current.get(id)
    if (!start) return
    storylineDwell.current.delete(id)
    if (!viewActive.current) return   // leaving the Reader is not reading
    if ((Date.now() - start) / 1000 > DWELL_SHORT_SECONDS && unreadIds.length > 0) {
      void sendEngagement('dwell_long', newestId)
      void markManyRef.current(unreadIds, { hold: true })
    }
  }, [sendEngagement])

  // One-tap "clear the deck" for the current Sections feed
  const markAllVisibleRead = useCallback(() => {
    // What is on the list, which with "I have N minutes" on is only the stories that fit.
    const storyIds = [...view.pinnedMix, ...view.mergedFeed].filter(s => !read.readIds.has(s.id)).map(s => s.id)
    return markManyReadUndoable(storyIds)
  }, [view.pinnedMix, view.mergedFeed, read.readIds, markManyReadUndoable])

  // Refresh = reload what is on screen in the background (the feed stays put),
  // the read marks, and the pipeline status. Button, pull-to-refresh and the
  // status sheet all come here.
  const { loadReadIds } = read
  const { refreshPipelineHealth } = health
  const refresh = useCallback(
    () => Promise.all([loadContent({ background: true }), loadReadIds(), refreshPipelineHealth()]).then(() => undefined),
    [loadContent, loadReadIds, refreshPipelineHealth],
  )

  // Coming back to the app after it sat in the background (it is not reloaded):
  // see resume.ts for the rules. Only while a Reader screen is showing; on Search
  // or Archive the Reader's own resume (`activate`, below) does its 10-minute check
  // when you return to it.
  const { reopen: reopenVisit } = visit
  const { reset: resetCatchUp } = catchUp
  const catchUpOn = catchUp.on
  useResume({
    enabled: active,
    onResume: (awayMs, hiddenAt) => {
      if (!viewActive.current) return
      const d = decideResume({ awayMs, catchUpOn, reopenAfterMs: CATCHUP_AWAY_HOURS * 3_600_000 })
      if (d.newVisit) reopenVisit(hiddenAt)
      if (d.redecide) {
        // Catch-up is decided afresh; the stories load from that decision. The read
        // marks and the status chip are still brought up to date now.
        resetCatchUp()
        void loadReadIds()
        void refreshPipelineHealth()
      } else if (d.refresh) {
        void refresh()
      }
    },
  })

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
    catchUp, catchUpView, startStorylineDwell, endStorylineDwell, sectionUnread,
    showUnreadOnly, toggleUnreadOnly, showAllStories,
    sortMode, setSortMode, timeBudget, setTimeBudget,
    // data
    sources: meta.sources, topicCount: meta.topicCount, activeCategoryKeys: meta.activeCategoryKeys,
    sourceWeights: weights.sourceWeights, topicWeights: weights.topicWeights,
    soloStories: content.soloStories, todayStories: content.todayStories,
    loading: content.loading, refreshing: content.refreshing, loadError: content.loadError, lastUpdated: content.lastUpdated,
    savedAt: content.savedAt,
    loadContent: content.loadContent, refresh,
    // read state
    readIds: read.readIds, readLoaded: read.loaded, layoutReadIds: read.layoutReadIds, loadReadIds: read.loadReadIds,
    markRead: read.markRead, markReadUndoable, markManyReadUndoable, markUnread, markAllVisibleRead,
    reactions: reactions.reactions, react: reactions.react,
    saved: { ids: saved.ids, available: saved.available, toggle: saved.toggle, reload: saved.reload },
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
