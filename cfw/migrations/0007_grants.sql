-- Access grants: nonced share-links / magic links for the gated AR surface.
-- Tokens are shown once at mint; only SHA-256 hashes are stored (full-entropy
-- input, so a fast hash is fine). A grant with `email` set is a magic link.
CREATE TABLE grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  email TEXT,
  scopes TEXT NOT NULL DEFAULT 'internal',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0
);
