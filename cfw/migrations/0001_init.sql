-- Migration number: 0001 	 init: state, events, counts, runs

-- Current state (what we diff new polls against)
CREATE TABLE stars (
  repo       TEXT NOT NULL,             -- "owner/name"
  uid        INTEGER NOT NULL,          -- GitHub user id (rename-proof)
  login      TEXT NOT NULL,             -- login at last observation
  starred_at TEXT,                      -- from star+json accept header
  PRIMARY KEY (repo, uid)
);

CREATE TABLE follows (
  target TEXT NOT NULL,                 -- followed user/org
  uid    INTEGER NOT NULL,
  login  TEXT NOT NULL,
  PRIMARY KEY (target, uid)
);

-- Append-only ledger
CREATE TABLE events (
  id     INTEGER PRIMARY KEY,
  ts     TEXT NOT NULL,                 -- starred_at for 'star' (when available), else observation time
  kind   TEXT NOT NULL CHECK (kind IN ('star','unstar','follow','unfollow')),
  target TEXT NOT NULL,                 -- "owner/repo" for star kinds, user/org for follow kinds
  uid    INTEGER,                       -- NULL for git-backfilled logins that no longer resolve
  login  TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'live',  -- 'live' | 'git' (backfill)
  sha    TEXT                           -- .watchy commit sha, backfill provenance only
);
CREATE INDEX events_ts ON events (ts);
CREATE INDEX events_target_ts ON events (target, ts);

-- Per-repo star counts observed on each run (cheap: comes free with repo listing)
CREATE TABLE counts (
  ts     TEXT NOT NULL,
  target TEXT NOT NULL,
  count  INTEGER NOT NULL,
  PRIMARY KEY (target, ts)
);

-- Heartbeat / run history (backs /api/status + dead-man's switch + alert state)
CREATE TABLE runs (
  id          INTEGER PRIMARY KEY,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  ok          INTEGER,                  -- 1/0
  n_events    INTEGER,
  error       TEXT,
  alerted     INTEGER NOT NULL DEFAULT 0  -- 1 if a Pushover alert was sent for this run
);
