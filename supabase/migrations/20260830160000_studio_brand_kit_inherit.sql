-- Studio: stop duplicating the brand kit's values in SQL.
--
-- WHAT WENT WRONG, AND IT TOOK FOUR HOURS
--
-- 20260830120000 seeded the house kit by writing every value into a
-- jsonb_build_object: the display face, the type scale, the grade, the
-- loudness. lib/brand/kit.ts held the same values in TypeScript.
--
-- Four hours later the code changed — the display face moved from a font the
-- renderer had never heard of to one it actually has, and the weight moved from
-- 700 to 400 because the free bold has no Romanian diacritics. The SQL row did
-- not move, because nothing tells it to.
--
-- The row is loaded over the code defaults, so the stale value wins. The next
-- render of the real film came back with:
--
--   ✕ every typeface the film asks for exists here
--       missing: Playfair Display 700 — rendered in the fallback face
--
-- The font guard caught it, which is what it is for. But the drift should not
-- have been possible.
--
-- THE FIX: the row holds OVERRIDES, not a copy.
--
-- resolveKit() in lib/brand/kit.ts fills every absent field from the house
-- default, so an empty object means "whatever the code says today". A kit row
-- now stores only what someone deliberately changed about it, and the code is
-- the single source of truth for everything else. There is nothing left to go
-- stale.

update public.studio_brand_kits
   set kit = '{}'::jsonb,
       updated_at = now()
 where id = 'tt'
   and kit ? 'type';          -- only the seeded copy; a hand-edited kit is left alone

comment on column public.studio_brand_kits.kit is
  'OVERRIDES ONLY. Absent fields are filled from lib/brand/kit.ts by resolveKit() on read, so the code stays the single source of truth and this column cannot drift away from it. An empty object is a complete, valid kit.';

-- ---------------------------------------------------------------------------
-- Projects saved before today carry a FULL frozen copy of the kit, which is
-- deliberate — an approved film must render next year exactly as it was
-- approved. It also means an old project keeps an old typeface for ever, which
-- is right for an approved version and wrong for one still being edited.
--
-- Nothing is rewritten here: silently changing the brand of a saved project is
-- exactly the behaviour the frozen copy exists to prevent. Studio gains a
-- "reîncarcă" control next to the kit instead, so adopting the current brand is
-- something a person does on purpose.
-- ---------------------------------------------------------------------------
