

## Plan: Contact Page + Remove FAQ + Privacy Policy Link in Footer

Three changes: create the Contact page, remove the FAQ footer link, and add a Privacy Policy link to the footer.

### Files to Create

| File | Purpose |
|------|---------|
| `src/pages/Contact.tsx` | Contact page with info sidebar (address, email, phone) and a functional form (name, email, subject, message) using the site's editorial design tokens |

### Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Add `/contact` route |
| `src/components/Footer.tsx` | Remove FAQ link, add Privacy Policy link |

### Implementation Details

**Contact page** — Two-column layout on desktop (info left, form right), single column on mobile. Left column has address (str. Memorandumului nr 2, Cluj-Napoca), email (needhelp@transilvaniatimes.com, press@transilvaniatimes.com), and phone with lucide icons. Right column has a form with Name, Email, Subject, and Message fields using the site's existing design language. Form uses `useState` for field values and a toast notification on submit. Touch targets are 48px+ for mobile.

**Footer** — Remove the FAQ link, add "Privacy Policy" linking to `/privacy` between "Contact Us" and "Terms & Conditions".

**Privacy page** — Already exists at `src/pages/PrivacyPolicy.tsx` and is routed at `/privacy`. No changes needed.

