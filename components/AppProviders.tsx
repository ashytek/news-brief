'use client'

import type { ReactNode } from 'react'
import { SnackbarProvider } from '@/components/ui'
import { AppNavProvider } from '@/components/nav/AppNav'
import { ReaderProvider } from '@/lib/reader/ReaderProvider'
import { BottomNav } from '@/components/shell/BottomNav'

/** Client-side state that outlives a single screen. Mounted once, by the
 *  (app) layout, so it survives navigation between Reader, Search, Archive
 *  and Sources. */
export function AppProviders({ userId, children }: { userId: string; children: ReactNode }) {
  return (
    <SnackbarProvider>
      <AppNavProvider>
        <ReaderProvider userId={userId}>
          {children}
          <BottomNav />
        </ReaderProvider>
      </AppNavProvider>
    </SnackbarProvider>
  )
}
