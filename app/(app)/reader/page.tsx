export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import ReaderClient from './ReaderClient'

export default async function ReaderPage() {
  const user = await getUser()
  if (!user) redirect('/auth')

  return <ReaderClient />
}
