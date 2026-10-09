import { categoryMeta } from '@/lib/categories'
import { cx } from './cx'

/** Category as an 8 px dot + kicker text in the category's token colour —
 *  never a filled pill (the redesign's "one accent, muted category marks"). */
export function CategoryMark({ category, short, className }: {
  category: string
  /** Use the short bottom-nav name ("India") instead of the full one. */
  short?: boolean
  className?: string
}) {
  const meta = categoryMeta(category)
  if (!meta) return <span className={cx('t-kicker text-fg-3', className)}>{category}</span>
  return (
    <span className={cx('t-kicker inline-flex items-center gap-1.5', meta.mark.text, className)}>
      <span aria-hidden="true" className={cx('size-2 flex-none rounded-full', meta.mark.dot)} />
      {short ? meta.shortLabel : meta.label}
    </span>
  )
}
