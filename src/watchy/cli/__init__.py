"""Command-line interface for watchy."""

from functools import partial
from typing import Optional

from click import echo, group, option, pass_context

from ..auth import get_github_token
from ..github import GitHubClient

err = partial(echo, err=True)


@group
@option("-t", "--token", help="GitHub API token (overrides auto-detection)")
@pass_context
def main(ctx, token: Optional[str]):
    """Watchy - Track GitHub stargazers and followers."""
    ctx.ensure_object(dict)

    # Use provided token or auto-detect from various sources
    if token is None:
        token = get_github_token()
    ctx.obj["client"] = GitHubClient(token)


# Import subcommands to register them with the main group
from . import backfill, follows, slack, sql, stars  # noqa: E402


if __name__ == "__main__":
    main()