'use client'

/**
 * Dev-only UI fixture — renders the reader's layout-critical pieces with
 * hostile mock data (no auth, no Supabase) so layout/perf issues can be
 * reproduced and measured in a plain browser at any viewport width.
 *
 * Visit /dev-ui at 360px width; run in console:
 *   [...document.querySelectorAll('*')].filter(el =>
 *     el.scrollWidth > document.documentElement.clientWidth + 1)
 * to enumerate horizontal-overflow offenders.
 */

import { SoloCard } from '@/components/SoloCard'
import { ClusteredCard } from '@/components/ClusteredCard'
import { CategoryNav } from '@/components/CategoryNav'
import type { StoryWithRelations, ClusterWithRelations, Category } from '@/lib/types'

const noop = () => {}

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

/** Legacy pre-walkthrough bullet (no title) — old stories must still render */
const mkLegacyBullet = (i: number) => ({
  text: `Legacy bullet ${i}: hard fact (${i * 3}%) first, then a why-it-matters clause in the old dot style.`,
  timestamp_seconds: i * 60,
})

const solo = {
  id: 'dev-solo-1',
  source_id: 'dev-src-1',
  category: 'india_global' as Category,
  headline: NASTY_TITLE,
  summary:
    'A hostile-length summary. Includes one long unbroken string ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ to probe wrapping behaviour on 360px-wide viewports.',
  bullets: Array.from({ length: 18 }, (_, i) => mkBullet(i + 1)),
  matched_topics: ['strait of hormuz', 'india'],
  created_at: new Date(Date.now() - 3600e3).toISOString(),
  videos: {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    thumbnail_url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    published_at: new Date(Date.now() - 1800e3).toISOString(),
  },
} as unknown as StoryWithRelations

const clusterStory = (n: number) =>
  ({
    ...solo,
    id: `dev-cs-${n}`,
    headline: `Cluster member ${n}: ${NASTY_TITLE}`,
    // Member 2 uses legacy bullets so the cluster view exercises the fallback
    bullets: n === 2
      ? Array.from({ length: 4 }, (_, i) => mkLegacyBullet(i + 1))
      : Array.from({ length: 5 }, (_, i) => mkBullet(i + 1)),
    created_at: new Date(Date.now() - n * 7200e3).toISOString(),
  }) as unknown as StoryWithRelations

const cluster = {
  id: 'dev-cluster-1',
  category: 'prophetic' as Category,
  consensus_summary:
    'Consensus with a long unbroken chunk LOREMIPSUMDOLORSITAMETCONSECTETURADIPISCINGELITSEDDOEIUSMOD to stress the consensus block.',
  last_updated_at: new Date().toISOString(),
  story_count: 3,
  stories: [clusterStory(1), clusterStory(2), clusterStory(3)],
} as unknown as ClusterWithRelations

const CATS = [
  { key: 'prophetic' as Category, label: 'Prophetic Word', color: 'violet' },
  { key: 'israel' as Category, label: 'Israel', color: 'blue' },
  { key: 'india_global' as Category, label: 'India & Global', color: 'amber' },
  { key: 'tech_ai' as Category, label: 'Tech & AI', color: 'emerald' },
]

export default function DevUiPage() {
  return (
    <div className="min-h-screen text-slate-100">
      {/* Header clone — every control force-rendered (worst case width) */}
      <header className="sticky top-0 z-50 bg-slate-950/95 border-b border-slate-800/60">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shrink-0" />
            <div>
              <h1 className="text-sm font-bold text-white leading-none tracking-tight">News Brief</h1>
              <p className="text-xs text-slate-400 mt-1 inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Sources failing · last check 23h ago
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
            <button className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg text-xs font-semibold bg-violet-500/25 text-violet-200 ring-1 ring-violet-500/40 shrink-0">
              Unread · 148
            </button>
            {[0, 1, 2, 3].map(i => (
              <button key={i} className="w-11 h-11 shrink-0 rounded-lg bg-slate-800/60 ring-1 ring-slate-700/60 flex items-center justify-center">
                <span className="w-4 h-4 rounded-sm bg-slate-600" />
              </button>
            ))}
          </div>
        </div>
        <CategoryNav categories={CATS} active="india_global" onChange={noop} topicCount={12} todayUnread={148} />
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-3 pb-24 md:pb-6">
        {/* Vantage-style divider clone */}
        <div className="flex items-center gap-3 pt-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-300 bg-amber-500/15 ring-1 ring-amber-500/30 px-2.5 py-1 rounded-full uppercase tracking-wider shrink-0">
            ⚡ Vantage — All Segments
          </span>
          <div className="flex-1 h-px bg-gradient-to-r from-amber-500/40 to-transparent" />
        </div>

        <SoloCard
          story={solo}
          source={{ id: 'dev-src-1', name: 'Firstpost Vantage Extended Name' } as never}
          isRead={false}
          onRead={noop}
          onEngagement={noop}
          onDwellStart={noop}
          onDwellEnd={noop}
          onMuteTopic={noop}
        />

        <ClusteredCard
          cluster={cluster}
          isRead={false}
          readStoryIds={new Set<string>()}
          onRead={noop}
          onEngagement={noop}
          onDwellStart={noop}
          onDwellEnd={noop}
          onMuteTopic={noop}
        />
      </main>
    </div>
  )
}
