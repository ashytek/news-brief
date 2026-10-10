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

/** Scroll the window so `el` starts right under the top bar. */
export function toTop(el: Element) {
  const y = window.scrollY + el.getBoundingClientRect().top - barBottom()
  movedAt = Date.now()
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
