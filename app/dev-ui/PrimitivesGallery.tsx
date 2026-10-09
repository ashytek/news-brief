'use client'

/**
 * Dev-only gallery of the design-system primitives (components/ui) on the dark
 * token palette, with mock data. Visit /dev-ui?view=primitives at 412 px and
 * compare with ui-audit-2026-10-03/after/ (the mockups these were built from).
 */
import { useState } from 'react'
import { Bell, Check, Inbox, RefreshCw, Search, TriangleAlert, CircleCheck } from 'lucide-react'
import {
  Button, ButtonLink, Chip, ChipLink, CategoryMark, DividerLabel, Highlight, IconButton, OptionSheet,
  Segmented, Sheet, SnackbarProvider, StateMessage, StoryRow, useSnackbar,
} from '@/components/ui'
import { CATEGORIES } from '@/lib/categories'
import type { StoryWithRelations } from '@/lib/types'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const mk = (over: Record<string, unknown>) => ({
  source_id: 's1',
  bullets: [],
  matched_topics: [],
  created_at: minsAgo(30),
  summary: 'A longer overview paragraph that is used as the dek when a story has no short version yet.',
  videos: {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    thumbnail_url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    published_at: minsAgo(30),
    duration_seconds: 725,
  },
  ...over,
}) as unknown as StoryWithRelations

