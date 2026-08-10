-- Cross-platform reach (specs/actor-intel.md): Bluesky via public.api.bsky.app;
-- x_followers has no automatic source yet (X counts need paid API or local scrape) —
-- column exists so any future source (or manual fill) feeds the ranking.
ALTER TABLE actors ADD COLUMN bsky_handle TEXT;
ALTER TABLE actors ADD COLUMN bsky_followers INTEGER;
ALTER TABLE actors ADD COLUMN x_followers INTEGER;
