"""Stable structured errors returned across the Orca trust boundary."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


ERROR_CODES = frozenset(
    {
        "protocol_invalid",
        "protocol_version_unsupported",
        "capability_unsupported",
        "workspace_unauthorized",
        "input_not_found",
        "input_format_invalid",
        "input_hash_mismatch",
        "input_encrypted",
        "archive_limit_exceeded",
        "archive_traversal_detected",
        "output_already_exists",
        "output_path_invalid",
        "dependency_unavailable",
        "conversion_failed",
        "generation_failed",
        "modification_failed",
        "timeout",
        "cancelled",
        "validation_failed",
        "render_unavailable",
        "render_failed",
        "commit_failed",
        "cleanup_failed",
        "job_conflict",
        "job_result_unknown",
    }
)


@dataclass(slots=True)
class ArtifactError(Exception):
    """Sanitized error suitable for a structured artifact result."""

    code: str
    message: str
    recovery: str
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.code not in ERROR_CODES:
            raise ValueError(f"unknown artifact error code: {self.code}")
        Exception.__init__(self, self.message)

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "recovery": self.recovery,
            "details": self.details,
        }
