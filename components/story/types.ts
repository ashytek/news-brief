import type { Reaction } from '@/lib/reader/useReactions'

/** What a story card or expanded row can do. The screens get these from
 *  `useStoryActions` (the provider's read marks, reactions and engagement); the
 *  dev gallery passes fakes. `onMute` exists only when the story has matched
 *  topics and the screen can mute them. */
export interface StoryActions {
  isRead: boolean
  reaction?: Reaction
  onRead: () => void
  onUnread: () => void
  onReact: (r: Reaction) => void
  onShare: () => void
  onMute?: () => void
}
