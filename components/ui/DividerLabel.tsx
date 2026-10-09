import type { ReactNode } from 'react'
import { cx } from './cx'

/** A small-caps label with a hairline running off to the right ("Before you
 *  left", "IGR + Vantage · Latest"). Optional `action` sits at the far end. */
export function DividerLabel({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center gap-3 pb-1 pt-5', className)}>
      <span className="t-overline">{children}</span>
      <div className="h-px flex-1 bg-hairline-strong" />
      {action}
    </div>
  )
}
