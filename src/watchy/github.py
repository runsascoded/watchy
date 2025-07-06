"""GitHub API client for fetching stargazers and followers."""

import json
import time
from typing import Iterator, Dict, Any, Optional
import requests


class GitHubClient:
    """Client for interacting with GitHub API."""

    def __init__(self, token: Optional[str] = None):
        self.session = requests.Session()
        if token:
            self.session.headers.update({"Authorization": f"token {token}"})
        self.session.headers.update({"Accept": "application/vnd.github.v3+json", "User-Agent": "watchy/0.1.0"})

    def _paginate(self, url: str, params: Optional[Dict[str, Any]] = None) -> Iterator[Dict[str, Any]]:
        """Paginate through GitHub API responses."""
        if params is None:
            params = {}
        params.setdefault("per_page", 100)

        while url:
            response = self.session.get(url, params=params)
            response.raise_for_status()

            # Handle rate limiting
            if response.status_code == 403 and "rate limit" in response.text.lower():
                reset_time = int(response.headers.get("X-RateLimit-Reset", 0))
                sleep_time = max(reset_time - int(time.time()) + 1, 60)
                print(f"Rate limited. Sleeping for {sleep_time} seconds...")
                time.sleep(sleep_time)
                continue

            data = response.json()
            for item in data:
                yield item

            # Get next page URL from Link header
            url = None
            if "Link" in response.headers:
                links = response.headers["Link"].split(",")
                for link in links:
                    if 'rel="next"' in link:
                        url = link.split(";")[0].strip("<> ")
                        break
            params = None  # Only use params for first request

    def get_stargazers(self, owner: str, repo: str) -> Iterator[Dict[str, Any]]:
        """Get stargazers for a repository."""
        url = f"https://api.github.com/repos/{owner}/{repo}/stargazers"
        params = {"per_page": 100}
        yield from self._paginate(url, params)

    def get_followers(self, user: str) -> Iterator[Dict[str, Any]]:
        """Get followers for a user or organization."""
        url = f"https://api.github.com/users/{user}/followers"
        params = {"per_page": 100}
        yield from self._paginate(url, params)

    def get_repositories(self, user: str) -> Iterator[Dict[str, Any]]:
        """Get repositories for a user or organization."""
        url = f"https://api.github.com/users/{user}/repos"
        params = {"per_page": 100, "type": "owner"}
        yield from self._paginate(url, params)
