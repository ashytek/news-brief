export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SourcesClient from './SourcesClient'

export default async function SourcesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: sources } = await supabase
    .from('sources')
    .select('*')
    .order('category')
    .order('name')

  const { data: runs } = await supabase
    .from('pipeline_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(5)

  return <SourcesClient sources={sources ?? []} recentRuns={runs ?? []} />
}
