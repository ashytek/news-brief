// Run: node --experimental-strip-types lib/reader/sourceStats.test.mjs   (Node >= 22.6). Roadmap session 8.
import { summariseSourceStats, describeSourceStat } from './sourceStats.ts'

let n = 0, bad = 0
const eq = (name, got, want) => {
  n++
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { bad++; console.log('FAIL', name, '\n  got ', g, '\n  want', w) }
}

const stories = [
  { id: 's1', source_id: 'A' }, { id: 's2', source_id: 'A' }, { id: 's3', source_id: 'A' },
  { id: 's4', source_id: 'B' },
]
const read = new Set(['s1', 's2', 's4', 'old-story'])
eq('counts stories and reads per source (a read id outside the window is ignored)', summariseSourceStats(stories, read, []), {
  A: { stories: 3, read: 2, likes: 0, dislikes: 0 }, B: { stories: 1, read: 1, likes: 0, dislikes: 0 },
})
eq('likes and dislikes: the newest reaction per story wins', summariseSourceStats(stories, read, [
  { story_id: 's1', signal: 'dislike' }, { story_id: 's1', signal: 'like' }, { story_id: 's3', signal: 'like' }, { story_id: 's4', signal: 'dislike' },
]), { A: { stories: 3, read: 2, likes: 1, dislikes: 1 }, B: { stories: 1, read: 1, likes: 0, dislikes: 1 } })
eq('a reaction to a story outside the window, or with no story, is not counted', summariseSourceStats(stories, read, [
  { story_id: 'gone', signal: 'like' }, { story_id: null, signal: 'like' },
]).A.likes, 0)
eq('other signals are not reactions', summariseSourceStats(stories, read, [{ story_id: 's1', signal: 'share' }]).A.likes, 0)
eq('no stories', summariseSourceStats([], new Set(), []), {})

eq('line: still loading', describeSourceStat(undefined, 1), null)
eq('line: a source with no stories', describeSourceStat({ stories: 0, read: 0, likes: 0, dislikes: 0 }, undefined), 'No stories in the last 30 days')
eq('line: read of total', describeSourceStat({ stories: 40, read: 18, likes: 0, dislikes: 0 }, 1), '18 of 40 read')
eq('line: likes and dislikes', describeSourceStat({ stories: 40, read: 18, likes: 3, dislikes: 1 }, 1), '18 of 40 read · 3 liked · 1 disliked')
eq('line: rarely read needs 10+ stories and under 20%', describeSourceStat({ stories: 10, read: 1, likes: 0, dislikes: 0 }, 1), '1 of 10 read · rarely read')
eq('line: not rarely read at exactly 20%', describeSourceStat({ stories: 10, read: 2, likes: 0, dislikes: 0 }, 1), '2 of 10 read')
eq('line: few stories are never "rarely read"', describeSourceStat({ stories: 9, read: 0, likes: 0, dislikes: 0 }, 1), '0 of 9 read')
eq('line: a weight that moved is shown', describeSourceStat({ stories: 40, read: 30, likes: 0, dislikes: 0 }, 1.2), '30 of 40 read · weight 1.2')
eq('line: a neutral weight is not', describeSourceStat({ stories: 40, read: 30, likes: 0, dislikes: 0 }, 1.02), '30 of 40 read')

console.log(bad === 0 ? `ok: ${n} checks` : `${bad} of ${n} FAILED`)
process.exit(bad === 0 ? 0 : 1)
