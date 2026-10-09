import { X } from 'lucide-react'
import { formatSince } from '@/lib/format'
import { IconButton } from '@/components/ui'

/** "N new since you left · Xh ago" — dismissible (F012, UI-040). */
export function SinceVisitNotice({ count, since, onDismiss }: { count: number; since: number; onDismiss: () => void }) {
  return (
    <div role="status" className="mt-3 flex items-center gap-2 rounded-panel bg-accent-soft py-0.5 pl-3.5 pr-0.5 text-sm font-medium text-fg-1">
      <span className="min-w-0 flex-1 py-2">
        {count} new since you left <span className="font-normal text-fg-2">· {formatSince(since)}</span>
      </span>
      <IconButton label="Dismiss" icon={X} onClick={onDismiss} className="size-11" />
    </div>
  )
}
