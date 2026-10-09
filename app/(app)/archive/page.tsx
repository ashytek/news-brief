export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import ArchiveClient from './ArchiveClient'

export default async function ArchivePage() {
  const user = await getUser()
  if (!user) redirect('/auth')

  return <ArchiveClient userId={user.id} />
}
