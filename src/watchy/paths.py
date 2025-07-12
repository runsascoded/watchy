"""Path management for watchy data directories."""

import re
from os import getenv
from pathlib import Path
from typing import Optional, Tuple


class WatchyPaths:
    """Encapsulates all watchy-related paths."""

    def __init__(self):
        self.root = Path(getenv("WATCHY_DIR", ".watchy"))

    @property
    def github(self) -> "GitHubPaths":
        """GitHub data paths."""
        return GitHubPaths(self.root / "github")


class GitHubPaths:
    """GitHub-specific paths within watchy directory."""

    def __init__(self, root: Path):
        self.root = root

    @property
    def stars(self) -> "StarsPaths":
        """Star tracking paths."""
        return StarsPaths(self.root / "stars")

    @property
    def follows(self) -> "FollowsPaths":
        """Follow tracking paths."""
        return FollowsPaths(self.root / "follows")


class StarsPaths:
    """Star tracking file paths."""

    def __init__(self, root: Path):
        self.root = root

    def repo(self, owner: str, repo: str) -> Path:
        """Get path for a specific repository's stargazers file."""
        return self.root / owner / f"{repo}.txt"


class FollowsPaths:
    """Follow tracking file paths."""

    def __init__(self, root: Path):
        self.root = root

    def user(self, username: str) -> Path:
        """Get path for a specific user's followers file."""
        return self.root / f"{username}.txt"


def infer_path_type(filepath: str) -> Tuple[Optional[str], Optional[dict]]:
    """Infer the type and metadata of a watchy path.

    Returns:
        (path_type, metadata) where:
        - path_type: 'stars', 'follows', or None
        - metadata: dict with extracted info (owner/repo for stars, user for follows)
    """
    # Match stars files: .../github/stars/owner/repo.txt
    stars_match = re.match(r'.*github/stars/([^/]+)/([^/]+)\.txt$', filepath)
    if stars_match:
        owner, repo = stars_match.groups()
        return 'stars', {'owner': owner, 'repo': repo, 'repo_key': f"{owner}/{repo}"}

    # Match follows files: .../github/follows/user.txt
    follows_match = re.match(r'.*github/follows/([^/]+)\.txt$', filepath)
    if follows_match:
        user = follows_match.group(1)
        return 'follows', {'user': user}

    return None, None


# Global instance for easy access
paths = WatchyPaths()