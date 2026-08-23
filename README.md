# 1) The widget is still not showing — your CSP fix has not deployed yet

I checked the live site just now. The header it serves is still the old one:

    connect-src 'self' https://zimpimoierpsocnmnizm.supabase.co
                wss://zimpimoierpsocnmnizm.supabase.co
                https://pagead2.googlesyndication.com
                https://adservice.google.com

No `api.open-meteo.com`. The fetch from inside the page still throws
`Failed to fetch`, and the widget still renders nothing.

**But the fix IS committed.** `origin/main` (head `6f29123`) has
`api.open-meteo.com` in both `next.config.ts` and `netlify.toml`. And the response
came back with `age=1`, so this is a fresh response, not a stale CDN copy.

So the code is right and the site has not picked it up. That means the Netlify build
either has not run yet, is still running, or **failed**. Check
Netlify -> Deploys for the build of commit `6f29123`. (I could not check it for you —
the Netlify API has been returning 502 through my connection all afternoon.)

Nothing more to change for the widget. Once that deploy goes green, hard-reload the
homepage and the temperature will appear next to the date.

---

# 2) The React #418 hydration error — found it, fixed it

## What #418 actually means

React's own error text for 418, verbatim:

    Hydration failed because the server rendered %s didn't match the client.
    As a result this tree will be regenerated on the client. This can happen
    if a SSR-ed Client Component used:
      - A server/client branch `if (typeof window !== 'undefined')`.
      - Variable input such as `Date.now()` or `Math.random()` which changes
        each time it's called.
      - Date formatting in a user's locale which doesn't match the server.
      ...

Two of those bullets describe your header exactly.

## The cause

`app/components/LayoutShell.tsx` starts with `'use client'` — it is an **SSR-ed
client component**, the precise case React names. Line 278 read:

    {new Date().toLocaleDateString('ro-RO', { weekday:'long', day:'numeric',
                                              month:'long', year:'numeric' })}

That line runs **twice**:

1. On the server — Netlify's Node process, running in **UTC**.
2. Again in the visitor's browser during hydration — Romania is **UTC+3** in summer.

`new Date()` with no argument is "right now", so the two calls are different
instants to begin with, and they are then formatted in two different time zones.
Between **21:00 and 24:00 UTC** — 00:00 to 03:00 Romanian time — the server says one
weekday and the browser says the next. Different text in the same DOM node, so React
throws #418 and **regenerates that whole subtree on the client**.

It is made worse by caching: `netlify.toml` sets
`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, so the HTML a
visitor receives can be several minutes old before their browser ever hydrates it.

There is a second, non-obvious bug hiding in the same line. Because no time zone was
pinned, a reader in Germany or the US was shown **their own local date** on a
Romanian newspaper's masthead.

## The fix

Pin the zone, and tell React the remaining sliver is expected:

    <span className="hidden sm:inline capitalize" suppressHydrationWarning>
      {new Date().toLocaleDateString('ro-RO', { weekday:'long', day:'numeric',
        month:'long', year:'numeric', timeZone: 'Europe/Bucharest' })}
    </span>

`timeZone: 'Europe/Bucharest'` makes server and client format the same instant the
same way, and makes the date correct for Romanian readers wherever they are.
`suppressHydrationWarning` covers what pinning cannot: a cached render and its
hydration can still land on opposite sides of midnight. It applies to this one text
node only — it does not silence hydration checks anywhere else.

## Three more files with the same fault

Same problem, smaller blast radius: these format a **stored** timestamp, so both
sides use the same instant, but with no `timeZone` the server (UTC) and the reader's
browser still disagree for anything published near midnight UTC — and article dates
were being shown in the reader's zone rather than Romania's.

    app/components/RelatedArticles.tsx    formatDate()
    app/components/CommentSection.tsx     formatDate()
    app/components/ArticleLangToggle.tsx  fmtDate()

All three now pin `timeZone: 'Europe/Bucharest'`.

## What I checked and did not change

`© {new Date().getFullYear()}` appears in `LayoutShell.tsx`, `SiteHeader.tsx` and
`SiteFooter.tsx`. Same family of bug, but the year only differs across New Year's
midnight, so I left them rather than widen the diff. Say the word and I will pin
those too.

The admin pages have many `toLocaleDateString` calls. They are irrelevant here —
they render behind the login gate and are not part of the public SSR/hydration path.

---

# Verification

- `tsc --noEmit` on the whole app: clean (only the pre-existing `@upstash/*` errors
  in `lib/rate-limit.ts`, untouched).
- `eslint` on all four files: **0 errors** (1 pre-existing warning in
  CommentSection about a `useEffect` dependency, not mine).
- Diff versus `origin/main`: LayoutShell +14/-2, RelatedArticles +4/-0,
  CommentSection +3/-1, ArticleLangToggle +3/-1. Nothing else touched.

**One thing worth flagging:** my working copy of `LayoutShell.tsx` was **stale** —
it predated the "Zboruri" flights button you added today. I refreshed it from
`origin/main` before editing, so this file is your current version plus the date fix,
and the flights button is intact. Had I edited my old copy, committing it would have
deleted that button.

    git add app/components/
    git commit -m "Pin date formatting to Europe/Bucharest to fix React #418 hydration mismatch"
