

## Plan: Sitemap, Robots.txt & Legal Entity Updates

### Company Details

- **Name**: ADD Individual Solutions Ltd.
- **VAT**: CY10439793M
- **Email**: contact@add-individual-solutions.com
- **Phone**: +35796919606
- **Address**: Sunset Valley, 7081 Pyla, Cyprus

### 1. Create Bilingual Sitemap (`public/sitemap.xml`)

Static sitemap with `xhtml:link` hreflang tags for all public routes. Since the site uses i18n (same URL, language toggle) rather than `/en/` and `/ro/` prefixes, each URL gets self-referencing hreflang annotations with `x-default`.

Routes to include: `/`, `/contact`, `/terms`, `/privacy`, `/blog`, plus category pages and static article slugs.

### 2. Update Robots.txt (`public/robots.txt`)

Add `Sitemap: https://transilvaniatimes.com/sitemap.xml` directive.

### 3. Update Legal Pages with Real Company Details

**Footer (`Footer.tsx`):**
- Add company line: "A media project by ADD Individual Solutions Ltd."
- Update contact email to `contact@add-individual-solutions.com`
- Update phone to `+35796919606`
- Add "Sunset Valley, 7081 Pyla, Cyprus" as corporate address (keep Cluj editorial desk)
- Update copyright line with company name

**Terms & Conditions (`TermsConditions.tsx`):**
- Replace hardcoded "str. Memorandumului" with Cyprus corporate address
- Update email to `contact@add-individual-solutions.com`
- Add company registration and VAT info

**Privacy Policy (`PrivacyPolicy.tsx`):**
- Same: update contact section with Cyprus HQ details
- Add Data Protection Authority reference (Cyprus Commissioner)

**Contact Page (`Contact.tsx`):**
- Add "Corporate Headquarters" section (Cyprus) alongside existing "Editorial Desk" (Cluj)
- Update phone number

**i18n (`src/i18n.ts`):**
- Update `terms_hq` to reference ADD Individual Solutions Ltd.
- Add new translation keys for corporate HQ, registration, VAT
- Make `terms_updated` and `privacy_updated` dates dynamic (or update to current)

### Files to Modify

| File | Change |
|------|--------|
| `public/sitemap.xml` | **New** — bilingual sitemap |
| `public/robots.txt` | Add Sitemap directive |
| `src/components/Footer.tsx` | Add company entity line, update email/phone, add Cyprus address |
| `src/pages/TermsConditions.tsx` | Replace contact section with Cyprus HQ + registration details |
| `src/pages/PrivacyPolicy.tsx` | Replace contact section with Cyprus HQ + DPA reference |
| `src/pages/Contact.tsx` | Add Corporate HQ section alongside Editorial Desk |
| `src/i18n.ts` | Update `terms_hq`, add company detail translation keys |

