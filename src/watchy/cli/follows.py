"""Follows subcommand for watchy CLI."""

from sys import exit

from click import argument, pass_context

from . import main, err
from ..paths import paths
from ..storage import save_logins_to_txt, print_logins_limited


@main.command
@pass_context
@argument("targets", nargs=-1, required=True)
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
            output_path = paths.github.follows.user(user)
            logins = save_logins_to_txt(iter(followers), output_path)
            print_logins_limited(logins)

    except Exception as e:
        err(f"Error fetching followers: {e}")
        exit(1)
