"""Commit subcommand for watchy CLI."""

from collections import defaultdict
from functools import cache
from pathlib import Path
from sys import exit

from click import argument, echo, option
from git import Repo
from utz import proc

from . import main, err
from ..paths import infer_path_type


@cache
def get_repo() -> Repo:
    """Get the git repository (cached for performance)."""
    return Repo('.')


def get_file_content(filepath: str, ref: str = None) -> set[str]:
    """Get file content as a set of non-empty lines from git or worktree."""
    try:
        if ref:
            # Use GitPython to get file content from specific ref
            try:
                repo = get_repo()
                blob = repo.commit(ref).tree / filepath
                content = blob.data_stream.read().decode('utf-8')
                lines = content.splitlines()
                return set(line.strip() for line in lines if line.strip())
            except:
                return set()
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


def parse_git_changes(refspec_str: str = None):
    """Parse git changes to categorize them.

    Args:
        refspec_str: If provided, analyze this commit or range instead of working tree
    """
    if refspec_str:
        # Parse specific commits or ranges
        return parse_commit_range_changes(refspec_str)
    else:
        # Parse working tree changes (original behavior)
        return parse_working_tree_changes()


def parse_working_tree_changes():
    """Parse git status --porcelain to categorize working tree changes."""
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

                # Categorize changes by file type using path inference
                path_type, metadata = infer_path_type(filepath)
                if path_type == 'stars':
                    repo_key = metadata['repo_key']
                    if added_users:
                        changes['stars']['added'][repo_key].update(added_users)
                    if removed_users:
                        changes['stars']['removed'][repo_key].update(removed_users)
                elif path_type == 'follows':
                    user = metadata['user']
                    if added_users:
                        changes['follows']['added'][user].update(added_users)
                    if removed_users:
                        changes['follows']['removed'][user].update(removed_users)

        return changes

    except Exception as e:
        err(f"Error parsing working tree changes: {e}")
        return None


def parse_commit_range_changes(refspec_str: str):
    """Parse changes in a specific commit or commit range."""
    try:
        repo = get_repo()
        changes = {
            'stars': {'added': defaultdict(set), 'removed': defaultdict(set)},
            'follows': {'added': defaultdict(set), 'removed': defaultdict(set)},
            'new_files': set()
        }

        # Parse commit range (could be single commit, range, etc.)
        if '..' in refspec_str:
            # Range like HEAD~3..HEAD
            start_ref, end_ref = refspec_str.split('..', 1)
            commits = list(repo.iter_commits(f"{start_ref}..{end_ref}"))
        else:
            # Single commit
            commits = [repo.commit(refspec_str)]

        # Process each commit
        for commit in reversed(commits):  # Process in chronological order
            if not commit.parents:
                # Initial commit - compare against empty tree
                parent = None
            else:
                parent = commit.parents[0]

            # Get diff between parent and commit
            if parent:
                diff = parent.diff(commit)
            else:
                diff = commit.diff(None)  # Compare against empty tree

            # Process each changed file
            for diff_item in diff:
                filepath = diff_item.b_path or diff_item.a_path

                if not filepath or not filepath.endswith('.txt'):
                    continue

                # Check if this is a new file
                if diff_item.new_file:
                    changes['new_files'].add(filepath)

                # Analyze content changes for modified files
                if diff_item.change_type == 'M':
                    # Get content from both sides
                    if parent:
                        old_content = get_file_content(filepath, parent.hexsha)
                    else:
                        old_content = set()
                    new_content = get_file_content(filepath, commit.hexsha)

                    # Compute added and removed usernames
                    added_users = new_content - old_content
                    removed_users = old_content - new_content

                    # Categorize changes by file type using path inference
                    path_type, metadata = infer_path_type(filepath)
                    if path_type == 'stars':
                        repo_key = metadata['repo_key']
                        if added_users:
                            changes['stars']['added'][repo_key].update(added_users)
                        if removed_users:
                            changes['stars']['removed'][repo_key].update(removed_users)
                    elif path_type == 'follows':
                        user = metadata['user']
                        if added_users:
                            changes['follows']['added'][user].update(added_users)
                        if removed_users:
                            changes['follows']['removed'][user].update(removed_users)

        return changes

    except Exception as e:
        err(f"Error parsing commit range changes: {e}")
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
        follow_parts = []
        if total_follows_added:
            follow_parts.append(f"+{total_follows_added}")
        if total_follows_removed:
            follow_parts.append(f"-{total_follows_removed}")
        summary_parts.append(f"📣{''.join(follow_parts)}")

    if total_stars_added or total_stars_removed:
        star_parts = []
        if total_stars_added:
            star_parts.append(f"+{total_stars_added}")
        if total_stars_removed:
            star_parts.append(f"-{total_stars_removed}")
        summary_parts.append(f"⭐️{''.join(star_parts)}")

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
        path_type, metadata = infer_path_type(filepath)
        if path_type == 'stars':
            new_repos.append(metadata['repo_key'])
        elif path_type == 'follows':
            new_repos.append(metadata['user'])

    if new_repos:
        details.append(f"- 📂 +{', '.join(new_repos)}")

    # Combine summary and details
    if details:
        return f"{summary}\n\n" + "\n".join(details)
    else:
        return summary


