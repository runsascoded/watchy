"""Command-line interface for watchy."""

import os
import sys
from pathlib import Path
from typing import Optional
import click
from .github import GitHubClient
from .storage import save_to_parquet, write_to_jsonl


@click.group()
@click.option("--token", envvar="GITHUB_TOKEN", help="GitHub API token (or set GITHUB_TOKEN env var)")
@click.pass_context
def main(ctx, token: Optional[str]):
    """Watchy - Track GitHub stargazers and followers."""
    ctx.ensure_object(dict)
    ctx.obj["client"] = GitHubClient(token)


@main.command()
@click.argument("repo")
@click.argument("output", required=False)
@click.pass_context
def stars(ctx, repo: str, output: Optional[str]):
    """Fetch stargazers for a repository.

    REPO should be in format 'owner/repo'.
    OUTPUT can be '-' for stdout (JSONL) or a file path for Parquet.
    If not specified, saves to .watchy/github/stars/<owner>/<repo>.parquet
    """
    if "/" not in repo:
        click.echo("Error: Repository must be in format 'owner/repo'", err=True)
        sys.exit(1)

    owner, repo_name = repo.split("/", 1)
    client = ctx.obj["client"]

    try:
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
