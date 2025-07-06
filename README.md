# `watchy`

[![PyPI version](https://badge.fury.io/py/watchy.svg)](https://badge.fury.io/py/watchy)

Python library and CLI tool for fetching and tracking GitHub stargazers and followers.

See [ryan-williams/.watchy] for [an example daily GHA][GHA] that polls for stargazers and followers of a few orgs and repos.

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

## Development

```bash
# Install with dev dependencies
pip install -e .[dev]

# Lint
ruff check src/watchy/
```

[ryan-williams/.watchy]: https://github.com/ryan-williams/.watchy
[GHA]: https://github.com/ryan-williams/.watchy/blob/main/.github/workflows/update.yml
