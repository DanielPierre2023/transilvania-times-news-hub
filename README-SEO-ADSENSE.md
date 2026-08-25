# SEO + AdSense fix — 25 aug 2026

## Ce s-a găsit la audit (verificat live)

1. **AdSense era complet inert.** Scriptul `adsbygoogle.js` se încărca pe tot
   site-ul, dar `AdUnit.tsx` nu era folosit NICĂIERI — zero unități de anunț
   pe orice pagină, zero cereri de anunțuri după încărcarea scriptului
   (verificat în network). În plus, anunțurile erau condiționate de bannerul
   nostru de cookie-uri, care NU este un CMP certificat Google — din 2024
   Google refuză să servească anunțuri în SEE (România) fără un CMP certificat
   TCF. Dublu blocaj = zero anunțuri, garantat.
2. **9 din 10 pagini /zboruri nu sunt indexate.** `site:transilvaniatimes.com/zboruri`
   returnează un singur rezultat (pagina principală). Cauza: paginile pe
   aeroport (cluj / targu-mures / sibiu, RO+EN) nu aveau niciun link intern
   către ele — tab-urile din FlightBoard sunt butoane client-side pe care
   Google nu le urmează. Pagini orfane = neindexate.
3. **Google News: site-ul lipsește complet** („Nu există niciun articol de
   afișat" la căutarea transilvaniatimes.com). Sitemap-ul de știri e valid,
   JSON-LD NewsArticle e corect — lipsește doar înscrierea în Publisher
   Center. Atenție și la cadență: cel mai recent articol din
   sitemap-news.xml era din 23 aug (acum ~2 zile). Dacă pipeline-ul a
   stagnat, asta afectează News mai mult decât orice detaliu tehnic.
4. robots.txt, sitemap.xml (toate cele 10 URL-uri zboruri), ads.txt,
   canonical, hreflang, meta — toate corecte. Nicio problemă.

## Ce e în acest pachet (commit + push, apoi Netlify face build)

| Fișier | Ce face |
|---|---|
| `lib/ads.ts` | NOU — configurare centrală AdSense: client ID + cele 4 slot ID-uri (vezi pașii de mai jos) |
| `app/components/AdUnit.tsx` | REFĂCUT — nu mai e blocat de bannerul nostru de cookie-uri (consimțământul pentru anunțuri îl gestionează CMP-ul certificat al Google); protecție anti-dublu-push; fallback SponsorBanner cât timp slot-ul e gol |
| `app/components/AirportQuickLinks.tsx` | NOU — linkuri crawlabile de pe /zboruri către paginile pe aeroport (rezolvă paginile orfane) |
| `app/zboruri/page.tsx` + `app/en/zboruri/page.tsx` | linkuri aeroporturi + BreadcrumbList JSON-LD + anunț sub tabel |
| `app/zboruri/[airport]/page.tsx` + EN | BreadcrumbList JSON-LD + anunț între tabel și FAQ |
| `app/zboruri/companii/page.tsx` + EN | BreadcrumbList JSON-LD |
| `app/blog/[slug]/page.tsx` + EN | anunț la finalul articolului + anunț în sidebar sub „Cele mai citite" |

Toate plasamentele afișează SponsorBanner-ul intern până când completezi
slot ID-urile în `lib/ads.ts` — deci poți da push imediat, nimic nu se strică.

## Pașii TĂI din console (fără ei, codul nu poate face nimic)

### A. AdSense — obligatoriu, în ordinea asta

1. **adsense.google.com → Privacy & messaging → GDPR** → Create message →
   alege site-ul, limba română, opțiunile implicite (Consent / Do not
   consent) → Publish. Acesta este CMP-ul certificat al Google; se livrează
   prin scriptul deja existent, fără cod. **Fără acest mesaj, AdSense nu
   servește nimic în România.**
2. **Sites** → verifică statusul transilvaniatimes.com. Dacă nu e „Ready",
   rezolvă întâi aprobarea (ads.txt e deja corect).
3. **Ads → By site → transilvaniatimes.com → Auto ads: ON** (am ales
   strategia „manual + auto").
4. **Ads → By ad unit → Display ads** → creează 4 unități și copiază
   numerele `data-ad-slot` în `lib/ads.ts`:
   - `tt-article-bottom` → `articleBottom`
   - `tt-article-sidebar` → `articleSidebar`
   - `tt-zboruri-below-board` → `zboruriBelowBoard`
   - `tt-airport-above-faq` → `airportAboveFaq`
5. Commit + push cu slot ID-urile completate.

### B. Search Console — indexarea celor 9 URL-uri

Pentru fiecare URL (după ce linkurile de la pasul de cod sunt live):
URL inspection → lipește URL-ul → **Request indexing**:

- /zboruri/cluj/ , /zboruri/targu-mures/ , /zboruri/sibiu/ , /zboruri/companii/
- /en/zboruri/ , /en/zboruri/cluj/ , /en/zboruri/targu-mures/ , /en/zboruri/sibiu/ , /en/zboruri/companii/

### C. Google News — Publisher Center

1. **publishercenter.google.com** → Add publication → „Transilvania Times",
   România, română (+ engleză ca secundară).
2. Verifică proprietatea site-ului (se face prin Search Console — ești deja
   verificat).
3. Completează logo (pătrat + dreptunghiular), URL, contact.
4. La Content → adaugă feed-urile existente: `https://transilvaniatimes.com/sitemap-news.xml`
   și `https://transilvaniatimes.com/rss.xml`.
5. Publish. Includerea în News e algoritmică — Google nu garantează, dar cu
   NewsArticle JSON-LD, sitemap de știri, autori reali și pagini de
   standarde editoriale (toate există deja), dosarul e complet.
6. **Cadența contează**: sitemap-news arată ultimul articol pe 23 aug.
   Verifică de ce nu s-a mai publicat nimic de 2 zile.

## Ce NU poate garanta nimeni

Poziția în top Google. Tot ce ține de tehnic e acum acoperit: indexare,
linkuri interne, structured data, News eligibility, AdSense conform. Restul
e conținut + timp.
