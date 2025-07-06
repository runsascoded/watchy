"""Command-line interface for watchy."""

from functools import partial
from os import getenv
from pathlib import Path
from sys import exit
from time import sleep
from typing import Optional

from click import argument, command, echo, group, option, pass_context

from .auth import get_github_token
from .github import GitHubClient
from .storage import save_logins_to_txt, write_logins_to_stdout, print_logins_limited

err = partial(echo, err=True)

WATCHY_DIR = Path(".watchy/github")


@group()
@option("-t", "--token", help="GitHub API token (overrides auto-detection)")
@pass_context
def main(ctx, token: Optional[str]):
    """Watchy - Track GitHub stargazers and followers."""
    ctx.ensure_object(dict)
    # Use provided token or auto-detect from various sources
    if token is None:
        token = get_github_token()
    ctx.obj["client"] = GitHubClient(token)


@main.command()
@argument("targets", nargs=-1, required=True)
@option("-s", "--sleep-s", default=0.1, help="Sleep seconds between repo fetches (default: 0.1)")
@pass_context
def stars(ctx, targets: tuple[str, ...], sleep_s: float):
    """Fetch stargazers for repositories or all repositories of users/orgs.

    TARGETS can be:
    - 'owner/repo' format for specific repositories
    - 'user' or 'org' format to fetch stars for all repositories owned by the user/org
    - Multiple targets can be specified

    Always saves to files under .watchy/ and prints usernames to stdout.
    """
    client = ctx.obj["client"]

    try:
        for target in targets:
            if "/" in target:
                # Single repository format: owner/repo
                owner, repo_name = target.split("/", 1)
                stargazers = list(client.get_stargazers(owner, repo_name))

                err(f"{len(stargazers)} stargazers for {target}")
                output_path = WATCHY_DIR / "stars" / owner / f"{repo_name}.txt"
                logins = save_logins_to_txt(iter(stargazers), output_path)
                print_logins_limited(logins)
            else:
                # User/org format: fetch all repositories and their stargazers
                user = target
                repos = list(client.get_repositories(user))

                if not repos:
                    err(f"No repositories found for user/org: {user}")
                    continue

                for i, repo in enumerate(repos):
                    repo_name = repo["name"]
                    stargazers = list(client.get_stargazers(user, repo_name))

                    err(f"{len(stargazers)} stargazers for {user}/{repo_name}")
                    repo_output_path = WATCHY_DIR / "stars" / user / f"{repo_name}.txt"
                    logins = save_logins_to_txt(iter(stargazers), repo_output_path)
                    print_logins_limited(logins)

                    # Sleep between repo fetches (except after the last one)
                    if i < len(repos) - 1 and sleep_s > 0:
                        sleep(sleep_s)

    except Exception as e:
        err(f"Error fetching stargazers: {e}")
        exit(1)


@main.command()
@argument("targets", nargs=-1, required=True)
@pass_context
def follows(ctx, targets: tuple[str, ...]):
    """Fetch followers for users or organizations.

    TARGETS are GitHub usernames or organization names.
    Multiple targets can be specified.

    Always saves to files under .watchy/ and prints usernames to stdout.
    """
    client = ctx.obj["client"]

    try:
        for user in targets:
            followers = list(client.get_followers(user))

            err(f"{len(followers)} followers for {user}")
            output_path = WATCHY_DIR / "follows" / f"{user}.txt"
            logins = save_logins_to_txt(iter(followers), output_path)
            print_logins_limited(logins)

    except Exception as e:
        err(f"Error fetching followers: {e}")
        exit(1)


if __name__ == "__main__":
    main()
