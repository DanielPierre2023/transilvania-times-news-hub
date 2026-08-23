# The weather widget — two different things with the same name

## First, the thing that will not fix it

`weather-alert`, the edge function we just repaired, **has no frontend output at
all**. Read its own header:

    Polls MeteoAlarm's Romania OPEN Atom feed, finds orange (level 3) / red
    (level 4) warnings for the 14 Transylvania counties, and emails opted-in
    subscribers once per warning per county.

It reads MeteoAlarm, sends emails through Resend, and writes dedup rows to
`weather_alerts_sent`. It writes nothing any page reads. Fixing its 401 was worth
doing — your subscribers were getting no storm warnings for at least a day — but it
was never going to make a widget appear.

## The widget is a separate component, and CSP is blocking it

`app/components/WeatherWidget.tsx` is the header temperature for Cluj-Napoca. It is
rendered in `LayoutShell.tsx` in two places (lines 280 and 407), so it is wired up
correctly. It fetches its data straight from the browser:

    fetch('https://api.open-meteo.com/v1/forecast?latitude=46.7712&longitude=23.6236&current_weather=true')

I ran that exact fetch from inside your live homepage. The result:

    THREW: Failed to fetch

Your Content-Security-Policy header, live on the site right now, allows these
`connect-src` hosts and no others:

    'self'
    https://zimpimoierpsocnmnizm.supabase.co
    wss://zimpimoierpsocnmnizm.supabase.co
    https://pagead2.googlesyndication.com
    https://adservice.google.com

`api.open-meteo.com` is not among them, so the browser refuses the request before it
leaves the page.

**And that is why you never saw an error.** The component ends with:

    .catch(() => setLoading(false))
    ...
    if (loading || temp === null) return null

CSP blocks the fetch, the catch swallows it, `temp` stays null, and the component
returns `null` — it renders nothing at all. No broken box, no console complaint from
the component, just a gap in the header where the temperature should be. It has been
doing this for every visitor on every page load.

## The fix

Add `https://api.open-meteo.com` to `connect-src`. The policy is declared in **two**
files and both have to change or they drift apart:

- `next.config.ts` — line 40, the `csp` array. This is the one that actually applies
  to server-rendered pages.
- `netlify.toml` — line 69, the `[[headers]]` block. This one covers static/CDN
  responses.

Both are in this archive, already edited. I checked that the resulting `connect-src`
is now character-for-character identical in the two files, and both were byte-identical
to `origin/main` before I touched them, so nothing else is overwritten. `tsc` is clean.

    git add next.config.ts netlify.toml
    git commit -m "Allow api.open-meteo.com in CSP connect-src so WeatherWidget renders"

Netlify rebuilds on push. After the deploy, hard-reload the homepage — you should see
the temperature and "Cluj-Napoca" appear in the header bar next to the date.

## While I was in there

I checked every third-party host the frontend calls from the browser.
`api.open-meteo.com` is the only one being blocked. The other two the code touches,
`api.anthropic.com` and `api.resend.com`, are called from server-side API routes,
where CSP does not apply — so nothing else is silently broken this way.

## One unrelated thing worth a look later

The homepage throws a React error #418 (a hydration mismatch) on load. It is not
related to the widget and it is not new, but it means some component renders
different HTML on the server than in the browser. It costs you a client-side re-render
of that subtree. Say the word and I will track down which component it is.
