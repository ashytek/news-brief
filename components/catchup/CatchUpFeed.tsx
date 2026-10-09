'use client'

import { useState } from 'react'
import { Inbox, TriangleAlert } from 'lucide-react'
import { StoryListItem } from '@/components/story/StoryListItem'
import { StorySkeleton } from '@/components/story/StorySkeleton'
import { useStoryActions } from '@/components/story/useStoryActions'
import { Button, DividerLabel, StateMessage } from '@/components/ui'
import { useReader } from '@/lib/reader/ReaderProvider'
import { CatchUpNotice } from './CatchUpNotice'
import { StorylineCard } from './StorylineCard'
import { StorylineRow } from './StorylineRow'

/** The catch-up body for Today and the Sections feeds: the notice, the developing
 *  stories (the newest open as a card, the rest folded to rows), then every other
 *  unread story as a headline list by day, each day with "Mark day read". The
 *  caller supplies the header (Today's masthead, or the Sections toggle). */
export function CatchUpFeed() {
  const r = useReader()
  const actionsFor = useStoryActions({ canMute: true })
  const view = r.catchUpView
  // What the reader opened or closed by hand; otherwise only the first storyline is open.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  // Today and All mix categories, so each row names its own; a single category needn't.
  const showCategory = r.activeTab === 'today' || r.activeTab === 'all'

  const body = (() => {
    if (r.loading || r.catchUp.pending) return <StorySkeleton />
    if (r.loadError) {
      return (
        <StateMessage
          tone="error"
          icon={TriangleAlert}
          title="Couldn't load the catch-up"
          action={{ label: 'Try again', onClick: () => { void r.refresh() } }}
        >
          Something went wrong fetching stories. Try again, or switch back to the normal feed.
        </StateMessage>
      )
    }
    if (!view || (view.storylines.length === 0 && view.days.length === 0)) {
      return (
        <StateMessage tone="ok" icon={Inbox} title="All caught up" action={{ label: 'Normal feed', onClick: () => r.catchUp.setOn(false) }}>
          Nothing unread from the last 7 days.
        </StateMessage>
      )
    }
    return (
      <>
        {view.storylines.length > 0 && (
          <section aria-label="Developing stories">
            <p className="t-overline pb-2.5 pt-6">Developing stories · {view.storylines.length}</p>
            <div className="flex flex-col">
              {view.storylines.map((entry, i) => {
                const id = entry.storyline.id
                const open = toggled[id] ?? i === 0
                return open
                  ? <StorylineCard key={id} entry={entry} actionsFor={actionsFor} showCategory={showCategory}
                      onCollapse={() => setToggled(t => ({ ...t, [id]: false }))} />
                  : <StorylineRow key={id} entry={entry} onOpen={() => setToggled(t => ({ ...t, [id]: true }))} />
              })}
            </div>
          </section>
        )}
        {view.days.map(day => (
          <section key={day.key} aria-label={day.label} data-day={day.key}>
            <DividerLabel
              className="mt-4"
              action={day.unreadIds.length > 0
                ? <Button variant="text" className="-mr-3" onClick={() => { void r.markManyReadUndoable(day.unreadIds) }}>Mark day read</Button>
                : undefined}
            >
              {day.label} · {day.stories.length}
            </DividerLabel>
            {day.stories.map(story => (
              <StoryListItem
                key={story.id}
                story={story}
                compact
                sourceName={r.sources[story.source_id]?.name}
                showCategory={showCategory}
                actions={actionsFor(story)}
              />
            ))}
          </section>
        ))}
      </>
    )
  })()

  return (
    <div data-catchup-feed>
      <CatchUpNotice view={view} />
      {body}
    </div>
  )
}
