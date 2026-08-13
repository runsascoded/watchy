# Per-route OG metadata + dynamic OG images

Backlog (RW, 2026-08-13). Today each instance has exactly one set of OG tags + one `og.jpg` (global, in `index.html`): opengraph.xyz on `gh.oa.dev/actors` shows the homepage card, generic title, no per-page description. Also flagged: title/description could use more SERP meat, `twitter:card` missing.

## Per-route OG pages: the `/<page>/og` pattern

Generalize the existing `/og` route (chrome-less 1200×630 render, screenshotted to `public/og.jpg`): each page that wants its own card gets a sibling `/<page>/og` render route, e.g.:

- `/actors/og` — stylized slice of the actors table. The OGI AR (1200×630 ≈ 1.9:1) suits "a few rows × lots of cols" — arguably a *nicer* view than the page itself. On `oa`: something cute like the table filtered to OA employees (`SLACK_USER_MAP` keys ≈ the org's known logins).
- `/og` (homepage) — should show a recent stylized rendering of the actual feed (not just star curves), so the card is alive.

## Per-route OG *tags* (SPA constraint)

One `index.html` serves every route, so per-route tags need edge injection: the worker already fronts assets (`run_worker_first`) — add an HTMLRewriter pass that swaps `og:title`/`og:description`/`og:image` by pathname (crawlers don't run JS; the SPA title effect isn't enough). Also add `twitter:card: summary_large_image` + a `<meta name="description">`.

## Dynamic OGI

Options, roughly in order of increasing freshness/effort:

1. **Snapshot on deploy** (sq++): `deploy-www.sh` runs the scrns capture before building — one-off, no infra.
2. **Daily re-render cron**: CF Browser Rendering (puppeteer binding, available on Workers Paid) screenshots `/<page>/og` on a cron, writes to R2/KV; `og:image` URLs point at a worker route serving the latest capture.
3. **Request-time edge render**: `workers-og`-style (Satori + resvg WASM) — generate the PNG from live D1 data per request (cached), no browser at all. Most "dynamic OGI" projects land here; layout is authored as JSX-ish templates rather than reusing the real page CSS, so the `/…/og` React routes stay the source of truth for look-dev and option 2/3 mimic them.

Start with 1 (or stay with manual capture) for `/actors/og`; graduate the homepage card to 2 or 3 when it should track the live feed.
