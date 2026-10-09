import Link from 'next/link'
import type { ButtonHTMLAttributes, ComponentPropsWithoutRef, ReactNode } from 'react'
import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'tonal' | 'outline' | 'text'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent-fill text-on-accent',
  tonal: 'bg-surface-2 text-fg-1',
  outline: 'border border-hairline-strong text-fg-1',
  text: 'text-accent px-3',
}

/** Class string for a button-shaped control — shared by <Button> and <ButtonLink>
 *  so a link can look like a button without nesting one in the other. 44 px
 *  minimum height (48 px when `block`), per the audit's target-size floor. */
export function buttonClass(variant: ButtonVariant = 'primary', block = false): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-full px-[18px] text-sm font-semibold leading-none',
    'select-none transition-[opacity,transform] active:scale-[0.98] active:opacity-80',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    block ? 'min-h-12 w-full' : 'min-h-11',
    VARIANT[variant],
  )
}

interface Shared {
  variant?: ButtonVariant
  block?: boolean
  /** Leading icon (lucide). Decorative: the label carries the meaning. */
  icon?: LucideIcon
  children: ReactNode
}

export function Button({
  variant = 'primary', block, icon: Icon, loading, children, className, disabled, type = 'button', ...rest
}: Shared & { loading?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonClass(variant, block), className)}
      {...rest}
    >
      {loading
        ? <LoaderCircle className="size-[18px] animate-spin" aria-hidden="true" />
        : Icon && <Icon className="size-[18px]" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function ButtonLink({
  variant = 'primary', block, icon: Icon, children, className, ...rest
}: Shared & Omit<ComponentPropsWithoutRef<typeof Link>, 'children'>) {
  return (
    <Link className={cx(buttonClass(variant, block), className)} {...rest}>
      {Icon && <Icon className="size-[18px]" aria-hidden="true" />}
      {children}
    </Link>
  )
}
