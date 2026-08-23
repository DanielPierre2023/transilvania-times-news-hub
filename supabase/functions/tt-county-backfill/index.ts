// tt-county-backfill — one-shot Gemini classifier for orphan posts.
// Reads blog_posts with county IS NULL, sends all to Gemini in one call,
// parses JSON array of {id, county}, runs one UPDATE per result.
// Idempotent — running twice does nothing extra (only NULLs are processed).
//
// Allowed counties (Transylvania + Național for outside):
//   cluj, bihor, alba, bistrita-nasaud, salaj, mures, sibiu, maramures,
//   satu-mare, hunedoara, brasov, covasna, harghita, national
//
// To run after deploy:
//   curl -X POST 'https://zimpimoierpsocnmnizm.supabase.co/functions/v1/tt-county-backfill' \
//        -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" -d '{}'

import { createClient } from 'jsr:@supabase/supabase-js@2'

const COUNTIES = [
  'cluj','bihor','alba','bistrita-nasaud','salaj','mures','sibiu',
  'maramures','satu-mare','hunedoara','brasov','covasna','harghita',
  'national'
]

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Fetch all orphan published posts
  const { data: posts, error: selErr } = await supabase
    .from('blog_posts')
    .select('id, title_ro, title_en, summary_ro, summary_en, category, subcategory')
    .is('county', null)
    .eq('status', 'published')
    .limit(500)

  if (selErr) {
    return new Response(JSON.stringify({ error: selErr.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
  if (!posts || posts.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0, message: 'No orphans' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // 2. Build classification prompt — one call, JSON array out
  const payload = posts.map((p, i) => ({
    n: i,
    id: p.id,
    t: (p.title_ro || p.title_en || '').slice(0, 200),
    s: (p.summary_ro || p.summary_en || '').slice(0, 300),
    cat: p.category, sub: p.subcategory,
  }))

  const system = `You classify Romanian news articles by Romanian county (județ). For each article, decide the most likely county based on the title, summary, category and subcategory.

ALLOWED VALUES (output exactly one of these, lowercase, hyphenated):
- Transylvanian counties: cluj, bihor, alba, bistrita-nasaud, salaj, mures, sibiu, maramures, satu-mare, hunedoara, brasov, covasna, harghita
- national (use this for: international news, foreign country news, national-level Romanian news without a specific Transylvanian county focus, sports outside the region, technology articles about global topics)

RULES:
- If a Transylvanian city is mentioned (Cluj-Napoca, Oradea, Alba Iulia, Bistrița, Zalău, Târgu Mureș, Sibiu, Baia Mare, Satu Mare, Deva, Brașov, Sfântu Gheorghe, Miercurea Ciuc, Turda, etc.) → use that county.
- Turda, Câmpia Turzii → cluj
- Oradea, Salonta, Beiuș → bihor
- Alba Iulia, Sebeș, Aiud, Blaj → alba
- Bistrița, Năsăud, Beclean → bistrita-nasaud
- Zalău, Jibou, Șimleu Silvaniei → salaj
- Târgu Mureș, Reghin, Sighișoara, Luduș → mures
- Sibiu, Mediaș, Cisnădie → sibiu
- Baia Mare, Sighetu Marmației, Borșa → maramures
- Satu Mare, Carei, Negrești-Oaș → satu-mare
- Deva, Hunedoara, Petroșani, Orăștie → hunedoara
- Brașov, Făgăraș, Săcele, Râșnov → brasov
- Sfântu Gheorghe, Târgu Secuiesc → covasna
- Miercurea Ciuc, Odorheiu Secuiesc, Gheorgheni → harghita
- If the article is about Bucharest, Constanța, Iași, Galați, Timișoara, Craiova, or anywhere outside Transylvania → national
- If foreign country (Italy, France, USA, Ukraine, etc.) → national
- If the article is about EU/NATO/general international → national
- If category is technology/business/sports/health and the subject is not local → national
- When uncertain → national (safer default)

Return ONLY a valid JSON array, no preamble, no markdown:
[{"id":"uuid","county":"cluj"}, ...]`

  const user = `Classify these ${posts.length} articles:\n\n${JSON.stringify(payload)}`

  // 3. Single Gemini call
  const gKey = Deno.env.get('GEMINI_API_KEY')
  if (!gKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY missing' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  const gRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${gKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 32000, responseMimeType: 'application/json' },
      }),
    }
  )

  const gText = await gRes.text()
  if (!gRes.ok) {
    return new Response(JSON.stringify({ error: `Gemini ${gRes.status}: ${gText.slice(0, 500)}` }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  const gData = JSON.parse(gText)
  const responseText = gData?.candidates?.[0]?.content?.parts?.[0]?.text || ''

  let classifications: { id: string; county: string }[] = []
  try {
    const cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    classifications = JSON.parse(cleaned)
    if (!Array.isArray(classifications)) throw new Error('Not an array')
  } catch (e) {
    return new Response(JSON.stringify({
      error: 'JSON parse failed',
      detail: (e as Error).message,
      raw_excerpt: responseText.slice(0, 500),
    }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // 4. Validate and apply
  const byId = new Map(posts.map(p => [p.id, p]))
  let updated = 0, skipped = 0, invalid = 0
  const errors: string[] = []

  for (const c of classifications) {
    if (!c.id || !c.county) { invalid++; continue }
    if (!byId.has(c.id)) { skipped++; continue }
    if (!COUNTIES.includes(c.county)) { invalid++; continue }

    const { error: uErr } = await supabase
      .from('blog_posts')
      .update({ county: c.county })
      .eq('id', c.id)
      .is('county', null)

    if (uErr) errors.push(`${c.id}: ${uErr.message}`)
    else updated++
  }

  return new Response(JSON.stringify({
    ok: true,
    total_orphans: posts.length,
    classifications_received: classifications.length,
    updated,
    skipped,
    invalid,
    errors: errors.slice(0, 10),
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})