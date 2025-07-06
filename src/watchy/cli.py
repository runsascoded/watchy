"""Command-line interface for watchy."""

import os
import sys
from pathlib import Path
from typing import Optional
import click
from .auth import get_github_token
from .github import GitHubClient
from .storage import save_to_parquet, write_to_jsonl


@click.group()
@click.option("--token", help="GitHub API token (overrides auto-detection)")
@click.pass_context
def main(ctx, token: Optional[str]):
    """Watchy - Track GitHub stargazers and followers."""
    ctx.ensure_object(dict)
    # Use provided token or auto-detect from various sources
    if token is None:
        token = get_github_token()
    ctx.obj["client"] = GitHubClient(token)


@main.command()
@click.argument("repo_or_user")
@click.argument("output", required=False)
@click.pass_context
def stars(ctx, repo_or_user: str, output: Optional[str]):
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
            stargazers = client.get_stargazers(owner, repo_name)

            if output == "-":
                write_to_jsonl(stargazers)
            else:
                if output is None:
                    output_path = Path(".watchy/github/stars") / owner / f"{repo_name}.parquet"
                else:
                    output_path = Path(output)

                save_to_parquet(stargazers, output_path)
                click.echo(f"Stargazers saved to {output_path}")
        else:
            # User/org format: fetch all repositories and their stargazers
            user = repo_or_user
            repos = list(client.get_repositories(user))

            if not repos:
                click.echo(f"No repositories found for user/org: {user}", err=True)
                sys.exit(1)

            all_stargazers = []
            for repo in repos:
                repo_name = repo["name"]
                click.echo(f"Fetching stargazers for {user}/{repo_name}...")
                stargazers = list(client.get_stargazers(user, repo_name))

                # Add repo info to each stargazer record
                for stargazer in stargazers:
                    stargazer["repo_name"] = repo_name
                    stargazer["repo_full_name"] = f"{user}/{repo_name}"

                all_stargazers.extend(stargazers)

            if output == "-":
                write_to_jsonl(iter(all_stargazers))
            else:
                if output is None:
                    output_path = Path(".watchy/github/stars") / user / "_all.parquet"
                else:
                    output_path = Path(output)

                save_to_parquet(iter(all_stargazers), output_path)
                click.echo(f"All stargazers for {user} ({len(all_stargazers)} total) saved to {output_path}")

    except Exception as e:
        click.echo(f"Error fetching stargazers: {e}", err=True)
        sys.exit(1)


@main.command()
@click.argument("user")
@click.argument("output", required=False)
@click.pass_context
def follows(ctx, user: str, output: Optional[str]):
    """Fetch followers for a user or organization.

    USER is the GitHub username or organization name.
    OUTPUT can be '-' for stdout (JSONL) or a file path for Parquet.
    If not specified, saves to .watchy/github/follows/<user>.parquet
    """
    client = ctx.obj["client"]

    try:
        followers = client.get_followers(user)

        if output == "-":
            write_to_jsonl(followers)
        else:
            if output is None:
                output_path = Path(".watchy/github/follows") / f"{user}.parquet"
            else:
                output_path = Path(output)

            save_to_parquet(followers, output_path)
            click.echo(f"Followers saved to {output_path}")

    except Exception as e:
        click.echo(f"Error fetching followers: {e}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
