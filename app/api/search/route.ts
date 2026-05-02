import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { STORY_SELECT } from '@/lib/constants'

const EMBEDDING_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'

async function getQueryEmbedding(text: string): Promise<number[] | null> {
  const key = process.env.GOOGLE_API_KEY
  if (!key) return null
  try {
    const res = await fetch(`${EMBEDDING_URL}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text: text.slice(0, 2000) }] },
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.embedding?.values ?? null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const query: string   = (body.query ?? '').trim()
  const category: string | null = body.category ?? null
  const daysBack: number | null = body.daysBack ?? null  // 7, 30, or null = all time

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  // ── Try hybrid search (needs migration) ──────────────────────────────────
  const embedding = await getQueryEmbedding(query)

  if (embedding) {
    const rpcParams: Record<string, unknown> = {
      query_text:      query,
      query_embedding: embedding,
      match_count:     25,
    }
    if (category)  rpcParams.category_filter = category
    if (daysBack)  rpcParams.days_back        = daysBack

    const { data: hybridData, error: hybridError } = await supabase
      .rpc('search_stories_hybrid', rpcParams)

    if (!hybridError && hybridData && hybridData.length > 0) {
      // Re-fetch full story relations for the matched IDs (hybrid returns
      // only scalar columns — we need videos/sources for the UI)
      const ids = (hybridData as Array<{ id: string; combined_score: number }>)
        .map(r => r.id)
      const scoreMap = Object.fromEntries(
        (hybridData as Array<{ id: string; combined_score: number }>)
          .map(r => [r.id, r.combined_score])
      )

      const { data: stories } = await supabase
        .from('stories')
        .select(STORY_SELECT)
        .in('id', ids)

      if (stories) {
        // Re-sort by score (Supabase .in() doesn't preserve order)
        const typed = stories as unknown as Array<{ id: string }>
        const sorted = typed.sort(
          (a, b) => (scoreMap[b.id] ?? 0) - (scoreMap[a.id] ?? 0)
        )
        return NextResponse.json({ results: sorted, mode: 'hybrid' })
      }
    }

    // Hybrid RPC failed (migration not run) — fall through to FTS-only
    if (!hybridError) {
      // No results from hybrid — genuine empty result
      if (hybridData?.length === 0) {
        // Try fallback anyway in case migration is partial
      }
    }
  }

  // ── Semantic-only fallback (no search_vector but embeddings exist) ────────
  if (embedding) {
    const semParams: Record<string, unknown> = {
      query_embedding: embedding,
      match_count:     25,
    }
    if (category)  semParams.category_filter = category
    if (daysBack)  semParams.days_back        = daysBack

    const { data: semData, error: semError } = await supabase
      .rpc('search_stories_semantic', semParams)

    if (!semError && semData && semData.length > 0) {
      const ids = (semData as Array<{ id: string }>).map(r => r.id)
      const { data: stories } = await supabase
        .from('stories')
        .select(STORY_SELECT)
        .in('id', ids)

      if (stories) {
        const idOrder = Object.fromEntries(ids.map((id, i) => [id, i]))
        const typed   = stories as unknown as Array<{ id: string }>
        const sorted  = typed.sort((a, b) => (idOrder[a.id] ?? 99) - (idOrder[b.id] ?? 99))
        return NextResponse.json({ results: sorted, mode: 'semantic' })
      }
    }
  }

  // ── Simple text fallback (no migration needed) ────────────────────────────
  // ilike on headline + summary — catches most name/country/topic queries
  const words = query.split(/\s+/).filter(w => w.length >= 2).slice(0, 5)
  if (words.length === 0) return NextResponse.json({ results: [] })

  // Build OR filter: headline or summary contains any word in the query
  const orFilter = words
    .flatMap(w => [`headline.ilike.%${w}%`, `summary.ilike.%${w}%`])
    .join(',')

  let q = supabase
    .from('stories')
    .select(STORY_SELECT)
    .or(orFilter)
    .order('created_at', { ascending: false })
    .limit(30)

  if (category) q = q.eq('category', category)
  if (daysBack) {
    const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
    q = q.gte('created_at', from)
  }

  const { data: fallbackData } = await q

  return NextResponse.json({ results: fallbackData ?? [], mode: 'text' })
}
