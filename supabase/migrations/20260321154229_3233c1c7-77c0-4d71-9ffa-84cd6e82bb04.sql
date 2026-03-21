ALTER TABLE scraped_articles ALTER COLUMN ai_score TYPE real USING ai_score::real;
ALTER TABLE scraped_articles ALTER COLUMN plagiarism_score TYPE real USING plagiarism_score::real;