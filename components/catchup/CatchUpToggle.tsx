'use client'

import { Segmented } from '@/components/ui'
import { useReader } from '@/lib/reader/ReaderProvider'

/** Brief | Catch-up (Today) or Feed | Catch-up (Sections): the switch for the
 *  catch-up view, always available, shared by every tab. */
export function CatchUpToggle({ feedLabel = 'Brief', className }: { feedLabel?: string; className?: string }) {
  const r = useReader()
  return (
    <Segmented
      label="View"
      value={r.catchUp.on ? 'catchup' : 'feed'}
      onChange={v => r.catchUp.setOn(v === 'catchup')}
      options={[{ value: 'feed', label: feedLabel }, { value: 'catchup', label: 'Catch-up' }]}
      className={className}
    />
  )
}
