import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from './Button'
import { cx } from './cx'

type Tone = 'neutral' | 'ok' | 'error'

const TILE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-3 ring-hairline',
  ok: 'bg-ok/10 text-ok ring-ok/30',
  error: 'bg-bad/10 text-bad ring-bad/30',
}

/** Empty / error / "all caught up" block: icon tile, title, one line of body,
 *  optional action. An error is announced assertively (`role="alert"`); the
 *  rest politely (`role="status"`). */
export function StateMessage({ tone = 'neutral', icon: Icon, title, children, action, className }: {
  tone?: Tone
  icon: LucideIcon
  title: string
  children?: ReactNode
  action?: { label: string; onClick: () => void } | ReactNode
  className?: string
}) {
  const act = action && typeof action === 'object' && 'label' in (action as object) && 'onClick' in (action as object)
    ? (action as { label: string; onClick: () => void })
    : null
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('px-6 py-16 text-center', className)}>
      <div className={cx('mb-4 inline-grid size-14 place-items-center rounded-panel ring-1', TILE[tone])}>
        <Icon className="size-7" aria-hidden="true" />
      </div>
      <p className="t-h3 text-fg-1">{title}</p>
      {children && <p className="t-meta mx-auto mt-1.5 max-w-xs">{children}</p>}
      {act
        ? <div className="mt-4"><Button variant="text" onClick={act.onClick}>{act.label}</Button></div>
        : action ? <div className="mt-4">{action as ReactNode}</div> : null}
    </div>
  )
}
