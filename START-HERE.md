# Burtiera = începutul frazei rostite. Adevărata cauză, și de ce reparațiile mele n-au prins.

## Ce ai văzut

„Lucian Bratu scrie că debitul râului C" — începutul frazei rostite, tăiat la
38 de caractere. Nu e un titlu; e prima propoziție a știrii, retezată.

## De ce reparațiile mele n-au schimbat nimic

Am reparat de două ori **funcția edge** (care scrie eticheta) și te-am pus s-o
redeployezi manual. Dar bulletinul se randează în **browser**, iar linia care
desenează burtiera lua eticheta funcției **exact așa cum venea, netrecută prin
nimic**:

```js
out.push({ ..., title: st.lower_third || `Știrea ${i+1}`, ... })
```

Când funcția trimitea o frază tăiată, fraza aia AJUNGEA pe ecran. Niciuna dintre
plasele mele din frontend nu atingea linia asta — reparasem alte două ramuri,
nu pe cea pe care o folosește buletinul tău. Greșeala mea, de trei ori la rând,
și pe layerul greșit.

## Reparația adevărată — în frontend, se deployează prin Netlify

Acum browserul **nu mai are încredere** în eticheta funcției. Pentru fiecare
știre alege titlul singur:

1. Dacă eticheta funcției e de fapt **începutul textului rostit** (un prefix al
   frazei) — semnătura exactă a bug-ului — o ignoră.
2. Folosește **titlul real al articolului** din baza ta de date — titlul scris
   de om, care nu e tăiat niciodată la mijloc de cuvânt.
3. Taie pe **cuvânt întreg**, la 70 de caractere, orice sursă.

Verificat cu cazul tău exact:

```
înainte : "Lucian Bratu scrie că debitul râului C"          (frază tăiată)
după    : "Debitul Crișului Repede a scăzut la cel mai redus nivel din ultimii"
```

## De ce contează asta enorm

Reparația e la **momentul randării**, nu la generarea scriptului. Deci:

- Se deployează prin **git → Netlify** (comitere normală). **NU trebuie să mai
  redeployezi nicio funcție edge.** Aia era partea care-ți tot pica.
- Merge chiar și pe buletinele **deja generate**: nu regenera scriptul —
  recompune videoul (butonul de compunere) și burtierele ies corect, pentru că
  titlul se recalculează în browser din titlul articolului, nu din eticheta
  veche stocată.

## Ce faci

1. **Comiți** cele 4 fișiere frontend (page + lib/text + package.json + suita).
   Netlify le deployează. Gata — asta repară ecranul.
2. Recompui buletinul. Burtierele arată titluri întregi.

Funcția `newsroom-anchor` e și ea în zip, curățată (self-contained, fără import
`_shared`, fără limita de 38, tăiere pe cuvânt). **E opțională acum** — o
deployezi când ai chef; chiar dacă n-o atingi niciodată, frontendul acoperă
totul. Nu mai depinzi de deploy-ul manual de funcție pentru burtiere corecte.

## Fișiere

| Cale | Ce e | Unde |
|---|---|---|
| `app/admin/newsroom/page.tsx` | **reparația reală** — titlul ales în browser | commit → Netlify |
| `lib/text/truncate.ts` | tăiere pe cuvânt | commit |
| `render-worker/package.json` | build-ul include `lib/text` | commit |
| `_verification/68-lower-third.cjs` | +4 aserțiuni pe ramura in-sync | commit |
| `supabase/functions/newsroom-anchor/index.ts` | funcția, curată | **opțional** deploy |

Supabase SQL: nimic. Railway: nimic.

## Verificat

`tsc` curat, `next build` curat (zero avertismente pe newsroom), **59 de suite,
2185 de aserțiuni, 0 căzute**. Am simulat alegerea titlului pe cazul tău real
(mai sus) — iese titlul întreg al articolului, nu fraza tăiată.

O aserțiune nouă pică dacă vreo ramură mai trimite `st.lower_third` brut pe
ecran — exact greșeala care ți-a stricat buletinul, prinsă de acum înainte.
