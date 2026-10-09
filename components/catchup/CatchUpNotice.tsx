'use client'

import { Button } from '@/components/ui'
import { nowDate } from '@/lib/format'
import { useReader } from '@/lib/reader/ReaderProvider'
import { awayLabel, type CatchUpView } from '@/lib/reader/catchUp'

/** "Away 3 days · 126 new · Catch-up view", with the way back to the normal feed.
 *  The reason is why the view switched itself on; the counts fall as you read. */
export function CatchUpNotice({ view }: { view: CatchUpView | null }) {
  const r = useReader()
  const away = r.catchUp.reason === 'away' && r.prevVisit !== null
  const headline = away
    ? `Away ${awayLabel(r.prevVisit!, nowDate().getTime())}${view ? ` · ${view.newCount} new` : ''}`
    : view ? `${view.unreadCount} unread` : 'Catch-up'
  return (
    <div role="status" data-catchup-notice className="mt-3 flex items-center gap-2 rounded-panel bg-accent-soft py-0.5 pl-3.5 pr-0.5 text-sm text-fg-1">
      <span className="min-w-0 flex-1 py-2">
        <span className="font-semibold">{headline}</span>
        <span className="block text-fg-2">Catch-up view</span>
      </span>
      <Button variant="text" onClick={() => r.catchUp.setOn(false)} className="flex-none">Normal feed</Button>
    </div>
  )
}
