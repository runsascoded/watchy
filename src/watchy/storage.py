"""Data storage utilities for text and JSONL output."""

import json
import sys
from pathlib import Path
from typing import Iterator, Dict, Any, Union


def save_logins_to_txt(data: Iterator[Dict[str, Any]], file_path: Path) -> list[str]:
    """Save login names to a text file, one per line. Returns list of logins."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    logins = [item["login"] for item in data]
    file_content = "\n".join(logins) + "\n"
    file_path.write_text(file_content)
    return logins


def print_logins_limited(logins: list[str]) -> None:
    """Print logins to stdout, limited to first and last 5 with ellipsis if more than 10."""
    if len(logins) <= 10:
        for login in logins:
            print(login)
    else:
        # Print first 5, ellipsis, then last 5
        for login in logins[:5]:
            print(login)
        print("...")
        for login in logins[-5:]:
            print(login)


def write_logins_to_stdout(data: Iterator[Dict[str, Any]]) -> None:
    """Write login names to stdout, one per line."""
    logins = [item["login"] for item in data]
    print_logins_limited(logins)
