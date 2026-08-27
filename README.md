# Rollback — the newsroom as it was BEFORE today's changes

One file: `app/admin/newsroom/page.tsx` (the exact version from commit 94dd404,
this morning, before any of today's work — verified type-clean).

## How to apply (your usual GitHub upload flow)

1. Open github.com → transilvania-times-news-hub → folder `app/admin/newsroom`
2. Click **Add file → Upload files**
3. Drag `page.tsx` from this zip into the page (same name = it replaces the old one)
4. Click **Commit changes**
5. Netlify builds automatically (~2-3 min). Then hard-refresh the admin page (Ctrl+F5).

## What you get back

- The simple newsroom from this morning: script → voice → lipsync → compose.
- Lipsync loops the short clip when the voice is longer (yesterday's behaviour).
- Monitor is the overlay style; platou/greenscreen work as before.
- The clip upload fix is included (inline error message, MP4/MOV accepted).

## What is NOT touched

- Ioana / ElevenLabs voice — keeps working.
- All uploaded clips, presets, bulletins, storage — untouched.
- The CSP fix and all other files — untouched.

The new dropdowns (Camera 2 / intro / outro / pistă regizată) disappear; the
extra values they saved in presets and browser storage are simply ignored by
the old code — harmless.
