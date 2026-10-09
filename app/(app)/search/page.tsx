export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import SearchClient from './SearchClient'

export default async function SearchPage() {
  const user = await getUser()
  if (!user) redirect('/auth')

  return <SearchClient />
}
