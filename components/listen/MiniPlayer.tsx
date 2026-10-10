'use client'

import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { IconButton } from '@/components/ui'
import { useListen } from '@/lib/listen/ListenProvider'

/** The bar that shows while something is being read aloud: where in the queue, the headline,
 *  and previous / pause / next / stop. Fixed above the bottom nav on a phone, at the foot of
 *  the content (beside the rail) on desktop. Pages leave room for it with `--player-h`. */
export function MiniPlayer() {
  const l = useListen()
  if (l.status === 'idle' || !l.current) return null
  const playing = l.status === 'playing'
  return (
    <div
      role="region"
      aria-label="Listening"
      className="fixed inset-x-0 bottom-[calc(var(--spacing-navbar)+env(safe-area-inset-bottom,0px))] z-[45] border-t border-hairline bg-surface-2 desk:bottom-0 desk:left-rail"
    >
      <div className="mx-auto flex h-16 max-w-2xl items-center gap-1 pl-gutter pr-1 desk:max-w-none">
        <div className="min-w-0 flex-1">
          <p className="t-meta truncate" aria-live="polite">
            {playing ? 'Listening' : 'Paused'}{l.total > 1 ? ` · ${l.index + 1} of ${l.total}` : ''}
            {l.current.sourceName ? ` · ${l.current.sourceName}` : ''}
          </p>
          <p className="truncate text-[15px] font-medium leading-5 text-fg-1">{l.current.story.headline}</p>
        </div>
        {l.total > 1 && <IconButton label="Previous story" icon={SkipBack} onClick={l.prev} />}
        <IconButton label={playing ? 'Pause' : 'Play'} icon={playing ? Pause : Play} onClick={playing ? l.pause : l.resume} />
        {l.total > 1 && <IconButton label="Next story" icon={SkipForward} onClick={l.next} />}
        <IconButton label="Stop listening" icon={X} onClick={l.stop} />
      </div>
    </div>
  )
}
