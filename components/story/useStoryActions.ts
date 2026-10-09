'use client'

import { useCallback } from 'react'
import type { StoryWithRelations } from '@/lib/types'
import { useReader } from '@/lib/reader/ReaderProvider'
import type { StoryActions } from './types'

/** Native share sheet on phones; clipboard on desktop. */
export function shareStory(story: StoryWithRelations) {
  const url = story.videos?.url ?? window.location.href
  if (navigator.share) {
    navigator.share({ title: story.headline, text: story.headline, url }).catch(() => {})
  } else {
    navigator.clipboard?.writeText(`${story.headline}\n${url}`).catch(() => {})
  }
}

/** Builds a story's actions from the shared Reader state, so a card in Today, a
 *  row in Search and a row in Archive all read, react and undo the same way.
 *  Muting is offered only where asked (the feeds): Search, Archive and Topics
 *  don't load the muted-topics list. */
export function useStoryActions({ canMute = false }: { canMute?: boolean } = {}) {
  const r = useReader()
  return useCallback((story: StoryWithRelations): StoryActions => {
    const topics = story.matched_topics ?? []
    return {
      isRead: r.readIds.has(story.id),
      reaction: r.reactions.get(story.id),
      onRead: () => { void r.markReadUndoable(story.id) },
      onUnread: () => { void r.markUnread(story.id) },
      onReact: reaction => r.react(story.id, reaction),
      onShare: () => { shareStory(story); void r.sendEngagement('share', story.id) },
      onMute: canMute && topics.length > 0
        ? () => { void r.muteTopics(topics); void r.sendEngagement('mute_topic', story.id) }
        : undefined,
    }
  }, [r, canMute])
}
