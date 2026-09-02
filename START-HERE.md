# Vocea „pe viteză" — a fost greșeala mea, din zip-ul de acum o oră

## Ce s-a întâmplat

Ți-am trimis conversia automată în .wav. Am scris-o așa:

```ts
encodeWav(monoSlice(buf, 0, buf.duration), buf.sampleRate)
```

Se citește corect. E greșit.

`monoSlice` **reeșantionează întotdeauna la 16 kHz** — a fost scrisă pentru
Whisper, unde 16 kHz e gratis ca acuratețe și o treime din octeți. Numele nu
spune asta. Apoi am scris în antetul WAV rata sursei, 48 kHz.

48000 / 16000 = **3**. Fișierul se redă de trei ori mai repede. MiniMax a clonat
fidel o veveriță.

Trei lucruri obișnuite au conspirat: funcția nu spune în nume că
reeșantionează, un `Float32Array` nu poate spune la ce rată e, iar `encodeWav`
primea rata ca argument **separat**. Ușor de greșit, imposibil de văzut la
citire.

## Reparația

Nu „am grijă data viitoare". Perechea nu se mai poate desface:

```ts
export interface MonoAudio { samples: Float32Array; rate: number }
export function monoAudio(buffer, from?, to?, outRate = buffer.sampleRate): MonoAudio
export const encodeWavFrom = (audio: MonoAudio) => encodeWav(audio.samples, audio.rate)
```

`monoAudio` are **rata sursei** ca implicit — opusul lui `monoSlice` — pentru că
o mostră de clonare e singurul fișier care nu trebuie coborât la 16 kHz: mostra
**e** lucrul care se copiază.

`monoSlice` primește acum un parametru de rată explicit și un comentariu de
douăzeci de rânduri care spune exact ce a pățit.

## Dovada

`_verification/67-sample-rate.cjs` — 22 de aserțiuni care **măsoară înălțimea
sunetului**, nu parametrii. A verifica dacă o variabilă conține 48000 ar fi
trecut și pe codul stricat: variabila chiar conținea 48000.

Deci: sintetizez un ton de 440 Hz, îl trec prin conversia reală și întreb
ffmpeg ce frecvență iese.

- prin calea corectă: **440 Hz, 3.0 secunde** ✓
- prin linia care ți-a ajuns pe site: **1320 Hz, 1.0 secundă** — bug-ul,
  reprodus intenționat, ca aserțiunea să nu poată trece dacă revine

## Ce faci

1. Comiți zip-ul ăsta.
2. **Șterge vocea clonată din mostra convertită** — e clonată dintr-un fișier
   3× accelerat, nu are cum să fie salvată.
3. Clonează din nou cu aceeași mostră. Acum iese la rata corectă.

Vocile tale mai vechi (Adriana, Daniel TT, Daniel TT2) sunt dinainte de
schimbarea mea și nu sunt afectate.

## Fișiere

| Cale | Ce e |
|---|---|
| `lib/media/wav.ts` | `monoAudio` + `encodeWavFrom`; `monoSlice` cu rată explicită |
| `app/admin/studio/page.tsx` | folosește perechea |
| `_verification/67-sample-rate.cjs` | **nou** — 22 aserțiuni, măsoară Hz cu ffmpeg |
| restul | cititorul de erori din zip-ul anterior, neschimbat |

Supabase: nimic. Railway: nimic pentru asta.

Verificat: `tsc` curat, `next build` curat, **58 de suite, 2145 de aserțiuni,
0 căzute**.

---

Îmi pare rău — asta a fost o regresie pe care ți-am trimis-o eu, iar tu ai
găsit-o ascultând. Suita de acum o prinde măsurând frecvența, nu citind cod.
