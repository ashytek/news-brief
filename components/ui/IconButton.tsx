import Link from 'next/link'
import type { ButtonHTMLAttributes, ComponentPropsWithoutRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'

interface Own {
  /** Accessible name. Required: an icon alone says nothing to a screen reader. */
  label: string
  icon: LucideIcon
  tone?: 'default' | 'accent'
  /** Small count bubble on the corner (e.g. unread). 0/undefined hides it. */
  badge?: number
}

type AsButton = Own & { href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'>
type AsLink = Own & { href: string } & Omit<ComponentPropsWithoutRef<typeof Link>, 'href' | 'aria-label' | 'children'>

function iconButtonClass(tone: Own['tone'], className?: string): string {
  return cx(
    'relative grid size-12 flex-none place-items-center rounded-full',
    'transition-[background-color,transform] active:scale-95 active:bg-surface-2 hover:bg-surface-2',
    tone === 'accent' ? 'text-accent' : 'text-fg-2',
    className,
  )
}

function Glyph({ icon: Icon, badge }: Pick<Own, 'icon' | 'badge'>) {
  return (
    <>
      <Icon className="size-[22px]" aria-hidden="true" />
      {badge ? (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 min-w-[18px] rounded-full bg-accent-fill px-1 text-center text-[11px] font-bold leading-[18px] tabular-nums text-on-accent"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </>
  )
}

/** 48 px round icon control (the design system's `.icon-btn`). Renders a link
 *  when `href` is given, a button otherwise. */
export function IconButton(props: AsButton | AsLink) {
  if (props.href !== undefined) {
    const { label, icon, tone, badge, className, ...rest } = props
    return (
      <Link aria-label={label} className={iconButtonClass(tone, className)} {...rest}>
        <Glyph icon={icon} badge={badge} />
      </Link>
    )
  }
  const { label, icon, tone, badge, className, type = 'button', ...rest } = props
  return (
    <button type={type} aria-label={label} className={iconButtonClass(tone, className)} {...rest}>
      <Glyph icon={icon} badge={badge} />
    </button>
  )
}
