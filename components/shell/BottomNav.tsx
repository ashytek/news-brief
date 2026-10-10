'use client'

import Link from 'next/link'
import { cx } from '@/components/ui'
import { useNav } from './useNav'

/** Five labelled destinations (see useNav). Tapping the item you are already on
 *  scrolls to the top (that replaced the floating arrow). Hidden on Sources, which is a
 *  sub-screen with its own back arrow, and on desktop widths, where the left rail
 *  (DesktopRail) takes over. */
export function BottomNav() {
  const { pathname, items } = useNav()

  if (pathname.startsWith('/sources')) return null

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-hairline bg-surface-1 pb-[env(safe-area-inset-bottom,0px)] desk:hidden"
    >
      <div className="mx-auto grid h-navbar max-w-2xl grid-cols-5">
        {items.map(({ key, label, icon: Icon, href, isActive, badge, onClick }) => (
          <Link
            key={key}
            href={href}
            prefetch={false}
            onClick={onClick}
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
                  className="absolute -top-1.5 left-7 min-w-5 rounded-full bg-accent-fill px-1 text-center text-xs font-bold leading-5 tabular-nums text-on-accent"
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </span>
            <span aria-hidden={badge > 0 ? true : undefined}>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
