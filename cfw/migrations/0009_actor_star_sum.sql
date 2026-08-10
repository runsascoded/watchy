-- Σ stargazers across the actor's owned repos (first 200 by name — see enrichActors).
-- NULL = not yet fetched; existing rows re-enrich gradually via the star_sum IS NULL predicate.
ALTER TABLE actors ADD COLUMN star_sum INTEGER;
