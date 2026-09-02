// Quick behavioural harness (run: deno run tt-anti-ai.test.ts)
import {
  ttDeShoutTitle, ttStripDashes, ttScrubLexicon, ttHumanizeText, ttHumanizeHtml, ttScoreAiTells,
} from './tt-anti-ai.ts'

let pass = 0, fail = 0
function eq(label: string, got: string, want: string) {
  const ok = got === want
  console.log(`${ok ? '✅' : '❌'} ${label}`)
  if (!ok) { console.log(`   got:  ${JSON.stringify(got)}`); console.log(`   want: ${JSON.stringify(want)}`) }
  ok ? pass++ : fail++
}
function show(label: string, got: string) { console.log(`ℹ️  ${label}\n   -> ${JSON.stringify(got)}`) }

console.log('\n── de-shout titles ──')
eq('RO all-caps w/ party acronym',
   ttDeShoutTitle('GRINDEANU RESPINGE ALIANȚA CU AUR'),
   'Grindeanu respinge alianța cu AUR')
eq('EN all-caps w/ country + acronym',
   ttDeShoutTitle('ROMANIA CUTS DEFICIT, SAYS PSD LEADER'),
   'Romania cuts deficit, says PSD leader')
eq('all-caps city compound',
   ttDeShoutTitle('PROTEST MASIV ÎN CLUJ-NAPOCA'),
   'Protest masiv în Cluj-Napoca')
eq('stray shouted emphasis word only',
   ttDeShoutTitle('Guvernul ANUNȚĂ măsuri noi'),
   'Guvernul anunță măsuri noi')
eq('already sentence case = untouched',
   ttDeShoutTitle('Romania cuts deficit by 44%'),
   'Romania cuts deficit by 44%')
eq('title case (EN) = left as-is (deShout only calms caps)',
   ttDeShoutTitle('Romania Cuts Deficit By 44%'),
   'Romania Cuts Deficit By 44%')
eq('acronym-only run kept',
   ttDeShoutTitle('PSD și PNL negociază'),
   'PSD și PNL negociază')
show('collision "IT"/"US" sample', ttDeShoutTitle('SAVE US NOW'))
show('proper noun surname (not in gazetteer)', ttDeShoutTitle('IOHANNIS SEMNEAZĂ DECRETUL'))

console.log('\n── dashes ──')
eq('spaced em dash -> comma', ttStripDashes('The plan — which failed — was costly'), 'The plan, which failed, was costly')
eq('numeric en-dash range -> hyphen', ttStripDashes('during 2019–2021 growth'), 'during 2019-2021 growth')
eq('mdash entity', ttStripDashes('cost&mdash;a lot'), 'cost, a lot')
eq('double hyphen as dash', ttStripDashes('the plan -- which failed'), 'the plan, which failed')
eq('idempotent', ttStripDashes(ttStripDashes('a — b — c')), 'a, b, c')

console.log('\n── lexicon EN ──')
show('delve/testament/boasts', ttScrubLexicon('We delve into the data. The city boasts a rich tapestry of culture. This stands as a testament to progress.', 'en'))
show('worth noting filler', ttScrubLexicon('The budget rose. It’s worth noting that inflation also rose. Moreover, wages fell.', 'en'))
show('crucial role', ttScrubLexicon('The bank plays a crucial role in the economy.', 'en'))

console.log('\n── lexicon RO ──')
show('RO tells', ttScrubLexicon('Guvernul joacă un rol crucial în economie. Merită menționat că deficitul a scăzut. Reforma reprezintă o dovadă a progresului.', 'ro'))

console.log('\n── html preservation ──')
const html = '<h2>ORAȘUL BOASTS O ISTORIE BOGATĂ</h2><p>The plan — bold — <strong>works</strong> and <em>lasts</em>.</p>'
show('humanizeHtml', ttHumanizeHtml(html, 'en'))

console.log('\n── detector ──')
const clean = ttScoreAiTells({ title: 'Bolojan promite reforma pensiilor', content: 'Guvernul a anunțat marți un nou plan. Măsura intră în vigoare din toamnă.', lang: 'ro' })
console.log('clean:', JSON.stringify(clean))
const dirty = ttScoreAiTells({
  title: 'ROMANIA BOASTS A NEW ERA',
  content: 'The city boasts a rich tapestry of culture. It’s worth noting that this stands as a testament to progress — a real change. Moreover, it plays a crucial role. Not only does it grow, but also thrives. In conclusion, the future is bright.',
  lang: 'en',
})
console.log('dirty:', JSON.stringify(dirty, null, 2))

console.log(`\n${fail === 0 ? '🎉' : '⚠️'}  ${pass} passed, ${fail} failed`)
