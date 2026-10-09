'use client'

import { Chip } from '@/components/ui'
import { CATEGORIES } from '@/lib/categories'
import { useReader } from '@/lib/reader/ReaderProvider'
import type { SectionKey } from '@/lib/reader/types'

/** The Sections chip row: All, then each category that has stories (dead ones
 *  are hidden), each with its unread count once known. Lives inside the sticky
 *  top bar so it stays in view while the feed scrolls. */
export function SectionsBar() {
  const r = useReader()
  const items: { key: SectionKey; label: string }[] = [
    { key: 'all', label: 'All' },
    ...CATEGORIES.filter(c => r.activeCategoryKeys.has(c.key)).map(c => ({ key: c.key as SectionKey, label: c.label })),
  ]
  return (
    <div role="group" aria-label="Sections" className="scrollbar-hide flex gap-2 overflow-x-auto px-gutter py-2">
      {items.map(({ key, label }) => (
        <Chip
          key={key}
          selected={r.activeTab === key}
          count={r.sectionUnread?.[key]}
          onClick={() => r.handleTabChange(key)}
        >
          {label}
        </Chip>
      ))}
    </div>
  )
}
