'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Rss, Settings } from 'lucide-react'
import { cx } from '@/components/ui'
import { useReader } from '@/lib/reader/ReaderProvider'
import { describePipeline, type PipelineTone } from '@/lib/reader/pipelineStatus'
import { Brand } from './Brand'
import { SettingsSheet } from './SettingsSheet'
import { StatusSheet } from './StatusSheet'
import { useNav } from './useNav'

const DOT: Record<PipelineTone, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }

const ITEM = 'flex h-11 w-full items-center gap-3 rounded-control px-3 text-left text-[15px] font-medium hover:bg-surface-2'

/** The desktop left rail (from 1180 px; the bottom nav takes the phone): wordmark, the
 *  five destinations with a muted unread count where there is one, Sources and Settings,
 *  and the pipeline status line at the foot (opens the status sheet, as the top bar's
 *  chip does on a phone). Fixed to the window; the page makes room with `desk:pl-rail`. */
export function DesktopRail() {
  const r = useReader()
  const { items } = useNav()
  const [sheet, setSheet] = useState<'status' | 'settings' | null>(null)
  const info = describePipeline(r.lastPipelineRun, r.pipelineStruggling)

  // Muted counts: the brief's unread, and the unread in the All feed (the same number as its chip).
  const counts: Partial<Record<string, number>> = { today: r.todayUnread, sections: r.sectionUnread?.all ?? 0 }

  return (
    <aside
      aria-label="Sidebar"
      className="fixed inset-y-0 left-0 z-30 hidden w-rail flex-col border-r border-hairline bg-surface-1 desk:flex"
    >
      <div className="flex h-topbar flex-none items-center px-5">
        <Brand />
      </div>

      <nav aria-label="Main" className="flex flex-col gap-0.5 px-3 pt-2">
        {items.map(({ key, label, icon: Icon, href, isActive, onClick }) => {
          const count = counts[key] ?? 0
          return (
            <Link
              key={key}
              href={href}
              prefetch={false}
              onClick={onClick}
              aria-current={isActive ? 'page' : undefined}
              aria-label={count > 0 ? `${label}, ${count} unread` : label}
              className={cx(ITEM, isActive ? 'bg-accent-soft text-accent' : 'text-fg-2')}
            >
              <Icon className="size-5 flex-none" aria-hidden="true" />
              <span className="flex-1" aria-hidden={count > 0 ? true : undefined}>{label}</span>
              {count > 0 && (
                <span aria-hidden="true" className={cx('text-xs font-medium tabular-nums', isActive ? 'text-accent' : 'text-fg-3')}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="mx-5 my-3 border-t border-hairline" />

      <div className="flex flex-col gap-0.5 px-3">
        <Link href="/sources" prefetch={false} className={cx(ITEM, 'text-fg-2')}>
          <Rss className="size-5 flex-none" aria-hidden="true" />
          Sources
        </Link>
        <button type="button" aria-haspopup="dialog" onClick={() => setSheet('settings')} className={cx(ITEM, 'text-fg-2')}>
          <Settings className="size-5 flex-none" aria-hidden="true" />
          Settings
        </button>
      </div>

      {info && (
        <button
          type="button"
          onClick={() => setSheet('status')}
          aria-haspopup="dialog"
          aria-label={`Pipeline status: ${info.label}`}
          className="mx-3 mb-4 mt-auto flex min-h-11 items-center gap-2.5 rounded-control px-3 text-left text-[13px] text-fg-3 hover:bg-surface-2"
        >
          <span aria-hidden="true" className={cx('size-2 flex-none rounded-full', DOT[info.tone])} />
          <span className="min-w-0 flex-1 truncate">{info.label}</span>
        </button>
      )}

      {sheet === 'status' && <StatusSheet open onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet open onClose={() => setSheet(null)} />}
    </aside>
  )
}
