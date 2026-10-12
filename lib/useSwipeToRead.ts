'use client'

import { useCallback, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { isLeaving, markMoved, reducedMotion, swipeApply, swipeReset } from '@/lib/reader/flow'

/** Swipe to mark read (roadmap session 11): touch only, right to left. */
const LOCK_PX = 10          // how far a finger must move before we decide what it is doing
const HORIZONTAL = 1.5      // ...and it is ours only if it moved this much more sideways than up or down
const SHARE = 0.35          // past this share of the width it counts
const FLING_SPEED = 0.5     // px per ms: a fast flick counts too...
const FLING_MIN_PX = 60     // ...once it has gone this far
const SLIDE_MS = 130
const SPRING_MS = 220
const GUTTER_MAX = 16       // the layer reaches to the page gutter, no further

interface Gesture {
  id: number
  el: HTMLElement
  x0: number
  y0: number
  width: number
  gutter: number
  locked: boolean
  ignored: boolean
  tx: number
  samples: { t: number; x: number }[]
}

/** Ease `from` to `to` over `ms`, calling `step` each frame; `done` once (even if frames stop). */
function tween(from: number, to: number, ms: number, step: (v: number) => void, done: () => void) {
  if (reducedMotion()) { step(to); done(); return }
  const t0 = performance.now()
  let over = false
  const end = () => { if (over) return; over = true; step(to); done() }
  const frame = (now: number) => {
    if (over) return
    const p = Math.min(1, (now - t0) / ms)
    if (p >= 1) return end()
    step(from + (to - from) * (1 - Math.pow(1 - p, 3)))
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  setTimeout(end, ms + 150)   // a hidden tab stops frames; the swipe still finishes
}

/** Is the reader selecting text inside this element? A swipe must not fight that. */
function selectingIn(el: Element): boolean {
  const sel = window.getSelection()
  return !!sel && !sel.isCollapsed && !!sel.anchorNode && el.contains(sel.anchorNode)
}

/**
 * Swipe an item right to left to mark it read. Past 35% of its width (or a fast flick) it
 * slides off and `onRead` runs, which is the same path as tapping Mark read (the item leaves,
 * the next comes to the top, Undo is offered); short of that it springs back. An accent
 * "Mark read" layer (`SwipeLayer`, a child of the item) shows underneath.
 *
 * Plain pointer events, no library. `touch-action: pan-y` (returned as `className`) leaves
 * vertical scrolling and pinch-zoom to the browser and gives us the sideways moves; the
 * gesture is ours only once it has moved 10 px and is clearly sideways, and a vertical drag
 * (the browser takes it over and cancels the pointer) never marks anything. Mouse and pen are
 * ignored, so desktop pointers never swipe; so are items with text selected in them.
 */
export function useSwipeToRead({ enabled, onRead }: { enabled: boolean; onRead: () => void }) {
  const live = useRef({ enabled, onRead })
  useLayoutEffect(() => { live.current = { enabled, onRead } })
  const g = useRef<Gesture | null>(null)
  const busy = useRef(false)   // sliding off or springing back

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!live.current.enabled || busy.current || e.pointerType !== 'touch' || !e.isPrimary) return
    const el = e.currentTarget
    if (selectingIn(el)) return
    const r = el.getBoundingClientRect()
    g.current = {
      id: e.pointerId, el, x0: e.clientX, y0: e.clientY, width: r.width,
      gutter: Math.max(0, Math.min(GUTTER_MAX, window.innerWidth - r.right)),
      locked: false, ignored: false, tx: 0, samples: [],
    }
  }, [])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = g.current
    if (!s || s.ignored || e.pointerId !== s.id) return
    const dx = e.clientX - s.x0
    const dy = e.clientY - s.y0
    if (!s.locked) {
      if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return
      if (dx < 0 && Math.abs(dx) > Math.abs(dy) * HORIZONTAL) {
        s.locked = true
        try { s.el.setPointerCapture(e.pointerId) } catch { /* the pointer is already gone */ }
        s.el.style.willChange = 'transform'
        s.el.style.userSelect = 'none'
        s.el.style.setProperty('-webkit-user-select', 'none')
        window.dispatchEvent(new Event('nb-swipe-lock'))   // a sideways drag is not a pull to refresh
      } else {
        s.ignored = true   // vertical, or to the right: not ours, for the rest of this touch
        return
      }
    }
    markMoved()   // the item leaving the screen sideways was not glanced at and skipped
    s.tx = Math.max(-s.width, Math.min(0, dx))
    s.samples.push({ t: e.timeStamp, x: s.tx })
    if (s.samples.length > 6) s.samples.shift()
    swipeApply(s.el, s.tx, s.gutter, -s.tx >= s.width * SHARE)
  }, [])

  const finish = useCallback((e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const s = g.current
    if (!s || e.pointerId !== s.id) return
    g.current = null
    if (!s.locked) return
    try { s.el.releasePointerCapture(s.id) } catch { /* already released */ }
    // Speed over the last ~100 ms (a finger that rested before lifting is not a flick).
    const last = s.samples[s.samples.length - 1]
    const old = s.samples.find(p => last && last.t - p.t <= 100)
    const speed = last && old && last.t > old.t && e.timeStamp - last.t <= 80 ? (last.x - old.x) / (last.t - old.t) : 0
    const far = -s.tx >= s.width * SHARE
    const flick = speed <= -FLING_SPEED && -s.tx >= FLING_MIN_PX
    busy.current = true
    if (!cancelled && live.current.enabled && (far || flick)) {
      tween(s.tx, -s.width, SLIDE_MS, v => swipeApply(s.el, v, s.gutter, true), () => {
        try { live.current.onRead() } finally {
          // The list normally takes the item away within a few frames (`leave`); if it did not,
          // put it back rather than leave it parked off screen.
          setTimeout(() => { busy.current = false; if (s.el.isConnected && !isLeaving(s.el)) swipeReset(s.el) }, 600)
        }
      })
    } else {
      tween(s.tx, 0, SPRING_MS, v => swipeApply(s.el, v, s.gutter), () => { swipeReset(s.el); busy.current = false })
    }
  }, [])

  return {
    /** Add to the item: `touch-action: pan-y` only while swiping is on. */
    className: enabled ? 'touch-pan-y touch-pinch-zoom' : '',
    /** Spread on the item (an `<article>`). */
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => finish(e, false),
      onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => finish(e, true),
    },
  }
}
