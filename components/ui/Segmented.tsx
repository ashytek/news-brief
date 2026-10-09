import { cx } from './cx'

/** Two-to-three way switch in a pill (Unread | All, Brief | Catch-up). Each
 *  option is a button with `aria-pressed`; the 34 px visual height has a taller
 *  hit area. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  /** Accessible name of the group. */
  label: string
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex gap-0.5 rounded-full bg-surface-2 p-[3px]', className)}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => { if (o.value !== value) onChange(o.value) }}
          className={cx(
            "relative h-[34px] rounded-full px-3.5 text-[13px] font-medium leading-none after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
            o.value === value ? 'bg-surface-3 text-fg-1' : 'text-fg-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
