"""Data storage utilities for Parquet and JSONL output."""

import json
import sys
from pathlib import Path
from typing import Iterator, Dict, Any
import pandas as pd


def save_to_parquet(data: Iterator[Dict[str, Any]], file_path: Path) -> None:
    """Save data to a Parquet file."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(list(data))
    df.to_parquet(file_path, index=False)


def write_to_jsonl(data: Iterator[Dict[str, Any]], output_file=None) -> None:
    """Write data to JSONL format (stdout or file)."""
    output = output_file or sys.stdout
    for item in data:
        print(json.dumps(item), file=output)