@main.command
@option("-n", "--dry-run", is_flag=True, help="Show what would be committed without actually committing")
@option("--fixup", is_flag=True, help="Amend the last commit with a new message based on its changes")
@option("-r", "--ref", help="Shorthand for analyzing a single commit (equivalent to REF^..REF)")
@argument("refspec_str", required=False)
def commit(refspec_str: str, dry_run: bool, fixup: bool, ref: str):
    """Generate and create a commit with a formatted message based on Git changes.

    By default, analyzes uncommitted changes from 'watchy stars' and 'watchy follows' commands.
    If COMMIT_RANGE is provided, analyzes those specific commits instead.

    COMMIT_RANGE can be:
    - A single commit: HEAD, abc123, HEAD~3
    - A range: HEAD~3..HEAD, main..feature-branch

    Creates a commit with a nicely formatted message showing:
    - 📣 Follow additions/removals by user
    - ⭐️ Star additions/removals by repository
    - 📂 New repositories being tracked

    Use --dry-run to preview the commit message without committing.
    Use --fixup to rewrite the last commit's message based on its changes.
    Use -r/--ref REF as shorthand for analyzing a single commit (REF^..REF).
    """
    # Check if we're in a git repository
    if not proc.check("git", "rev-parse", "--git-dir"):
        err("Not in a git repository")
        exit(1)

    # Validate conflicting options
    if sum(bool(x) for x in [refspec_str, fixup, ref]) > 1:
        err("Cannot use multiple commit specification options together")
        exit(1)

    # Handle --fixup option
    if fixup:
        # For fixup, analyze the HEAD commit
        refspec_str = "HEAD"

    # Handle -r/--ref option
    if ref:
        # Convert single ref to range: REF^..REF
        refspec_str = f"{ref}^..{ref}"

    # Parse the git changes
    changes = parse_git_changes(refspec_str)
    if changes is None:
        err("Failed to parse git changes")
        exit(1)

    # Generate commit message
    commit_message = format_commit_message(changes)

    if (refspec_str and not fixup) or dry_run:
        if refspec_str:
            echo(f"Commit message for {refspec_str}:")
        else:
            echo("Commit message preview:")
        echo("=" * 50)
        echo(commit_message)
        echo("=" * 50)

        # If analyzing specific commits (but not fixing up), don't actually commit
        if refspec_str and not fixup:
            return
        elif dry_run:
            return

    # Handle fixup vs normal commit differently
    try:
        if fixup:
            # For fixup, just rewrite the commit message
            proc.run("git", "commit", "--amend", "-m", commit_message)
            echo(f"Fixed up commit with new message:")
            echo(commit_message)
        else:
            # Check if there are any changes to commit
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
