'use client'

import { useMemo } from 'react'
import { Check, CircleCheck, Inbox, TriangleAlert } from 'lucide-react'
import { FeedStory } from '@/components/story/FeedStory'
import { StorySkeleton } from '@/components/story/StorySkeleton'
import { useStoryActions } from '@/components/story/useStoryActions'
import { Button, ButtonLink, StateMessage } from '@/components/ui'
import { ListenBrief } from '@/components/listen/ListenBrief'
import { estimateReadMinutes, readShort } from '@/lib/format'
import { useReader } from '@/lib/reader/ReaderProvider'
import { TodayMasthead } from './TodayMasthead'

/** The Today tab: a masthead (date, title, how long it takes, progress), the lead
 *  story with its full-width image, then the rest as short cards, and a real
 *  stopping point at the end. Ranking is unchanged (rankItems). */
export function TodayFeed() {
  const r = useReader()
  const actionsFor = useStoryActions({ canMute: true })

  // Ranked in useFeedView (so the nav badge and this brief agree).
  const ranked = r.todayRanked

  const readCount = ranked.filter(item => r.readIds.has(item.data.id)).length
  const unreadCount = ranked.length - readCount
  const minutes = useMemo(
    () => ranked.reduce((sum, { data: s }) => {
      const short = readShort(s.short)
      return sum + estimateReadMinutes(short ? [short.lead, ...short.keyPoints] : [s.summary])
    }, 0),
    [ranked],
  )
  const channels = useMemo(() => Object.values(r.sources).filter(s => s.is_active !== false).length, [r.sources])

  if (r.loading) return <StorySkeleton />

  if (r.loadError) {
    return (
      <>
        <TodayMasthead />
        <StateMessage
          tone="error"
          icon={TriangleAlert}
          title="Couldn't load today's brief"
          action={{ label: 'Try again', onClick: () => { void r.refresh() } }}
        >
          Something went wrong fetching stories. Check the pipeline status in the top bar, or try again.
        </StateMessage>
      </>
    )
  }

  if (ranked.length === 0) {
    return (
      <>
        <TodayMasthead />
        <StateMessage tone="ok" icon={Inbox} title="All caught up">
          Nothing new in the last 24 hours.
        </StateMessage>
      </>
    )
  }

  const pct = Math.round((readCount / ranked.length) * 100)

  return (
    <div>
      <TodayMasthead
        meta={`${ranked.length} stories · about ${minutes} min${channels > 0 ? ` · AI summaries of ${channels} channels` : ''}`}
      >
        <div className="mt-2 flex items-center gap-3">
          <div
            role="progressbar"
            aria-label="Read so far"
            aria-valuemin={0}
            aria-valuemax={ranked.length}
            aria-valuenow={readCount}
            className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3"
          >
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <span className="t-meta flex-none">
            {unreadCount === 0 ? <span className="inline-flex items-center gap-1 text-ok"><Check className="size-3.5" aria-hidden="true" />All read</span> : `${readCount} of ${ranked.length} read`}
          </span>
        </div>
        <ListenBrief stories={ranked.filter(i => !r.readIds.has(i.data.id)).map(i => i.data)} label="Listen to the brief" className="mt-3 self-start" />
      </TodayMasthead>

      <div className="mt-3">
        {ranked.map(({ data: story }, i) => (
          <FeedStory
            key={story.id}
            first={i === 0}
            story={story}
            source={r.sources[story.source_id]}
            variant={i === 0 ? 'lead' : 'standard'}
            showCategory
            actions={actionsFor(story)}
            onDwellStart={() => r.startDwell(story.id)}
            onDwellEnd={({ longForm }) => r.endDwell(story.id, story.id, longForm)}
          />
        ))}
      </div>

      {/* End of the brief — a real stopping point, not just a list that stops */}
      <div data-endcap role="status" className="px-2 pb-2 pt-8 text-center">
        <div className="mb-3 inline-grid size-12 place-items-center rounded-panel bg-ok/10 text-ok ring-1 ring-ok/30">
          <CircleCheck className="size-6" aria-hidden="true" />
        </div>
        <p className="font-serif text-xl font-semibold text-fg-1">
          {unreadCount === 0 ? "You're all caught up" : "That's today's brief"}
        </p>
        <p className="t-body mt-1 text-fg-2">
          {unreadCount === 0
            ? `That's all ${ranked.length} stories in today's brief.`
            : `That's all ${ranked.length} stories in today's brief. ${unreadCount} still unread.`}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button
            variant="tonal"
            onClick={() => { r.openSections(); window.scrollTo({ top: 0 }) }}
          >
            Browse sections
          </Button>
          <ButtonLink variant="outline" href="/archive" prefetch={false}>Open archive</ButtonLink>
        </div>
      </div>
    </div>
  )
}
