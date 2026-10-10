'use client'

import { Headphones, Square } from 'lucide-react'
import type { StoryWithRelations } from '@/lib/types'
import { Button, IconButton } from '@/components/ui'
import { useListen } from '@/lib/listen/ListenProvider'
import { useReader } from '@/lib/reader/ReaderProvider'

/** "Listen" for a whole list: reads these stories in order (the unread ones of Today's brief,
 *  or of the Sections feed on screen) with the mini player to pause, skip or stop. While
 *  anything is being read it becomes "Stop". Hidden where the browser can't read aloud. */
export function ListenBrief({ stories, label = 'Listen', iconOnly = false, className }: {
  stories: StoryWithRelations[]
  label?: string
  /** A round icon button (the Sections toolbar, where a row of labelled controls is already full). */
  iconOnly?: boolean
  className?: string
}) {
  const listen = useListen()
  const r = useReader()
  if (!listen.supported || (stories.length === 0 && listen.status === 'idle')) return null
  const busy = listen.status !== 'idle'
  const toggle = () => {
    if (busy) listen.stop()
    else listen.playQueue(stories.map(story => ({ story, sourceName: r.sources[story.source_id]?.name })))
  }
  if (iconOnly) {
    return <IconButton label={busy ? 'Stop listening' : label} icon={busy ? Square : Headphones} tone={busy ? 'accent' : 'default'} aria-pressed={busy} onClick={toggle} className={className} />
  }
  return (
    <Button
      variant="tonal"
      icon={busy ? Square : Headphones}
      aria-pressed={busy}
      className={className}
      onClick={toggle}
    >
      {busy ? 'Stop' : label}
    </Button>
  )
}
