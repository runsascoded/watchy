-- GH profile enrichment for actors behind posted events (specs/site-ar.md phase 1)
CREATE TABLE actors (
  login TEXT PRIMARY KEY,
  name TEXT,
  company TEXT,
  location TEXT,
  bio TEXT,
  blog TEXT,
  twitter TEXT,
  followers INTEGER,
  following INTEGER,
  public_repos INTEGER,
  gh_created_at TEXT,
  orgs TEXT,             -- JSON array of org logins
  fetched_at TEXT NOT NULL
);
