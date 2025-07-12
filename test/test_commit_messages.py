"""Tests for commit message inference from actual GHA commits."""

import os
import sys
from pathlib import Path

import pytest
from git import Repo

# Add src to path so we can import watchy modules
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from watchy.cli.commit import format_commit_message, parse_commit_range_changes


class TestCommitMessageInference:
    """Test commit message inference against real GHA commits in .watchy."""

    @classmethod
    def setup_class(cls):
        """Set up test class with .watchy repo."""
        cls.watchy_dir = Path(__file__).parent.parent / ".watchy"
        if not cls.watchy_dir.exists():
            pytest.fail("No .watchy directory found - tests require cloned .watchy repo")

        # Change to .watchy directory for git operations
        cls.original_cwd = os.getcwd()
        os.chdir(cls.watchy_dir)

        cls.repo = Repo('.')

    @classmethod
    def teardown_class(cls):
        """Restore original working directory."""
        os.chdir(cls.original_cwd)

    def test_recent_gha_commits_exist(self):
        """Verify we have some recent GHA commits to test against."""
        commits = list(self.repo.iter_commits("HEAD~10..HEAD"))
        gha_commits = [c for c in commits if c.message.strip().startswith("GHA")]
        assert len(gha_commits) >= 3, "Need at least 3 GHA commits for testing"

    def test_new_file_creation_commit(self):
        """Test commit message for new file creation (first time tracking a repo)."""
        # Test against commit d3818c4 which creates Open-Athena/binder-lab.txt
        commit_sha = "d3818c4"
        commit = self.repo.commit(commit_sha)  # Let it fail if not found

        # Parse changes for this specific commit
        changes = parse_commit_range_changes(commit_sha)
        assert changes is not None, "Failed to parse commit changes"

        # Generate commit message
        message = format_commit_message(changes)

        # Verify exact message content
        expected_lines = [
            "GHA: 📂+1",
            "",
            "- 📂 +Open-Athena/binder-lab"
        ]
        actual_lines = message.split('\n')
        assert actual_lines == expected_lines, f"Expected exact lines {expected_lines}, got {actual_lines}"

    def test_single_star_change_commit(self):
        """Test commit message for a single star change (addition/removal)."""
        # Test against commit 6e508a0 which changes 1 star in Open-Athena/binder-lab
        commit_sha = "6e508a0"
        commit = self.repo.commit(commit_sha)  # Let it fail if not found

        changes = parse_commit_range_changes(commit_sha)
        assert changes is not None, "Failed to parse commit changes"

        message = format_commit_message(changes)
        actual_lines = message.split('\n')

        # This commit should show star activity - verify the exact structure
        assert actual_lines[0].startswith("GHA: "), "First line should start with 'GHA: '"
        assert "⭐️" in actual_lines[0], "Should show star activity in summary"
        assert "Open-Athena/binder-lab" in message, "Should mention the repo"

        # Should have summary + empty line + details structure
        assert len(actual_lines) >= 3, "Should have summary, empty line, and details"
        assert actual_lines[1] == "", "Second line should be empty"

        # Should have a detail line mentioning the repo
        detail_lines = [line for line in actual_lines[2:] if "Open-Athena/binder-lab" in line]
        assert len(detail_lines) == 1, "Should have exactly one detail line for the repo"
        assert detail_lines[0].startswith("- ⭐️ Open-Athena/binder-lab:"), "Detail line should start with star emoji and repo"

    def test_commit_range_analysis(self):
        """Test analyzing a range of commits."""
        # Test the last 3 GHA commits
        commit_range = "HEAD~3..HEAD"

        changes = parse_commit_range_changes(commit_range)
        assert changes is not None, "Failed to parse commit range changes"

        message = format_commit_message(changes)
        actual_lines = message.split('\n')

        # Verify structure
        assert actual_lines[0].startswith("GHA: "), "First line should start with 'GHA: '"

        # Since we're aggregating multiple commits, should have some structure
        if len(actual_lines) > 1:
            # If there are details, should have empty line separator
            assert actual_lines[1] == "", "Second line should be empty if details exist"
            # And some detail lines
            detail_lines = [line for line in actual_lines[2:] if line.startswith("- ")]
            assert len(detail_lines) > 0, "Should have some detail lines for aggregated changes"

    def test_message_format_structure(self):
        """Test that generated messages follow the expected format."""
        # Test against HEAD commit which we know has specific content
        commit_sha = "HEAD"

        changes = parse_commit_range_changes(commit_sha)
        assert changes is not None, "Should be able to parse HEAD commit"

        message = format_commit_message(changes)
        lines = message.split('\n')

        # Verify exact expected content for HEAD commit
        expected_lines = [
            "GHA: ⭐️+1",
            "",
            "- ⭐️ Open-Athena/binder-lab: +ryan-williams"
        ]
        assert lines == expected_lines, f"Expected exact lines {expected_lines}, got {lines}"

    def test_no_changes_message(self):
        """Test message when there are no relevant changes."""
        # Create empty changes dict
        empty_changes = {
            'stars': {'added': {}, 'removed': {}},
            'follows': {'added': {}, 'removed': {}},
            'new_files': set()
        }

        message = format_commit_message(empty_changes)
        # Should be exactly one line with no changes message
        expected_lines = ["GHA: No significant changes"]
        actual_lines = message.split('\n')
        assert actual_lines == expected_lines, f"Expected exact lines {expected_lines}, got {actual_lines}"

    def test_path_inference_in_changes(self):
        """Test that path inference correctly categorizes changes."""
        # Test a commit that we know has changes
        commit_sha = "d3818c4"  # Known to create new file

        changes = parse_commit_range_changes(commit_sha)  # Let it fail if commit not found
        assert changes is not None, "Should successfully parse commit changes"

        # Verify changes are properly categorized
        assert isinstance(changes, dict), "Changes should be a dict"
        assert 'stars' in changes, "Should have stars category"
        assert 'follows' in changes, "Should have follows category"
        assert 'new_files' in changes, "Should have new_files category"

        # This specific commit should have new files
        assert len(changes['new_files']) > 0, "This commit should have new files"
        assert 'github/stars/Open-Athena/binder-lab.txt' in changes['new_files'], \
            "Should detect the specific new file"

        # If there are star changes, verify they're properly formatted
        if changes['stars']['added'] or changes['stars']['removed']:
            # Repo keys should be in "owner/repo" format
            all_repos = set(changes['stars']['added'].keys()) | set(changes['stars']['removed'].keys())
            for repo_key in all_repos:
                assert '/' in repo_key, f"Repo key '{repo_key}' should be in 'owner/repo' format"

    @pytest.mark.parametrize("commit_ref,expected_lines", [
        ("HEAD", [
            "GHA: ⭐️+1",
            "",
            "- ⭐️ Open-Athena/binder-lab: +ryan-williams"
        ]),
        ("HEAD~1", [
            "GHA: 📂+1",
            "",
            "- 📂 +Open-Athena/binder-lab"
        ]),
        ("HEAD~2", [
            "GHA: 📣+1",
            "",
            "- 📣 ryan-williams: +alxmrs"
        ])
    ])
    def test_multiple_recent_commits(self, commit_ref, expected_lines):
        """Test message generation for multiple recent commits."""
        changes = parse_commit_range_changes(commit_ref)  # Let it fail if commit not found
        assert changes is not None, f"Should successfully parse commit {commit_ref}"

        message = format_commit_message(changes)
        lines = message.split('\n')

        # Verify exact expected content
        assert lines == expected_lines, f"Commit {commit_ref} - Expected exact lines {expected_lines}, got {lines}"

    def test_specific_commit_message_content(self):
        """Test the exact content of specific known commits."""
        # Test specific commits with their expected exact output
        test_cases = [
            {
                "commit": "d3818c4",
                "expected_lines": [
                    "GHA: 📂+1",
                    "",
                    "- 📂 +Open-Athena/binder-lab"
                ]
            },
        ]

        for case in test_cases:
            commit = self.repo.commit(case["commit"])  # Let it fail if not found
            changes = parse_commit_range_changes(case["commit"])
            assert changes is not None, f"Failed to parse commit {case['commit']}"

            message = format_commit_message(changes)
            actual_lines = message.split('\n')

            # Verify exact line-by-line match
            assert actual_lines == case["expected_lines"], \
                f"Commit {case['commit']} - Expected lines {case['expected_lines']}, got {actual_lines}"

    def test_emoji_formatting_edge_cases(self):
        """Test that emoji formatting omits zeros correctly."""
        # Test different combinations of additions/removals
        test_cases = [
            # Only additions
            {
                "changes": {
                    'stars': {'added': {'repo1': {'user1', 'user2'}}, 'removed': {}},
                    'follows': {'added': {}, 'removed': {}},
                    'new_files': set()
                },
                "expected_summary": "GHA: ⭐️+2"
            },
            # Only removals
            {
                "changes": {
                    'stars': {'added': {}, 'removed': {'repo1': {'user1'}}},
                    'follows': {'added': {}, 'removed': {}},
                    'new_files': set()
                },
                "expected_summary": "GHA: ⭐️-1"
            },
            # Both additions and removals
            {
                "changes": {
                    'stars': {'added': {'repo1': {'user1'}}, 'removed': {'repo2': {'user2'}}},
                    'follows': {'added': {}, 'removed': {}},
                    'new_files': set()
                },
                "expected_summary": "GHA: ⭐️+1-1"
            },
            # Mixed scenario with follows
            {
                "changes": {
                    'stars': {'added': {'repo1': {'user1'}}, 'removed': {}},
                    'follows': {'added': {'user1': {'follower1'}}, 'removed': {'user2': {'follower2'}}},
                    'new_files': {'file1.txt'}
                },
                "expected_summary": "GHA: 📣+1-1, ⭐️+1, 📂+1"
            }
        ]

        for i, case in enumerate(test_cases):
            message = format_commit_message(case["changes"])
            actual_summary = message.split('\n')[0]
            assert actual_summary == case["expected_summary"], \
                f"Test case {i+1} - Expected '{case['expected_summary']}', got '{actual_summary}'"
