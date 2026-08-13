"""JSON-lines command interface for the isolated reference worker."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import uuid
from pathlib import Path
from typing import Any

from .errors import ArtifactError
from .worker import WorkerContext, run_job


def _artifact_mappings(values: list[str]) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for value in values:
        artifact_id, separator, raw_path = value.partition("=")
        if not separator or not artifact_id or not raw_path or artifact_id in result:
            raise ValueError("--artifact must be a unique ARTIFACT_ID=/trusted/path mapping")
        result[artifact_id] = Path(raw_path)
    return result


def _decode_request(text: str) -> str | dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("{"):
        value = json.loads(stripped)
        if not isinstance(value, dict):
            raise ValueError("request JSON must be an object")
        return value
    return stripped


def _registrar(root: Path):
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("--artifact-output must be a real directory")

    def register(source: Path, kind: str) -> str:
        artifact_id = f"art_{uuid.uuid4().hex}"
        suffix = source.suffix.casefold()
        destination = root / f"{artifact_id}{suffix}"
        with source.open("rb") as input_stream, destination.open("xb") as output_stream:
            shutil.copyfileobj(input_stream, output_stream, length=1024 * 1024)
        return artifact_id

    return register


def _failure(error: Exception) -> dict[str, Any]:
    if isinstance(error, ArtifactError):
        detail = error.to_dict()
    else:
        detail = {
            "code": "protocol_invalid",
            "message": "The worker request could not be decoded.",
            "recovery": "Send one strict JSON object or one exact protocol envelope per line.",
            "details": {},
        }
    return {"ok": False, "error": detail}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run isolated Excel Artifact v1 jobs")
    parser.add_argument("--workspace", required=True, type=Path, help="trusted selected-project root")
    parser.add_argument("--request", type=Path, help="single request/envelope file; stdin is JSONL otherwise")
    parser.add_argument(
        "--artifact",
        action="append",
        default=[],
        metavar="ID=PATH",
        help="trusted opaque artifact resolution (repeatable)",
    )
    parser.add_argument(
        "--artifact-output",
        type=Path,
        help="trusted private directory for registered preview artifacts",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        mappings = _artifact_mappings(args.artifact)
        registrar = _registrar(args.artifact_output) if args.artifact_output else None
        context = WorkerContext.for_workspace(
            args.workspace,
            artifact_resolver=lambda artifact_id: mappings[artifact_id],
            artifact_registrar=registrar,
        )
    except Exception as error:
        print(json.dumps(_failure(error), ensure_ascii=False, separators=(",", ":")))
        return 2

    if args.request:
        try:
            requests = [args.request.read_text(encoding="utf-8")]
        except (OSError, UnicodeError) as error:
            print(json.dumps(_failure(error), ensure_ascii=False, separators=(",", ":")))
            return 2
    else:
        requests = [line for line in sys.stdin if line.strip()]

    failed = False
    for raw in requests:
        try:
            result = run_job(_decode_request(raw), context)
            failed = failed or result["state"] != "completed"
        except Exception as error:
            result = _failure(error)
            failed = True
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
    return 1 if failed else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
