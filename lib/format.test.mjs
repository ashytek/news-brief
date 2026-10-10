// Run: node --experimental-strip-types lib/format.test.mjs   (Node >= 22.6). Roadmap session 7.
// Offline checks of the pure helpers in lib/format.ts: displayHeadline (session 7), reading time, the
// round-up flag, the time-budget trim and the share / Gemini text (session 8).
import { displayHeadline, storyMinutes, isRoundUp, trimToBudget, storySummaryText, geminiPrompt, listenChunks, LISTEN_CHUNK_MAX } from './format.ts'

let n = 0, bad = 0
const eq = (name, got, want) => {
  n++
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { bad++; console.log('FAIL', name, '\n  got ', g, '\n  want', w) }
}

eq('shouting headline becomes Title Case', displayHeadline('WHAT CONCENTRATIONS MEANS FOR CHRISTIANS'), 'What Concentrations Means For Christians')
eq('sentence case untouched', displayHeadline('Iran says talks will resume in Geneva'), 'Iran says talks will resume in Geneva')
eq('normal headline with acronyms untouched', displayHeadline('UK and US agree new AI safety deal'), 'UK and US agree new AI safety deal')
eq('exactly 60% upper is untouched', displayHeadline('ABCDEF abcd'), 'ABCDEF abcd')
eq('just over 60% upper is changed', displayHeadline('ABCDEFG abc'), 'Abcdefg Abc')
eq('apostrophe does not capitalise the next letter', displayHeadline("DON'T MISS THIS WARNING NOW"), "Don't Miss This Warning Now")
eq('hyphenated', displayHeadline('ANTI-WAR PROTEST GROWS IN CITY'), 'Anti-War Protest Grows In City')
eq('quote opening', displayHeadline('THE "NEW" ORDER IS HERE TODAY'), 'The "New" Order Is Here Today')
eq('short all-caps is left alone', displayHeadline('NATO'), 'NATO')
eq('digits only', displayHeadline('2026'), '2026')
eq('empty', displayHeadline(''), '')

// ── session 8 ──
const words = n => Array.from({ length: n }, () => 'word').join(' ')
eq('storyMinutes: short version of 120 words is 1 min', storyMinutes({ short: { lead: words(40), key_points: [words(40), words(40)] }, summary: words(900) }), 1)
eq('storyMinutes: 400 words is 2 min', storyMinutes({ short: { lead: words(200), key_points: [words(200)] }, summary: '' }), 2)
eq('storyMinutes: no short version uses the overview (500 words = 2 min)', storyMinutes({ short: null, summary: words(500) }), 2)
eq('storyMinutes: never below 1', storyMinutes({ short: null, summary: 'tiny' }), 1)
eq('round-up lead', isRoundUp({ short: { lead: 'Round-up: Thailand\'s Queen flew a jet', key_points: [] } }), true)
eq('round up with a space is not (the pipeline guard is "Round-up")', isRoundUp({ short: { lead: 'Roundup of the day', key_points: [] } }), true)
eq('a normal lead is not a round-up', isRoundUp({ short: { lead: 'Iran says talks will resume', key_points: [] } }), false)
eq('no short version is not a round-up', isRoundUp({ short: null }), false)
const mins = { a: 2, b: 3, c: 4, d: 1 }
const trim = (items, b) => trimToBudget(items, x => mins[x], b)
eq('budget 5 takes a, b', trim(['a', 'b', 'c', 'd'], 5), ['a', 'b'])
eq('budget 10 takes a, b, c, d (10 min)', trim(['a', 'b', 'c', 'd'], 10), ['a', 'b', 'c', 'd'])
eq('budget 1 still gives the first story', trim(['c', 'a'], 1), ['c'])
eq('stops at the first that does not fit (order is kept, nothing skipped)', trim(['a', 'c', 'd'], 5), ['a'])
eq('empty list', trim([], 5), [])
const st = { headline: 'Houthi missiles strike Saudi base', summary: 'Long overview.', short: { lead: 'Missiles hit a base.', key_points: ['Two dead', 'Talks stall'] }, videos: { url: 'https://youtu.be/x' } }
eq('summary text', storySummaryText(st, 'Firstpost Vantage'), { body: 'Houthi missiles strike Saudi base\nFirstpost Vantage · AI summary of the video\n\nMissiles hit a base.\n• Two dead\n• Talks stall', url: 'https://youtu.be/x' })
eq('summary text without a short version uses the overview', storySummaryText({ ...st, short: null }).body, 'Houthi missiles strike Saudi base\nAI summary of the video\n\nLong overview.')
eq('summary text without a link', storySummaryText({ ...st, videos: null }).url, null)
const gp = geminiPrompt(st, 'Firstpost Vantage')
eq('gemini prompt starts with the instruction', gp.startsWith('Cross-check this AI summary of a YouTube video.'), true)
eq('gemini prompt carries the summary and the link', gp.includes('• Two dead') && gp.endsWith('Video: https://youtu.be/x'), true)

const lc = listenChunks(st)
eq('listen: headline, lead, points, each a piece ending in a full stop', lc, ['Houthi missiles strike Saudi base.', 'Missiles hit a base.', 'Two dead.', 'Talks stall.'])
eq('listen: without a short version it reads the overview', listenChunks({ headline: 'H', summary: 'One. Two.', short: null }), ['H.', 'One. Two.'])
const long = 'First sentence is here. ' + Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') + ', and a tail that goes on and on without any stop at all until the very end of it'
const lc2 = listenChunks({ headline: 'H', summary: long, short: null })
eq('listen: nothing longer than the limit', lc2.every(c => c.length <= LISTEN_CHUNK_MAX + 1), true)
const words2 = x => x.replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean)
eq('listen: nothing lost when a long text is cut (same words, same order)', words2(lc2.slice(1).join(' ')), words2(long))
eq('listen: links are not read out', listenChunks({ headline: 'See https://youtu.be/abc now', summary: '', short: null }), ['See now.'])
eq('listen: short sentences are joined into one piece up to the limit', listenChunks({ headline: 'H', summary: 'A. B. C.', short: null }), ['H.', 'A. B. C.'])
eq('listen: a piece with no ending gets one', listenChunks({ headline: 'No end here', summary: 'x', short: null })[0], 'No end here.')
eq('listen: empty parts are skipped', listenChunks({ headline: '', summary: 'Only this.', short: null }), ['Only this.'])

console.log(bad === 0 ? `ok: ${n} checks` : `${bad} of ${n} FAILED`)
process.exit(bad === 0 ? 0 : 1)
