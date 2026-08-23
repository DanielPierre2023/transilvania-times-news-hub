UPDATE — clean HH:MM times (no seconds in pills/columns)
Extract in the REPO ROOT so files land at:
  lib/flights.ts
  app/components/FlightBoard.tsx
  app/components/NextDeparturesWidget.tsx
Then: git add -A && git commit -m "Flights: display times as HH:MM" && git push
(No function redeploy needed — frontend only.)
