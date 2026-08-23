TRANSILVANIA TIMES — Zboruri: date LIVE de la aeroportul Cluj (FIDS)
====================================================================

Extrageți acest zip în RĂDĂCINA repo-ului, suprascrieți tot, commit + push.
Partea de server e DEJA făcută de Claude (funcția v19 + coloanele noi în DB).

CE E NOU — datele oficiale ale aeroportului Cluj (panourile din terminal,
folosite cu permisiunea aeroportului):

  • statusuri oficiale: AIRBORNE (decolat, cu ora reală), GATE OPEN /
    GATE CLOSED, CHECK-IN (cu numărul ghișeului), DELAYED cu ora estimată
  • POARTA de îmbarcare (ex. „Poarta A7") — afișată sub status pe desktop
    și în cardul de zbor pe mobil
  • GHIȘEUL de check-in (ex. „Check-in 13")
  • toate incluse și în textul de share (WhatsApp etc.)

  Prioritate surse: panoul aeroportului (FIDS) > AeroDataBox > orar static.
  Status nou „Poartă deschisă" (albastru, cu punct pulsant).

  Fișiere modificate: lib/flights.ts, lib/database.types.ts,
  app/components/FlightBoard.tsx, toate paginile /zboruri (select + gate),
  app/api/flights/route.ts, NextDeparturesWidget.tsx
  + migrarea supabase/migrations/20260823220000_airport_flights_gate_checkin.sql
    (DEJA aplicată în producție de Claude — doar pentru istoricul repo-ului)
