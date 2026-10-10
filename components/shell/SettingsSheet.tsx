'use client'

import Link from 'next/link'
import { LogOut, RefreshCw, Rss } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Segmented, Sheet } from '@/components/ui'
import { setDensity, useDensity } from '@/lib/density'
import { createClient } from '@/lib/supabase/client'
import { clearDeviceCopy } from '@/lib/offline'
import { useReader } from '@/lib/reader/ReaderProvider'

const ROW = 'flex min-h-14 w-full items-center gap-3.5 rounded-panel px-3 text-left text-base font-medium text-fg-1 hover:bg-surface-2 active:bg-surface-2'

function Row({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <>
      <Icon className="size-[22px] flex-none text-fg-2" aria-hidden="true" />
      {children}
    </>
  )
}

/** Settings: Sources, refresh, sign out. (Sign-out and Sources moved here from
 *  the old "More" menu; Run now and the build stamp live in the status sheet.) Also the
 *  density switch (Comfortable | Compact), a setting of this device. */
export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const r = useReader()
  const density = useDensity()

  const signOut = async () => {
    await createClient().auth.signOut()
    await clearDeviceCopy()   // the saved feeds and the offline pages go with the session
    // A full page load on purpose: it drops all in-memory feed state with the session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/auth'
  }

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <ul className="flex flex-col pb-2 pt-2">
        <li className="px-3 pb-3 pt-2">
          <p className="text-base font-medium text-fg-1">Density</p>
          <p className="t-meta mt-0.5">
            {density === 'compact'
              ? 'Headline rows that open to the short card. Nothing is marked read for you.'
              : 'Short cards with the key points showing.'}
          </p>
          <Segmented
            label="Density"
            value={density}
            onChange={setDensity}
            options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
            className="mt-2.5"
          />
        </li>
        <li>
          <Link href="/sources" prefetch={false} onClick={onClose} className={ROW}>
            <Row icon={Rss}>Sources</Row>
          </Link>
        </li>
        <li>
          <button type="button" className={ROW} onClick={() => { onClose(); void r.refresh() }}>
            <Row icon={RefreshCw}>Refresh feed</Row>
          </button>
        </li>
        <li>
          <button type="button" className={ROW} onClick={signOut}>
            <Row icon={LogOut}>Sign out</Row>
          </button>
        </li>
      </ul>
    </Sheet>
  )
}
