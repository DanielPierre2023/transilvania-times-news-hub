// lib/ads.ts
//
// Central AdSense configuration for Transilvania Times.
//
// HOW TO ACTIVATE REAL ADS
// ------------------------
// 1. In the AdSense console (adsense.google.com) go to  Ads → By ad unit →
//    Display ads  and create one unit per placement below (name them like the
//    keys, e.g. "tt-article-bottom"). Format: "Square/Responsive" is fine.
// 2. Copy each unit's `data-ad-slot` number (a ~10-digit number) into the
//    matching entry below and redeploy.
// 3. While an entry is '' the placement renders the in-house SponsorBanner
//    instead, so the layout never breaks and no empty AdSense frame is shown.
//
// NOTE: ads only serve in the EEA after the GDPR consent message is enabled
// in AdSense → Privacy & messaging (Google's certified CMP). See
// README-SEO-ADSENSE.md.

export const ADSENSE_CLIENT = 'ca-pub-5809590003717527'

export const AD_SLOTS = {
  /** Under the article body, after sources/corrections, before "Urmărește-ne". */
  articleBottom: '',
  /** Right-hand article sidebar, under "Cele mai citite". */
  articleSidebar: '',
  /** Under the flight board on /zboruri and /en/zboruri. */
  zboruriBelowBoard: '',
  /** Airport pages (/zboruri/cluj etc.), between the board and the FAQ. */
  airportAboveFaq: '',
} as const

export type AdSlotKey = keyof typeof AD_SLOTS
