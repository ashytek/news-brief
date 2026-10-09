import type { ReactNode } from 'react'

/** The masthead of a page: optional overline (a date), the serif title, one meta line. */
export function PageHead({ overline, title, meta, children }: {
  overline?: string
  title: string
  meta?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 pb-2 pt-5">
      {overline && <p className="t-overline">{overline}</p>}
      <h1 className="t-display">{title}</h1>
      {meta && <p className="t-meta">{meta}</p>}
      {children}
    </div>
  )
}
