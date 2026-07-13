-- Migration number: 0002 	 runs: sweep metadata for /health
ALTER TABLE runs ADD COLUMN full_sweep INTEGER;
ALTER TABLE runs ADD COLUMN n_repos INTEGER;
ALTER TABLE runs ADD COLUMN n_skipped INTEGER;
