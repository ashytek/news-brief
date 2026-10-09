'use client'

import { Check } from 'lucide-react'
import { Sheet } from './Sheet'
import { cx } from './cx'

/** A bottom sheet that picks one of a few options (the Search filters). Rows are
 *  48 px+ radio buttons; choosing one applies it and closes the sheet. */
export function OptionSheet<T extends string>({ open, onClose, title, value, onChange, options }: {
  open: boolean
  onClose: () => void
  title: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div role="radiogroup" aria-label={title} className="flex flex-col pb-1 pt-2">
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => { onChange(o.value); onClose() }}
            className="flex min-h-14 w-full items-center gap-3 rounded-panel px-3 text-left text-base font-medium text-fg-1 hover:bg-surface-2 active:bg-surface-2"
          >
            <span className="flex-1">{o.label}</span>
            <Check className={cx('size-[18px] flex-none text-accent', o.value !== value && 'invisible')} aria-hidden="true" />
          </button>
        ))}
      </div>
    </Sheet>
  )
}
