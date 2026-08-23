TRANSILVANIA TIMES — Zboruri: bugfix + test automat în CI
==========================================================

Extrageți în rădăcina repo-ului, commit + push. Funcția din Supabase e DEJA
reparată și rulează în producție (v22) — nu trebuie să deployați nimic acolo.

DESPRE fids.regression.mjs — NU SE DEPLOIAZĂ NICĂIERI:
  • NU e o funcție Supabase. Funcția care rulează pe server e DOAR index.ts.
  • NU intră în build-ul site-ului: Next.js compilează doar app/, lib/, i18n/
    (vezi tsconfig.json), nu folderul supabase/.
  • E un test pentru dezvoltatori, care stă lângă cod ca documentație vie —
    exact ca parse.samples.test.ts, care e acolo de la început.

  Îl puteți rula manual oricând, din rădăcina repo-ului:
      node supabase/functions/flights-sync/fids.regression.mjs
  Nu are nevoie de internet, de chei sau de baza de date. Afișează 7 verificări
  și „all passed".

NOU: rulează AUTOMAT în GitHub Actions (.github/workflows/ci.yml), la fiecare
push și pull request, imediat după lint. Dacă cineva strică logica de dată a
zborurilor, CI-ul devine roșu ÎNAINTE ca Netlify să publice — nu după ce
cititorii văd zboruri „decolate" care încă n-au plecat.

Fișiere: .github/workflows/ci.yml (pas nou),
         supabase/functions/flights-sync/index.ts (fix-ul),
         supabase/functions/flights-sync/fids.regression.mjs (testul).
Restul, neschimbat, inclus ca superset.
