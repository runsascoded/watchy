"""Authentication utilities for GitHub API."""

import os
import subprocess
from pathlib import Path
from typing import Optional


def get_github_token() -> Optional[str]:
    """Get GitHub token from various sources in priority order.

    Priority order:
    1. GITHUB_TOKEN environment variable
    2. .token file in current directory
    3. gh CLI token (from gh auth token)

    Returns:
        GitHub token string or None if no token found
    """
    # 1. Environment variable
    token = os.getenv("GITHUB_TOKEN")
    if token:
        return token

    # 2. .token file
    token_file = Path(".token")
    if token_file.exists():
        try:
            token = token_file.read_text().strip()
            if token:
                return token
        except Exception:
            pass  # Continue to next method

    # 3. gh CLI token
    try:
        result = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True)
        token = result.stdout.strip()
        if token:
            return token
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass  # gh CLI not available or not authenticated

    return None
