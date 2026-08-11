# Actor intel: feed org-icons, actions on /actors, agent digest, threaded Slack replies

RW asks (2026-08-09), in one batch:

1. **Feed grouped headers**: org name is low-info skim-matter — replace with the org's avatar icon; repo short-name is generally unambiguous.
2. **/actors**: make it clearer *what actions* each notable person took, and *when*. Plus an agent-digestible summary of "recent" (last 6mo / '26 YTD) high-profile actors, for Jeff/Yael's agents to feed into applitrack.
3. **Weekly summary**: OA members (Alex, Ryan…) aren't notable "new actors" on our own repos — omit them.
4. **Per-event Slack msgs are low-info**: add threaded replies with interesting actor bits. Optionally invoke Claude to research each actor as actions come in (RW leans per-event over weekly-only) — leverages Slack threading, currently unused.
5. **Link out to the dashboard more prominently** from event msgs, rather than denorming ever more world-state into each message.

## Design

### 1. Feed org icons (`www/src/target.tsx`)

`TargetLink` renders `https://github.com/<org>.png?size=40` (GitHub redirects to the org/user avatar) + the repo short-name; full `org/repo` in the tooltip. Used in grouped `?g` headers, inline feed lines, and the /actors actions column. Org-only targets (follows) show icon + org name.

### 2. Actions + digest (worker + FE)

- `/api/actors` now attaches `events: [{ts, kind, target}]` per actor (one extra query over the ~3k posted events; grouped in-memory).
- `/actors` table: "actions" column renders each event as kind-emoji + `TargetLink` + date (capped at 8, "+n more" beyond); replaces the bare "latest" column.
- **`/api/actors/summary`** (gated `internal`, so agents authenticate with a grant token via `Authorization: Bearer` — mint one at `/access`):
  - Params: `months` (default 6), `since` (ISO date, overrides months), `min_followers` (default 100), `limit` (default 100), `format=md|json` (default json).
  - Excludes OA members (org membership or company matching open…athena), i.e. prospects only.
  - JSON: `{since, min_followers, generated_at, n, actors: [{login, name, company, location, bio, blog, twitter, followers, orgs, events: [...]}]}`.
  - `format=md`: compact markdown, one section per actor — name/login/followers, company · location, bio, links, event bullets ("starred marin-community/marin · 2026-08-09").

### 3. Weekly summary notables: OA exclusion

`buildWeekStats` notables query adds `orgs NOT LIKE '%"Open-Athena"%'` and `company NOT LIKE '%open%athena%'` (catches `@Open-Athena` and `Open Athena` company strings).

### 4. Threaded actor-bits replies (+ optional Claude research)

- Migration `0008_actor_research.sql`: `slack_posts.reply_ts` (NULL = unprocessed, `''` = processed-no-reply), `actors.research`, `actors.research_at`.
- `syncActorReplies(env)` (slack.ts), run each tick after `enrichActors`: for posted events whose actor row is enriched, post one threaded reply (`thread_ts` = parent's `slack_posts.ts`) with profile bits: name · company · location · followers/repos/joined · orgs · bio · links (𝕏/blog) · dashboard link. Low-info actors (no name/company/bio and < 50 followers) get the `''` sentinel — no noise reply. Caps + 1s pacing like `syncSlack`.
- **Claude research** (`researchActor`, actors.ts): when `ANTHROPIC_API_KEY` (worker secret) is set, actors with `followers ≥ RESEARCH_MIN_FOLLOWERS` (var, default 100) get a one-time web-searched 2-3 sentence "who is this + why they might matter to OA" blurb (claude-sonnet-5 + web_search tool), cached in `actors.research` — so an actor starring 5 repos is researched once, not 5×. Replies for research-eligible actors defer until research lands (next tick) when the key is configured; without the key, everything degrades to profile-bits-only.

### 5. Dashboard links

- `DASHBOARD_URL` var (`https://watchy.oa.dev` — Slack audience is OA; the site is public with AR gated, so links work for everyone).
- Event msgs: running-total suffix (`1,248 :star:`) becomes a link to the dashboard feed filtered to the target (`/?t=<target>`); state stays in the dashboard, msg stays lean.
- Weekly summary: footer line linking the dashboard + /actors.
- Threaded replies: trailing link to `/actors`.

## v2 — /actors interest ranking (RW feedback 2026-08-10)

Feedback: table too x-scrolly; JOINED/REPOS ~irrelevant; want following count (weed out follow-spammers), "total stars on their repos", churn-awareness (XiaomingX follow+unfollow ×2 ⇒ uninteresting), and recency weighted so "norvig starred marin ~1mo ago" tops a simple ranking. Wide viewports should get a wider table.

- **Interest score** (FE + digest, same formula): `log10(1+followers) × followers/(followers+following) × √(Σ 2^(−age/hl))` over **still-active** star/follow events. One knob: `?hl=` half-life days (default 60) — the fame-vs-recency dial. √ tempers many-small-events vs one-famous-star; churned events (event's star/follow no longer in current state, per new `active` flag from `postedEventsByLogin`) contribute 0. Result: t11s 3.4, norvig 3.0, Helw150 2.5 top the board.
- **Insiders hidden by default** on /actors (`?oa` toggle): Open-Athena *or marin-community* org members, or company matching open…athena (marin-community added after Helw150/Will Held — Marin contributor, not in the OA org — topped the prospect list). Same exclusion in the digest and weekly notables.
- **Columns**: actor (login/name/company·location stacked) · interest · flw/ing · Σ⭐ · actions (churned struck-through) · orgs (≤4 + "+n") · links · bio. JOINED/REPOS dropped.
- **`star_sum`** (migration 0009): Σ stargazers over owned repos (≤200, GH can't sort repos by stars); enrichment re-sweeps existing actors via `star_sum IS NULL` predicate (~8h at 10/tick). "Repos with ≥write access" isn't publicly computable (collaborator lists need push access) — owned repos is the proxy. Enrichment upsert now preserves `research` columns (was INSERT OR REPLACE).
- **Digest**: ranks the full eligible set by the same score (60d) before `limit`; entries carry `interest`, `following`, and "(no longer active)" event annotations.
- **Wide VP**: `.layout:has(.actors) { max-width: 96rem }`.

## v3 — cross-platform reach (RW, 2026-08-10)

- **X follower counts**: browser-visible but not worker-fetchable — the no-JS HTML has no counts (only bio in `og:description`; browsers get them via authed/guest-token GraphQL), syndication endpoint dead. Options if wanted later: paid API (Basic ~$200/mo) or periodic local headless scrape. `actors.x_followers` column exists (migration 0010) so any source can feed it; ranking uses it when present.
- **Bluesky**: fully open API (`public.api.bsky.app`). `findBsky` (worker + backfill script) matches conservatively: handle guesses `{twitter}.bsky.social` / `{login}.bsky.social`, then `searchActors` requiring an exact display-name match. Stores `bsky_handle` + `bsky_followers`; 🦋 link on /actors (follower count in tooltip), bsky line in digest.
- **Fame is now log10(1 + GH + bsky + X followers)** (FE + digest); the spam ratio stays GH-only.
- **`scripts/enrich-backfill.py`**: one-off local backfill (gh CLI + bsky public API → batched D1 UPDATEs) for `following`/`star_sum`/bsky on existing actors — bypasses the worker's 10-actors-per-tick cadence (which exists to bound per-cron-invocation GH subrequests; ~500 actors would otherwise take ~8h).

## v4 — TTs, sort/scoring controls, actor-voiced replies, short OP links (RW, 2026-08-10)

- **/actors**: floating-ui `Tooltip` component (`components/Tooltip.tsx`, shared `.tt` styling) replaces native titles — interest cells get a per-actor breakdown (fame/ratio/recency with numbers), headers, event rows (kind + full ts + churn), orgs "+n", 🦋 (bsky count). Follow-up sweep converted the stragglers (`TargetLink`, feed ts/source, Access, Graphs legend, Icons) — no native `title=` left.
- **Thread replies include `star_sum`** ("8,306 :star: on their repos") in the stats line — it's computed, not a GH profile field: Σ `stargazers_count` over the repo listing.
- **Sort/scoring controls** (all URL-prm'd): `s` = interest | recent-action (exact rev-chron by newest eligible event), `hl` half-life days input, `w` window days (0 = ∞; only actions newer than this count toward score/recent). Rev-chron ≈ the hl→0 limit of the score, but floats underflow there — `sort=recent` is the robust special case.
- **Thread replies speak as the actor**: `chat.postMessage` `username` = GH name (fallback login) + `icon_url` = their GH avatar; the bold name line dropped from the body (redundant with author).
- **Event msgs**: target link text is now the repo short-name (org identity rides on the per-message avatar); optional `:org:` workspace-emoji prefix outside the link via `SLACK_ORG_EMOJI` var (empty until emojis are uploaded to the workspace — else Slack shows literal shortcodes). Python mirror (`src/watchy/slack.py render_event`) updated for byte-parity incl. dashboard-link + emoji params.

## v5 — hovercards + actor-voiced-OP experiment (RW, 2026-08-10)

- **Links col TTs**: "@handle on X", "handle on Bluesky · N followers", "Name on LinkedIn (prefilled people-search)", blog host.
- **`ActorCard` hovercard** on /actors logins — GH-hovercard-style (avatar, name·login, company·location, followers/following/Σ⭐, bio), built entirely from enrichment data (no OG fetching; a worker-side OG proxy would be needed for LinkedIn/X/blog previews — deferred). `TargetLink` tip upgraded to icon + full name.
- **Actor-voiced OP demo** (event 3095, manual post; worker unchanged pending verdict): sender = "Naveen Nagarajan ⭐'d marin" + GH avatar; body = stats (`6 followers · 79 repos (3 ⭐) · joined 2014`) / links (gh · 🦋 · LinkedIn) / event ref (repo · ts · running-total→dashboard); no thread reply. Ledger repointed (`ts` updated, `reply_ts=''`). If adopted: `syncSlack` posts this shape directly and `syncActorReplies` retires.

## v6 — actor-voiced OPs adopted (RW, 2026-08-10)

Demo approved → production format. Every event message now *is* the actor:

- **Sender**: `<name|login> <verb-emoji> <target-short> — M/D HH:MMZ` (e.g. `Naveen Nagarajan ⭐'d marin — 8/10 22:46Z`; literal emoji — usernames don't render shortcodes; falls back to login if > 80 chars). Icon = actor's GH avatar (displacing the org/kind icons; kind now rides the sender verb: ⭐'d / 💔 un-⭐'d / 📣 followed / 🔇 unfollowed).
- **Body**: L1 `<gh|login> [(@slack)] · N followers · M repos (K :star:) · joined YYYY · :bsky: <N> · 𝕏 <@h> · :linkedin: <search>`; then company·location / `_bio_` / orgs / 🌐 blog / :mag: research as available; last line = event ref `<repo|short> · <dashboard|total unit>` (dt lives in the sender now). Low-info actors: event-ref line only, login-voiced.
- **Pipeline reorder**: `enrichActors` → `researchActors` → `syncSlack` (OPs embed the bits, so posting *waits*: missing actor row or pending research for a notable actor stops the batch — chronology preserved, delay ≤ 1 tick). `enrichActors` now covers all-event actors (dropped the posted-only join — chicken-and-egg otherwise); `researchActors` keys on unposted matching events.
- **Retired**: `syncActorReplies`/`renderActorReply` (threads gone); `iconUrl` no longer used for event posts (kept for py parity/bootstrap); `slack_posts.reply_ts` is historical.
- `renderEvent` retained for the py-bootstrap parity contract only.

## v7 — de-clutter (RW, 2026-08-11)

- **No dt in the sender line**: date is implied by the post date; with the cron tightened `*/10` → `*/5` the Slack post ts is within ~5min of the action ts, so the exact time goes too. (Cost check: a normal tick is ~16-25 GH subrequests — count-delta gate means stargazer pages only fetch on change — so 288 ticks/day is far under GH's 5k/hr; CF cron invocations are ~free.)
- **LinkedIn search gated on a real full name** (≥2 tokens): `keywords=imrobot` / `keywords=Denis` searches return junk — worse than no link. Handle-like and single-token names now get no LI link. Deferred: when `ANTHROPIC_API_KEY` lands, the research agent could return a *judged* LI profile URL (structured output) instead of the blind search link.
- **"0 repos" kept** — it's signal (throwaway/new account).

### Open (discussed, not built): weekly-thread channel structure

RW: per-event OPs are voluminous/low-signal for channel members' unread badges. Proposal: a "Week of M/D" OP each week; the same actor-voiced posts become thread replies (no channel-level notification unless following the thread); a post-hoc weekly summary (Tues AM, covering prior 7d) becomes the higher-signal OP — possibly with color replies highlighting notable actors, before/after star counts, plot graphics. Workshop in a private staging channel first (couple of people are in #github-engagement now).

Staging: private `#watchy-staging` (`C0BPFJS550A`, created via Slack MCP — bot token lacks `groups:write`; bot + RW members).

Demo v2 (2026-08-11, after RW feedback on v1's mixed-format replay): OP = repo-grouped WTD scoreboard, sender "📅 Week of 8/10" + `:date:` icon (no watchy branding), lines `:org: <repo> · base → <dash|current :unit:>`; replies = per-action verbose append-log, all 16 events re-rendered via production `renderActorOp` (`tmp/render-week.mts` → `tmp/weekly-demo-v2.py`). In prod the OP would be `chat.update`'d on each action (edits don't notify — replies notify thread followers only). Workspace already has `:marin:`/`:marin-community:`/`:open-athena:`/`:oa:` emojis, so `SLACK_ORG_EMOJI` can be populated now.

## v8 — msg refinements from staging demo v2 (RW, 2026-08-11)

All in production `renderActorOp`/`syncSlack` (deployed; staging demo v3 shows them on this week's events):

- **Sender verbs tenseless, emoji-only**: `star ⭐ / unstar 💔 / follow 🔔 / unfollow 🔕` ("user ⭐ repo"); 🔔/🔕 = subscribe/mute (replacing 📣/🔇 — alternates considered: ➕/➖, 👀).
- **B2b combining**: consecutive same-actor events in a batch merge into one message — sender `mearcstapa-gqz ⭐ marin, 🔔 marin-community`, one event-ref line each; ledger rows share the post ts. `renderActorOp` now takes `(events[], actor, opts)` (opts: counts[], slackUser, dashboardUrl, orgEmoji map).
- **LI profile detection**: a `linkedin.com/in/…` blog renders as `:linkedin: <url|slug>` in the socials slot, suppressing both the blind people-search and the redundant blog entry.
- **Employer links**: company → LI *company* search; `@Org`-style companies → GH org page.
- **Bold notables**: followers ≥ 100 and star_sum ≥ 1000 render bold.
- **Top-repo teases** (migration 0011 `actors.top_repos`, JSON top-3 by stars): repos ≥ 200⭐ (max 2) inline in the star_sum parens — "25 repos (*3,663 ⭐* · VMamba 3,217)". Enrichment captures them (`fetchRepoStats`); re-sweep predicate `star_sum > 0 AND top_repos IS NULL` backfills existing actors at 10/tick (~1 day at */5).
- **Compact body**: company · location · _bio_ (whitespace-collapsed) · 🌐 blog fold into one line; blog anchors strip protocol + trailing slash.
- **`SLACK_ORG_EMOJI` enabled**: workspace already has `:marin:`/`:marin-community:`/`:open-athena:`/`:oa:`.
- **Weekly-OP demo v3** (`tmp/weekly-demo-v3.py`): sender "Week of 8/10" (📅 dropped — redundant with the `:date:` AVI); body org-grouped — org line (follows delta) with its repos as indented bullets, `:open-athena: marin-dna` flat (no OA-org activity); `notable:` line (followers ≥ 50 or star_sum ≥ 500 this week).
- **thrds**: not usable for posting pre-rendered mrkdwn (`to_slack()` md conversion mangles it — `*bold*` → `_…_`); spec'd `raw=True` passthrough in `~/c/thrds/specs/raw-mrkdwn-passthrough.md`.

### v8.1 follow-ups (RW, 2026-08-11)

- **🔔/🔕 unified as the follow units too** — the `:mega:`/🔇 stragglers were the running-total unit (`130 :mega:`) and FE kind-emojis; all now `:bell:`/🔕 (cfw KINDS, summary.ts, py parity, www Feed/Actors/EventTimeline).
- **Orgs linked** in actor msgs: `orgs:` entries → `<github.com/org|org>`.
- **OP uses real Slack bullets**: mrkdwn `text` has no list syntax (v3 faked it with literal `•`); the OP is now `rich_text` blocks — org section, `rich_text_list` of its repos, flat sections for orgs without org-level activity, notable line (links as structured elements, emoji as `{type: emoji}`).
- **Staging-sync poller** (`tmp/staging-sync.py`, backgrounded, 5-min cycles, 100-cycle cap): mirrors new prod `watchy_event` msgs into the staging thread verbatim (username/icon/text/metadata from prod history) and rebuilds the OP blocks from D1 (baselines = last pre-week `counts` row; notable = followers ≥ 50 or star_sum ≥ 500). State in `tmp/staging-sync-state.json` (mirrored prod ts).
- **Notable as a `<ul>`** (poller OP): "Notable:" + bullet per actor — GH-linked login, follower count, abbreviated affiliation (cleaned company + `(city)` — "UCAS (Beijing)"; city dropped for self-locating institutions like "Tsinghua University"; linked to LI company search), top-repo tease (≥200⭐) or Σ⭐ (≥500), and `↳` permalinking their details reply *in the same thread* (`chat.getPermalink`, cached; login→reply-ts map from thread metadata / leading GH link). `↳` is plain Unicode (U+21B3), not emoji — that's why it works inside link anchor text; custom emoji can't (rich_text `emoji` elements don't nest in `link`), but literal unicode ⭐/🔔 can — OP totals render as `[1,257 ⭐]`-style anchors (matching the mrkdwn event msgs, which always did `<url|1,253 :star:>`).
- **LI company-search keywords cleaned** (`companyKeywords`): literal GH company strings find nothing on LI ("IIIS, Tsinghua University" → 0 results) — strip parentheticals/@handles, keep last comma segment ("Tsinghua University", "Sereact"); display text unchanged.
- **Event msgs are Block Kit now**: mrkdwn renders anchor shortcodes *outside* the link (stored text keeps `<url|1,257 :star:>` but the UI extracts the emoji — DOM-verified), so `renderActorOp` emits `blocks`: a `section` (mrkdwn bits lines, unchanged) + a `rich_text` block for event-ref lines whose total links carry literal ⭐/🔔 inside the anchor (`UNIT_CHAR`); org emoji stay as `emoji` elements outside links (custom emoji can't nest in `link`). `text` remains the mrkdwn fallback. Staging replies chat.update'd to the new shape (`tmp/edit-staging-replies.py`); poller mirrors prod `blocks` verbatim.
- **User-token sender aside**: no way to drop the APP badge while customizing sender — overrides need bot + `chat:write.customize` (always badged, anti-spoofing); user-token posts are the real authed user only (modern granular-scope apps lost the legacy `as_user=false` override).

## v9 — weekly threads in production (RW approval, 2026-08-11)

Staging demo approved → #github-engagement transformed:

- **Migration 0012 `weekly_threads`** (`week_start` Monday-ISO PK → OP `ts`).
- **`cfw/src/weekly.ts`**: `weekStartOf`/`weekLabel`; pure `buildWeeklyOp(weekStart, {events, counts, actors, replyLink}, {dashboardUrl, orgEmoji})` (org-grouped scoreboard: org header + repo `rich_text_list` bullets when the org saw follows, flat lines otherwise; Notable bullets with affil + top-repo/Σ⭐ + ↳); `ensureWeeklyThread` (posts "Week of M/D" OP, `:date:` icon, `watchy_weekly` metadata, records row); `updateWeeklyOp` (D1 → blocks → chat.update). Notable ↳ permalinks constructed from `SLACK_WORKSPACE_URL` var (no getPermalink calls).
- **`syncSlack`**: each group posts with `thread_ts` of its event-week's OP (created on demand; ensure-failure stops the batch rather than posting channel-level); after a batch, every touched week's OP is rebuilt.
- **Transform** (`tmp/prod-weekly-transform.py` → `build-prod-op.mts` → `prod-weekly-finish.py`): captured the 18 flat msg ts, posted the prod OP (`1786475715.836179`) + 17 re-rendered replies, repointed `slack_posts.ts` to the reply ts, built + applied the OP scoreboard via the worker's own builder, deleted the 18 flat msgs, verified zero stragglers.
- Staging poller retired (`#github-engagement-staging` can be archived whenever).
- Open: move the Monday-14:00-UTC summary cron to Tue AM as the higher-signal channel-level OP (discussed, not yet requested).
- **`findBsky` name-search gated on multi-token names**: a GH user named "Anonymous" exact-matched `youranoncentral.bsky.social` (455k followers), poisoning reach — it topped the one-off showcase ranking. 22 single-token name-search matches cleared from `actors` (handle-guess matches untouched); same ≥2-token gate as the LI search link.
- **/actors**: Σ⭐ values with `top_repos` get a TT listing the top repos (chips/`<details>` considered — TT matches the interest-breakdown pattern without widening rows); "sort" label TT explains interest vs recent-action (the latter = exact rev-chron, conceptually the hl→0 limit but a plain sort since the score underflows there).
- **One-off showcase msg** (`tmp/top-actors-msg.py`): top-10 external actors by interest (local port of `scoreActor`, hl=60) posted channel-level to #github-engagement for cross-linking from #eng/#comms/#recruiting.

## Status — ✅ shipped 2026-08-10 (research pending key)

- [x] Feed org icons (grouped headers + inline lines + actions column)
- [x] `/api/actors` events attach; `/api/actors/summary` JSON + md
- [x] /actors actions column + digest links
- [x] Weekly notables OA exclusion
- [x] Migration 0008; `syncActorReplies` + research plumbing
- [x] Dashboard links (event suffix, weekly footer, reply footer)
- [x] Deploy worker + both Pages; verify
- [ ] `ANTHROPIC_API_KEY` worker secret (user-side; research activates when set)
