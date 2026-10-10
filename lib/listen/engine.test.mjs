// Run: node --experimental-strip-types lib/listen/engine.test.mjs   (Node >= 22.6). Roadmap session 8.
// Offline checks of the Listen engine (lib/listen/engine.ts) with a fake speech synth: no browser.
import { ListenEngine, pickVoice } from './engine.ts'

let n = 0, bad = 0
const eq = (name, got, want) => {
  n++
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { bad++; console.log('FAIL', name, '\n  got ', g, '\n  want', w) }
}

/** A fake synth: records what was spoken, and lets the test finish or break the current utterance. */
function rig() {
  const spoken = [], timers = []
  let current = null, cancels = 0, speaking = false
  const synth = {
    speak(u) { spoken.push(u.text); current = u; speaking = true },
    cancel() { cancels++; const u = current; current = null; speaking = false; if (u) setImmediateCancel(u) },
    get speaking() { return speaking },
    getVoices: () => [{ lang: 'en-US', localService: true, name: 'US' }, { lang: 'en-GB', localService: false, name: 'GB net' }, { lang: 'en-GB', localService: true, name: 'GB local' }],
  }
  // a cancelled utterance still fires an "interrupted" error, like Chrome
  const late = []
  const setImmediateCancel = u => late.push(u)
  const engine = new ListenEngine(synth, text => ({ text, lang: '', rate: 0, voice: null, onend: null, onerror: null }), (fn, ms) => timers.push({ fn, ms }))
  return {
    engine, spoken, synth,
    get cancels() { return cancels },
    /** run the timers that are due */
    tick() { const t = timers.splice(0); t.forEach(x => x.fn()) },
    /** the current utterance finishes */
    finishChunk() { const u = current; speaking = false; current = null; u?.onend?.() },
    /** deliver the stale events of cancelled utterances */
    flushLate() { late.splice(0).forEach(u => { u.onerror?.({ error: 'interrupted' }); u.onend?.() }) },
    breakChunk(error) { const u = current; current = null; speaking = false; u?.onerror?.({ error }) },
    forget() { current = null; speaking = false },   // the browser stopped speaking while the page was hidden
    get timers() { return timers.map(t => t.ms) },
    get current() { return current },
  }
}
const A = { id: 'a', chunks: ['A head.', 'A lead.', 'A point.'] }
const B = { id: 'b', chunks: ['B head.', 'B lead.'] }
const C = { id: 'c', chunks: [] }

// voice choice
eq('pickVoice: on-device British English first', pickVoice([{ lang: 'en-US', localService: true }, { lang: 'en-GB', localService: false }, { lang: 'en-GB', localService: true }]).localService, true)
eq('pickVoice: British beats American', pickVoice([{ lang: 'en-US', localService: true }, { lang: 'en-GB', localService: false }]).lang, 'en-GB')
eq('pickVoice: Indian English before other English', pickVoice([{ lang: 'en-AU', localService: true }, { lang: 'en_IN', localService: true }]).lang, 'en_IN')
eq('pickVoice: none for a non-English phone', pickVoice([{ lang: 'de-DE', localService: true }]), undefined)

// play one story from start to finish
let r = rig()
eq('starts idle', r.engine.getSnapshot(), { status: 'idle', index: 0, total: 0, id: null })
r.engine.playQueue([A])
eq('playing, nothing spoken until the pause after cancel is over', [r.engine.getSnapshot().status, r.spoken.length], ['playing', 0])
r.tick(); r.finishChunk(); r.finishChunk(); r.finishChunk()
eq('one story is read piece by piece, in order', r.spoken, ['A head.', 'A lead.', 'A point.'])
eq('and then it is idle', r.engine.getSnapshot().status, 'idle')

// a queue: stories one after the other, with a gap
r = rig()
r.engine.playQueue([A, B])
r.tick(); r.finishChunk(); r.finishChunk(); r.finishChunk()
eq('after the last piece of story 1 there is a gap before story 2', r.timers.length === 1 && r.timers[0] > 300, true)
eq('still on story 1 during the gap', r.engine.getSnapshot().index, 0)
r.tick()
eq('then story 2 starts', [r.engine.getSnapshot().index, r.engine.getSnapshot().id, r.spoken.at(-1)], [1, 'b', 'B head.'])
r.finishChunk(); r.finishChunk()
eq('the queue ends idle', [r.engine.getSnapshot().status, r.spoken.length], ['idle', 5])

