

## Plan: Comment Section + Social Share Suite + SEO Tags

### 1. ShareSuite Component (`src/components/ShareSuite.tsx`)

Create a reusable sharing component with two modes:
- **Editorial row** (desktop): Minimalist espresso-colored icon row placed under the byline
- **Sticky mobile dock**: Fixed bottom bar on mobile only with `backdrop-blur`

Includes Facebook, X/Twitter, LinkedIn, WhatsApp share links + native `navigator.share()` button. Uses `lucide-react` icons (already installed). Colors use existing Tailwind tokens (`espresso`, `clay`, `brand-red`, `action-orange`).

### 2. Comment Section (`src/components/CommentSection.tsx`)

Build a comment engine using the existing `blog_comments` table (already has RLS policies for public insert + admin management) and the `blog_comments_public` secure view for reading approved comments.

- **Comment form**: Name, email (optional), comment text. Inserts into `blog_comments` with `status: 'pending'`
- **Comment list**: Reads from `blog_comments_public` view (excludes email, only approved). Shows author name, date, content, and AI reply if present
- **i18n support**: Bilingual labels for EN/RO
- Triggers AI auto-reply via `ai-comment-reply` edge function on submit (fire-and-forget, admin approves later)

### 3. SEO Tags Display

Add visual tag pills at the bottom of articles. For static articles, derive tags from category/slug. For blog posts, use the `tags` array from the DB.

### 4. Open Graph Meta Tags

Enhance `ArticleSEO.tsx` to inject OG meta tags (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`) for social sharing previews. Add `twitter:card` meta tags.

### 5. Integration into Article Pages

| File | Changes |
|------|---------|
| `src/components/ShareSuite.tsx` | **New** — sharing component |
| `src/components/CommentSection.tsx` | **New** — comment engine |
| `src/pages/Article.tsx` | Add ShareSuite (editorial row after byline + sticky mobile), CommentSection before footer, SEO tags |
| `src/pages/BlogPost.tsx` | Add ShareSuite, CommentSection, SEO tags display |
| `src/components/ArticleSEO.tsx` | Add OG + Twitter Card meta tags |
| `src/i18n.ts` | Add comment-related translation keys (`comments_title`, `comments_name`, `comments_email`, `comments_placeholder`, `comments_submit`, `comments_pending`, `comments_none`, `share_label`) |

### Comment Flow

```text
User submits comment → INSERT into blog_comments (status: pending)
                     → Fire ai-comment-reply edge function (generates AI reply)
                     → Admin sees in CommentsManager → Approves
                     → Comment + AI reply visible via blog_comments_public view
```

### Design Notes

- Share icons use `espresso` outline style by default, colored bg on hover — matches editorial aesthetic
- Sticky mobile dock uses `animate-slide-up` (already defined in `index.css`)
- Comment section uses `border-t-2 border-espresso` separator, serif italic heading
- No external dependencies needed — all icons from `lucide-react`, all data from Supabase

