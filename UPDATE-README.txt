TRANSILVANIA TIMES — Zboruri: actualizare logo-uri + nume companii + estimări
=============================================================================

CE CONȚINE (extrageți acest zip în RĂDĂCINA repo-ului, suprascrieți tot):

  lib/flights.ts                       — coduri ICAO→IATA (ROT/NSM/TWI de la
                                         Târgu Mureș), nume companii derivate
                                         din cod (Sibiu nu publică numele)
  app/components/AirlineLogo.tsx       — logo-uri wordmark uniforme (Daisycon,
                                         normalizate) cu fallback Kiwi + monogramă
  app/components/FlightBoard.tsx       — numele companiei apare și la Sibiu;
                                         filtrul/căutarea/share folosesc numele
                                         derivat; coloana Estimat arată ora
                                         așteptată pentru TOATE zborurile viitoare
  + restul fișierelor (neschimbate față de ultima versiune, incluse ca superset
    ca să nu rămână nimic desincronizat)

PAȘI:
  1. Extrageți zip-ul în rădăcina repo-ului (unde e package.json).
     Windows: click dreapta → Extract All → alegeți DIRECT folderul repo-ului
     (verificați să nu se creeze un subfolder în plus!).
  2. Commit + push. Netlify face build automat.

Funcția flights-sync este deja la v18 (deploy făcut de Claude) — nu trebuie
nimic în Supabase.
