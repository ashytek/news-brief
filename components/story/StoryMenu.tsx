'use client'

import { useState, type ReactNode } from 'react'
import { BellOff, Bookmark, BookmarkCheck, Check, ClipboardCopy, Ellipsis, Headphones, Share2, Square, ThumbsDown, ThumbsUp, Undo2, type LucideIcon } from 'lucide-react'
import { IconButton, Sheet, cx } from '@/components/ui'
import type { StoryActions } from './types'

function Row({ icon: Icon, selected, onPick, children }: {
  icon: LucideIcon
  selected?: boolean
  onPick: () => void
  children: ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="flex min-h-14 w-full items-center gap-3.5 rounded-panel px-3 text-left text-base font-medium text-fg-1 hover:bg-surface-2 active:bg-surface-2"
      >
        <Icon className={cx('size-[22px] flex-none', selected ? 'text-accent' : 'text-fg-2')} aria-hidden="true" />
        <span className="flex-1">{children}</span>
        {selected && <Check className="size-[18px] flex-none text-accent" aria-label="Chosen" />}
      </button>
    </li>
  )
}

/** The ⋯ button on a card: More like this / Less like this / Mute topic / Listen / Save
 *  for later / Share / Copy for Gemini / Mark unread, in a bottom sheet (48 px rows, focus trapped, Esc closes). The
 *  sheet is only in the page while it is open. */
export function StoryMenu({ actions }: { actions: StoryActions }) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const pick = (fn: () => void) => () => { fn(); close() }
  return (
    <>
      <IconButton label="More actions" icon={Ellipsis} aria-haspopup="dialog" onClick={() => setOpen(true)} />
      {open && (
        <Sheet open onClose={close} title="Story options">
          <ul className="flex flex-col pb-1 pt-2">
            <Row icon={ThumbsUp} selected={actions.reaction === 'like'} onPick={pick(() => actions.onReact('like'))}>More like this</Row>
            <Row icon={ThumbsDown} selected={actions.reaction === 'dislike'} onPick={pick(() => actions.onReact('dislike'))}>Less like this</Row>
            {actions.onMute && <Row icon={BellOff} onPick={pick(actions.onMute)}>Mute this topic for 2 weeks</Row>}
            {actions.onListen && (
              <Row icon={actions.listening ? Square : Headphones} onPick={pick(actions.onListen)}>{actions.listening ? 'Stop listening' : 'Listen'}</Row>
            )}
            {actions.onSave && (
              <Row icon={actions.saved ? BookmarkCheck : Bookmark} selected={actions.saved} onPick={pick(actions.onSave)}>
                {actions.saved ? 'Saved for later' : 'Save for later'}
              </Row>
            )}
            <Row icon={Share2} onPick={pick(actions.onShare)}>Share summary</Row>
            {actions.onCopyForGemini && <Row icon={ClipboardCopy} onPick={pick(actions.onCopyForGemini)}>Copy for Gemini</Row>}
            {actions.isRead && <Row icon={Undo2} onPick={pick(actions.onUnread)}>Mark unread</Row>}
          </ul>
        </Sheet>
      )}
    </>
  )
}
