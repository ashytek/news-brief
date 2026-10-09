/** Unread / All and Mark all read live in a toolbar under the header,
 *  not in it (UI-023). */
export function FeedToolbar({ showUnreadOnly, unreadCount, onToggleUnread, onMarkAllRead }: {
  showUnreadOnly: boolean
  unreadCount: number
  onToggleUnread: () => void
  onMarkAllRead: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        onClick={onToggleUnread}
        aria-pressed={showUnreadOnly}
        className={`flex items-center gap-1.5 px-3 min-h-11 rounded-lg text-sm font-semibold transition-all active:scale-95 ${
          showUnreadOnly
            ? 'bg-violet-500/25 text-violet-200 ring-1 ring-violet-500/40'
            : 'bg-slate-800/60 text-slate-300 ring-1 ring-slate-700/60 hover:bg-slate-800 hover:text-white'
        }`}
      >
        {showUnreadOnly ? `Unread${unreadCount > 0 ? ` · ${unreadCount}` : ''}` : 'All stories'}
      </button>

      {unreadCount > 0 && (
        <button
          onClick={onMarkAllRead}
          className="flex items-center gap-1.5 px-3 min-h-11 rounded-lg text-sm font-semibold bg-slate-800/60 text-slate-300 ring-1 ring-slate-700/60 hover:bg-emerald-500/20 hover:text-emerald-200 hover:ring-emerald-500/40 active:scale-95 transition-all"
          title="Mark everything here as read"
        >
          <svg className="w-4 h-4" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 13l4 4L14 9m-3 4l4 4L23 7" />
          </svg>
          Mark all read
        </button>
      )}
    </div>
  )
}
