import { CloudOff } from 'lucide-react'
import { Button } from '@/components/ui'
import { formatSince } from '@/lib/format'
import { useReader } from '@/lib/reader/ReaderProvider'

/** Shown when the stories on screen are the app's own copy from an earlier load,
 *  because the network failed (no signal on the walk home): says so, and offers a
 *  retry. It also retries by itself when the connection comes back. */
export function SavedFeedNotice() {
  const r = useReader()
  if (r.savedAt === null || r.loading) return null
  return (
    <div role="status" className="mt-3 flex items-center gap-2 rounded-panel bg-surface-1 py-0.5 pl-3.5 pr-0.5 text-sm text-fg-1">
      <CloudOff className="size-4 flex-none text-warn" aria-hidden="true" />
      <span className="min-w-0 flex-1 py-2">
        <span className="font-semibold">Saved {formatSince(r.savedAt)}</span>
        <span className="block text-fg-2">Couldn&apos;t reach the server, so this is the last feed it loaded.</span>
      </span>
      <Button variant="text" onClick={() => { void r.refresh() }} className="flex-none">Try again</Button>
    </div>
  )
}
