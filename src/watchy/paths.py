"""Path management for watchy data directories."""

from os import getenv
from pathlib import Path


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


# Global instance for easy access
paths = WatchyPaths()