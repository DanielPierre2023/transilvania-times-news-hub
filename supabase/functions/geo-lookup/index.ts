import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const COUNTRY_NAMES: Record<string, string> = {
  RO: 'Romania', US: 'United States', GB: 'United Kingdom', DE: 'Germany',
  FR: 'France', IT: 'Italy', ES: 'Spain', NL: 'Netherlands', BE: 'Belgium',
  AT: 'Austria', CH: 'Switzerland', PL: 'Poland', CZ: 'Czech Republic',
  SK: 'Slovakia', HU: 'Hungary', BG: 'Bulgaria', HR: 'Croatia', RS: 'Serbia',
  UA: 'Ukraine', MD: 'Moldova', GR: 'Greece', TR: 'Turkey', SE: 'Sweden',
  NO: 'Norway', DK: 'Denmark', FI: 'Finland', PT: 'Portugal', IE: 'Ireland',
  CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', JP: 'Japan', KR: 'South Korea',
  CN: 'China', IN: 'India', BR: 'Brazil', MX: 'Mexico', AR: 'Argentina',
  CL: 'Chile', CO: 'Colombia', ZA: 'South Africa', EG: 'Egypt', NG: 'Nigeria',
  KE: 'Kenya', IL: 'Israel', AE: 'United Arab Emirates', SA: 'Saudi Arabia',
  SG: 'Singapore', MY: 'Malaysia', TH: 'Thailand', VN: 'Vietnam', PH: 'Philippines',
  ID: 'Indonesia', TW: 'Taiwan', HK: 'Hong Kong', RU: 'Russia', CY: 'Cyprus',
  LU: 'Luxembourg', MT: 'Malta', LT: 'Lithuania', LV: 'Latvia', EE: 'Estonia',
  SI: 'Slovenia', BA: 'Bosnia and Herzegovina', ME: 'Montenegro', MK: 'North Macedonia',
  AL: 'Albania', XK: 'Kosovo',
};

const ipCache = new Map<string, { country: string | null; city: string | null; ts: number }>();
const CACHE_TTL = 3600_000;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const cfCountryCode = req.headers.get('cf-ipcountry') || '';
    const countryFromCf = COUNTRY_NAMES[cfCountryCode.toUpperCase()] || null;
    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : (req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || '');

    if (ip && ipCache.has(ip)) {
      const cached = ipCache.get(ip)!;
      if (Date.now() - cached.ts < CACHE_TTL) {
        return new Response(JSON.stringify({ country: cached.country, city: cached.city }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      ipCache.delete(ip);
    }

    if (!ip || ip === '127.0.0.1' || ip === '::1') {
      return new Response(JSON.stringify({ country: countryFromCf, city: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let city: string | null = null;
    let country = countryFromCf;
    try {
      const res = await fetch(`https://ipapi.co/${ip}/json/`, {
        headers: { 'User-Agent': 'TransilvaniaTimes-Analytics/1.0' },
      });
      if (res.ok) {
        const data = await res.json();
        if (!data.error) {
          city = data.city || null;
          if (!country && data.country_name) country = data.country_name;
        }
      }
    } catch (_e) { /* ipapi.co failed */ }

    ipCache.set(ip, { country, city, ts: Date.now() });
    if (ipCache.size > 5000) {
      const oldest = [...ipCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
      for (let i = 0; i < 1000; i++) ipCache.delete(oldest[i][0]);
    }

    return new Response(JSON.stringify({ country, city }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (_e) {
    return new Response(JSON.stringify({ country: null, city: null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
