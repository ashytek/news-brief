'use client'

import type { ReactNode } from 'react'
import { SnackbarProvider } from '@/components/ui'
import { AppNavProvider } from '@/components/nav/AppNav'
import { ReaderProvider } from '@/lib/reader/ReaderProvider'
import { BottomNav } from '@/components/shell/BottomNav'
import { DesktopRail } from '@/components/shell/DesktopRail'
import { ServiceWorker } from '@/components/ServiceWorker'
import { ListenProvider } from '@/lib/listen/ListenProvider'
import { MiniPlayer } from '@/components/listen/MiniPlayer'

/** Client-side state that outlives a single screen. Mounted once, by the
 *  (app) layout, so it survives navigation between Reader, Search, Archive
 *  and Sources. */
export function AppProviders({ userId, children }: { userId: string; children: ReactNode }) {
  return (
    <SnackbarProvider>
      <AppNavProvider>
        <ListenProvider>
        <ReaderProvider userId={userId}>
          {/* From 1180 px the rail is fixed at the left and the page makes room for it. */}
          <div className="flex flex-1 flex-col desk:pl-rail">{children}</div>
          <DesktopRail />
          <MiniPlayer />
          <BottomNav />
          <ServiceWorker />
        </ReaderProvider>
        </ListenProvider>
      </AppNavProvider>
    </SnackbarProvider>
  )
}
