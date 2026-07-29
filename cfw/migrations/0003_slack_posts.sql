-- Ledger of events the worker has posted (or should never post) to Slack.
-- ts = Slack message ts; NULL for rows seeded at cutover (posted by the CLI
-- backfill, or pre-cutover events intentionally never posted).
CREATE TABLE slack_posts (
  event_id INTEGER PRIMARY KEY REFERENCES events(id),
  ts TEXT
);
