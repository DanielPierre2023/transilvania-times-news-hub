TRANSILVANIA TIMES — Zboruri: BUGFIX „zboruri viitoare apar ca decolate"
========================================================================

DOAR pentru istoricul repo-ului: funcția e DEJA reparată și rulează în
producție (v22, pusă de Claude), iar datele greșite au fost curățate.
Extrageți în rădăcină, commit + push, ca repo-ul să fie identic cu producția.

CE S-A ÎNTÂMPLAT:
  Panoul live al aeroportului Cluj afișează DOAR ora (HH:MM), fără dată, și
  după miezul nopții mai arată o vreme zborurile zilei precedente. Vechea
  logică ghicea ziua din ordinea rândurilor — iar la 00:40 a atribuit
  „AIRBORNE 06:02" (zborul de IERI dimineață) zborului de AZI de la 06:00.
  Rezultat: zboruri care pleacă peste câteva ore apăreau ca decolate.

CE S-A REPARAT:
  1. Ziua nu se mai ghicește. Fiecare rând de pe panou e potrivit cu orarul
     oficial (care ARE date reale), alegând ziua cea mai apropiată de „acum".
  2. Statusul decide ce zile sunt posibile: „AIRBORNE/LANDED" doar pentru un
     zbor din trecut, „CHECK-IN/BOARDING" doar în ±5 ore. Un rând care nu se
     potrivește cu nicio zi plauzibilă e IGNORAT, nu ghicit.
  3. Regulă de siguranță finală: un zbor programat în VIITOR nu poate fi
     „decolat"/„aterizat" — orice astfel de marcaj e șters automat la fiecare
     sincronizare, indiferent de la ce sursă vine.
  4. Test de regresie rulabil: supabase/functions/flights-sync/fids.regression.mjs
     (rulează: node supabase/functions/flights-sync/fids.regression.mjs)

  Fișiere: supabase/functions/flights-sync/index.ts (+ testul nou).
  Frontend-ul e neschimbat față de zip-ul anterior, inclus ca superset.
