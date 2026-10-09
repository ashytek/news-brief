import Link from 'next/link'
import type { ButtonHTMLAttributes, ComponentPropsWithoutRef, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'

interface Own {
  /** Selected/active state. A button chip announces it as `aria-pressed`; a link chip as `aria-current`. */
  selected?: boolean
  /** Muted trailing count ("98"). 0 is shown; undefined hides it. */
  count?: number
  icon?: LucideIcon
  children: ReactNode
}

/** Visual height 36 px; an invisible ::after extends the hit area to 48 px. */
export function chipClass(selected?: boolean): string {
  return cx(
    'relative inline-flex h-9 flex-none items-center gap-1.5 rounded-control px-3.5 text-sm font-medium leading-none',
    "transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
    selected
      ? 'border border-transparent bg-accent-soft text-fg-1'
      : 'border border-hairline-strong bg-transparent text-fg-2 hover:bg-surface-2',
  )
}

function Inner({ icon: Icon, count, selected, children }: Pick<Own, 'icon' | 'count' | 'selected' | 'children'>) {
  return (
    <>
      {Icon && <Icon className="size-4" aria-hidden="true" />}
      {children}
      {count !== undefined && (
        <span className={cx('font-medium tabular-nums', selected ? 'text-accent' : 'text-fg-3')}>{count}</span>
      )}
    </>
  )
}

export function Chip({
  selected, count, icon, children, className, type = 'button', ...rest
}: Own & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button type={type} aria-pressed={selected ?? false} className={cx(chipClass(selected), className)} {...rest}>
      <Inner icon={icon} count={count} selected={selected}>{children}</Inner>
    </button>
  )
}

export function ChipLink({
  selected, count, icon, children, className, ...rest
}: Own & Omit<ComponentPropsWithoutRef<typeof Link>, 'children'>) {
  return (
    <Link aria-current={selected ? 'page' : undefined} className={cx(chipClass(selected), className)} {...rest}>
      <Inner icon={icon} count={count} selected={selected}>{children}</Inner>
    </Link>
  )
}
