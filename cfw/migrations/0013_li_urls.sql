-- Curated LinkedIn URLs: enrichment can't reliably find these (blog-field
-- linkedin.com/in/… detection aside, LI blocks scraping), so they're filled in
-- manually / by future LLM-judged lookup. Renderers prefer them over blind
-- LI people/company searches.
ALTER TABLE actors ADD COLUMN li_url TEXT;
ALTER TABLE actors ADD COLUMN li_company_url TEXT;
