# Feed: details mode + actor hovercards

The feed is a list of logins; Slack posts show people (avatar, display name). Close the gap on the site — without turning a public page into a directory of the people who engage with the repos.

## The line, and why it's there

`actors` holds two tiers:

- **GitHub-public** — name, company, location, bio, blog, twitter, followers/following, public_repos, orgs, Σ⭐, top repos. Every field is on `github.com/<login>`, which the feed already links to.
- **Derived** — `research` (LLM-written characterization), `bsky_handle`/`bsky_followers`, `x_followers`, `li_url`/`li_company_url`. This is cross-platform linkage *we* assembled, plus generated prose about a person. It stays gated, always.

Even so, the public tier is not automatically publishable: a searchable aggregation of "who engages with our repos, with their employers" differs in kind from GitHub showing one profile, however public each field is. So the split shipped is:

| Viewer | details off | details on |
|---|---|---|
| public | today's feed | **+ avatars** |
| signed in (`internal`) | today's feed | + avatars, display names, hovercard |

Avatars are public because they add no information: the login is already rendered and already links to the profile that shows the same picture. Everything that requires `/api/actors` — the name, the card — requires the scope.

## Implementation

- `?d` (use-prms `boolParam`), alongside `?g` for group-by-repo; also an omnibar action, matching the other filters.
- `components/Avatar.tsx` — `avatars.githubusercontent.com/u/<uid>?s=N`, using the GitHub user id already stored on every event (`events.uid`, already returned by the public `/api/events`), so this needs no new column, no API call, and no stored avatar URL.

  The obvious `github.com/<login>.png` is a **302 to exactly that CDN URL, served `cache-control: no-cache`** — so a 100-row page re-requests ~100 redirects on every single load, and GitHub 503s a share of them. That was the cause of the broken avatars, not a per-image failure. The CDN URL skips the redirect and is a plain cacheable asset (`max-age=300`). Fall back to the login URL when `uid` is null (possible on backfilled `git` events; currently 0 of the last 100).

  `onError` still sets `visibility: hidden` rather than removing the node — a removed node reflows the row's text, and the reflow is more distracting than the gap.
- `components/ActorCard.tsx` — lifted verbatim out of `pages/Actors.tsx`, which already hovercarded it on the actors table. Public tier only, which is what makes it safe to reuse anywhere a viewer may see actors at all.
- `Actor`/`ActorEvent` moved `pages/Actors.tsx` → `api.ts`, so a shared component doesn't import types from a page.
- The actors query is `enabled: details && INTERNAL && !!whoami` — a signed-out visitor never issues the gated request, so the wall is never the mechanism, absence of the request is.
- **`GET /api/actors/cards?logins=…`** (gated `internal`) backs the names and cards, *not* `/api/actors`.

  The first cut reused `/api/actors`, and most rows still showed a bare login: that endpoint serves the actors *table*, so it's `ORDER BY followers DESC LIMIT 500`. 2064 logins qualify, so anyone below rank 500 (the cutoff sits at 76 followers) was simply absent from the response — `eric-czech` at rank 766 and `dchu917` at 1375 both have names in `actors`, they just never reached the client. Raising the limit would have meant shipping 2000 full rows — derived tier, research prose, and every posted event per actor — to label 100 feed lines.

  `cards` takes an explicit login list and returns only the eight fields `ActorCard` renders. `ActorCardFields = Pick<Actor, …>` in `api.ts` keeps one card component for both callers, and means the gated derived tier is absent from the response by *type*, not by discipline.
- The query key is the sorted login set of the loaded pages, so paging in refetches a superset; `placeholderData: keepPreviousData` holds the resolved names on screen rather than flashing back to logins while it does.

## Verified

Public path, live: avatars render at line height, and a failed image hides cleanly instead of showing a broken-image glyph (seen with real 503s from the pre-CDN URL form).

Signed-in path, live on `gh.oa.dev`: names resolve for every feed row that has one — which is what surfaced the top-500 truncation above.

Name coverage in the DB (2026-08-18): 2064 distinct event logins, all 2064 with `actors` rows, 1761 (85%) with a GitHub display name. The remaining 15% have no name set on their profile and fall back to the login via `a.name ?? e.login`.

## Deferred

- Density: details mode currently only adds an avatar + name. "Closer to the Slack message" could also mean the target's org icon, or a second line — worth revisiting once it's been lived with.
- The card could carry the derived tier for admins (research prose, cross-platform reach). Deliberately not shipped: the same component rendering different fields per viewer is exactly how a gated field leaks into a public page.
