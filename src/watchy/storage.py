"""Data storage utilities for text and JSONL output."""

import json
import sys
from pathlib import Path
from typing import Iterator, Dict, Any, Union


def save_logins_to_txt(data: Iterator[Dict[str, Any]], file_path: Path) -> None:
    """Save login names to a text file, one per line."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    logins = [item["login"] for item in data]
    file_path.write_text("\n".join(logins) + "\n")


def write_logins_to_stdout(data: Iterator[Dict[str, Any]]) -> None:
    """Write login names to stdout, one per line."""
    for item in data:
        print(item["login"])
