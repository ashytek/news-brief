'use client'

import type { MouseEvent } from 'react'
import { usePathname } from 'next/navigation'
import { Archive, Hash, Layers, Newspaper, Search, type LucideIcon } from 'lucide-react'
import { useReader } from '@/lib/reader/ReaderProvider'
import { isSection } from '@/lib/reader/types'

export type NavKey = 'today' | 'sections' | 'topics' | 'search' | 'archive'

const ITEMS: { key: NavKey; label: string; icon: LucideIcon; href: string }[] = [
  { key: 'today', label: 'Today', icon: Newspaper, href: '/reader' },
  { key: 'sections', label: 'Sections', icon: Layers, href: '/reader' },
  { key: 'topics', label: 'Topics', icon: Hash, href: '/reader' },
  { key: 'search', label: 'Search', icon: Search, href: '/search' },
  { key: 'archive', label: 'Archive', icon: Archive, href: '/archive' },
]

export type NavItem = {
  key: NavKey
  label: string
  icon: LucideIcon
  href: string
  isActive: boolean
  /** Unread count shown on the item (Today: the brief), 0 for none. */
  badge: number
  onClick: (e: MouseEvent<HTMLAnchorElement>) => void
}

/** The five destinations and which is active, shared by the bottom nav (phones) and
 *  the left rail (desktop). Today, Sections and Topics are views of the Reader (one
 *  route, kept mounted); Search and Archive are their own screens. Selecting the item
 *  you are already on scrolls to the top. */
export function useNav() {
  const pathname = usePathname()
  const r = useReader()

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

  const items: NavItem[] = ITEMS.map(item => ({
    ...item,
    isActive: item.key === active,
    badge: item.key === 'today' ? r.todayUnread : 0,
    onClick: onSelect(item.key),
  }))

  return { pathname, items }
}
