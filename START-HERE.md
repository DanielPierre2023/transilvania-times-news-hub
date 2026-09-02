# De ce nu mergea clonarea vocii

## Răspunsul exact

Am prins răspunsul real al funcției din browserul tău. Era acesta:

```
fal minimax voice-clone 422: Unsupported audio format.
Supported formats are .wav, .mp3.
```

**Mostra ta audio nu era .wav sau .mp3.** Aproape sigur .m4a (de pe telefon) sau
.webm (înregistrare făcută în browser). fal o refuză înainte să se uite la
conținut — se uită la extensia din URL.

Nu era vina cheilor, a creditelor, a consimțământului sau a lungimii mostrei. Am
verificat pe viu: `voice-lab` răspunde 200, `elevenlabs: true`, `minimax: true`,
și ai deja trei voci clonate (Adriana, Daniel TT, Daniel TT2).

## De ce ai văzut „Edge Function returned a non-2xx status code"

Ăsta e al doilea bug, și e cel mai grav dintre cele două.

`supabase.functions.invoke` pune mereu **aceeași** propoziție în `error.message`,
indiferent de motiv. Răspunsul adevărat al funcției stă în `error.context`, iar
pagina Studio îl arunca:

```ts
if (e) throw new Error(e.message)     // ← mereu "non-2xx"
```

Deci **fiecare** eșec din Studio — clonare, generare de mișcare, randare, voce —
raporta o propoziție identică, fără să spună nici măcar care pas a picat. Iar
funcțiile edge răspundeau atent: 400 cu „FAL_KEY not set", 403 cu explicația
consimțământului, 502 cu textul providerului. Nimic din toate astea nu ajungea
pe ecran.

Pagina Newsroom citea corect. Studio, Producție și Podcast — nu. Patru locuri,
unul singur corect: asta se întâmplă cu o reparație care trăiește într-o pagină.

---

## Ce s-a schimbat

### 1. Motivul real ajunge pe ecran, peste tot

`lib/supabase/edgeError.ts` — un singur cititor, folosit de toate cele patru
pagini. De acum eroarea arată așa:

> `voice-lab: fal minimax voice-clone 422: Unsupported audio format. Supported formats are .wav, .mp3.`

Numele funcției în față, pentru că o pagină care face unsprezece apeluri
trebuie să spună și **care** a picat.

Traduc doar patru mesaje în limbaj omenesc (credite fal terminate, cheie fal
lipsă, cheie ElevenLabs lipsă, consimțământ). Restul trec **cuvânt cu cuvânt** —
o traducere greșită e mai rea decât niciuna, fiindcă trimite omul să repare
ceva ce nu e stricat.

### 2. Formatul se convertește singur

Browserul poate deschide .m4a, .webm, .ogg, .aac — o face oricum, ca să măsoare
durata. Deci acum le **convertește în .wav** pe drum, la rata de eșantionare a
sursei (o referință de clonare e exact fișierul care nu trebuie redus la 16 kHz),
și îți spune într-o linie albastră că a făcut-o.

Dacă browserul chiar nu poate deschide formatul, îți spune asta — nu te lasă să
încarci ceva ce fal va refuza.

### 3. Durata se măsoară aici, nu se ghicește pe server

Funcția respingea o mostră sub 60 KB ca „prea scurtă", pentru că mărimea era
singurul indiciu pe care îl avea. Indiciul e greșit în ambele direcții: 20 de
secunde într-un codec de mesaj vocal au 40 KB și erau refuzate, cu mesajul că
sunt prea scurte.

Acum browserul măsoară durata reală și scrie numărul lângă fiecare mostră
(„mostra 1: 24.3s"). Sub 10 secunde e refuz, cu numărul în mesaj. Sub 20 merge,
dar îți spune că 20–30 dau o voce mult mai fidelă.

---

## Ce comiți

| Cale | Ce e |
|---|---|
| `lib/supabase/edgeError.ts` | **nou** — cititorul, într-un singur loc |
| `app/admin/studio/page.tsx` | cititorul + conversia formatului + durata măsurată |
| `app/admin/productie/page.tsx` | cititorul, 6 apeluri |
| `app/admin/podcast/page.tsx` | cititorul, 4 apeluri |
| `app/admin/newsroom/page.tsx` | pus pe modulul comun (avea copia lui corectă) |
| `render-worker/package.json` | build-ul compilează și noul modul, pentru teste |
| `_verification/66-edge-errors.cjs` | **nou** — 42 de aserțiuni |
| `_verification/55-campaign-render.cjs` | aserțiuni mutate pe noua formă a apelului |

**Supabase: nimic. Railway: nimic** (pentru reparația asta — deploy-ul de
`render-worker/src/` din zip-ul anterior rămâne de făcut, dacă nu l-ai făcut).

Verificat: `tsc --noEmit` curat, `next build` curat, **57 de suite, 2123 de
aserțiuni, 0 căzute**. Am și stricat înadins cititorul ca să confirm că
aserțiunile chiar cad.

---

## Ce faci acum

1. Comiți.
2. Reîncerci clonarea cu aceeași mostră — se convertește automat.
3. Dacă mai pică, mesajul îți spune de data asta **exact** de ce.

Un singur lucru de știut despre vocile clonate cu MiniMax: fal le șterge dacă nu
sunt folosite cel puțin o dată în 7 zile. Funcția rostește deja o frază scurtă
imediat după clonare, ca să le rețină permanent — deci vocile tale existente sunt
în siguranță.
