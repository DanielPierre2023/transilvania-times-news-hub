TRANSILVANIA TIMES — Zboruri: REDESIGN frontend (mobil + desktop)
=================================================================

Extrageți acest zip în RĂDĂCINA repo-ului (unde e package.json), suprascrieți
tot, apoi commit + push. Netlify face build automat. Nimic de făcut în Supabase.

CE SE SCHIMBĂ:

  MOBIL (sub 768px) — layout complet nou, tip card:
   • fiecare zbor e un card: ora mare + „est HH:MM" dedesubt (gri = la timp,
     roșu = revizuit), destinația, compania (colorată), nr. zbor, ora la
     celălalt capăt, status cu punct pulsant
   • butonul DISTRIBUIE e mereu vizibil (cerc 40px); la atingere se deschide
     rândul WhatsApp / Messenger / Facebook / Telegram / restul (nativ iOS+Android)
   • fără scroll orizontal; filtrele stau într-un sertar (buton cu badge);
     titluri de dată în serif italic
   • identic pe iOS și Android: selecturi cu săgeată proprie (appearance-none),
     font 16px în câmpuri (fără zoom automat pe iPhone), ținte de atingere 40px+

  DESKTOP — tabelul rămâne, rafinat editorial:
   • benzi de dată în serif italic, accent roșu pe rândul activ (hover),
     statusuri tip pastilă cu punct colorat, numerale tabulare

  Fișiere modificate: app/components/FlightBoard.tsx, lib/flights.ts
  (+ restul, neschimbate, incluse ca superset ca să nu rămână nimic desincronizat)
