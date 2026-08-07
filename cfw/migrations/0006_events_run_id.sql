-- Link events to the collection run that observed them (richer run tooltips; null for pre-existing rows)
ALTER TABLE events ADD COLUMN run_id INTEGER;
