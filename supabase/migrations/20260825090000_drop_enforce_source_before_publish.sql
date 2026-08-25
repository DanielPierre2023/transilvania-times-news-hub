-- 25 Aug 2026 — Remove the mandatory-source publish guard.
--
-- A BEFORE INSERT/UPDATE trigger on blog_posts (trg_enforce_source_before_publish)
-- raised: "Cannot publish blog_posts ... no source recorded (source_url,
-- scraped_article_id and sources[] are all empty). Attach a source before
-- publishing." It was added to force attribution on SCRAPED content, but it
-- also blocked original articles written in the Editor AI, which have no
-- external source. Daniel writes his own articles, so the guard is removed.
--
-- (The trigger was applied directly to the database, not via a prior repo
-- migration; this file records its intentional removal so a rebuild-from-
-- migrations never reintroduces it.)

DROP TRIGGER IF EXISTS trg_enforce_source_before_publish ON public.blog_posts;
DROP FUNCTION IF EXISTS public.enforce_source_before_publish();
