UPDATE — Estimat column + estimated other-end times
====================================================
1) New "Estimat" column in the table (visible on desktop): the estimated
   DEPARTURE time for departures / estimated ARRIVAL time for arrivals,
   at this airport. Red when it differs from schedule.
2) Under the city name: the other-end time now becomes an ESTIMATE when the
   flight has a known delay — shown as "~19:45" in red, with a tooltip
   explaining the derivation; otherwise the scheduled time is shown.
3) Share text includes the same estimated other-end time.

REQUIRES the previous update (tt-zboruri-update-othertime.zip) to be
deployed first: its migration + function redeploy provide the data.

Extract this zip in the REPO ROOT (file lands at app/components/FlightBoard.tsx), then:
  git add -A && git commit -m "Flights: Estimat column + derived other-end estimates" && git push
(Frontend only.)
