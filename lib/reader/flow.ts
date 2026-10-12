/**
 * The reading flow on screen: what "the next story" is, and bringing it to the top.
 *
 * Ash, 10 Oct 2026: a story you mark read leaves the list and the next one comes to
 * the top of the screen; Mark day read brings the next day up; Mark all read on a
 * developing story brings the next item up; folding a developing story puts it at the
 * top. Everything a reader moves through carries `data-flow` (cards, rows, storylines,
 * catch-up days, the end of the brief); stories also carry `data-story-id`.
 *
 * DOM only, no React: callers run these around their own state changes.
 */

const FLOW = '[data-flow]'

/** The list item showing this story (a card or a row; never the desktop reading pane). */
export function flowItemOf(storyId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`${FLOW}[data-story-id="${CSS.escape(storyId)}"]`)
}

/** A selector that finds this flow item again after React has re-rendered it (a folded
 *  storyline row becomes an open card when the one above it leaves, for instance). */
function selectorOf(el: HTMLElement): string | null {
  const { storyId, storylineId, day } = el.dataset
  if (storyId) return `${FLOW}[data-story-id="${CSS.escape(storyId)}"]`
  if (storylineId) return `${FLOW}[data-storyline-id="${CSS.escape(storylineId)}"]`
  if (day) return `${FLOW}[data-day="${CSS.escape(day)}"]`
  if (el.hasAttribute('data-endcap')) return `${FLOW}[data-endcap]`
  return null
}

/** The first flow item after `el` in page order that is not inside it. */
export function nextFlowItem(el: Element): HTMLElement | null {
  for (const cand of document.querySelectorAll<HTMLElement>(FLOW)) {
    if (cand === el || el.contains(cand)) continue
    if (el.compareDocumentPosition(cand) & Node.DOCUMENT_POSITION_FOLLOWING) return cand
  }
  return null
}

/** Bottom edge of the sticky top bar (with the Sections chips when they are in it). */
function barBottom(): number {
  const bar = document.querySelector('[data-topbar]')
  return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0
}

let movedAt = 0

/** True just after the app itself scrolled the page (below). Cards that left the screen
 *  because of that move were not glanced at and skipped, so the dwell timer must not
 *  report them as `dwell_short` (it lowers their topic's weight). */
export function movedByAppRecently(): boolean {
  return Date.now() - movedAt < 1500
}

/** Say that the app itself is moving content (a swipe, a fade-out): see `movedByAppRecently`. */
export function markMoved() {
  movedAt = Date.now()
}

/** The reader asked their device for less motion: nothing animates, everything still works. */
export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Scroll the window so `el` starts right under the top bar. */
export function toTop(el: Element) {
  const y = window.scrollY + el.getBoundingClientRect().top - barBottom()
  markMoved()
  // The two-argument form: no `behavior` (older Safari rejects 'instant'); the page has no
  // smooth scroll-behavior, so this jumps, which is what we want (the list already changed).
  window.scrollTo(0, Math.max(0, Math.round(y)))
}

