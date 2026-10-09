import { Button, Segmented } from '@/components/ui'

/** Under the chip row: how many are unread, the Unread | All switch, and Mark all
 *  read (which now shows an Undo). */
export function FeedToolbar({ showUnreadOnly, unreadCount, onToggleUnread, onMarkAllRead }: {
  showUnreadOnly: boolean
  unreadCount: number
  onToggleUnread: () => void
  onMarkAllRead: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-2">
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
  )
}
