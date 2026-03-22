// Root layout — required by Next.js App Router.
// This is a minimal shell. All meaningful layout (fonts, providers, i18n)
// lives in app/[locale]/layout.tsx which wraps every locale route.

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
```

That is the entire file. It is intentionally minimal — just passes children through. The `<html>` and `<body>` tags, fonts, and providers are all in `app/[locale]/layout.tsx` where the `locale` param is available. This is the correct `next-intl` architecture.

Commit message: `fix: add required root app/layout.tsx shell for Next.js App Router`

---

After this commit, the build output will show:
```
Route (app)
┌ ƒ /          ← SSR, locale ro
└ ƒ /en        ← SSR, locale en
