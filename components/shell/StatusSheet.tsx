'use client'

import Link from 'next/link'
import { Rss, RefreshCw, Zap, X } from 'lucide-react'
import { Button, Sheet, cx } from '@/components/ui'
import { useReader } from '@/lib/reader/ReaderProvider'
import { describePipeline, type PipelineTone } from '@/lib/reader/pipelineStatus'

const DOT: Record<PipelineTone, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }

/** "Run now" and its progress/result line. Shared by the status sheet and the
 *  top of Sources, so there is one place that knows the trigger states. */
export function RunNow({ size = 'default' }: { size?: 'default' | 'compact' }) {
  const r = useReader()
  const busy = r.triggerState !== 'idle'
  const note = r.triggerError ?? r.triggerMessage
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon={Zap}
          loading={r.triggerState === 'triggering'}
          disabled={busy}
          onClick={r.handleTriggerPipeline}
          className={cx(size === 'compact' && 'min-h-10 px-4')}
        >
          {busy ? 'Running…' : 'Run now'}
        </Button>
        {!busy && note && (
          <Button variant="text" icon={X} onClick={r.dismissTriggerMessage} aria-label="Dismiss message">Dismiss</Button>
        )}
      </div>
      {note && (
        <p role="status" className={cx('t-label', r.triggerError ? 'text-bad' : 'text-fg-2')}>{note}</p>
      )}
    </div>
  )
}

/** The status chip's sheet: pipeline health, Run now, refresh, build stamp. */
export function StatusSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const r = useReader()
  const info = describePipeline(r.lastPipelineRun, r.pipelineStruggling)
  return (
    <Sheet open={open} onClose={onClose} title="Pipeline status">
      <div className="flex flex-col gap-5 px-1 pb-2 pt-3">
        <p className="flex items-center gap-2.5 t-body">
          <span aria-hidden="true" className={cx('size-2.5 flex-none rounded-full', info ? DOT[info.tone] : 'bg-fg-3')} />
          {info ? info.label : 'No pipeline run seen yet'}
        </p>
        <RunNow />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="tonal"
            icon={RefreshCw}
            loading={r.refreshing}
            onClick={() => { void r.refresh() }}
          >
            Refresh feed
          </Button>
          <Link
            href="/sources"
            prefetch={false}
            onClick={onClose}
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-accent"
          >
            <Rss className="size-[18px]" aria-hidden="true" />
            Sources and recent runs
          </Link>
        </div>
        <p className="t-meta font-mono">Build {process.env.NEXT_PUBLIC_BUILD_SHA}</p>
      </div>
    </Sheet>
  )
}
