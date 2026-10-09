import { formatSince } from '@/lib/format'

/** "N new since you left · Xh ago" — dismissible (F012, UI-040). */
export function SinceVisitNotice({ count, since, onDismiss }: { count: number; since: number; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-2 text-sm font-semibold text-violet-200 bg-violet-500/10 ring-1 ring-violet-500/25 rounded-xl pl-3 pr-1"
    >
      <span className="py-2">{count} new since you left · {formatSince(since)}</span>
      <button
        onClick={onDismiss}
        className="shrink-0 min-w-11 min-h-11 flex items-center justify-center rounded-lg text-violet-200 hover:bg-violet-500/20 active:bg-violet-500/20"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
