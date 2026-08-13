# Two-branch model: `rw` reference instance + `oa` deployment fork

## Motivation

The expectation for reuse is that people **clone/fork the repo and commit their own config** — not copy a wrangler `env` block inside a shared file. So the repo maintains two branches, each a complete, deployable instance:

- **`rw`** — the project lineage: base codebase + the personal reference instance ([watchy.rbw.sh]). `cfw/wrangler.jsonc` *is* the instance config, at top level — no wrangler environments.
- **`oa`** — Open Athena's deployment ([gh.oa.dev]), branched from `rw`. **GitHub default branch** (the showpiece). Its commits on top of `rw` are a *fabricated-semantic lineage*: each one is a step of "how to fork this for your org", so `git log rw..oa` / the branch diff read as a tutorial:
  1. point the instance config at your orgs (CF account, D1, targets, ports)
  2. enable opt-in features (Slack posting, auth gate)
  3. rebrand the site
  4. swap the OG image/tags
  5. README banner

## What lives where

Feature *code* stays on `rw`, config-gated and dormant when unconfigured (Slack, auth gate, actor enrichment all degrade cleanly) — so the base stays the single home of the schema/migrations and core refactors, and `oa`'s delta is config + branding. Two reasons this line matters:

- **D1 migrations must not diverge across branches** — sequence collisions on every merge, permanent schema drift.
- Merge friction scales with fork-only code; config/branding files conflict rarely and trivially.

Fork-only *extensions* (new pages, new trackers) are fair game on `oa` when they're genuinely instance-specific; anything generally useful merges down into `rw` first.

## Flow

- `rw` is upstream. Periodically `git merge rw` into `oa` (**merge, not rebase** — the fork topology is part of the story; `oa`'s tutorial commits stay at the branch root).
- Local layout: root checkout = `oa`; `wt/rw` worktree = `rw` (direnv finds the root `.envrc` from `wt/`).
- Deploys: each branch's `cfw/` `pnpm deploy` (worker) + `scripts/deploy-www.sh` (Pages) deploy *that* instance. On `oa` these route through `scripts/oa-wrangler.sh` (swaps in `CLOUDFLARE_ADMIN_TOKEN` + the OA account id, since ambient creds are personal).
- Dev ports: `rw` www 4199 / worker 4200; `oa` www 4201 / worker 4202 — both branches' dev servers can run side by side.

Each branch's README links the other: `oa` opens with a "deployment fork of [`rw`]" banner; `rw` points at `oa` as the worked fork example.

## History note

`main` (pre-split, both instances as wrangler envs — see [worker-split.md](./worker-split.md)) is the common ancestor of both branches and is retired after the split; the env-based layout lives on in its history.

[watchy.rbw.sh]: https://watchy.rbw.sh
[gh.oa.dev]: https://gh.oa.dev
