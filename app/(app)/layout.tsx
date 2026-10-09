import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { AppProviders } from '@/components/AppProviders'

/** Shared shell for the signed-in screens (Reader, Search, Archive, Sources).
 *  Next keeps a layout mounted while you move between the pages under it, so
 *  the state in <AppProviders> — notably the Reader's loaded feed — survives
 *  a trip to Search and back, and the browser can restore your scroll position.
 *  (The `(app)` folder is a route group: it adds no segment to the URL.) */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/auth')
  return <AppProviders userId={user.id}>{children}</AppProviders>
}
