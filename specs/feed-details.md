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

## Verified

Public path, live: avatars render at line height, and a failed image hides cleanly instead of showing a broken-image glyph (seen with real 503s from the pre-CDN URL form). The signed-in path (names + card) is unexercised end-to-end — it needs a CF Access login — but `ActorCard` is the same component already rendering on the Actors page.

## Deferred

- Density: details mode currently only adds an avatar + name. "Closer to the Slack message" could also mean the target's org icon, or a second line — worth revisiting once it's been lived with.
- The card could carry the derived tier for admins (research prose, cross-platform reach). Deliberately not shipped: the same component rendering different fields per viewer is exactly how a gated field leaks into a public page.
