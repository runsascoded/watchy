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
from .storage import save_to_parquet, write_to_jsonl

err = partial(echo, err=True)


@group()
@option("--token", help="GitHub API token (overrides auto-detection)")
@pass_context
def main(ctx, token: Optional[str]):
    """Watchy - Track GitHub stargazers and followers."""
    ctx.ensure_object(dict)
    # Use provided token or auto-detect from various sources
    if token is None:
        token = get_github_token()
    ctx.obj["client"] = GitHubClient(token)


@main.command()
@argument("repo_or_user")
@argument("output", required=False)
@option("-s", "--sleep-s", default=0.1, help="Sleep seconds between repo fetches (default: 0.1)")
@pass_context
def stars(ctx, repo_or_user: str, output: Optional[str], sleep_s: float):
    """Fetch stargazers for a repository or all repositories of a user/org.

    REPO_OR_USER can be:
    - 'owner/repo' format for a specific repository
    - 'user' or 'org' format to fetch stars for all repositories owned by the user/org

    OUTPUT can be '-' for stdout (JSONL) or a file path for Parquet.
    If not specified, saves to .watchy/github/stars/<owner>/<repo>.parquet or .watchy/github/stars/<user>/_all.parquet
    """
    client = ctx.obj["client"]

    try:
        if "/" in repo_or_user:
            # Single repository format: owner/repo
            owner, repo_name = repo_or_user.split("/", 1)
            stargazers = list(client.get_stargazers(owner, repo_name))

            if output == "-":
                write_to_jsonl(iter(stargazers))
            else:
                if output is None:
                    output_path = Path(".watchy/github/stars") / owner / f"{repo_name}.parquet"
                else:
                    output_path = Path(output)

                save_to_parquet(iter(stargazers), output_path)
                err(f"Stargazers saved to {output_path}")

            err(f"Found {len(stargazers)} stargazers for {repo_or_user}")
        else:
            # User/org format: fetch all repositories and their stargazers
            user = repo_or_user
            repos = list(client.get_repositories(user))

            if not repos:
                err(f"No repositories found for user/org: {user}")
                exit(1)

            all_stargazers = []
            for i, repo in enumerate(repos):
                repo_name = repo["name"]
                err(f"Fetching stargazers for {user}/{repo_name}...")
                stargazers = list(client.get_stargazers(user, repo_name))

                if output == "-":
                    # For stdout mode, add repo info to each stargazer record and accumulate
                    for stargazer in stargazers:
                        stargazer["repo_name"] = repo_name
                        stargazer["repo_full_name"] = f"{user}/{repo_name}"
                    all_stargazers.extend(stargazers)
                else:
                    # For file mode, save each repo separately
                    if output is None:
                        repo_output_path = Path(".watchy/github/stars") / user / f"{repo_name}.parquet"
                    else:
                        # If custom output path provided for org mode, append repo name
                        base_path = Path(output)
                        repo_output_path = base_path.parent / f"{base_path.stem}_{repo_name}.parquet"

                    save_to_parquet(iter(stargazers), repo_output_path)
                    err(f"Stargazers for {user}/{repo_name} ({len(stargazers)}) saved to {repo_output_path}")

                # Sleep between repo fetches (except after the last one)
                if i < len(repos) - 1 and sleep_s > 0:
                    sleep(sleep_s)

            if output == "-":
                write_to_jsonl(iter(all_stargazers))
                err(f"Found {len(all_stargazers)} total stargazers across {len(repos)} repositories for {user}")
            else:
                err(f"Saved stargazers for {len(repos)} repositories belonging to {user}")

    except Exception as e:
        err(f"Error fetching stargazers: {e}")
        exit(1)


@main.command()
@argument("user")
@argument("output", required=False)
@pass_context
def follows(ctx, user: str, output: Optional[str]):
    """Fetch followers for a user or organization.

    USER is the GitHub username or organization name.
    OUTPUT can be '-' for stdout (JSONL) or a file path for Parquet.
    If not specified, saves to .watchy/github/follows/<user>.parquet
    """
    client = ctx.obj["client"]

    try:
        followers = list(client.get_followers(user))

        if output == "-":
            write_to_jsonl(iter(followers))
        else:
            if output is None:
                output_path = Path(".watchy/github/follows") / f"{user}.parquet"
            else:
                output_path = Path(output)

            save_to_parquet(iter(followers), output_path)
            err(f"Followers saved to {output_path}")

        err(f"Found {len(followers)} followers for {user}")

    except Exception as e:
        err(f"Error fetching followers: {e}")
        exit(1)


if __name__ == "__main__":
    main()
