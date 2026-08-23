TRANSILVANIA TIMES — Zboruri: coloana „Estimat" eliminată (era redundantă)
==========================================================================

Extrageți în RĂDĂCINA repo-ului, suprascrieți tot, commit + push.
(Acest zip ÎNLOCUIEȘTE zip-ul FIDS anterior — conține tot, inclusiv datele
live de la aeroportul Cluj. Serverul e deja la zi, nu atingeți Supabase.)

CE S-A SCHIMBAT:
  • Coloana „Estimat" a dispărut — statusul purta deja ora („Decolat 21:29",
    „Estimat 01:00"), deci coloana doar repeta informația.
  • În locul ei, stil panou de aeroport: când există o oră revizuită, ora
    programată apare tăiată, cu ora nouă în ROȘU lângă ea — pe desktop în
    coloana „Programat", pe mobil în blocul orei din card.
  • Zbor la timp = o singură oră, curată. Fără dubluri.

  Fișier modificat: app/components/FlightBoard.tsx (restul, neschimbate,
  incluse ca superset)
