"""Commit subcommand for watchy CLI."""

import re
from collections import defaultdict
from pathlib import Path
from sys import exit

from click import echo, option, pass_context
from utz import proc

from . import main, err


def get_file_content(filepath: str, ref: str = None) -> set[str]:
    """Get file content as a set of non-empty lines from git or worktree."""
    try:
        if ref:
            # Get file content from git ref (e.g., HEAD)
            lines = proc.lines("git", "show", f"{ref}:{filepath}")
            # Return set of non-empty lines
            return set(line.strip() for line in lines if line.strip())
        else:
            # Get file content from worktree
            file_path = Path(filepath)
            if file_path.exists():
                lines = file_path.read_text().splitlines()
                return set(line.strip() for line in lines if line.strip())
            else:
                return set()
    except:
        return set()


def parse_git_changes():
    """Parse git status --porcelain to categorize changes."""
    try:
        # Run git status --porcelain to get machine-readable output
        lines = proc.lines("git", "status", "--porcelain")

        changes = {
            'stars': {'added': defaultdict(set), 'removed': defaultdict(set)},
            'follows': {'added': defaultdict(set), 'removed': defaultdict(set)},
            'new_files': set()
        }

        # Parse each line of git status output
        for line in lines:
            if not line:
                continue

            status = line[:2]
            filepath = line[3:]

            # Check if this is a new file (untracked or added)
            if status[0] in ('A', '?'):
                changes['new_files'].add(filepath)

            # Only process modified files for diff analysis
            if status[0] == 'M' and filepath.endswith('.txt'):
                # Load file content from HEAD and worktree
                head_content = get_file_content(filepath, "HEAD")
                worktree_content = get_file_content(filepath)

                # Compute added and removed usernames
                added_users = worktree_content - head_content
                removed_users = head_content - worktree_content

                # Categorize changes by file type using proper path matching
                # Match stars files: .../github/stars/owner/repo.txt
                stars_match = re.match(r'.*github/stars/([^/]+)/([^/]+)\.txt$', filepath)
                if stars_match:
                    owner, repo = stars_match.groups()
                    repo_key = f"{owner}/{repo}"
                    if added_users:
                        changes['stars']['added'][repo_key].update(added_users)
                    if removed_users:
                        changes['stars']['removed'][repo_key].update(removed_users)

                # Match follows files: .../github/follows/user.txt
                follows_match = re.match(r'.*github/follows/([^/]+)\.txt$', filepath)
                if follows_match:
                    user = follows_match.group(1)
                    if added_users:
                        changes['follows']['added'][user].update(added_users)
                    if removed_users:
                        changes['follows']['removed'][user].update(removed_users)

        return changes

    except Exception as e:
        err(f"Error parsing git changes: {e}")
        return None


def format_commit_message(changes):
    """Format changes into a nice commit message with emojis."""
    if not changes:
        return "GHA: No changes detected"

    # Count totals
    total_follows_added = sum(len(users) for users in changes['follows']['added'].values())
    total_follows_removed = sum(len(users) for users in changes['follows']['removed'].values())
    total_stars_added = sum(len(users) for users in changes['stars']['added'].values())
    total_stars_removed = sum(len(users) for users in changes['stars']['removed'].values())
    total_new_files = len(changes['new_files'])

    # Build summary line
    summary_parts = []
    if total_follows_added or total_follows_removed:
        summary_parts.append(f"📣+{total_follows_added}-{total_follows_removed}")
    if total_stars_added or total_stars_removed:
        summary_parts.append(f"⭐️+{total_stars_added}-{total_stars_removed}")
    if total_new_files:
        summary_parts.append(f"📂+{total_new_files}")

    if not summary_parts:
        return "GHA: No significant changes"

    summary = f"GHA: {', '.join(summary_parts)}"

    # Build detailed lines
    details = []

    # Follow changes by user
    all_follow_users = set(changes['follows']['added'].keys()) | set(changes['follows']['removed'].keys())
    for user in sorted(all_follow_users):
        added = changes['follows']['added'].get(user, set())
        removed = changes['follows']['removed'].get(user, set())

        parts = []
        if added:
            parts.append(f"+{', '.join(sorted(added))}")
        if removed:
            parts.append(f"-{', '.join(sorted(removed))}")

        if parts:
            details.append(f"- 📣 {user}: {', '.join(parts)}")

    # Star changes by repo
    all_star_repos = set(changes['stars']['added'].keys()) | set(changes['stars']['removed'].keys())
    for repo in sorted(all_star_repos):
        added = changes['stars']['added'].get(repo, set())
        removed = changes['stars']['removed'].get(repo, set())

        parts = []
        if added:
            parts.append(f"+{', '.join(sorted(added))}")
        if removed:
            parts.append(f"-{', '.join(sorted(removed))}")

        if parts:
            details.append(f"- ⭐️ {repo}: {', '.join(parts)}")

    # New files (repos created)
    new_repos = []
    for filepath in sorted(changes['new_files']):
        # Match new stars files: .../github/stars/owner/repo.txt
        stars_match = re.match(r'.*github/stars/([^/]+)/([^/]+)\.txt$', filepath)
        if stars_match:
            owner, repo = stars_match.groups()
            new_repos.append(f"{owner}/{repo}")

        # Match new follows files: .../github/follows/user.txt
        follows_match = re.match(r'.*github/follows/([^/]+)\.txt$', filepath)
        if follows_match:
            user = follows_match.group(1)
            new_repos.append(user)

    if new_repos:
        details.append(f"- 📂 +{', '.join(new_repos)}")

    # Combine summary and details
    if details:
        return f"{summary}\n\n" + "\n".join(details)
    else:
        return summary


@main.command
@option("-n", "--dry-run", is_flag=True, help="Show what would be committed without actually committing")
@pass_context
def commit(ctx, dry_run: bool):
    """Generate and create a commit with a formatted message based on Git changes.

    Analyzes uncommitted changes from 'watchy stars' and 'watchy follows' commands
    and creates a commit with a nicely formatted message showing:
    - 📣 Follow additions/removals by user
    - ⭐️ Star additions/removals by repository
    - 📂 New repositories being tracked

    Use --dry-run to preview the commit message without committing.
    """
    try:
        # Check if we're in a git repository
        proc.run("git", "rev-parse", "--git-dir")
    except Exception:
        err("Not in a git repository")
        exit(1)

    # Parse the git changes
    changes = parse_git_changes()
    if changes is None:
        err("Failed to parse git changes")
        exit(1)

    # Generate commit message
    commit_message = format_commit_message(changes)

    if dry_run:
        echo("Commit message preview:")
        echo("=" * 50)
        echo(commit_message)
        echo("=" * 50)
        return

    # Check if there are any changes to commit
    try:
        # Check for staged changes (git diff --cached --quiet returns 1 if changes exist)
        try:
            proc.run("git", "diff", "--cached", "--quiet")
            staged_changes = False
        except:
            staged_changes = True

        # Check for unstaged changes (git diff --quiet returns 1 if changes exist)
        try:
            proc.run("git", "diff", "--quiet")
            unstaged_changes = False
        except:
            unstaged_changes = True

        if not staged_changes and not unstaged_changes:
            echo("No changes to commit")
            return

        # Stage all changes if there are unstaged changes
        if unstaged_changes:
            proc.run("git", "add", ".")

        # Create the commit
        proc.run("git", "commit", "-m", commit_message)

        echo(f"Committed changes with message:")
        echo(commit_message)

    except Exception as e:
        err(f"Git commit failed: {e}")
        exit(1)