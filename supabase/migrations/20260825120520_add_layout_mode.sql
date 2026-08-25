-- 20260825120520_add_layout_mode.sql
--
-- Adds an opt-in per-article layout mode for Birou editorial articles.
--
--   'auto'  → current behaviour: the renderer normalises the body into uniform
--             justified paragraphs (the "fixed pagination"). This is the DEFAULT
--             for every existing row and for every pipeline article
--             (tt-generate-article / tt-process-scraped-article), so their
--             rendering is completely unchanged.
--   'rich'  → the renderer honours editor-authored structure: ## / ### subtitles,
--             > pull-quotes, - / 1. lists and **bold**. Only articles an editor
--             explicitly marks as 'rich' in Birou editorial ever use this path.
--
-- Backfill is intentionally a no-op beyond the default: all 572 existing rows
-- become 'auto' and render byte-identically to before.

-- ── blog_posts (published articles) ────────────────────────────────────────
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS layout_mode text NOT NULL DEFAULT 'auto';

ALTER TABLE public.blog_posts
  DROP CONSTRAINT IF EXISTS blog_posts_layout_mode_check;

ALTER TABLE public.blog_posts
  ADD CONSTRAINT blog_posts_layout_mode_check
  CHECK (layout_mode IN ('auto', 'rich'));

-- ── editor_drafts (Birou editorial working copies) ─────────────────────────
ALTER TABLE public.editor_drafts
  ADD COLUMN IF NOT EXISTS layout_mode text NOT NULL DEFAULT 'auto';

ALTER TABLE public.editor_drafts
  DROP CONSTRAINT IF EXISTS editor_drafts_layout_mode_check;

ALTER TABLE public.editor_drafts
  ADD CONSTRAINT editor_drafts_layout_mode_check
  CHECK (layout_mode IN ('auto', 'rich'));
