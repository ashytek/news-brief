'use client'

import type { ReactNode } from 'react'
import { SnackbarProvider } from '@/components/ui'
import { AppNavProvider } from '@/components/nav/AppNav'
import { ReaderProvider } from '@/lib/reader/ReaderProvider'
import { BottomNav } from '@/components/shell/BottomNav'
import { DesktopRail } from '@/components/shell/DesktopRail'
import { ServiceWorker } from '@/components/ServiceWorker'

/** Client-side state that outlives a single screen. Mounted once, by the
 *  (app) layout, so it survives navigation between Reader, Search, Archive
 *  and Sources. */
export function AppProviders({ userId, children }: { userId: string; children: ReactNode }) {
  return (
    <SnackbarProvider>
      <AppNavProvider>
        <ReaderProvider userId={userId}>
          {/* From 1180 px the rail is fixed at the left and the page makes room for it. */}
          <div className="flex flex-1 flex-col desk:pl-rail">{children}</div>
          <DesktopRail />
          <BottomNav />
          <ServiceWorker />
        </ReaderProvider>
      </AppNavProvider>
    </SnackbarProvider>
  )
}
