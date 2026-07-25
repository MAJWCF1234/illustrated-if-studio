"""Illustrated IF — graphical desktop player (pygame renderer).

Presentation layer only: story logic, saves, and rollback come from the
shared ``if_engine`` runtime. Importing ``if_gui`` itself does not require
pygame; the dependency is pulled in lazily by :func:`main` so headless
tooling can keep using ``if_engine`` without a display or pygame installed.
"""

from __future__ import annotations

from pathlib import Path

__all__ = ["main"]


def main(project_dir: "Path | str") -> int:
    from .app import run

    return run(project_dir)
