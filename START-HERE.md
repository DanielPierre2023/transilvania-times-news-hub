# tt-ci-fix — CI has been failing since 25 August, and it is not the code

## What is actually wrong

`npm ci` refuses to install when `package.json` and `package-lock.json` disagree.
They have disagreed for five days.

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json are in sync.
npm error Missing: @types/sanitize-html@2.16.1 from lock file
npm error Missing: mammoth@1.12.2 from lock file
npm error Missing: sanitize-html@2.17.7 from lock file
        ... and 42 transitive packages
```

The commit history says exactly how:

| file | last changed |
|---|---|
| `package.json` | **25 Aug 2026** — gained sanitize-html, mammoth, @types/sanitize-html |
| `package-lock.json` | **15 Aug 2026** |

Ten days apart. Both commits are titled *Add files via upload* — files added
through the GitHub web interface, which cannot run `npm install`, so the lock was
never regenerated. Every push since has failed at the same step.

**It is not the commit that alerted you.** `dcf52f1` is the tt-typeface drop; I
checked its file list and it touches no manifest at all. It just happened to be
the push that made you look.

## The fix, and it is verified rather than asserted

I regenerated the lock from the **byte-identical** `package.json` that is on
`main` — sha256 `7420dc66…`, confirmed against the copy here — and then ran the
exact command that has been failing:

```
npm install --package-lock-only     # 617 packages resolved
npm ci                              # added 563 packages in 21s, exit 0
```

That is the whole hotfix: **one file**, `package-lock.json`.

## Also in here, and deliberately smaller than it could be

The same run carried a second warning:

> Node.js 20 is deprecated. actions/checkout@v4 and actions/setup-node@v4 target
> Node.js 20 but are being forced to run on Node.js 24.

Both actions are bumped to their current majors, **v7**. The inputs this workflow
uses — `node-version`, `cache` — are unchanged across those majors.

**What I did NOT change, on purpose:** the runtime stays on Node **20**.

The log also shows `EBADENGINE` warnings — `@supabase/*` 2.112 and
`sanitize-html` 2.17 now declare `node >= 22`. They are warnings, not errors;
npm does not enforce `engines` unless `engine-strict` is set. And `netlify.toml`
pins `NODE_VERSION = "20"`, so bumping CI alone would make CI green on a
configuration the site never builds — which is worse than no CI. Moving both to
22 is a real change to the production build environment and deserves its own
deploy, not a ride-along on a hotfix.

## Deploy

Two files, repo only.

```
package-lock.json                 regenerated, verified with npm ci
.github/workflows/ci.yml          actions v4 → v7, plus why Node stays at 20
```

## One caveat, stated plainly

I verified the lock by running `npm ci` here. **I cannot run a GitHub Actions
job from here**, so the action version bump is the one part of this the next push
verifies rather than I do. If CI goes red on those, reverting `ci.yml` alone
restores it and keeps the lock fix — they are independent.

## Housekeeping, while you are in there

`START-HERE.md` is being committed to the repository root and overwritten by
every drop, so the repo now carries one set of notes and has lost the rest. They
would be better as `docs/2026-08-30-typeface.md` and so on — or not committed at
all. Your call; I will follow whichever you prefer in the next package.

Worth considering separately: CI runs typecheck, lint, the flight regression and
the build, but not the 443 assertions in `_verification/`. Those need ffmpeg and
node-canvas, so it is a heavier job — but it is the difference between CI
checking that the code compiles and CI checking that the renderer still renders.
