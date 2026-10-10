'use client'

import { Headphones, Square } from 'lucide-react'
import type { StoryWithRelations } from '@/lib/types'
import { Button } from '@/components/ui'
import { useListen } from '@/lib/listen/ListenProvider'
import { useReader } from '@/lib/reader/ReaderProvider'

/** "Listen" for a whole list: reads these stories in order (the unread ones of Today's brief,
 *  or of the Sections feed on screen) with the mini player to pause, skip or stop. While
 *  anything is being read it becomes "Stop". Hidden where the browser can't read aloud. */
export function ListenBrief({ stories, label = 'Listen', className }: {
  stories: StoryWithRelations[]
  label?: string
  className?: string
}) {
  const listen = useListen()
  const r = useReader()
  if (!listen.supported || (stories.length === 0 && listen.status === 'idle')) return null
  const busy = listen.status !== 'idle'
  return (
    <Button
      variant="tonal"
      icon={busy ? Square : Headphones}
      aria-pressed={busy}
      className={className}
      onClick={() => {
        if (busy) listen.stop()
        else listen.playQueue(stories.map(story => ({ story, sourceName: r.sources[story.source_id]?.name })))
      }}
    >
      {busy ? 'Stop' : label}
    </Button>
  )
}
