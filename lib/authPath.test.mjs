// Run: node --experimental-strip-types lib/authPath.test.mjs   (Node >= 22.6). Roadmap session 9.
import { isAuthPath } from './authPath.ts'
const cases = [['/auth', true], ['/auth/', true], ['/auth/callback', true], ['/authors', false], ['/authority', false], ['/authx/y', false], ['/reader', false], ['/', false], ['/oauth', false], ['/auth-debug', false]]
let bad = 0
for (const [p, want] of cases) { const got = isAuthPath(p); if (got !== want) { bad++; console.log('FAIL', p, got, want) } }
console.log(bad ? `${bad} failed` : `${cases.length} path checks passed`)
process.exit(bad ? 1 : 0)
