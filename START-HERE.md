# Fix: clipul se tăia înainte de „La revedere"

## Ce era stricat
La final, buletinul tăia ultima propoziție a prezentatorului — „La revedere" — cu o
idee înainte să se termine. Nu era vina vocii, a fișierului sau a cardului de final.
Era o singură linie din bucla de compunere (`app/admin/newsroom/page.tsx`).

## Cauza (pe scurt)
Bucla încheia faza de conținut la `v.currentTime >= dur - 0.05`. `dur` este durata
reală a clipului, deci acea condiție se declanșa cu ~50 ms **înainte** ca elementul
video să-și dea propriul semnal `ended` — clipul nu apuca să redea ultimele 50 ms.
Mai rău: chiar cadrul următor apela `v.pause()`, care reteza brusc ultima silabă,
fără „ring-out" (release-ul de 0.25 s al compresorului + stingerea naturală a lui
„revedere"). De aceea suna tăiat mai mult decât cele 50 ms lipsă, iar peste el intra
cardul de final (care are patul muzical, dar nu și vocea).

## Reparația
1. Faza de conținut se încheie acum pe semnalul propriu al media-ului, `v.ended`.
   Clauza numerică `dur - 0.05` rămâne **doar ca gardă anti-blocaj** (media oprită
   la capăt ȘI care nu mai avansează o jumătate de secundă) — niciodată ca lucrul
   care oprește un clip aflat încă în redare.
2. Un `TAIL_PAD` de 0.4 s ține ultimul cadru cu prezentatorul **nepauzat**, ca
   ultimul cuvânt și stingerea lui să intre în înregistrare.
3. Abia după acel „tail" se pune pauză pe prezentator și pornește cardul de final.

Rezultat: se aude „La revedere" întreg, plus o răsuflare, apoi endcard-ul.

## Ce e în arhivă (2 fișiere, la căile exacte din repo)
- `app/admin/newsroom/page.tsx` — fișierul complet, gata de pus peste cel din repo.
  Conține și reparațiile anterioare (intro-ul care nu se genera + burtierele cu
  titlul articolului), deci e cumulativ — dacă nu apucaseși să pui `tt-intro-fix`,
  acesta le acoperă pe toate.
- `_verification/69-signoff.cjs` — suită nouă care ține reparația pe loc: cade dacă
  cineva readuce tăierea (verificat — vezi mai jos).

## Cum deployezi (doar frontend → Netlify)
1. Copiază cele 2 fișiere peste cele din repo, la exact aceleași căi.
2. Commit + push. Netlify redeployează automat.

**NU** e nevoie de nimic în Supabase (nicio funcție edge, nicio migrare SQL) și
**nimic** pe Railway. E o schimbare pur de frontend.

## Verificare făcută înainte de livrare
- `tsc --noEmit` — curat, 0 erori (verificare de tipuri pe tot proiectul).
- `next build` (offline) — **Compiled successfully**, ieșire 0.
- Suita completă: **2206 aserțiuni, 0 eșecuri**, 60 de suite — inclusiv noua
  `69-signoff` (16 aserțiuni).
- Test negativ: am rulat cele 5 gărzi noi pe varianta veche (cu bug) și toate 5
  „prind" regresia — deci suita chiar mușcă, nu trece degeaba.

Poți reface verificarea local oricând cu: `npm run verify`.
