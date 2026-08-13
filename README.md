# `watchy`

[![PyPI version](https://badge.fury.io/py/watchy.svg)](https://badge.fury.io/py/watchy)

Python library and CLI tool for fetching and tracking GitHub stargazers and followers.

See [ryan-williams/.watchy] for [an example daily GHA][GHA] that polls for stargazers and followers of a few orgs and repos.

**Note**: as of [GitHub's 2026-06-30 access restrictions][gh-changelog], the stargazers
API requires a token belonging to an admin or collaborator of each repo; `watchy stars`
can no longer fetch arbitrary repos' stargazers.

[`cfw/`](cfw/) contains a Cloudflare Worker that polls hourly and appends
star/unstar/follow/unfollow **events** to a D1 database (see
[`specs/d1-worker.md`](specs/d1-worker.md)); `watchy backfill` seeds it from a
`.watchy`-style git history, and `watchy sql` queries it.

## Features

- Fetch stargazers for GitHub repositories
- Fetch followers for GitHub users or organizations
- Save data to simple text files (one username per line)

## Installation

```bash
pip install watchy
```

## Usage

### Command Line Interface

#### Fetch Repository Stargazers

```bash
# Single repository
watchy stars owner/repo

# Multiple repositories
watchy stars owner/repo1 owner/repo2 another-user/repo3

# All repositories for a user/org
watchy stars username
watchy stars orgname

# Mixed targets
watchy stars owner/repo username orgname
```

#### Fetch User/Organization Followers

```bash
# Single user
watchy follows username

# Multiple users
watchy follows user1 user2 user3

# Mix users and orgs
watchy follows user1 orgname user2
```

### Output

`watchy` always:
- saves usernames to text files under `.watchy/` (configurable with `$WATCHY_DIR`)
- prints usernames to stdout (first 5, ..., last 5 if >10 total)
- shows counts in log messages (to stderr)

**File locations:**
- Stargazers: `.watchy/github/stars/<owner>/<repo>.txt`
- Followers: `.watchy/github/follows/<user>.txt`

**Example output:**
```
42 stargazers for owner/repo
alice
bob
charlie
david
emily
...
user38
user39
user40
user41
user42
```

### Authentication

`watchy` automatically loads GitHub tokens from:

1. `--token` command line argument
2. `GITHUB_TOKEN` environment variable
3. `.token` file in current directory
4. `gh auth token` (GitHub CLI)

```bash
# Using environment variable
export GITHUB_TOKEN=your_personal_access_token
watchy stars owner/repo

# Using command line argument
watchy --token your_token stars owner/repo

# Using .token file
echo "your_token" > .token
watchy stars owner/repo

# Using GitHub CLI (if logged in)
gh auth login
watchy stars owner/repo  # Automatically uses gh token
```

### Rate Limiting

```bash
# Add delay between requests when fetching multiple repos
watchy stars myorg -s 1.0  # 1 second delay between repos
```

#### Backfill events from git history

Derive star/unstar/follow/unfollow events from a `.watchy`-style data repo's
commit history, for import into the [worker](cfw/)'s D1 database:

```bash
watchy backfill > backfill.sql        # walks $WATCHY_DIR (default .watchy)
watchy sql -f backfill.sql            # import
```

See `watchy backfill --help` and [`specs/d1-worker.md`](specs/d1-worker.md) for
re-run semantics (`-u/--until`, `-S/--no-seed-state`) and the stars vs. follows
event-emission policy.

#### Query the worker's D1 database

```bash
watchy sql "SELECT kind, count(*) FROM events GROUP BY kind"   # rows out as JSONL
watchy sql -l ...                                              # local dev db
```

### Python API

```python
from watchy.github import GitHubClient
from watchy.storage import save_logins_to_txt
from pathlib import Path

# Create client (auto-detects token)
client = GitHubClient()

# Fetch stargazers
stargazers = list(client.get_stargazers("owner", "repo"))
logins = save_logins_to_txt(iter(stargazers), Path("stargazers.txt"))

# Fetch followers
followers = list(client.get_followers("username"))
```

## Run your own instance

The Cloudflare stack ([`cfw/`](cfw/) worker + D1, [`www/`](www/) site) is designed to be pointed at any set of repos/orgs. Each instance is a [wrangler environment](https://developers.cloudflare.com/workers/wrangler/environments/) in [`cfw/wrangler.jsonc`](cfw/wrangler.jsonc) — two live as worked examples: the top-level env (personal: [watchy.rbw.sh]) and `env.oa` (Open Athena: [gh.oa.dev]), each fully standalone on its own CF account (see [`specs/worker-split.md`](specs/worker-split.md)).

To stand one up:

1. Copy an env block; set `account_id`, and `TARGETS` to your owners (`stars`: owners whose repos' stargazers to track; `follows`: users/orgs whose followers to track).
2. `wrangler d1 create watchy` → paste `database_id`; `wrangler d1 migrations apply watchy -e <env> --remote`.
3. Secrets: `WATCHY_TOKEN` (GH token — must be a collaborator/admin of tracked repos for stargazer access, per GitHub's 2026-06 restriction). Fine-grained PATs are scoped to a single resource owner, so multi-org instances add per-owner overrides: `WATCHY_TOKEN_<OWNER>` (owner uppercased, non-alphanumerics → `_`, e.g. `WATCHY_TOKEN_MARIN_COMMUNITY`), falling back to `WATCHY_TOKEN`. Optional: `SLACK_BOT_TOKEN` + the `SLACK_*` vars for per-event Slack posting and weekly summaries; `SESSION_SECRET`/`ADMIN_EMAILS` for the auth-grant gate; `ANTHROPIC_API_KEY` for actor-research replies. Every feature degrades cleanly when its vars are absent.
4. `pnpm build` in `www/` (site assets are served by the worker itself), then `wrangler deploy -e <env>`. The `*/5` cron collects; events appear at the worker's URL.

Seed history with `watchy backfill` (from a [`.watchy`-style][ryan-williams/.watchy] git ledger) if you have one; otherwise the bootstrap stargazer pass captures original `starred_at` dates on its own.

## Development

```bash
# Install with dev dependencies
pip install -e .[dev]

# Lint
ruff check src/watchy/
```

[ryan-williams/.watchy]: https://github.com/ryan-williams/.watchy
[GHA]: https://github.com/ryan-williams/.watchy/blob/main/.github/workflows/update.yml
[watchy.rbw.sh]: https://watchy.rbw.sh
[gh.oa.dev]: https://gh.oa.dev