const sections = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Section ${i + 1}`, text: 'Walkthrough text '.repeat(20), timestamp_seconds: i * 90 }))

const STORIES = {
  unread: mk({
    id: 'a', category: 'india_global',
    headline: 'Flydubai pilot thwarts hijack attempt: what the first reports say, and what they disagree on',
    short: { lead: 'A Flydubai captain overpowered an armed passenger on a Dubai–Tel Aviv flight; reports differ on the number on board.', key_points: ['One', 'Two'] },
    bullets: sections(6),
    videos: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', thumbnail_url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg', published_at: minsAgo(25), duration_seconds: 725 },
  }),
  read: mk({
    id: 'b', category: 'prophetic',
    headline: 'Markets slide for a fifth session as oil climbs past a key level',
    short: { lead: 'Indian equities fell again; analysts point to crude and foreign outflows rather than domestic earnings.', key_points: ['One'] },
    bullets: sections(4),
    videos: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', thumbnail_url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg', published_at: minsAgo(60 * 20), duration_seconds: 1325 },
  }),
  noThumb: mk({
    id: 'c', category: 'tech_ai', headline: 'A story with no thumbnail and a hostile token WWW.SOMEEXTREMELYLONGDOMAINNAMETHATWILLNOTWRAP.COM/PATH_SEGMENT in its headline',
    short: null, bullets: [], videos: { url: null, thumbnail_url: null, published_at: minsAgo(60 * 50), duration_seconds: null },
  }),
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="t-overline mb-3">{title}</h2>
      {children}
    </section>
  )
}

function Demo() {
  const { show } = useSnackbar()
  const [sheet, setSheet] = useState(false)
  const [chip, setChip] = useState('all')
  const [expanded, setExpanded] = useState(true)
  const [seg, setSeg] = useState<'unread' | 'all'>('unread')
  const [opt, setOpt] = useState<'all' | '7d' | '30d'>('all')
  const [optSheet, setOptSheet] = useState(false)

  return (
    <div className="mx-auto max-w-2xl px-gutter pb-40 pt-6">
      <h1 className="t-display">Primitives</h1>
      <p className="t-standfirst mt-1">Dark-only token palette · Newsreader headlines · Geist UI</p>

      <Section title="Type scale">
        <div className="space-y-2">
          <p className="t-title">t-title · Headline in Newsreader 600</p>
          <p className="t-lead">t-lead · The lead story headline</p>
          <p className="t-head">t-head · A row headline that can run to three lines on a phone</p>
          <p className="t-standfirst">t-standfirst · The summary under a story headline.</p>
          <p className="t-body">t-body · Reading text at sixteen pixels.</p>
          <p className="t-h3">t-h3 · Section title</p>
          <p className="t-label">t-label · Control label</p>
          <p className="t-meta">t-meta · 22h ago · 4 min read</p>
          <p className="t-kicker text-fg-2">t-kicker · source name</p>
          <p className="t-overline">t-overline · Section label</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="tonal">Tonal</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="text">Text</Button>
          <Button icon={RefreshCw}>With icon</Button>
          <Button loading>Loading</Button>
          <Button disabled variant="tonal">Disabled</Button>
          <ButtonLink href="/dev-ui" variant="outline">As link</ButtonLink>
        </div>
        <div className="mt-3"><Button block>Email me a sign-in link</Button></div>
      </Section>

      <Section title="Icon buttons">
        <div className="flex items-center gap-2">
          <IconButton label="Search" icon={Search} />
          <IconButton label="Refresh" icon={RefreshCw} />
          <IconButton label="Notifications" icon={Bell} badge={7} />
          <IconButton label="Done" icon={Check} tone="accent" />
          <IconButton label="Search (link)" icon={Search} href="/dev-ui" />
        </div>
      </Section>

      <Section title="Chips">
        <div className="flex gap-2 overflow-x-auto">
          {[['all', 'All', 128], ['prophetic', 'Prophetic', 12], ['india', 'India & Global', 98]].map(([k, l, n]) => (
            <Chip key={k as string} selected={chip === k} count={n as number} onClick={() => setChip(k as string)}>{l}</Chip>
          ))}
          <ChipLink href="/dev-ui" selected>Link chip</ChipLink>
        </div>
      </Section>

      <Section title="Category marks">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {CATEGORIES.map(c => <CategoryMark key={c.key} category={c.key} />)}
        </div>
      </Section>

      <Section title="Segmented · divider · highlight · option sheet">
        <Segmented label="Show" value={seg} onChange={setSeg} options={[{ value: 'unread', label: 'Unread' }, { value: 'all', label: 'All' }]} />
        <DividerLabel>Before you left</DividerLabel>
        <p className="t-body"><Highlight text="A search match inside a sentence about Trump and tariffs" query="trump tariffs" /></p>
        <div className="mt-3"><Button variant="tonal" onClick={() => setOptSheet(true)}>Date: {opt}</Button></div>
        <OptionSheet open={optSheet} onClose={() => setOptSheet(false)} title="Date" value={opt} onChange={setOpt}
          options={[{ value: 'all', label: 'Any time' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }]} />
      </Section>

      <Section title="Story rows">
        <div>
          <StoryRow story={STORIES.unread} sourceName="India Global Review" showCategory
            expanded={expanded} onToggle={() => setExpanded(v => !v)}>
            <div className="rounded-panel bg-surface-1 p-4 t-body">The expanded short card goes here: lead, key points, sections.</div>
          </StoryRow>
          <StoryRow story={STORIES.read} sourceName="Vantage" showCategory isRead onToggle={() => {}} />
          <StoryRow story={STORIES.noThumb} sourceName="Jonathan Cahn" showCategory onToggle={() => {}} />
        </div>
      </Section>

      <Section title="Sheet · Snackbar">
        <div className="flex flex-wrap gap-3">
          <Button variant="tonal" onClick={() => setSheet(true)}>Open sheet</Button>
          <Button variant="tonal" onClick={() => show({ message: 'Marked 9 as read', actionLabel: 'Undo', onAction: () => show({ message: 'Undone' }) })}>Snackbar with Undo</Button>
          <Button variant="tonal" onClick={() => show({ message: 'Saved', duration: 2500 })}>Plain snackbar</Button>
        </div>
        <Sheet open={sheet} onClose={() => setSheet(false)} title="Status">
          <p className="t-body mt-2 text-fg-2">Pipeline healthy · last run 3h ago.</p>
          <div className="mt-4 flex gap-3"><Button>Run now</Button><Button variant="text" onClick={() => setSheet(false)}>Close</Button></div>
        </Sheet>
      </Section>

      <Section title="State messages">
        <div className="rounded-panel bg-surface-1">
          <StateMessage tone="ok" icon={CircleCheck} title="You're all caught up">That&apos;s all 12 stories in today&apos;s brief.</StateMessage>
          <StateMessage tone="error" icon={TriangleAlert} title="Couldn't load this feed" action={{ label: 'Try again', onClick: () => {} }}>
            Something went wrong fetching stories.
          </StateMessage>
          <StateMessage icon={Inbox} title="Nothing here yet">The pipeline will populate this on its next run.</StateMessage>
        </div>
      </Section>
    </div>
  )
}

export function PrimitivesGallery() {
  return (
    <SnackbarProvider>
      <div className="min-h-screen bg-canvas text-fg-1">
        <Demo />
      </div>
    </SnackbarProvider>
  )
}
