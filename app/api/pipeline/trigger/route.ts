import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const REPO = 'ashytek/news-brief'
const WORKFLOW_FILE = 'news-pipeline.yml'

// Tunable — arbitrary but sensible given each run has a real Apify/Gemini cost.
const COOLDOWN_MS = 15 * 60_000
// The workflow has timeout-minutes: 45, so a `running` row older than this
// is guaranteed stale/crashed (never called finish_pipeline_run) — treat it
// as dead rather than blocking manual triggers forever with no recovery path.
const STALE_RUNNING_MS = 50 * 60_000

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

export async function POST(req: NextRequest) {
  await req.json().catch(() => ({})) // tolerant parse; body unused in v1

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const token = process.env.GITHUB_PIPELINE_PAT
  if (!token) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  try {
    const { data: latest } = await supabase
      .from('pipeline_runs')
      .select('id, status, started_at')
      .order('started_at', { ascending: false })
      .limit(1)

    const latestRun = latest?.[0]

    if (latestRun?.status === 'running') {
      const age = Date.now() - new Date(latestRun.started_at).getTime()
      if (age < STALE_RUNNING_MS) {
        return NextResponse.json(
          { error: 'Pipeline already running', startedAt: latestRun.started_at },
          { status: 409 }
        )
      }
      // else: stale/stuck running row — treat as dead, fall through
    }

    if (latestRun) {
      const age = Date.now() - new Date(latestRun.started_at).getTime()
      if (age < COOLDOWN_MS) {
        return NextResponse.json(
          { error: 'Triggered too recently', retryAfterSeconds: Math.ceil((COOLDOWN_MS - age) / 1000) },
          { status: 429 }
        )
      }
    }

    // Dispatch-to-row-insert blind window: it takes GitHub roughly 1.5-4 min
    // to queue + checkout + pip-install before start_pipeline_run() ever
    // writes a row, during which the guard above only sees the old
    // (finished) row and would let a duplicate real dispatch through — the
    // workflow's concurrency group queues rather than dedupes, so both
    // would still run back-to-back at full cost. Close it with GitHub's own
    // run list.
    for (const status of ['queued', 'in_progress']) {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=${status}`,
        { headers: GH_HEADERS(token) }
      )
      if (res.ok) {
        const body = await res.json().catch(() => null)
        if (body?.total_count > 0) {
          return NextResponse.json(
            { error: 'Pipeline already running', source: 'github' },
            { status: 409 }
          )
        }
      }
      // Non-ok here isn't fatal to the check — fall through to the dispatch
      // attempt itself, which will surface a clearer error if the PAT is bad.
    }

    const dispatchRes = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main' }),
      }
    )

    if (dispatchRes.status !== 204) {
      const body = await dispatchRes.text().catch(() => '')
      if (dispatchRes.status === 401 || dispatchRes.status === 403) {
        console.error('GitHub dispatch auth failure — PAT expired or revoked?', dispatchRes.status, body)
      } else {
        console.error('GitHub dispatch failed', dispatchRes.status, body)
      }
      return NextResponse.json({ error: 'GitHub dispatch failed' }, { status: 502 })
    }

    return NextResponse.json({
      ok: true,
      triggeredAt: new Date().toISOString(),
      latestRunId: latestRun?.id ?? null,
    })
  } catch (e) {
    console.error('Pipeline trigger route error', e)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
