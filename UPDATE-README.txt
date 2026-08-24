TRANSILVANIA TIMES — Zboruri: 3 fixes
=====================================

Extrageți în rădăcina repo-ului, commit + push. Nu trebuie făcut nimic în
Supabase — funcția e deja pe v24 și baza a fost curățată.

1) LOGO COMPANII PE MOBIL (era absent din redesign)
   • cardul mobil primește AirlineLogo lângă numele companiei;
     desktopul rămâne neschimbat.

2) SHARE FACEBOOK & MESSENGER (împărtășea homepage-ul, nu zborul)
   • Cauza: Facebook a eliminat parametrul `quote` în 2017, iar Messenger
     folosește doar link-ul URL. Ambele scrape-uiesc OpenGraph de la URL,
     nu textul trimis.
   • Fix: link permanent per zbor cu tag-uri OpenGraph flight-specifice:
        /zboruri/f/{airport}-{d|a}-{YYYYMMDD}-{zbor}-{HHMM}/   (RO)
        /en/zboruri/f/{airport}-{d|a}-{YYYYMMDD}-{zbor}-{HHMM}/  (EN)
     Facebook / Messenger scrape titlul + descrierea generate din baza de
     date și afișează cardul zborului. Pagina redirecționează utilizatorii
     către panoul aeroportului; canonical rămâne pagina părinte (fără
     dilluție SEO — noindex pe permalink-uri).
   • WhatsApp și Telegram continuă cu textul pre-populat + link (funcționează).

3) ZBORURI VECHI CU „DELAYED" RĂMASE PE PANOU (ex. A2 107)
   • Cauza: după ce aeroportul scoate un zbor completat din orarul publicat,
     upsert-ul nu-l mai atinge; sticky-restore se aplica doar la
     SCHEDULED → terminal, nu la DELAYED → terminal.
   • Fix: după 60 min de la ora ESTIMATĂ, DELAYED devine automat
     DEPARTED (plecări) / LANDED (sosiri), păstrând estimarea ca ora reală.
     Regulă în funcție + patch DB la fiecare sync (curăță și rândurile
     rămase din trecut). A2 107 22:00 → 01:00 e deja marcat DEPARTED în bază.

TESTE NOI ÎN CI:
   .github/workflows/ci.yml rulează la fiecare push:
     - node supabase/functions/flights-sync/fids.regression.mjs (7 verificări)
     - node supabase/functions/flights-sync/stale.regression.mjs (5 verificări)

Fișiere principale:
   app/components/FlightBoard.tsx     — logo pe mobil + share prin permalink
   app/zboruri/f/[slug]/page.tsx      — permalink RO
   app/en/zboruri/f/[slug]/page.tsx   — permalink EN
   supabase/functions/flights-sync/index.ts — DELAYED cleanup
   supabase/functions/flights-sync/stale.regression.mjs — test nou
   .github/workflows/ci.yml           — CI pas nou
