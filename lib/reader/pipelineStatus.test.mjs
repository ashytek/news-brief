// Run: node --experimental-strip-types lib/reader/pipelineStatus.test.mjs   (Node >= 22.6). 3 Nov 2026.
// Offline checks of the status chip rules (lib/reader/pipelineStatus.ts), including the
// "Gemini credit ran out" state the pipeline signals through pipeline_runs.error_log.
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

// pipelineStatus.ts imports '@/lib/format' (the tsconfig alias): map '@/x' to <repo>/x.ts for Node.
const root = new URL('../../', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) {
     return s.startsWith('@/') ? next(new URL(s.slice(2) + '.ts', ${JSON.stringify(root)}).href, c) : next(s, c)
   }`))
const { describePipeline, isCreditDepleted, CREDIT_DEPLETED_MARKER } = await import('./pipelineStatus.ts')

let n = 0, bad = 0
const eq = (name, got, want) => {
  n++
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { bad++; console.log('FAIL', name, '\n  got ', g, '\n  want', w) }
}

const NOTE = `${CREDIT_DEPLETED_MARKER}: Gemini prepaid credit is used up. Top up in Google AI Studio → Billing.`
const MIN = 60_000, H = 3_600_000
const ago = ms => new Date(Date.now() - ms)

// isCreditDepleted
eq('failed + marker in a list', isCreditDepleted({ status: 'failed', error_log: [NOTE] }), true)
eq('failed + marker as a string', isCreditDepleted({ status: 'failed', error_log: NOTE }), true)
eq('failed with another error', isCreditDepleted({ status: 'failed', error_log: ["{'message': 'JSON could not be generated', 'code': 504}"] }), false)
eq('failed, no error_log', isCreditDepleted({ status: 'failed', error_log: null }), false)
eq('partial with the marker (not a stop)', isCreditDepleted({ status: 'partial', error_log: [NOTE] }), false)
eq('success', isCreditDepleted({ status: 'success' }), false)
eq('no run', isCreditDepleted(undefined), false)
eq('null run', isCreditDepleted(null), false)

// describePipeline: the credit state wins over everything and keeps the age chip
eq('credit out, 20 min ago', describePipeline(ago(20 * MIN), false, true),
  { tone: 'bad', short: '20m', label: 'Gemini credit ran out · top up in AI Studio · last run 20m ago' })
eq('credit out beats struggling', describePipeline(ago(3 * H), true, true)?.label.startsWith('Gemini credit ran out'), true)
eq('credit out beats down (2 days)', describePipeline(ago(48 * H), false, true)?.label.startsWith('Gemini credit ran out'), true)
eq('no run seen: still null', describePipeline(null, false, true), null)

// unchanged without it (the default and an explicit false)
eq('ok', describePipeline(ago(20 * MIN), false), { tone: 'ok', short: '20m', label: 'Checked 20m ago' })
eq('ok, explicit false', describePipeline(ago(20 * MIN), false, false), { tone: 'ok', short: '20m', label: 'Checked 20m ago' })
eq('stale', describePipeline(ago(9 * H), false)?.tone, 'warn')
eq('down', describePipeline(ago(25 * H), false)?.label.startsWith('Pipeline down'), true)
eq('struggling', describePipeline(ago(3 * H), true)?.label.startsWith('Sources failing'), true)

// The marker is the one the pipeline writes (pipeline/llm.py)
const py = readFileSync(new URL('../../pipeline/llm.py', import.meta.url), 'utf8')
eq('same marker as pipeline/llm.py', py.includes(`CREDIT_DEPLETED_MARKER = "${CREDIT_DEPLETED_MARKER}"`), true)

// Every place that draws the status passes the credit flag
for (const f of ['components/shell/TopBar.tsx', 'components/shell/DesktopRail.tsx', 'components/shell/StatusSheet.tsx']) {
  const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
  eq(`${f} passes pipelineCreditOut`, src.includes('describePipeline(r.lastPipelineRun, r.pipelineStruggling, r.pipelineCreditOut)'), true)
}
const hook = readFileSync(new URL('./usePipelineHealth.ts', import.meta.url), 'utf8')
eq('the health query selects error_log', /select\('[^']*error_log[^']*'\)/.test(hook), true)

console.log(bad === 0 ? `ok: ${n} checks` : `${bad} of ${n} FAILED`)
process.exit(bad === 0 ? 0 : 1)
