ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS subcategory text;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS subcategory text;