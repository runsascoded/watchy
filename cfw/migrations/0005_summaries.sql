-- Weekly summary posts (specs/site-ar.md phase 5)
CREATE TABLE summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL UNIQUE,  -- ISO date of the 7-day window's start
  created_at TEXT NOT NULL,
  text TEXT NOT NULL,               -- Slack mrkdwn as posted
  stats TEXT NOT NULL,              -- JSON: per-target deltas + notables
  slack_ts TEXT                     -- null if posting failed/disabled
);
