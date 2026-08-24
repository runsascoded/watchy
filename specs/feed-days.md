# Feed: day summaries + collapse

A 200-star day buries the days around it. Scrolling past 200 lines to learn it was "181 ⭐ on marin" is the wrong way to find that out, and there was no way to skip it.

The day's rule already existed as a heading. It now carries the day's numbers and doubles as the fold control.

## The header states a fact about the day

Which is why the numbers come from the server. Computing them from the loaded events made the header lie the moment a day outgrew a page: with `PAGE = 100` the 8/24 header read `89 ⭐` while the day was at 181.

`GET /api/days` groups `events` by `(day, kind, target)`, with a second pass for `COUNT(DISTINCT login)` — that one can't be summed across the cells. Filters come from `eventFilters`, shared with `/api/events`, so the header always describes exactly the rows underneath it.

Rows are one per day×kind×target — a few hundred for the whole history — so it's one cached query, not a per-day fetch.

## Stats suppress themselves

Every bit has to earn its place, or the header becomes noise on the 90% of days with two events:

| bit | shown when |
|---|---|
| `N ⭐️ · N 💔 · N 🔔 · N 🔕` | always (kinds present, in that order) |
| `N actors` | fewer actors than events — i.e. somebody acted twice |
| `marin 181 · … · +2 more` | more than one target, and not under group-by-repo (the `h3`s already say it) |
| the whole line | day has >2 events — **or** is collapsed, since then nothing else is on screen |

Ties among targets break by name, so equal counts don't reorder between renders.

## Collapse

Days default open (the alternative auto-collapses a day you were reading, on reload). `?c=2026-08-24,2026-08-23` records only what's *folded*, so the empty param is the default view and a shared link carries your folds. Omnibar gets collapse-all / expand-all.

The load-more `IntersectionObserver` is re-armed per page rather than observed once: it only fires on intersection *change*, so a page that doesn't grow past the sentinel leaves it silently intersecting and paging stops. With days collapsed, that's the normal case — the page barely grows. It terminates when the accumulated headers finally push the sentinel out of range.

## Tested

`www` had no tests at all before this; it has vitest + testing-library now. `test/DayHeader.test.tsx` specs the table above as rendered output, including the regression itself (a rollup of 180 rendering as 180 regardless of what's on screen), and `test/Avatar.test.tsx` pins CDN-by-uid.

Not covered by unit tests, and worth an e2e layer if this grows: the collapse→URL→reload round trip, and that auto-paging actually resumes. Automated-browser verification of the latter is blocked by Chrome suspending `IntersectionObserver` in a hidden tab, which a real Playwright run (foregrounded, or headless-with-visible-viewport) would not hit.
