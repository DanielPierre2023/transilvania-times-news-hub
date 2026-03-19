

## Plan: Redesign Footer to Match Reference Template

The current footer uses a dark background with a simple 3-column layout. The reference image shows a completely different design on the paper/cream background with the newsletter integrated into the footer area.

### What changes

**Footer layout** — Switch from dark `bg-foreground` to light `bg-paper` background. Restructure into:

1. **Top section**: "Transilvania Times" in red decorative serif + red divider line
2. **Middle section** (4 columns on desktop):
   - **Popular Categories** (red heading) — 2-column grid of 8 categories
   - **Contact Us** (red heading) — address with map-pin icon, email with mail icon, phone with phone icon
   - **Accessibility** (red heading) — links to Contact Us, Privacy Policy, 404
   - **Newsletter** (red card) — email input + "Thank you" button, integrated here instead of as a separate section
3. **Bottom bar**: copyright left, social media icons right (Facebook, Twitter, Instagram, GitHub), separated by a red divider line

**Newsletter removal from pages** — Since the newsletter moves into the footer, remove the separate `<Newsletter />` component from all pages (Index, Article, Category, Contact, TermsConditions, PrivacyPolicy).

### Files to modify

| File | Change |
|------|--------|
| `src/components/Footer.tsx` | Full redesign: paper bg, 4-column layout, red headings, integrated newsletter, social icons, new bottom bar |
| `src/components/Newsletter.tsx` | Restyle as an inline card (red bg) for embedding in the footer |
| `src/pages/Index.tsx` | Remove `<Newsletter />` import and usage |
| `src/pages/Article.tsx` | Remove `<Newsletter />` import and usage |
| `src/pages/Category.tsx` | Remove `<Newsletter />` import and usage |
| `src/pages/Contact.tsx` | Remove `<Newsletter />` import and usage |
| `src/pages/TermsConditions.tsx` | Remove `<Newsletter />` import and usage |
| `src/pages/PrivacyPolicy.tsx` | Remove `<Newsletter />` import and usage |
| `src/i18n.ts` | Add translation keys for "Accessibility", social link labels if needed |

### Design details

- Headings use `text-primary` (brand red) with serif font
- Category list in 2-column `grid-cols-2` layout matching the reference
- Contact info items use lucide icons (MapPin, Mail, Phone) in red
- Newsletter card: `bg-primary` with white text, paper-colored input, white "Thank you" button
- Bottom bar: thin red top border, copyright left, 4 social icon buttons right
- All text in espresso/foreground color on paper background

