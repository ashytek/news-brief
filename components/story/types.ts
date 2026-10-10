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
  /** Put the summary and a "cross-check this" instruction on the clipboard, for one paste into Gemini. */
  onCopyForGemini?: () => void
  /** Save for later. `saved` is undefined where saving isn't available (the table isn't created yet). */
  saved?: boolean
  onSave?: () => void
  /** Read it aloud. Undefined where the browser can't. `listening` = it is being read now. */
  onListen?: () => void
  listening?: boolean
}