/** Runs `fn` once React has committed the change just made and the browser has laid it out. */
export function afterPaint(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

/**
 * Call just before something that may take `el` out of the list (Mark read, Mark day
 * read, Mark all read). The returned function, called after the change, brings the item
 * that followed `el` to the top of the screen, but only if `el` really left (or moved
 * below it, like a read story sinking in the All view). Where nothing leaves (Search,
 * Archive, a storyline's report list) nothing moves.
 */
export function keepFlow(el: Element | null): () => void {
  const first = el ? nextFlowItem(el) : null
  const sel = first ? selectorOf(first) : null
  return () => {
    const next = first?.isConnected ? first : sel ? document.querySelector(sel) : null
    if (!el || !next) return
    const gone = !el.isConnected || !!(next.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    if (gone) toTop(next)
  }
}

/** After an Undo: if the story (or group) that came back is above the screen or below
 *  it, bring it to the top; if it is already in view, leave the page alone. */
export function revealAfterUndo(find: () => Element | null) {
  // The marks come back when the request answers, so wait (a few frames at most) for it.
  let frames = 0
  const look = () => {
    const el = find()
    if (!el) { if (++frames < 30) requestAnimationFrame(look); return }
    const r = el.getBoundingClientRect()
    if (r.top < barBottom() || r.top > window.innerHeight - 80) toTop(el)
  }
  afterPaint(look)
}

// ── Leaving (roadmap session 11) ─────────────────────────────────────────────

/** How long an item takes to fade and fold away before the list changes. */
export const LEAVE_MS = 180

const leaving = new WeakMap<Element, Animation>()

/** True while `leave` is fading this item (it has not been taken out of the list yet). */
export function isLeaving(el: Element): boolean {
  return leaving.has(el)
}

/** Put a faded or swiped item back as it was (the list did not take it away after all). */
function restore(el: HTMLElement) {
  leaving.get(el)?.cancel()
  leaving.delete(el)
  el.style.overflowY = ''
  swipeReset(el)
}

/**
 * Take an item out of the list gently: it fades and folds away (opacity and height, 180 ms),
 * then `commit` runs (the state change that really removes it; callers bring the next item
 * to the top after that, as before). With reduced motion, no Web Animations, or nothing to
 * animate, `commit` runs at once. A second call for an item already leaving does nothing.
 *
 * The fold only happens when the item's top is on screen: an item you have scrolled into the
 * middle of (its top above the bar) only fades, because folding it would slide everything
 * below it up past the bar and the scroll to the next item would bring it back.
 *
 * If the list does not take the item away (it was already read, the write is refused, an
 * Archive row), it is restored once the change has been painted.
 */
export function leave(el: HTMLElement | null, commit: () => void) {
  if (!el || !el.isConnected || leaving.has(el) || reducedMotion() || typeof el.animate !== 'function') {
    if (!el || !leaving.has(el)) commit()
    return
  }
  markMoved()
  const cs = getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  const fold = rect.top >= barBottom() - 1
  const from: Keyframe = { opacity: Number(cs.opacity) || 1 }
  const to: Keyframe = { opacity: 0 }
  if (fold) {
    Object.assign(from, {
      height: `${rect.height}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
      marginTop: cs.marginTop, marginBottom: cs.marginBottom, borderTopWidth: cs.borderTopWidth, borderBottomWidth: cs.borderBottomWidth,
    })
    Object.assign(to, {
      height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
    })
    // `clip`, not `hidden`: hidden would also clip sideways and cut the swipe's "Mark read" layer.
    el.style.overflowY = 'clip'
  }
  const anim = el.animate([from, to], { duration: LEAVE_MS, easing: 'ease-out', fill: 'forwards' })
  leaving.set(el, anim)
  let done = false
  const finish = () => {
    if (done) return
    done = true
    commit()
    // The list has taken it away by now, or it never will: put back whatever is still here.
    afterPaint(() => { if (el.isConnected) restore(el); else leaving.delete(el) })
  }
  anim.onfinish = finish
  anim.oncancel = finish
  setTimeout(finish, LEAVE_MS + 150)   // a hidden tab pauses animations: the tap still counts
}

// ── Swipe layer (roadmap session 11) ─────────────────────────────────────────

const LAYER = ':scope > [data-swipe-layer]'

/** Slide an item `tx` px (negative = left) and show the "Mark read" layer in the strip it
 *  uncovers: the layer hangs off the item's right edge, so it is exactly as wide as the
 *  strip plus the page gutter. */
export function swipeApply(el: HTMLElement, tx: number, gutter: number, armed = false) {
  el.style.transform = tx === 0 ? '' : `translate3d(${tx}px,0,0)`
  const layer = el.querySelector<HTMLElement>(LAYER)
  if (!layer) return
  layer.style.display = 'flex'
  layer.style.width = `${Math.max(0, -tx + gutter)}px`
  layer.dataset.armed = armed ? 'true' : 'false'
}

/** Back to rest: no transform, no layer, text selectable again. */
export function swipeReset(el: HTMLElement) {
  el.style.transform = ''
  el.style.willChange = ''
  el.style.userSelect = ''
  el.style.setProperty('-webkit-user-select', '')
  const layer = el.querySelector<HTMLElement>(LAYER)
  if (!layer) return
  layer.style.display = ''
  layer.style.width = ''
  delete layer.dataset.armed
}

// ── Scrolling past (roadmap session 11) ──────────────────────────────────────

/** Ids of the cards that are entirely above the visible area (their bottom is above the
 *  top bar's bottom edge) and ask to be released (`data-release`: a dwell-read card). */
export function scrolledPastIds(): string[] {
  const bottom = barBottom()
  const ids: string[] = []
  for (const el of document.querySelectorAll<HTMLElement>('[data-release]')) {
    if (el.getBoundingClientRect().bottom <= bottom) ids.push(...(el.dataset.release ?? '').split(' ').filter(Boolean))
  }
  return ids
}

/**
 * Call just before something above the screen is taken out of the page. The returned function,
 * called in a layout effect after the change (before the browser paints), scrolls by exactly
 * as much as the content you are looking at moved, so nothing visibly jumps. Safari on iOS has
 * no CSS scroll anchoring, so this is done by hand; where the browser has already compensated
 * the difference is zero and nothing is done.
 */
export function anchorView(): () => void {
  const bottom = barBottom()
  let anchor: HTMLElement | null = null
  for (const el of document.querySelectorAll<HTMLElement>(FLOW)) {
    if (el.getBoundingClientRect().bottom > bottom + 1) { anchor = el; break }
  }
  if (!anchor) return () => {}
  const sel = selectorOf(anchor)
  const top = anchor.getBoundingClientRect().top
  return () => {
    const now = anchor.isConnected ? anchor : sel ? document.querySelector<HTMLElement>(sel) : null
    if (!now) return
    const delta = now.getBoundingClientRect().top - top
    if (Math.abs(delta) >= 1) window.scrollTo(0, Math.max(0, Math.round(window.scrollY + delta)))
  }
}
