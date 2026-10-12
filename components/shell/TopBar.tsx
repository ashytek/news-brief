'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Settings, WifiOff } from 'lucide-react'
import { IconButton, cx } from '@/components/ui'
import { useReader } from '@/lib/reader/ReaderProvider'
import { describePipeline, type PipelineTone } from '@/lib/reader/pipelineStatus'
import { Brand } from './Brand'
import { SettingsSheet } from './SettingsSheet'
import { StatusSheet } from './StatusSheet'

const DOT: Record<PipelineTone, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }

/** The 56 px solid top bar: brandmark + wordmark, a pipeline status chip (dot +
 *  age) that opens the status sheet, and one settings button. Sticky, with an
 *  offline notice and a thin refresh bar hanging under it; `children` (the
 *  Sections chip row) stick with it. No backdrop-blur: it re-samples the feed on
 *  every scroll frame on mid-range Android. On desktop widths the bar itself is gone (the
 *  rail has all three) and only the offline notice, the Sections chips and the refresh bar
 *  remain. Pads the top safe-area inset (iOS
 *  standalone draws under the status bar: `black-translucent` + `viewport-fit=cover`). With
 *  `progress` (0 to 1) a thin accent line along its bottom edge shows how much of Today's brief
 *  is read. */
export function TopBar({ children, progress }: { children?: ReactNode; progress?: number | null }) {
  const r = useReader()
  const [sheet, setSheet] = useState<'status' | 'settings' | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator.onLine is unknown during SSR
    setOffline(!navigator.onLine)
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  const info = describePipeline(r.lastPipelineRun, r.pipelineStruggling)

  return (
    <div data-topbar className={cx('sticky top-0 z-40 border-b border-hairline bg-canvas pt-[env(safe-area-inset-top,0px)]', !children && 'desk:border-b-0')}>
      {/* On desktop the rail carries the brand, the status and Settings. */}
      <header className="mx-auto flex h-topbar max-w-2xl items-center gap-2 pl-gutter pr-1 desk:hidden">
        <Brand />
        <div className="flex-1" />
        {info && (
          <button
            type="button"
            onClick={() => setSheet('status')}
            aria-label={`Pipeline status: ${info.label}`}
            aria-haspopup="dialog"
            className="inline-flex h-11 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium leading-none text-fg-3 hover:bg-surface-2 active:bg-surface-2"
          >
            <span aria-hidden="true" className={cx('size-2 rounded-full', DOT[info.tone])} />
            {info.short}
          </button>
        )}
        <IconButton label="Settings" icon={Settings} aria-haspopup="dialog" onClick={() => setSheet('settings')} />
      </header>

      {offline && (
        <div role="status" className="border-t border-hairline bg-surface-1 px-gutter py-2 text-center">
          <p className="t-label inline-flex items-center gap-1.5 text-warn">
            <WifiOff className="size-4" aria-hidden="true" />
            Offline. Showing the last loaded stories.
          </p>
        </div>
      )}

      {children}

      {/* Today's brief only: how much of it is read, so it stays in sight once the masthead has
          scrolled away (roadmap session 11). The masthead has the accessible progress bar. */}
      {typeof progress === 'number' && (
        <div aria-hidden="true" data-brief-progress className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-2 desk:hidden">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {/* A reload in the background (refresh button, pull-to-refresh, Run now finishing):
          the feed stays put and this bar says something is happening. */}
      {(r.refreshing) && (
        <div role="progressbar" aria-label="Refreshing" className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-surface-3">
          <div className="h-full w-1/3 animate-[refresh-slide_1.1s_ease-in-out_infinite] bg-accent" />
        </div>
      )}

      {/* Mounted only while open: no hidden <dialog> in the page for every screen. */}
      {sheet === 'status' && <StatusSheet open onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet open onClose={() => setSheet(null)} />}
    </div>
  )
}
