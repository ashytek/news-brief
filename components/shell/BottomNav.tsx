'use client'

import type { MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Archive, Hash, Layers, Newspaper, Search, type LucideIcon } from 'lucide-react'
import { cx } from '@/components/ui'
import { useReader } from '@/lib/reader/ReaderProvider'
import { isSection } from '@/lib/reader/types'

type NavKey = 'today' | 'sections' | 'topics' | 'search' | 'archive'

const ITEMS: { key: NavKey; label: string; icon: LucideIcon; href: string }[] = [
  { key: 'today', label: 'Today', icon: Newspaper, href: '/reader' },
  { key: 'sections', label: 'Sections', icon: Layers, href: '/reader' },
  { key: 'topics', label: 'Topics', icon: Hash, href: '/reader' },
  { key: 'search', label: 'Search', icon: Search, href: '/search' },
  { key: 'archive', label: 'Archive', icon: Archive, href: '/archive' },
]

/** Five labelled destinations. Today, Sections and Topics are views of the Reader
 *  (one route, kept mounted); Search and Archive are their own screens. Tapping the
 *  item you are already on scrolls to the top (that replaced the floating arrow).
 *  Hidden on Sources, which is a sub-screen with its own back arrow. */
export function BottomNav() {
  const pathname = usePathname()
  const r = useReader()

  if (pathname.startsWith('/sources')) return null

  const active: NavKey | null =
    pathname.startsWith('/search') ? 'search'
    : pathname.startsWith('/archive') ? 'archive'
    : r.activeTab === 'today' ? 'today'
    : r.activeTab === 'topics' ? 'topics'
    : isSection(r.activeTab) ? 'sections'
    : null

  const onSelect = (key: NavKey) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    if (key === 'today') r.handleTabChange('today')
    else if (key === 'sections') r.openSections()
    else if (key === 'topics') r.handleTabChange('topics')
    // Already here: no navigation, just back to the top.
    if (key === active) {
      e.preventDefault()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-hairline bg-surface-1 pb-[env(safe-area-inset-bottom,0px)]"
    >
      <div className="mx-auto grid h-navbar max-w-2xl grid-cols-5">
        {ITEMS.map(({ key, label, icon: Icon, href }) => {
          const isActive = key === active
          const badge = key === 'today' ? r.todayUnread : 0
          return (
            <Link
              key={key}
              href={href}
              prefetch={false}
              onClick={onSelect(key)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={badge > 0 ? `${label}, ${badge} unread` : label}
              className={cx(
                'relative flex flex-col items-center justify-center gap-1 text-xs leading-4 active:opacity-70',
                isActive ? 'font-semibold text-fg-1' : 'font-medium text-fg-2',
              )}
            >
              <span
                className={cx(
                  'relative grid h-[30px] w-14 place-items-center rounded-full transition-colors',
                  isActive && 'bg-accent-soft text-accent',
                )}
              >
                <Icon className="size-[22px]" aria-hidden="true" />
                {badge > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-1 left-8 min-w-[18px] rounded-full bg-accent-fill px-1 text-center text-[11px] font-bold leading-[18px] tabular-nums text-on-accent"
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span aria-hidden={badge > 0 ? true : undefined}>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
