import { NextRequest, NextResponse } from 'next/server'

// POST /api/rewrite — proxies rewrite requests to Anthropic API
// This exists because the Anthropic API blocks browser-side CORS requests.
// The checker page calls this route instead of api.anthropic.com directly.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { text, issues } = body as { text: string; issues: string[] }

    if (!text || text.length < 20) {
      return NextResponse.json({ error: 'Text prea scurt.' }, { status: 400 })
    }

    const apiKey = process.env.CLAUDE_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'CLAUDE_API_KEY not configured.' }, { status: 500 })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `Rescrie acest text in romana pentru a elimina TOATE tiparele de AI si TOATE secventele copiate.

PROBLEME DETECTATE:
${(issues || []).join('\n')}

REGULI DE RESCRIERE:
1. Fiecare propozitie trebuie reconstruita complet — NU parafrazare la nivel de cuvant.
2. ELIMINA toate tranzitiile AI: "in contextul in care", "pe de alta parte", "in acelasi timp", "de asemenea", "mai mult", "cu toate acestea", "totusi".
3. Variaza NEREGULAT lungimea propozitiilor — doua scurte consecutive, apoi una lunga, apoi una medie. NU alterna mecanic.
4. Schimba ORDINEA ideilor fata de textul original.
5. Insereaza ocazional o propozitie fragmentara: "Rezultatul: blocaj." sau "Deci niciun acord."
6. Variaza modul de atribuire: "a spus", "a transmis", "a scris pe Facebook", nu mereu "a declarat" sau "potrivit".
7. NU fabrica surse, interviuri sau citate care nu apar in textul original.
8. Pastreaza TOATE faptele din text. NU adauga informatii noi.

TEXT DE RESCRIS:
${text}

Raspunde DOAR cu textul rescris, fara explicatii sau comentarii.`
        }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: `Anthropic ${response.status}: ${err.substring(0, 200)}` }, { status: 502 })
    }

    const data = await response.json()
    const result = data?.content?.[0]?.text || ''

    return NextResponse.json({ result })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: `Server error: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    )
  }
}
