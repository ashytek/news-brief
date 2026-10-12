// Netlify Scheduled Function: the PRIMARY scheduler for the news pipeline (roadmap session 11).
//
// GitHub's own cron proved unreliable (3-10 Oct 2026: 2-5 runs a day, often hours late), so this
// function dispatches the GitHub Actions workflow instead, at the slots the cron was meant to hit.
// It does what app/api/pipeline/trigger/route.ts does (same repo, same workflow, the same Netlify
// environment variable GITHUB_PIPELINE_PAT) with one difference: it passes inputs.source = "schedule",
// so the run is recorded in pipeline_runs.trigger_source as "schedule", not "manual" (a manual run
// makes the next scheduled run skip, see run_pipeline.py). GitHub's cron stays as a BACKUP, 30 min
// later, with a guard that skips it when this function's run already started.
//
// Times are UTC (a Netlify schedule is always UTC): 03:17, 09:17, 15:17, 21:17 = 04:17, 10:17, 16:17,
// 22:17 UK summer time. Runs only on the published production deploy (Netlify does not fire schedules
// on deploy previews or branch deploys). Limit 30 s, so the GitHub call has a 15 s timeout.
//
// No retries on purpose: a failed dispatch is logged and the function returns a non-2xx status (shown
// as a failed invocation in the Netlify UI); GitHub's backup cron covers a missed slot.
// The token is never logged. The module's other exports exist for netlify/tests/pipeline-schedule.test.mjs.

// Must stay a literal object: Netlify reads it statically at build time.
export const config = { schedule: '17 3,9,15,21 * * *' }

// Keep in step with app/api/pipeline/trigger/route.ts (the test compares them).
export const REPO = 'ashytek/news-brief'
export const WORKFLOW_FILE = 'news-pipeline.yml'
export const REF = 'main'

export type DispatchResult = { ok: boolean; status: number; message: string }
type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export async function dispatchPipeline(
  token: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchResult> {
  if (!token) {
    return { ok: false, status: 500, message: 'GITHUB_PIPELINE_PAT is not set for Functions in this Netlify site' }
  }

  let res: Response
  try {
    res = await fetchImpl(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'newsbrief-pipeline-schedule',
        },
        body: JSON.stringify({ ref: REF, inputs: { source: 'schedule' } }),
        signal: AbortSignal.timeout(15_000),
      },
    )
  } catch (e) {
    // The error message of a failed fetch never contains the request headers.
    return { ok: false, status: 502, message: `GitHub dispatch request failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (res.status === 204) {
    return { ok: true, status: 204, message: `dispatched ${WORKFLOW_FILE} on ${REF} with source=schedule` }
  }

  const body = (await res.text().catch(() => '')).slice(0, 300)
  const hint = res.status === 401 || res.status === 403 ? ' (PAT expired or revoked, or missing Actions read/write?)' : ''
  return { ok: false, status: 502, message: `GitHub dispatch failed with HTTP ${res.status}${hint}: ${body}` }
}

function readToken(): string | undefined {
  const netlify = (globalThis as { Netlify?: { env?: { get(name: string): string | undefined } } }).Netlify
  return netlify?.env?.get('GITHUB_PIPELINE_PAT') ?? process.env.GITHUB_PIPELINE_PAT
}

export default async function handler(): Promise<Response> {
  const result = await dispatchPipeline(readToken())
  if (result.ok) {
    console.log(`pipeline-schedule: ${result.message}`)
  } else {
    console.error(`pipeline-schedule: ${result.message}`)
  }
  return new Response(JSON.stringify({ ok: result.ok, message: result.message }), {
    status: result.ok ? 200 : result.status,
    headers: { 'content-type': 'application/json' },
  })
}
