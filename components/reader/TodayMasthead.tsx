'use client'

import type { ReactNode } from 'react'
import { CatchUpToggle } from '@/components/catchup/CatchUpToggle'
import { PageHead } from '@/components/shell/PageHead'
import { mastheadDate } from '@/lib/format'

/** Today's masthead: the date, "Today's Brief", an optional meta line, the
 *  Brief | Catch-up switch, then whatever the page adds (the progress bar). Shown in
 *  the normal brief, in its empty and error states, and in the catch-up, so the
 *  switch is always within reach. */
export function TodayMasthead({ meta, children }: { meta?: ReactNode; children?: ReactNode }) {
  return (
    <PageHead overline={mastheadDate()} title="Today's Brief" meta={meta}>
      <CatchUpToggle className="mt-2 self-start" />
      {children}
    </PageHead>
  )
}
