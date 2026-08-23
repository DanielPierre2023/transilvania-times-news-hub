// ───────────────────────────────────────────────────────────────────────────
// flights-sync — collects arrivals & departures for the three Transylvanian
// airports (Cluj-Napoca, Târgu Mureș, Sibiu) from their official public flight
// boards, normalizes them into one schema, and upserts into `airport_flights`.
//
// Invoked every 10 minutes by pg_cron (see the airport_flights_cron migration).
// Guarded by the `x-sync-secret` header so only the scheduler can trigger it.
//
//   POST            → sync all sources, write to DB, return a summary.
//   GET  ?test=1    → DRY RUN: parse all sources, return counts + samples,
//                     write nothing. Use this to validate parsers after deploy.
//
// Pure parsing lives in ./parse.ts (unit-tested off-runtime). This file owns
// networking, auth, and the DB write.
// ───────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SOURCES, extractFlightTable, mapRows, type FlightRecord, type Source } from "./parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const USER_AGENT =
  "TransilvaniaTimesFlightBot/1.0 (+https://transilvaniatimes.com; contact@transilvaniatimes.com)";
const FETCH_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ro,en;q=0.8", "Accept": "text/html" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) return await res.text();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let out = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

async function collectSource(src: Source): Promise<{ records: FlightRecord[]; error?: string }> {
  try {
    const html = await fetchHtml(src.url);
    const table = extractFlightTable(html);
    if (!table) return { records: [], error: "no flight table found" };
    return { records: mapRows(src, table) };
  } catch (e) {
    return { records: [], error: String((e as Error)?.message ?? e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("FLIGHTS_SYNC_SECRET");
  const provided = req.headers.get("x-sync-secret");
  if (!secret || provided !== secret) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const dryRun = req.method === "GET" && url.searchParams.get("test") === "1";

  const perSource: Record<string, { count: number; error?: string; sample?: FlightRecord[] }> = {};
  const all: FlightRecord[] = [];
  for (const src of SOURCES) {
    const { records, error } = await collectSource(src);
    perSource[`${src.airport}:${src.direction}`] = {
      count: records.length,
      error,
      sample: dryRun ? records.slice(0, 3) : undefined,
    };
    all.push(...records);
  }

  if (dryRun) return json({ dryRun: true, total: all.length, sources: perSource });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let upserted = 0;
  const errors: string[] = [];
  const BATCH = 200;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const { error } = await supabase
      .from("airport_flights")
      .upsert(batch, { onConflict: "airport,direction,flight_date,flight_no,scheduled_time" });
    if (error) errors.push(error.message);
    else upserted += batch.length;
  }

  // Prune anything older than yesterday (Europe/Bucharest).
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const cutoff = new Date(today + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  const { error: delErr } = await supabase
    .from("airport_flights")
    .delete()
    .lt("flight_date", cutoff.toISOString().slice(0, 10));
  if (delErr) errors.push(`prune: ${delErr.message}`);

  // Health alert: if any source suddenly returns zero rows (likely a parser
  // break after a site redesign), email an operator. Optional — only fires
  // when RESEND_API_KEY + FLIGHTS_ALERT_EMAIL are set.
  const dead = Object.entries(perSource).filter(([, v]) => v.count === 0);
  let alerted = false;
  if (dead.length) {
    alerted = await sendAlert(dead.map(([k, v]) => `${k}: ${v.error ?? "0 rows"}`));
  }

  // Disruption → news brief: record newly-detected cancellations / big delays
  // and email an editor a ready-to-run brief. Editor-in-the-loop by design —
  // nothing is auto-published into the editorial pipeline.
  let disruptionsNew = 0;
  const disruptions = buildDisruptions(all);
  if (disruptions.length) {
    const { data: inserted, error: dErr } = await supabase
      .from("flight_disruptions")
      .upsert(disruptions, {
        onConflict: "airport,direction,flight_date,flight_no,scheduled_time,kind",
        ignoreDuplicates: true,
      })
      .select("airport,direction,flight_date,flight_no,scheduled_time,airline,city,kind,detail");
    if (dErr) errors.push(`disruptions: ${dErr.message}`);
    const fresh = inserted ?? [];
    disruptionsNew = fresh.length;
    if (fresh.length) await sendDisruptionDigest(fresh as DisruptionRow[]);
  }

  return json({
    ok: errors.length === 0 && dead.length === 0,
    parsed: all.length,
    upserted,
    disruptionsNew,
    sources: Object.fromEntries(Object.entries(perSource).map(([k, v]) => [k, { count: v.count, error: v.error }])),
    deadSources: dead.length ? dead.map(([k]) => k) : undefined,
    alerted: dead.length ? alerted : undefined,
    errors: errors.length ? errors : undefined,
  });
});

const DELAY_ALERT_MIN = 60;
const AIRPORT_NAMES: Record<string, string> = {
  CLJ: "Aeroportul Cluj-Napoca", TGM: "Aeroportul Târgu Mureș", SBZ: "Aeroportul Sibiu",
};

interface DisruptionRow {
  airport: string; direction: string; flight_date: string; flight_no: string;
  scheduled_time: string; airline: string | null; city: string | null;
  kind: string; detail: string | null;
}

function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function buildDisruptions(rows: FlightRecord[]): DisruptionRow[] {
  const out: DisruptionRow[] = [];
  for (const f of rows) {
    let kind = "", detail = "";
    if (f.status === "CANCELLED") {
      kind = "CANCELLED"; detail = "Zbor anulat";
    } else if (f.status === "DELAYED" && f.estimated_time) {
      const d = minutesOf(f.estimated_time) - minutesOf(f.scheduled_time);
      if (d >= DELAY_ALERT_MIN) { kind = "DELAYED"; detail = `Întârziere ~${d} min (estimat ${f.estimated_time})`; }
    }
    if (!kind) continue;
    out.push({
      airport: f.airport, direction: f.direction, flight_date: f.flight_date,
      flight_no: f.flight_no, scheduled_time: f.scheduled_time,
      airline: f.airline, city: f.city, kind, detail,
    });
  }
  return out;
}

async function sendDisruptionDigest(list: DisruptionRow[]): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("FLIGHTS_NEWS_EMAIL") ?? Deno.env.get("FLIGHTS_ALERT_EMAIL");
  if (!key || !to) return false;
  const from = Deno.env.get("FLIGHTS_ALERT_FROM") ?? "Transilvania Times <alerts@transilvaniatimes.com>";
  const items = list.map((d) => {
    const arrow = d.direction === "departure" ? "spre" : "dinspre";
    const label = d.kind === "CANCELLED" ? "Zbor anulat" : "Întârziere majoră";
    return `<li><strong>${label}</strong> — ${AIRPORT_NAMES[d.airport] ?? d.airport}: ${d.flight_no}${
      d.airline ? " (" + d.airline + ")" : ""
    } ${arrow} ${d.city ?? "—"}, programat ${d.flight_date} ${d.scheduled_time}. ${d.detail ?? ""}</li>`;
  }).join("");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to,
        subject: `✈️ Zboruri: ${list.length} perturbare(i) — brief pentru redacție`,
        html: `<p>Perturbări nou detectate la aeroporturile din Transilvania (verificați cu compania aeriană înainte de publicare):</p><ul>${items}</ul>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendAlert(lines: string[]): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("FLIGHTS_ALERT_EMAIL");
  if (!key || !to) return false;
  const from = Deno.env.get("FLIGHTS_ALERT_FROM") ?? "Transilvania Times <alerts@transilvaniatimes.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to,
        subject: "⚠️ Zboruri: o sursă de aeroport nu returnează date",
        html: `<p>Sincronizarea zborurilor a găsit surse fără rânduri (posibil parser stricat după un redesign):</p><ul>${
          lines.map((l) => `<li>${l}</li>`).join("")
        }</ul><p>Rulează <code>?test=1</code> pe funcția <code>flights-sync</code> pentru diagnostic.</p>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
