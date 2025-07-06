# Watchy

A Python library and CLI tool for fetching and tracking GitHub stargazers and followers.

## Features

- Fetch stargazers for any GitHub repository
- Fetch followers for any GitHub user or organization
- Save data to Parquet files for efficient storage and analysis
- Output data as JSONL to stdout for streaming workflows
- Automatic pagination through GitHub API results
- Rate limiting handling with automatic retries
- Support for authenticated requests with GitHub tokens

## Installation

```bash
pip install -e .
```

## Usage

### Command Line Interface

#### Fetch Repository Stargazers

```bash
# Save to default location: .watchy/github/stars/owner/repo.parquet
watchy stars owner/repo

# Output to stdout as JSONL
watchy stars owner/repo -

# Save to custom file
watchy stars owner/repo /path/to/stargazers.parquet
```

#### Fetch User/Organization Followers

```bash
# Save to default location: .watchy/github/follows/username.parquet
watchy follows username

# Output to stdout as JSONL
watchy follows username -

# Save to custom file
watchy follows username /path/to/followers.parquet
```

### Authentication

For higher rate limits, set your GitHub token:

```bash
export GITHUB_TOKEN=your_personal_access_token
watchy stars owner/repo
```

Or pass it directly:

```bash
watchy --token your_token stars owner/repo
```

### Python API

```python
from watchy.github import GitHubClient
from watchy.storage import save_to_parquet, write_to_jsonl
from pathlib import Path

# Create client (optionally with token)
client = GitHubClient(token="your_token")

# Fetch stargazers
stargazers = client.get_stargazers("owner", "repo")
save_to_parquet(stargazers, Path("stargazers.parquet"))

# Fetch followers
followers = client.get_followers("username")
write_to_jsonl(followers)  # Output to stdout
```

## Data Format

The fetched data contains standard GitHub API fields for users:

- `id` - GitHub user ID
- `login` - Username
- `avatar_url` - Profile picture URL
- `html_url` - Profile URL
- `type` - User type (User/Organization)
- And other GitHub API user fields

## Rate Limiting

- Unauthenticated requests: 60 requests/hour
- Authenticated requests: 5,000 requests/hour
- The tool automatically handles rate limiting with backoff and retry

## Requirements

- Python ≥3.9
- Dependencies: requests, pandas, pyarrow, click

## Development

```bash
# Install with dev dependencies
pip install -e .[dev]

# Run linting
ruff check watchy/
```