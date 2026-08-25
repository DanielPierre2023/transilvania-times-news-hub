TRANSILVANIA TIMES — Zboruri: „Companii & bagaje" — design nou cu carduri
=========================================================================

Extrageți în rădăcina repo-ului, commit + push. Pură frontend, nimic în Supabase.
Înlocuiește zip-ul „companii" anterior (superset complet).

CE E NOU (design):
  • Carduri ALBE distincte, cu umbră și colțuri rotunjite, pe un fundal cald
    colorat — fiecare companie separată clar, fără confuzie.
  • Bandă superioară în culoarea companiei (identitate) + insigne colorate
    pe aeroport: CLJ roșu, TGM verde-petrol, SBZ albastru — nicio confuzie.
  • LOGO-UL companiei, mare, într-o casetă albă în capul fiecărui card
    (aceeași sursă ca panoul live).
  • Rutele plafonate la 12 + buton „+N rute" pentru restul (cardurile rămân
    compacte; lista completă e la o atingere).
  • Cardurile de birou bagaje (sus) au același stil: alb, bandă colorată,
    insignă de aeroport.

Datele (rute complete, handling Menzies/TAROM/Turkish) rămân cele reale,
neschimbate.

Fișiere modificate:
  app/components/AirlineLogo.tsx        (dimensiune „large" pentru logo în card)
  app/components/AirlinesDirectory.tsx  (carduri noi + plafonare rute)
  app/components/AirlinesPageContent.tsx(carduri birou bagaje)
(restul, neschimbate, incluse ca superset)
