# tt-podcast-studio — stația de montaj podcast

Citește **GHID.md** pentru cum se folosește. Acest fișier e ce se comite și ce se
deployează.

Verificat înainte de trimitere: `tsc --noEmit` curat, `next build` curat (zero
avertismente pe pagina nouă), **56 de suite, 2081 de aserțiuni, 0 căzute**.
Randarea MP3 e testată cu ffmpeg pe fișiere reale, nu doar afirmată.

---

## 1 · Commit — copiezi peste, exact pe aceste căi

| Cale | Ce e |
|---|---|
| `lib/podcast/edit.ts` | **nou** — modelul de montaj: tăieturi manuale, comutatoare, undo |
| `lib/podcast/deliver.ts` | **nou** — capitole, transcriere, titlu/descriere |
| `lib/podcast/episode.ts` | modificat — gain per vorbitor, sunetul camerelor |
| `lib/podcast/clip.ts` | modificat — sunetul camerelor |
| `lib/timeline/migrate.ts` | modificat — `sceneAudio` și `audioGain` per plan |
| `app/admin/podcast/page.tsx` | **rescris** — editorul |
| `_verification/51-reachable.cjs` | modificat — controalele noi |
| `_verification/61-episode.cjs` | modificat — episodul are sunet |
| `_verification/63-audio-episode.cjs` | **nou** — MP3-ul, cu ffmpeg |
| `_verification/64-transcript-edit.cjs` | **nou** — montajul prin transcriere |
| `_verification/65-deliver.cjs` | **nou** — capitole, note, parser |
| `_verification/report.cjs` | modificat — matricea, cu funcțiile noi |

## 2 · Railway — **da, aici trebuie deploy**

Trei fișiere din `render-worker/src/`: `render.js`, `index.js`, `audio.js`.

Fără ele, butonul **MP3 pentru feed** trimite un job pe care workerul actual nu
știe să-l facă. Restul paginii merge; MP3-ul nu.

## 3 · SQL — nimic

## 4 · Funcții edge — nimic

Nici un fișier din `supabase/functions/` nu s-a atins. Titlul și descrierea merg
prin `ai-blog-assistant`, care e deja deployat.

---

## Ce s-a schimbat, și de ce

### Nu se putea tăia. Acum se taie citind.

Pagina veche calcula un montaj și nu îl arăta nimănui. Scria „38 tăieturi ·
214,6s scoase" și nu îți dădea niciun fel de a vedea care 38, de a auzi una, de
a nu fi de acord cu una, sau de a face a treizeci și noua. La întrebarea „cum
tai?", răspunsul sincer era „nu tai — taie el, și speri".

Acum transcrierea **e** montajul: selectezi cuvinte cu mouse-ul, apeși Taie, iar
ele ies din episod — barate pe ecran, ca să vezi ce ai făcut, și se pun înapoi cu
un click. Tăieturile automate sunt același fel de obiect ca ale tale, de aia
poate fi anulată oricare, individual.

Totul produce `Cut[]`. `keptRanges` face din asta ce rămâne și
`buildEpisodeProject` face din asta filmul — deci previzualizarea, MP3-ul,
video-ul și subtitrările nu pot fi în dezacord despre unde sunt tăieturile.

### Două bug-uri găsite în ce ți-am trimis săptămâna trecută

**Episodul ieșea MUT.** `migrateLegacyProject` pune fiecare clip video pe
`audio: { gain: 0 }` — corect pentru b-roll sub un voiceover, și înseamnă
programul întreg pentru o conversație. Butonul „Randează episodul" pe care ți
l-am dat ar fi produs un film fără sunet, și clipurile verticale la fel. Nimic nu
prinsese asta pentru că toate aserțiunile se opreau la proiect și niciuna nu
construia timeline-ul pe care îl primește randorul. Găsit construindu-l și
uitându-mă la el.

**Parserul de note tăia răspunsul la primul rând.** Flagul `m` face ca `$` să se
potrivească la sfârșitul fiecărui **rând**, deci o descriere de două paragrafe
venea ca primul paragraf, iar o listă de trei citate ca un citat. Arăta exact ca
un model care a răspuns scurt.

Ambele au acum aserțiuni care le prind, și am verificat că aserțiunile chiar cad
când repun bug-ul.

### MP3-ul, care lipsea

Un podcast livrează în primul rând un fișier audio. Pipeline-ul nu putea face
unul: mixerul, ducking-ul cu sidechain și loudnorm-ul în două treceri existau
toate, în spatele unei funcții care desenează întâi fiecare cadru de video. Deci
o oră de conversație însemna o oră de Chromium rasterizând o imagine fixă ca să
ajungă la sunetul care era gata în minutul zece — și apoi scoteai video-ul de pe
el manual.

`renderAudioOnly` ajunge la etapa de sunet fără imagine, prin **același** mixer
și același normalizator. Testat cu ffmpeg: e chiar MP3 (extensia nu dovedește
nimic), la 44,1 kHz stereo, de lungimea timeline-ului și nu a patului muzical, la
−16 LUFS măsurat pe fișierul final, sub −1 dBTP. Și muzica **se dă măsurabil la
o parte** de sub voce: 880 Hz sub vorbire față de 880 Hz în gol, cu ducking-ul
neutralizat diferența e −0,1 dB, cu el funcțional trece pragul de 2,5 dB.

### Ținta de volum

`podcast: −16 LUFS, −1 dBTP, LRA 7`. Aceeași țintă ca presetul social, dar
interval mai strâns: 11 LU e potrivit pentru un feed cu multă muzică și prea larg
pentru doi oameni care vorbesc, unde lasă vorbitorul mai încet să dispară sub
zgomotul din mașină.

---

## Ce nu e făcut

Scris aici ca să nu-l descoperi în ziua în care publici:

- **intro / outro** ca piese separate (muzica e pat continuu, nu jingle)
- **reducere de zgomot** dincolo de filtrul trece-sus
- **redenumirea capitolelor în pagină** (se face în fișierul exportat)
- **corectarea transcrierii** — poți tăia cuvinte, nu le poți rescrie, deci un
  nume propriu greșit de Whisper rămâne greșit în subtitrări

Primele două sunt lucru de o zi fiecare. Al patrulea e cel pe care l-aș face
următorul dacă podcastul intră în producție în două săptămâni: un nume greșit în
subtitrări e vizibil pentru toată lumea.

---

## Dacă nu ai comis zip-ul anterior (`tt-podcast`)

Nu contează ordinea: zip-ul ăsta **le conține și pe acelea**, în aceeași stare
verificată. Fișierele în plus, incluse ca să fie de sine stătător:

`app/admin/components/ProductionChrome.tsx` · `app/admin/productie/page.tsx` ·
`app/admin/studio/page.tsx` · `app/admin/layout.tsx` ·
`render-worker/package.json` · `_verification/56-audio-chunking.cjs` ·
`_verification/62-nav.cjs` ·
`supabase/migrations/20260902090000_campaign_timelines_and_org.sql` ·
`.github/workflows/ci.yml`

Migrarea aceea e **deja aplicată** în baza ta — fișierul merge în repo doar ca să
existe evidența. Tot nu ai nimic de rulat în Supabase.
