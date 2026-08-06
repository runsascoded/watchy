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
2. **AR page on the site** ✅ — `/actors` React route over `/api/actors` (filter box, org chips, OA badge, X/LinkedIn/blog links). Compiled in only when `VITE_INTERNAL=1` — the public watchy.rbw.sh bundle omits it entirely.
3. **Auth wall** — following the `$oa/marin-gcs-usage` precedent (gcs.oa.dev): CF Access app in the **Open Athena CF account**, edge-gating the hostname; app code stays coarse (no in-app JWT validation). applitrack's app-level OAuth+roles is more than we need.
   - ✅ CFP project **watchy-internal** created + deployed in the OA account (internal build); `watchy.oa.dev` registered as its custom domain (pending DNS).
   - **Dashboard runbook (RW — deploy token lacks zone + Zero Trust perms)**, OA CF account:
     1. DNS: `oa.dev` zone → add CNAME `watchy` → `watchy-internal.pages.dev`, proxied. (Activates the pending custom domain.)
     2. Zero Trust → Access → Applications → Add self-hosted: name **watchy**, domains `watchy.oa.dev` **and** `watchy-internal.pages.dev` (the pages.dev URL is otherwise publicly reachable), policy = clone of "GCS usage": allow email-domain `openathena.ai` (+ external whitelist as needed).
   - ⚠️ Until step 2, `watchy-internal.pages.dev` is up and ungated (obscure URL, public-GH data only — but do the Access app promptly).
   - Public watchy.rbw.sh keeps feed/health/icons; AR (and later summaries) internal-only.
4. **Plots** — `/api/counts` already exists; add a time-series chart page (star-history style) per target + overview.
5. **Weekly summaries** — second cron (Monday AM): Δ per target over the week, new notable actors (by followers), event count → post to Slack + store in D1 `summaries` for the site narrative page. Mechanical first; LLM narrative later.
6. **Deep AR (agentic)** — scheduled Claude routine scoring "prospect interestingness" (GH reach, org signals, web/LinkedIn discovery) writing back into `actors` extra fields; human-reviewable.
