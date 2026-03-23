const SUPABASE_STORAGE_PREFIX = 'https://zimpimoierpsocnmnizm.supabase.co/storage/v1/object/public/'

const UNSPLASH_CATEGORY_QUERIES: Record<string, string> = {
  news:        'breaking news journalism',
  politics:    'romanian parliament politics government',
  technology:  'technology innovation digital',
  business:    'business economy finance market',
  culture:     'art culture museum architecture',
  travel:      'transylvania romania landscape travel',
  education:   'education school university students',
  sports:      'sports athletics competition',
  health:      'healthcare medicine hospital',
  opinion:     'journalism writing editorial',
}

/**
 * Build a high-quality editorial image prompt from article metadata.
 * Designed for photojournalistic, NYT-style imagery.
 */
export function buildImagePrompt(title: string, category: string, county?: string): string {
  const locationContext = county ? `in ${county}, Transylvania, Romania` : 'in Transylvania, Romania'

  return [
    'Photojournalistic editorial photograph',
    'documentary style',
    'no text overlay',
    'no watermarks',
    'no logos',
    `Subject inspired by: ${title}`,
    locationContext,
    `Editorial category: ${category}`,
    'Style: New York Times front page photography',
    'high resolution',
    'natural lighting',
    'emotionally resonant',
    'color grading: muted desaturated tones',
  ].join(', ')
}

/**
 * Generate image via Pollinations.ai (free, no API key needed).
 * Returns a direct URL — Pollinations serves the image at the URL itself.
 */
export async function generateViaPollinationsAI(
  prompt: string,
  width = 1200,
  height = 630
): Promise<string | null> {
  try {
    const encodedPrompt = encodeURIComponent(prompt)
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&enhance=true&model=flux`

    // Test that Pollinations responds (HEAD request to avoid downloading)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (res.ok) return url
    return null
  } catch {
    return null
  }
}

/**
 * Fetch a relevant photo from Unsplash (free, no API key for basic usage).
 * Uses the public source API — no auth required.
 */
export async function generateViaUnsplash(
  category: string,
  keywords: string[] = []
): Promise<string | null> {
  try {
    const baseQuery = UNSPLASH_CATEGORY_QUERIES[category] || 'transylvania romania news'
    const extraKeywords = keywords.slice(0, 2).join(' ')
    const query = `${baseQuery} ${extraKeywords}`.trim()
    const encoded = encodeURIComponent(query)

    // Unsplash Source API — returns a redirect to a random matching photo
    // 1200x630 = standard OG image ratio
    const url = `https://source.unsplash.com/1200x630/?${encoded}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
    })

    clearTimeout(timeout)

    // Unsplash redirects to the actual image — get the final URL
    if (res.ok && res.url && res.url.includes('images.unsplash.com')) {
      return res.url
    }

    // Return the source URL as fallback — it will still work in <img>
    if (res.ok) return url
    return null
  } catch {
    return null
  }
}

/**
 * Main entry point — tiered image generation with automatic fallback.
 *
 * Tier 1: Pollinations.ai (free, AI-generated, editorial quality)
 * Tier 2: Unsplash (free, real photography, keyword-matched)
 *
 * Returns the image URL, or null if both services fail.
 */
export async function generateArticleImage(
  title: string,
  category: string,
  county?: string,
  tags?: string[]
): Promise<{ url: string; source: 'pollinations' | 'unsplash' } | null> {
  const prompt = buildImagePrompt(title, category, county)

  // Tier 1 — Pollinations AI
  const pollinationsUrl = await generateViaPollinationsAI(prompt)
  if (pollinationsUrl) {
    return { url: pollinationsUrl, source: 'pollinations' }
  }

  // Tier 2 — Unsplash
  const unsplashUrl = await generateViaUnsplash(category, tags)
  if (unsplashUrl) {
    return { url: unsplashUrl, source: 'unsplash' }
  }

  return null
}
