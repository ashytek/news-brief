// Run: node --experimental-strip-types lib/format.test.mjs   (Node >= 22.6). Roadmap session 7.
// Offline checks of displayHeadline (lib/format.ts).
import { displayHeadline } from './format.ts'

let n = 0, bad = 0
const eq = (name, got, want) => {
  n++
  if (got !== want) { bad++; console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want)) }
}

eq('shouting headline becomes Title Case', displayHeadline('WHAT CONCENTRATIONS MEANS FOR CHRISTIANS'), 'What Concentrations Means For Christians')
eq('sentence case untouched', displayHeadline('Iran says talks will resume in Geneva'), 'Iran says talks will resume in Geneva')
eq('normal headline with acronyms untouched', displayHeadline('UK and US agree new AI safety deal'), 'UK and US agree new AI safety deal')
eq('exactly 60% upper is untouched', displayHeadline('ABCDEF abcd'), 'ABCDEF abcd')
eq('just over 60% upper is changed', displayHeadline('ABCDEFG abc'), 'Abcdefg Abc')
eq('apostrophe does not capitalise the next letter', displayHeadline("DON'T MISS THIS WARNING NOW"), "Don't Miss This Warning Now")
eq('hyphenated', displayHeadline('ANTI-WAR PROTEST GROWS IN CITY'), 'Anti-War Protest Grows In City')
eq('quote opening', displayHeadline('THE "NEW" ORDER IS HERE TODAY'), 'The "New" Order Is Here Today')
eq('short all-caps is left alone', displayHeadline('NATO'), 'NATO')
eq('digits only', displayHeadline('2026'), '2026')
eq('empty', displayHeadline(''), '')

console.log(bad === 0 ? `ok: ${n} checks` : `${bad} of ${n} FAILED`)
process.exit(bad === 0 ? 0 : 1)
