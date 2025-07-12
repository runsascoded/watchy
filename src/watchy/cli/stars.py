"""Stars subcommand for watchy CLI."""

from sys import exit
from time import sleep

from click import argument, option, pass_context

from . import main, err
from ..paths import paths
from ..storage import save_logins_to_txt, print_logins_limited


@main.command
@pass_context
@option("-s", "--sleep-s", default=0.1, help="Sleep seconds between repo fetches (default: 0.1)")
@argument("targets", nargs=-1, required=True)
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
                output_path = paths.github.stars.repo(owner, repo_name)
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
                    repo_output_path = paths.github.stars.repo(user, repo_name)
                    logins = save_logins_to_txt(iter(stargazers), repo_output_path)
                    print_logins_limited(logins)

                    # Sleep between repo fetches (except after the last one)
                    if i < len(repos) - 1 and sleep_s > 0:
                        sleep(sleep_s)

    except Exception as e:
        err(f"Error fetching stargazers: {e}")
        exit(1)
