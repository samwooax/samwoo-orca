"""Orca-owned JSON-lines host for the frozen Excel Artifact worker."""

from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any

from orca_excel_artifact.artifact_store import ResolvedArtifact
from orca_excel_artifact.capabilities import ExcelArtifactCapability, detect_capability
from orca_excel_artifact.errors import ArtifactError
from orca_excel_artifact.worker import WorkerContext, run_job
from orca_document_worker import run_document_job


def _request(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("host request must be an object")
    return value


def _artifact_resolver(values: object):
    if not isinstance(values, list):
        raise ValueError("artifacts must be an array")
    artifacts: dict[str, ResolvedArtifact] = {}
    for value in values:
        if not isinstance(value, dict):
            raise ValueError("artifact metadata must be an object")
        artifact_id = str(value["artifactId"])
        artifacts[artifact_id] = ResolvedArtifact(
            Path(str(value["path"])),
            str(value["sha256"]),
            int(value["sizeBytes"]),
            artifact_id,
        )

    def resolve(artifact_id: str) -> ResolvedArtifact:
        return artifacts[artifact_id]

    return resolve


def _capability() -> ExcelArtifactCapability:
    return detect_capability(render_sandbox_verified=False)


def _run(value: dict[str, Any]) -> dict[str, Any]:
    action = value.get("hostAction")
    capability = _capability()
    if action == "capability":
        return {"ok": True, "capability": capability.public_dict()}
    if action == "document":
        return run_document_job(_request(value.get("documentRequest")))
    if action != "run":
        raise ValueError("hostAction must be capability or run")
    context = WorkerContext.for_workspace(
        Path(str(value["workspace"])),
        artifact_resolver=_artifact_resolver(value.get("artifacts", [])),
        negotiated_capability=capability,
    )
    return run_job(_request(value["request"]), context, job_id=str(value["jobId"]))


def main() -> int:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            response = _run(_request(json.loads(line.lstrip("\ufeff"))))
        except ArtifactError as error:
            response = {"ok": False, "error": error.to_dict()}
        except Exception:
            if os.environ.get("ORCA_ARTIFACT_DEBUG") == "1":
                traceback.print_exc(file=sys.stderr)
            response = {
                "ok": False,
                "error": {
                    "code": "protocol_invalid",
                    "message": "The Orca artifact host rejected the request.",
                    "recovery": "Retry through a supported Orca build.",
                    "details": {},
                },
            }
        print(json.dumps(response, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
