'use client'

import { useCallback } from 'react'
import type { StoryWithRelations } from '@/lib/types'
import { useReader } from '@/lib/reader/ReaderProvider'
import { useSnackbar } from '@/components/ui'
import { useListen } from '@/lib/listen/ListenProvider'
import { copyText } from '@/lib/clipboard'
import { geminiPrompt, storySummaryText } from '@/lib/format'
import { afterPaint, flowItemOf, keepFlow } from '@/lib/reader/flow'
import { useReadingPane } from '@/components/reader/ReadingPane'
import type { StoryActions } from './types'

/** Share the summary, not just the link (roadmap session 8): the native share sheet on
 *  phones gets the headline, channel, short version and the video link; where there is
 *  none (desktop) the same text goes to the clipboard. */
export function shareStory(story: StoryWithRelations, sourceName?: string) {
  const { body, url } = storySummaryText(story, sourceName)
  if (navigator.share) {
    navigator.share({ title: story.headline, text: body, ...(url ? { url } : {}) }).catch(() => {})
  } else {
    navigator.clipboard?.writeText(url ? `${body}\n\n${url}` : body).catch(() => {})
  }
}

/** Builds a story's actions from the shared Reader state, so a card in Today, a
 *  row in Search and a row in Archive all read, react and undo the same way.
 *  Muting is offered only where asked (the feeds): Search, Archive and Topics
 *  don't load the muted-topics list. */
export function useStoryActions({ canMute = false }: { canMute?: boolean } = {}) {
  const r = useReader()
  const listen = useListen()
  const snackbar = useSnackbar()
  const pane = useReadingPane()
  return useCallback((story: StoryWithRelations): StoryActions => {
    const topics = story.matched_topics ?? []
    const sourceName = r.sources[story.source_id]?.name
    const listening = listen.status !== 'idle' && listen.current?.story.id === story.id
    return {
      isRead: r.readIds.has(story.id),
      reaction: r.reactions.get(story.id),
      // Done with it: the story leaves the list and the next one comes to the top of the
      // screen (Ash, 10 Oct 2026). On a desktop the pane moves on to the next row's story.
      onRead: () => {
        const item = flowItemOf(story.id)
        const bringNext = keepFlow(item)
        const rows = pane && item ? Array.from(document.querySelectorAll<HTMLElement>('[data-pane-row]')) : []
        const at = rows.indexOf(item as HTMLElement)
        const nextRow = at >= 0 ? rows[at + 1] ?? null : null
        void r.markReadUndoable(story.id)
        afterPaint(() => {
          if (!pane) return bringNext()
          if (item?.isConnected || !nextRow?.isConnected) return
          pane.selectId(nextRow.dataset.storyId ?? '')
          nextRow.scrollIntoView({ block: 'nearest' })
        })
      },
      onUnread: () => { void r.markUnread(story.id) },
      onReact: reaction => r.react(story.id, reaction),
      onShare: () => { shareStory(story, sourceName); void r.sendEngagement('share', story.id) },
      onMute: canMute && topics.length > 0
        ? () => { void r.muteTopics(topics); void r.sendEngagement('mute_topic', story.id) }
        : undefined,
      onCopyForGemini: () => {
        void copyText(geminiPrompt(story, sourceName)).then(ok => snackbar.show({ message: ok ? 'Copied. Paste it into Gemini.' : "Couldn't copy" }))
      },
      saved: r.saved.available ? r.saved.ids.has(story.id) : undefined,
      onSave: r.saved.available ? () => { void r.saved.toggle(story) } : undefined,
      onListen: listen.supported
        ? () => { if (listening) listen.stop(); else listen.play({ story, sourceName }) }
        : undefined,
      listening,
    }
  }, [r, listen, snackbar, canMute, pane])
}
