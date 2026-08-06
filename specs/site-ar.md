# Internal watchy site: actor research (AR), plots, weekly summaries

Vision (RW, 2026-08-07): an auth-walled variant of watchy.rbw.sh — same event feed as the Slack channel, plus an AR listing (recruiting-oriented, for Yael/Jeff), star/follower graphs over time, and recent weekly summaries. AR rows link out to Twitter/LinkedIn where derivable.

## Feasibility notes (socials)

- **Twitter/X**: handle comes free from the GH profile (`twitter_username`) → link out. Follower counts require the paid X API — not worth it; link-only.
- **LinkedIn**: no public API for arbitrary-person lookup. v1: prefilled people-search link (`linkedin.com/search/results/people/?keywords=<name>`) — when Yael/Jeff click through logged-in, LinkedIn itself shows mutual connections, which beats anything we could compute. Later: agentic enrichment (Claude + web search) proposing profile URLs into a reviewable field.
- **Mutuals we *can* compute**: GH-side — which OA members follow / are followed by the actor (`/users/{login}/following` ∩ org members etc.). Cheap and genuinely useful.

## Phases

1. **`actors` table + worker enrichment + `/api/actors`** ✅ (this commit)
   - D1 `actors`: GH profile fields + `orgs` (JSON) + `fetched_at`.
   - Each cron tick enriches ≤10 posted-event actors lacking a fresh row (2 GH calls each; 30-day refresh). Backfills gradually; bootstrap-imported the 262 June+ actors.
   - `/api/actors`: actors joined with posted-event counts/latest, follower-sorted.
2. **AR page on the site** — port the artifact table to a React route reading `/api/actors` (+ twitter/linkedin links, GH-mutuals column). Hold behind phase 3 — don't ship recruit-scouting UI on the public host.
3. **Auth wall** — Cloudflare Access (Zero Trust) in front of a new hostname, allowlist `@openathena.ai` (email OTP or Google SSO; free tier covers this).
   - **Open decisions (RW)**: hostname + zone (`watchy.openathena.ai`? is `oa.dev` owned?); which CF account carries the zone/Access (org's, presumably, vs personal where watchy currently lives).
   - Public watchy.rbw.sh keeps feed/health/icons; AR (and maybe summaries) internal-only.
4. **Plots** — `/api/counts` already exists; add a time-series chart page (star-history style) per target + overview.
5. **Weekly summaries** — second cron (Monday AM): Δ per target over the week, new notable actors (by followers), event count → post to Slack + store in D1 `summaries` for the site narrative page. Mechanical first; LLM narrative later.
6. **Deep AR (agentic)** — scheduled Claude routine scoring "prospect interestingness" (GH reach, org signals, web/LinkedIn discovery) writing back into `actors` extra fields; human-reviewable.
