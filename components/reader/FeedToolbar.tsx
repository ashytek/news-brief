'use client'

import { useState } from 'react'
import { Clock } from 'lucide-react'
import { Button, Chip, OptionSheet, Segmented } from '@/components/ui'
import { ListenBrief } from '@/components/listen/ListenBrief'
import { useReader } from '@/lib/reader/ReaderProvider'

const BUDGET_OPTIONS = [
  { value: 'off', label: 'Everything unread' },
  { value: '5', label: '5 minutes' },
  { value: '10', label: '10 minutes' },
  { value: '20', label: '20 minutes' },
]

/** Under the chip row: how many are unread, the Unread | All switch, Mark all read (with an
 *  Undo); then one row to shape the list: Latest | For you, the time chip ("I have N minutes")
 *  and Listen (roadmap session 8). */
export function FeedToolbar({ showUnreadOnly, unreadCount, onToggleUnread, onMarkAllRead }: {
  showUnreadOnly: boolean
  unreadCount: number
  onToggleUnread: () => void
  onMarkAllRead: () => void
}) {
  const r = useReader()
  const [sheet, setSheet] = useState(false)
  const shown = [...r.pinnedMix, ...r.mergedFeed].filter(s => !r.readIds.has(s.id))
  const budget = r.budget
  const options = [
    { value: 'off', label: `Everything unread${r.unreadMinutes > 0 ? ` · about ${r.unreadMinutes} min` : ''}` },
    ...BUDGET_OPTIONS.slice(1),
  ]
  return (
    <div className="pt-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="t-meta" aria-live="polite">{unreadCount} unread</p>
        <div className="flex items-center gap-1">
          <Segmented
            label="Show"
            value={showUnreadOnly ? 'unread' : 'all'}
            onChange={() => onToggleUnread()}
            options={[{ value: 'unread', label: 'Unread' }, { value: 'all', label: 'All' }]}
          />
          {unreadCount > 0 && <Button variant="text" onClick={onMarkAllRead} className="px-2.5">Mark all read</Button>}
        </div>
      </div>

      {/* Shaping the list: the order, how long you have (the chip says how long it all takes until you pick), and Listen. */}
      <div className="mt-1 flex items-center gap-2">
        <Segmented
          label="Order"
          value={r.sortMode}
          onChange={r.setSortMode}
          options={[{ value: 'latest', label: 'Latest' }, { value: 'foryou', label: 'For you' }]}
        />
        <Chip
          icon={Clock}
          selected={budget !== null}
          aria-haspopup="dialog"
          aria-label={budget ? `Time: ${budget.limit} minutes. Change.` : `Time: about ${r.unreadMinutes} minutes unread. Choose how long you have.`}
          onClick={() => setSheet(true)}
        >
          {budget ? `${budget.limit} min` : `${r.unreadMinutes} min`}
        </Chip>
        <ListenBrief stories={shown.slice(0, 20)} iconOnly label="Listen to these" className="-my-1" />
      </div>

      {budget && (
        <p role="status" className="t-meta mt-1">
          {budget.shown} of {budget.total} unread · about {budget.minutes} min.{' '}
          <button type="button" onClick={() => r.setTimeBudget(null)} className="font-medium text-accent">Show all</button>
        </p>
      )}

      {sheet && (
        <OptionSheet
          open
          onClose={() => setSheet(false)}
          title="How long have you got?"
          value={budget ? String(budget.limit) : 'off'}
          onChange={v => r.setTimeBudget(v === 'off' ? null : Number(v))}
          options={options}
        />
      )}
    </div>
  )
}
