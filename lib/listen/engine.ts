/**
 * The Listen engine (roadmap session 8, F014): reads stories aloud with the browser's own
 * speech synthesis (on-device, free). A plain class with no React and no imports, so its
 * queue, pause, skip and recovery rules are tested offline with a fake synth
 * (lib/listen/engine.test.mjs): `node --experimental-strip-types lib/listen/engine.test.mjs`.
 *
 * Why it speaks one piece at a time instead of queueing a whole story with the browser:
 *  - pause/resume of a queued utterance is unreliable (Android Chrome ignores `pause`), so
 *    pause here is "stop, remember the piece, speak it again on resume";
 *  - a skip or a stop must cancel cleanly: every utterance carries the generation it was
 *    started in, and an `onend`/`onerror` from an earlier generation is ignored (a cancelled
 *    utterance still fires its events);
 *  - Chrome can cut a long utterance short, so pieces are short (listenChunks).
 */

export interface Utt {
  lang: string
  rate: number
  voice: unknown
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
}

export interface Synth {
  speak(u: Utt): void
  cancel(): void
  readonly speaking: boolean
  getVoices(): { lang: string; localService: boolean; name: string }[]
}

export interface Entry { id: string; chunks: string[] }

export type ListenStatus = 'idle' | 'playing' | 'paused'
export interface Snapshot {
  status: ListenStatus
  /** Which story of the queue is being read (0-based). */
  index: number
  total: number
  /** Id of that story, or null when idle. */
  id: string | null
}

/** Silence between two stories, and the pause after a cancel before the next speak (Chrome
 *  drops a `speak` issued in the same tick as a `cancel`). */
const STORY_GAP_MS = 700
const AFTER_CANCEL_MS = 60

const IDLE: Snapshot = { status: 'idle', index: 0, total: 0, id: null }

/** British English first (the summaries are written in it), then Indian English, then any
 *  English; an on-device voice over a network one (works without signal and doesn't stall). */
export function pickVoice<V extends { lang: string; localService: boolean }>(voices: V[]): V | undefined {
  const rank = (v: V) => {
    const lang = v.lang.replace('_', '-').toLowerCase()
    const l = lang === 'en-gb' ? 0 : lang === 'en-in' ? 1 : lang.startsWith('en') ? 2 : 9
    return l * 2 + (v.localService ? 0 : 1)
  }
  return [...voices].filter(v => rank(v) < 9).sort((a, b) => rank(a) - rank(b))[0]
}

export class ListenEngine {
  private queue: Entry[] = []
  private qi = 0
  private ci = 0
  private status: ListenStatus = 'idle'
  private gen = 0
  private snap: Snapshot = IDLE
  private listeners = new Set<() => void>()

  private synth: Synth
  private create: (text: string) => Utt
  private schedule: (fn: () => void, ms: number) => void

  // (explicit fields, not constructor parameter properties: Node's type stripping, which runs the offline tests, rejects those)
  constructor(
    synth: Synth,
    create: (text: string) => Utt,
    schedule: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms) },
  ) {
    this.synth = synth
    this.create = create
    this.schedule = schedule
  }

  // useSyncExternalStore wants stable references
  getSnapshot = (): Snapshot => this.snap
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }

  private emit() {
    const id = this.queue[this.qi]?.id ?? null
    const next: Snapshot = this.status === 'idle'
      ? IDLE
      : { status: this.status, index: this.qi, total: this.queue.length, id }
    if (next.status === this.snap.status && next.index === this.snap.index && next.total === this.snap.total && next.id === this.snap.id) return
    this.snap = next
    this.listeners.forEach(l => l())
  }

  /** Start reading `entries` from story `start`. Replaces whatever was playing. */
  playQueue(entries: Entry[], start = 0) {
    const usable = entries.filter(e => e.chunks.length > 0)
    if (usable.length === 0) return
    this.gen++
    this.synth.cancel()
    this.queue = usable
    this.qi = Math.min(Math.max(0, start), usable.length - 1)
    this.ci = 0
    this.status = 'playing'
    this.emit()
    this.speakSoon()
  }

  pause() {
    if (this.status !== 'playing') return
    this.gen++
    this.synth.cancel()
    this.status = 'paused'
    this.emit()
  }

  resume() {
    if (this.status !== 'paused') return
    this.gen++
    this.status = 'playing'
    this.emit()
    this.speakSoon()   // the piece it stopped in, from its start
  }

  /** The next story (or the end). */
  next() {
    if (this.status === 'idle') return
    this.gen++
    this.synth.cancel()
    if (this.qi + 1 >= this.queue.length) return this.finish()
    this.qi++
    this.ci = 0
    this.status = 'playing'
    this.emit()
    this.speakSoon()
  }

  /** Back to the start of this story; if already near its start, to the story before. */
  prev() {
    if (this.status === 'idle') return
    this.gen++
    this.synth.cancel()
    if (this.ci <= 1 && this.qi > 0) this.qi--
    this.ci = 0
    this.status = 'playing'
    this.emit()
    this.speakSoon()
  }

  stop() {
    if (this.status === 'idle' && this.queue.length === 0) return
    this.gen++
    this.synth.cancel()
    this.finish()
  }

  /** The page came back (the phone was unlocked). If it should be speaking but the browser
   *  stopped while hidden, carry on from the piece it was in. */
  recover() {
    if (this.status !== 'playing' || this.synth.speaking) return
    this.gen++
    this.synth.cancel()
    this.speakSoon()
  }

  private finish() {
    this.queue = []
    this.qi = 0
    this.ci = 0
    this.status = 'idle'
    this.emit()
  }

  private speakSoon() {
    const g = this.gen
    this.schedule(() => { if (g === this.gen && this.status === 'playing') this.speak() }, AFTER_CANCEL_MS)
  }

  private speak() {
    const entry = this.queue[this.qi]
    if (!entry) return this.finish()
    if (this.ci >= entry.chunks.length) return this.advance()
    const g = this.gen
    const u = this.create(entry.chunks[this.ci])
    u.lang = 'en-GB'
    u.rate = 1
    const voice = pickVoice(this.synth.getVoices())
    if (voice) u.voice = voice
    u.onend = () => {
      if (g !== this.gen || this.status !== 'playing') return
      this.ci++
      this.speak()
    }
    u.onerror = e => {
      if (g !== this.gen) return
      if (e.error === 'canceled' || e.error === 'interrupted') return   // our own cancel
      this.gen++
      this.finish()
    }
    this.synth.speak(u)
  }

  private advance() {
    if (this.qi + 1 >= this.queue.length) return this.finish()
    const g = this.gen
    this.schedule(() => {
      if (g !== this.gen || this.status !== 'playing') return
      this.qi++
      this.ci = 0
      this.emit()
      this.speak()
    }, STORY_GAP_MS)
  }
}
