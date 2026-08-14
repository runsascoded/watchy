# Omnibar: user-filtered feed views (backburner)

Done (2026-08-13): Feed's filter dropdowns (kinds, targets, group-by-repo) register as `use-kbd` actions while Feed is mounted — searchable via omnibar/⌘K.

Backburnered (RW, 2026-08-13, "wholly-new-features enough"):

- **All mentioned users as omnibar entries** → selecting one applies a login-filtered feed view (the `?l=` filter already exists; the entry set is every distinct `login` in events — thousands, so this wants `useOmnibarEndpoint` (async query against `/api/events?login=`-style search or a new `/api/logins` endpoint) rather than eagerly-registered actions).
- **Users by org membership**: actors enrichment already stores `orgs` (see `isInsider` in `Actors.tsx`) — group omnibar entries / feed views by org (e.g. "Stanford folks", "OA members"), or a `?org=` feed filter resolved through the actors table. Ties into the `/actors/og` OA-employees-card idea (specs/og-routes.md).