// pause and resume: the piece it stopped in is spoken again
r = rig()
r.engine.playQueue([A]); r.tick(); r.finishChunk()    // spoke head, now speaking lead
r.engine.pause()
eq('pause: paused, speech cancelled', [r.engine.getSnapshot().status, r.cancels >= 1], ['paused', true])
r.flushLate()
eq('the cancelled utterance\'s late events do nothing', [r.spoken.length, r.engine.getSnapshot().status], [2, 'paused'])
r.engine.resume(); r.tick()
eq('resume: the interrupted piece again', r.spoken.slice(2), ['A lead.'])
r.finishChunk(); r.finishChunk()
eq('and on to the end', [r.spoken.at(-1), r.engine.getSnapshot().status], ['A point.', 'idle'])
r.engine.pause()
eq('pause when idle does nothing', r.engine.getSnapshot().status, 'idle')

// next / prev
r = rig()
r.engine.playQueue([A, B]); r.tick(); r.finishChunk()
r.engine.next(); r.flushLate(); r.tick()
eq('next: story 2 from its start, the late events of the cancelled piece are ignored', [r.engine.getSnapshot().index, r.spoken.at(-1), r.spoken.length], [1, 'B head.', 3])
r.engine.prev(); r.flushLate(); r.tick()
eq('prev near the start of a story: the story before', [r.engine.getSnapshot().index, r.spoken.at(-1)], [0, 'A head.'])
r.finishChunk(); r.finishChunk()    // now in A's third piece
r.engine.prev(); r.flushLate(); r.tick()
eq('prev later in a story: its own start', [r.engine.getSnapshot().index, r.spoken.at(-1)], [0, 'A head.'])
r.engine.next(); r.tick(); r.engine.next()
eq('next on the last story ends the queue', r.engine.getSnapshot().status, 'idle')

// stop
r = rig()
r.engine.playQueue([A, B]); r.tick(); r.engine.stop(); r.flushLate()
eq('stop: idle, nothing more is spoken', [r.engine.getSnapshot().status, r.spoken.length], ['idle', 1])
r.tick()
eq('and a late timer does not restart it', r.spoken.length, 1)

// start in the middle, skip stories with nothing to read
r = rig()
r.engine.playQueue([A, C, B], 1); r.tick()
eq('empty stories are dropped from the queue; the start index is clamped', [r.engine.getSnapshot().total, r.engine.getSnapshot().index, r.spoken[0]], [2, 1, 'B head.'])
r = rig()
r.engine.playQueue([C])
eq('nothing to read: nothing happens', r.engine.getSnapshot().status, 'idle')

// replacing a queue
r = rig()
r.engine.playQueue([A]); r.tick(); r.engine.playQueue([B]); r.flushLate(); r.tick()
eq('a new queue replaces the old one cleanly', [r.spoken.at(-1), r.engine.getSnapshot().id], ['B head.', 'b'])

// errors
r = rig()
r.engine.playQueue([A]); r.tick(); r.breakChunk('synthesis-failed')
eq('a real error ends playback (no stuck "playing")', r.engine.getSnapshot().status, 'idle')
r = rig()
r.engine.playQueue([A]); r.tick(); r.breakChunk('interrupted')
eq('an "interrupted" error from the browser alone is not an end', r.engine.getSnapshot().status, 'playing')

// recover: the page was hidden and the browser stopped speaking
r = rig()
r.engine.playQueue([A]); r.tick(); r.finishChunk()    // speaking lead
r.forget()
r.engine.recover(); r.tick()
eq('recover: speaks the piece it was in again', r.spoken.slice(-2), ['A lead.', 'A lead.'])
r.engine.recover()
eq('recover while speaking does nothing', r.spoken.length, 3)
r.engine.pause(); const before = r.spoken.length; r.engine.recover(); r.tick()
eq('recover while paused does nothing', r.spoken.length, before)

// subscribers hear changes
r = rig(); let heard = 0
const off = r.engine.subscribe(() => { heard++ })
r.engine.playQueue([A]); r.engine.pause(); off(); r.engine.resume()
eq('listeners are told of changes until they unsubscribe', heard, 2)

console.log(bad === 0 ? `ok: ${n} checks` : `${bad} of ${n} FAILED`)
process.exit(bad === 0 ? 0 : 1)
