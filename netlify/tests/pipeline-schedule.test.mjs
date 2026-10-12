// Offline checks for the Netlify Scheduled Function (roadmap session 11). No network: fetch is replaced.
// Lives OUTSIDE netlify/functions on purpose: every top-level file in that folder is deployed as a function.
// Run: node --experimental-strip-types netlify/tests/pipeline-schedule.test.mjs   (Node >= 22.6)
import { readFileSync } from 'node:fs'
import { dispatchPipeline, config, REPO, WORKFLOW_FILE, REF, default as handler } from '../functions/pipeline-schedule.mts'

let pass = 0, fail = 0
const check = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL:', name, extra) } }
const TOKEN = 'ghp_TESTTOKEN_not_a_real_secret_123'

// A fetch that records every call and answers as told. Never touches the network.
function mockFetch(answer) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    if (answer instanceof Error) throw answer
    return answer
  }
  fn.calls = calls
  return fn
}
const res = (status, body = '') => new Response(status === 204 ? null : body, { status })

// ---------------------------------------------------------------- the request
{
  const f = mockFetch(res(204))
  const r = await dispatchPipeline(TOKEN, f)
  check('204 -> ok', r.ok === true && r.status === 204, r)
  check('exactly one request', f.calls.length === 1, f.calls.length)
  const { url, init } = f.calls[0]
  check('URL is the workflow_dispatch endpoint of the pipeline workflow',
    url === 'https://api.github.com/repos/ashytek/news-brief/actions/workflows/news-pipeline.yml/dispatches', url)
  check('method POST', init.method === 'POST')
  const h = init.headers
  check('Authorization header is a Bearer token (value not asserted)', typeof h.Authorization === 'string' && h.Authorization.startsWith('Bearer ') && h.Authorization.length > 'Bearer '.length + 8)
  check('Accept, API version, Content-Type and User-Agent headers are present',
    h.Accept === 'application/vnd.github+json' && h['X-GitHub-Api-Version'] === '2022-11-28' && h['Content-Type'] === 'application/json' && !!h['User-Agent'])
  const body = JSON.parse(init.body)
  check('body: ref is main', body.ref === 'main', body)
  check('body: inputs.source is "schedule" (so the run is not recorded as manual)', body.inputs?.source === 'schedule', body)
  check('body has nothing else', Object.keys(body).sort().join() === 'inputs,ref' && Object.keys(body.inputs).join() === 'source', body)
  check('a timeout signal is set (the platform limit is 30 s)', init.signal instanceof AbortSignal)
  check('the result message does not contain the token', !JSON.stringify(r).includes(TOKEN))
}

// ---------------------------------------------------------------- failures: logged, never thrown, never retried
{
  const f = mockFetch(res(401, '{"message":"Bad credentials"}'))
  const r = await dispatchPipeline(TOKEN, f)
  check('401 -> not ok, 502, says why', r.ok === false && r.status === 502 && r.message.includes('HTTP 401') && r.message.includes('Bad credentials'), r)
  check('401 -> hints at the PAT', /PAT/.test(r.message), r.message)
  check('401 -> one request only (no retry loop)', f.calls.length === 1, f.calls.length)
  check('401 -> token not in the message', !r.message.includes(TOKEN))
}
{
  const f = mockFetch(res(422, '{"message":"Unexpected inputs provided: [\\"source\\"]"}'))
  const r = await dispatchPipeline(TOKEN, f)
  check('422 (workflow lacks the input) -> status and body are in the message', !r.ok && r.message.includes('HTTP 422') && r.message.includes('Unexpected inputs'), r)
}
{
  const f = mockFetch(res(500, 'x'.repeat(5000)))
  const r = await dispatchPipeline(TOKEN, f)
  check('a huge error body is truncated', r.message.length < 500, r.message.length)
}
{
  const f = mockFetch(new TypeError('fetch failed'))
  let r, threw = false
  try { r = await dispatchPipeline(TOKEN, f) } catch { threw = true }
  check('a network error does not throw', !threw)
  check('a network error -> not ok, 502, message says what happened', r && !r.ok && r.status === 502 && r.message.includes('fetch failed'), r)
  check('a network error -> one attempt only', f.calls.length === 1)
}
{
  const f = mockFetch(res(204))
  const r = await dispatchPipeline(undefined, f)
  check('no token -> not ok, 500, names the variable, no request made', !r.ok && r.status === 500 && r.message.includes('GITHUB_PIPELINE_PAT') && f.calls.length === 0, r)
  const r2 = await dispatchPipeline('', f)
  check('empty token -> same', !r2.ok && f.calls.length === 0)
}

