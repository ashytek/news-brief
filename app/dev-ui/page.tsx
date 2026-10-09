'use client'

/**
 * Dev-only UI fixture — renders the cards with hostile mock data (no auth, no
 * Supabase) so layout/perf issues can be reproduced and measured in a plain
 * browser at any viewport width. Not served in production (the proxy only lets
 * the exact /dev-ui path through outside production builds).
 *
 * Visit /dev-ui at 360px width; run in console:
 *   [...document.querySelectorAll('*')].filter(el =>
 *     el.scrollWidth > document.documentElement.clientWidth + 1)
 * to enumerate horizontal-overflow offenders.
 */

import { useState, useSyncExternalStore } from 'react'
import { StoryCard } from '@/components/story/StoryCard'
import { StoryListItem } from '@/components/story/StoryListItem'
import type { StoryActions } from '@/components/story/types'
import { DividerLabel, SnackbarProvider } from '@/components/ui'
import { PrimitivesGallery } from './PrimitivesGallery'
import type { StoryWithRelations, Category } from '@/lib/types'

const noop = () => {}
// Dev aid: the first card records its dwell callbacks on window.__dwell so a
// scroll test can check the F029 tall-card case without a real phone.
const logDwell = (e: string) => {
  const w = window as unknown as { __dwell?: string[] }
  ;(w.__dwell ??= []).push(e)
}

const NASTY_TITLE =
  'PAKISTAN FOOLED USA | Iran Fighter Jets Inside Pakistan #TrumpGoldPhoneBreakingNewsExclusiveGeopoliticsAnalysis2026'

const mkBullet = (i: number) => ({
  // Walkthrough-format sections (title present) — matches post-July-2026
  // summariser output. One in four carries a hostile unbroken token.
  title: `Section ${i}: The Mechanics of ThingNumber${i}`,
  text:
    i % 4 === 0
      ? `Includes an unbroken token WWW.SOMEEXTREMELYLONGDOMAINNAMETHATWILLNOTWRAP.COM/PATH_SEGMENT_${i} to test overflow. A second sentence explains the mechanism in flowing prose so the section reads like a briefing note.`
      : `A flowing two-sentence explanation with a hard fact (${i * 7}%) preserved exactly. The mechanism is taught back rather than merely asserted, matching the walkthrough style.`,
  timestamp_seconds: i * 95,
})

// Fixed dates (old enough to print as plain dates): the server and the browser
// render this module separately, so anything built from the clock would differ
// between them and trip a hydration warning.
const PUBLISHED = '2026-10-01T10:00:00.000Z'

const soloBase = {
  id: 'dev-solo-1',
  source_id: 'dev-src-1',
  category: 'india_global' as Category,
  headline: NASTY_TITLE,
  summary:
    'A hostile-length summary. Includes one long unbroken string ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ to probe wrapping behaviour on 360px-wide viewports.',
  bullets: Array.from({ length: 18 }, (_, i) => mkBullet(i + 1)),
  matched_topics: ['strait of hormuz', 'india'],
  created_at: PUBLISHED,
  videos: {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    thumbnail_url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    published_at: PUBLISHED,
    duration_seconds: 3725,
  },
}

// Short card — the default once a story has `short`. The lead carries a
// hostile unbroken token to probe wrapping.
const solo = {
  ...soloBase,
  short: {
    lead:
      'A two-sentence lead that gives the outcome, not just the topic. It includes WWW.SOMEEXTREMELYLONGDOMAINNAMETHATWILLNOTWRAP.COM/PATH_SEGMENT to probe wrapping.',
    key_points: [
      'First key point: a hard figure (14,000 ft) kept exactly as stated, in one sentence.',
      'Second key point naming a person and an organisation, with a date (2 October).',
      'Third key point with a currency amount (£2.5m) and a percentage (38%).',
    ],
  },
} as unknown as StoryWithRelations

// The same story before it is backfilled: falls back to the long summary.
const soloNoShort = { ...soloBase, id: 'dev-solo-2', short: null } as unknown as StoryWithRelations
const soloRow = { ...solo, id: 'dev-solo-3' } as unknown as StoryWithRelations

const SOURCE = { id: 'dev-src-1', name: 'Firstpost Vantage Extended Name' } as never

const subscribeNothing = () => () => {}
const readSearch = () => window.location.search

/** Fake actions with working local state, so the dev page can exercise the card
 *  without the provider (no auth, no Supabase). */
function useFakeActions(startRead = false): StoryActions {
  const [isRead, setRead] = useState(startRead)
  const [reaction, setReaction] = useState<StoryActions['reaction']>()
  return {
    isRead, reaction,
    onRead: () => setRead(true),
    onUnread: () => setRead(false),
    onReact: setReaction,
    onShare: noop,
    onMute: noop,
  }
}

function Fixture() {
  const a = useFakeActions()
  const b = useFakeActions(true)
  const c = useFakeActions()
  const d = useFakeActions()
  const e = useFakeActions()
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 flex h-topbar items-center border-b border-hairline bg-canvas px-gutter">
        <span className="font-serif text-[21px] font-semibold">NewsBrief</span>
      </header>
      <main className="mx-auto max-w-2xl px-gutter pb-24">
        <DividerLabel>Lead card</DividerLabel>
        <StoryCard
          story={solo} source={SOURCE} variant="lead" showCategory actions={a}
          onDwellStart={() => logDwell('start')} onDwellEnd={o => logDwell(`end longForm=${o.longForm}`)}
        />

        <DividerLabel>Read state: dimmed, no strike-through</DividerLabel>
        <StoryCard story={solo} source={SOURCE} showCategory actions={b} onDwellStart={noop} onDwellEnd={noop} />

        <DividerLabel>Standard card</DividerLabel>
        <StoryCard story={solo} source={SOURCE} actions={c} onDwellStart={noop} onDwellEnd={noop} />

        <DividerLabel>No short version yet (falls back to the overview)</DividerLabel>
        <StoryCard story={soloNoShort} source={SOURCE} actions={d} onDwellStart={noop} onDwellEnd={noop} />

        <DividerLabel>Headline row, opens into the short card</DividerLabel>
        <StoryListItem story={soloRow} sourceName="Firstpost Vantage Extended Name" showCategory actions={e} />
      </main>
    </div>
  )
}

export default function DevUiPage() {
  // ?view=primitives swaps in the design-system gallery. useSyncExternalStore
  // keeps the first client render equal to the server's, so no hydration mismatch.
  const search = useSyncExternalStore(subscribeNothing, readSearch, () => '')
  if (new URLSearchParams(search).get('view') === 'primitives') return <PrimitivesGallery />
  return <SnackbarProvider><Fixture /></SnackbarProvider>
}
