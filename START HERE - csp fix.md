# CSP fix — the render preview inside Studio

**GitHub only. Two files, both at the repository root.**

    netlify.toml
    next.config.ts

## What this fixes

The clip renders correctly and downloads correctly, but the little video player
inside Studio stays black. That is not the file — it is your site's
Content-Security-Policy.

`media-src` and `connect-src` list every origin the browser is allowed to load
media from: your Supabase bucket and fal.media. The render worker serves
finished masters from its own Railway origin, which was on neither list, so the
browser refuses to play it in the page.

Downloading still worked the whole time, because navigating to a URL is not
governed by the page's CSP — only loading it *into* the page is.

This is my omission: I moved renders onto a new origin and did not update the
policy that guards it.

## The change

One origin added to `media-src` and to `connect-src`:

    https://transilvania-times-news-hub-production.up.railway.app

Both files carry the same policy — `netlify.toml` sets it at the edge,
`next.config.ts` sets it in the app. They have to agree, so both are changed.
Nothing else in either file is touched.

If you ever move the worker to a custom domain, that domain replaces this one in
both places.

## Verified

    npx tsc --noEmit    exit 0