// ---------------------------------------------------------------- the handler (what Netlify invokes)
{
  const logs = []
  const realLog = console.log, realErr = console.error, realFetch = globalThis.fetch
  console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => logs.push(a.join(' '))
  try {
    process.env.GITHUB_PIPELINE_PAT = TOKEN
    const f = mockFetch(res(204)); globalThis.fetch = f
    const ok = await handler(new Request('https://example.test/', { method: 'POST', body: JSON.stringify({ next_run: '2026-10-12T09:17:00Z' }) }))
    check('handler: 200 on success', ok.status === 200 && (await ok.json()).ok === true)
    check('handler: dispatched once with the token from the environment', f.calls.length === 1 && f.calls[0].init.headers.Authorization === `Bearer ${TOKEN}`)

    globalThis.fetch = mockFetch(res(403, '{"message":"Resource not accessible by personal access token"}'))
    const bad = await handler()
    check('handler: non-2xx (so Netlify shows a failed invocation) when GitHub refuses', bad.status === 502 && (await bad.json()).ok === false)

    delete process.env.GITHUB_PIPELINE_PAT
    const none = mockFetch(res(204)); globalThis.fetch = none
    const missing = await handler()
    check('handler: 500 and no request when the variable is missing', missing.status === 500 && none.calls.length === 0)
  } finally {
    console.log = realLog; console.error = realErr; globalThis.fetch = realFetch
  }
  check('handler logged something for each call', logs.length >= 3, logs)
  check('the token never appears in any log line', !logs.join('\n').includes(TOKEN), logs)
}

// ---------------------------------------------------------------- stays in step with the rest of the repo
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const route = read('../../app/api/pipeline/trigger/route.ts')
check('REPO matches the Run-now route', route.includes(`const REPO = '${REPO}'`), REPO)
check('WORKFLOW_FILE matches the Run-now route', route.includes(`const WORKFLOW_FILE = '${WORKFLOW_FILE}'`), WORKFLOW_FILE)
check('the route still dispatches ref main (no inputs: the workflow default "manual" applies)', route.includes("body: JSON.stringify({ ref: 'main' })") && REF === 'main')
const wf = read(`../../.github/workflows/${WORKFLOW_FILE}`)
check('the workflow file exists and has a source input with manual (default) and schedule',
  /inputs:\s*\n\s+source:[\s\S]*?type: choice[\s\S]*?- manual\s*\n\s+- schedule[\s\S]*?default: manual/.test(wf))
check('PIPELINE_TRIGGER_SOURCE reads inputs.source, falling back to manual',
  wf.includes("PIPELINE_TRIGGER_SOURCE:   ${{ github.event_name == 'workflow_dispatch' && (inputs.source || 'manual') || 'schedule' }}"))
check('the backup guard is armed only for GitHub\'s own schedule event',
  wf.includes("PIPELINE_SKIP_IF_RECENT_HOURS: ${{ github.event_name == 'schedule' && '3' || '' }}"))
check('concurrency group still prevents overlap', /concurrency:\s*\n\s+group: news-pipeline\s*\n\s+cancel-in-progress: false/.test(wf))

// schedules: Netlify at :17, GitHub's backup at :47, same hours
const ghCron = wf.match(/- cron: "([^"]+)"/)?.[1]
const [nMin, nHours, ...nRest] = config.schedule.split(' ')
const [gMin, gHours, ...gRest] = (ghCron ?? '').split(' ')
check('Netlify schedule is 17 3,9,15,21 * * *', config.schedule === '17 3,9,15,21 * * *', config.schedule)
check('GitHub backup cron is 30 min later in every slot', nMin === '17' && gMin === '47' && nHours === gHours && nRest.join() === gRest.join(), [config.schedule, ghCron])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
