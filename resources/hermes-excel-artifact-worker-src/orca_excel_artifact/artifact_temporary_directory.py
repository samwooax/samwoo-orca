"""Temporary artifact directories with bounded Windows cleanup retries."""

from __future__ import annotations

import os
import shutil
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


WINDOWS_CLEANUP_SECONDS = 5.0


def _deletion_path(path: Path) -> str:
    value = os.path.abspath(path)
    if os.name != "nt" or value.startswith("\\\\?\\"):
        return value
    if value.startswith("\\\\"):
        return f"\\\\?\\UNC\\{value[2:]}"
    return f"\\\\?\\{value}"


def _remove_directory(path: Path) -> None:
    deadline = time.monotonic() + (WINDOWS_CLEANUP_SECONDS if os.name == "nt" else 0)
    delay = 0.05
    deletion_path = _deletion_path(path)
    while True:
        try:
            shutil.rmtree(deletion_path)
            return
        except FileNotFoundError:
            return
        except OSError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 0.5)


@contextmanager
def artifact_temporary_directory(
    *, prefix: str, directory: Path | str | None = None
) -> Iterator[Path]:
    path = Path(tempfile.mkdtemp(prefix=prefix, dir=directory))
    try:
        yield path
    finally:
        _remove_directory(path)
