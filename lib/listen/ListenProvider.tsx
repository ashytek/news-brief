'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { StoryWithRelations } from '@/lib/types'
import { listenChunks } from '@/lib/format'
import { ListenEngine, type ListenStatus, type Snapshot } from './engine'

export interface ListenItem { story: StoryWithRelations; sourceName?: string }

interface ListenApi {
  /** False where the browser has no speech synthesis: every Listen control is hidden. */
  supported: boolean
  status: ListenStatus
  /** The story being read, or null when idle. */
  current: ListenItem | null
  index: number
  total: number
  /** Read one story. */
  play: (item: ListenItem) => void
  /** Read these in order (the brief). */
  playQueue: (items: ListenItem[]) => void
  pause: () => void
  resume: () => void
  next: () => void
  prev: () => void
  stop: () => void
}

const IDLE: Snapshot = { status: 'idle', index: 0, total: 0, id: null }
const noopSubscribe = () => () => {}
const idleSnapshot = () => IDLE

const Ctx = createContext<ListenApi | null>(null)

/** Listen (roadmap session 8): the speech engine, kept above the screens so a story keeps
 *  being read while you move between Today, Search and Archive. While it plays it keeps the
 *  screen awake (phones stop browser speech when they lock), shows the lock-screen controls
 *  where the browser offers them, and tells the layout how much room the mini player takes
 *  (`--player-h`). Reading never marks a story read. */
export function ListenProvider({ children }: { children: ReactNode }) {
  // Created on the client only (the server has no speech); undefined where unsupported.
  const engine = useMemo(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return null
    const synth = window.speechSynthesis
    return new ListenEngine(
      {
        speak: u => synth.speak(u as SpeechSynthesisUtterance),
        cancel: () => synth.cancel(),
        get speaking() { return synth.speaking },
        getVoices: () => synth.getVoices(),
      },
      text => new SpeechSynthesisUtterance(text) as unknown as ReturnType<ConstructorParameters<typeof ListenEngine>[1]>,
    )
  }, [])

  const supported = useSyncExternalStore(noopSubscribe, () => engine !== null, () => false)
  const snap = useSyncExternalStore(engine?.subscribe ?? noopSubscribe, engine?.getSnapshot ?? idleSnapshot, idleSnapshot)

  // The stories of the queue in play (the engine knows only ids and pieces).
  const items = useRef<ListenItem[]>([])

  const playQueue = useCallback((list: ListenItem[]) => {
    if (!engine) return
    const usable = list.filter(i => listenChunks(i.story).length > 0)
    items.current = usable
    engine.playQueue(usable.map(i => ({ id: i.story.id, chunks: listenChunks(i.story) })))
  }, [engine])
  const play = useCallback((item: ListenItem) => playQueue([item]), [playQueue])

  const pause = useCallback(() => engine?.pause(), [engine])
  const resume = useCallback(() => engine?.resume(), [engine])
  const next = useCallback(() => engine?.next(), [engine])
  const prev = useCallback(() => engine?.prev(), [engine])
  const stop = useCallback(() => engine?.stop(), [engine])

  const current = snap.status === 'idle' ? null : (items.current[snap.index] ?? null)
  const playing = snap.status === 'playing'
  const active = snap.status !== 'idle'

  // Keep the screen on while reading aloud. The lock is released by the browser when the
  // page is hidden, so it is asked for again when the page comes back, and speech that the
  // browser stopped meanwhile is carried on from the piece it was in.
  useEffect(() => {
    if (!playing || !engine) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const hold = async () => {
      try {
        if (!('wakeLock' in navigator)) return
        const l = await navigator.wakeLock.request('screen')
        if (cancelled) void l.release()
        else lock = l
      } catch { /* denied (battery saver, hidden): reading carries on, the screen may sleep */ }
    }
    void hold()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void hold()
      engine.recover()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [playing, engine])

  // Lock-screen / notification controls, where the browser has them.
  useEffect(() => {
    if (!engine || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    if (!active || !current) {
      ms.metadata = null
      return
    }
    ms.metadata = new MediaMetadata({
      title: current.story.headline,
      artist: current.sourceName ?? 'NewsBrief',
      album: 'NewsBrief · Listen',
      artwork: current.story.videos?.thumbnail_url ? [{ src: current.story.videos.thumbnail_url, sizes: '320x180', type: 'image/jpeg' }] : [],
    })
    ms.playbackState = playing ? 'playing' : 'paused'
    const set = (action: MediaSessionAction, fn: () => void) => { try { ms.setActionHandler(action, fn) } catch { /* not supported */ } }
    set('play', () => engine.resume())
    set('pause', () => engine.pause())
    set('stop', () => engine.stop())
    set('nexttrack', () => engine.next())
    set('previoustrack', () => engine.prev())
    return () => {
      for (const a of ['play', 'pause', 'stop', 'nexttrack', 'previoustrack'] as MediaSessionAction[]) set(a, null as unknown as () => void)
    }
  }, [engine, active, playing, current])

  // The mini player is a fixed bar: pages add this to their bottom padding.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--player-h', active ? '65px' : '0px')
    return () => { root.style.removeProperty('--player-h') }
  }, [active])

  const api = useMemo<ListenApi>(() => ({
    supported, status: snap.status, current, index: snap.index, total: snap.total,
    play, playQueue, pause, resume, next, prev, stop,
  }), [supported, snap.status, snap.index, snap.total, current, play, playQueue, pause, resume, next, prev, stop])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useListen(): ListenApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useListen must be used inside <ListenProvider>')
  return v
}
