'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'
import { cx } from './cx'

/** Bottom sheet on the native <dialog>: the browser supplies the focus trap,
 *  Esc-to-close, inert background and top-layer stacking, so none of it is
 *  hand-rolled. Closing (Esc, the X, a tap on the dim area) always goes through
 *  `onClose`; the parent owns `open`. */
export function Sheet({ open, onClose, title, children, className }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  // Lock page scroll behind the sheet. On <html>, not <body>: see globals.css
  // for why body must never become a scroll container.
  useEffect(() => {
    if (!open) return
    const el = document.documentElement
    const prev = el.style.overflow
    el.style.overflow = 'hidden'
    return () => { el.style.overflow = prev }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // 'close' fires for Esc and for d.close(); the parent's state follows either way.
      onClose={onClose}
      // The dialog box has no padding, so a click whose target is the dialog
      // itself landed on the ::backdrop.
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      className={cx(
        'fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto overscroll-contain',
        'rounded-t-2xl border-0 bg-surface-1 p-0 text-fg-1 backdrop:bg-black/60 open:animate-sheet-in',
        className,
      )}
    >
      <div className="px-gutter pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between pt-2">
          <h2 id={titleId} className="t-h3 pl-1">{title}</h2>
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>
        {children}
      </div>
    </dialog>
  )
}
