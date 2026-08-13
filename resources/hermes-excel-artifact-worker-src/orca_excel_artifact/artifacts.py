"""Internal artifact references and path-free public result helpers.

Filesystem paths deliberately live only on these worker-internal objects.  An Orca
integration must exchange them for an opaque, authority-checked artifact handle
before serialising a result across the Runtime boundary.
"""

from __future__ import annotations

import hashlib
import hmac
import mimetypes
import os
import re
import stat
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

from .errors import ArtifactError
from .limits import ArtifactLimits, DEFAULT_LIMITS


class ArtifactKind(StrEnum):
    XLSX = "xlsx"
    PPTX = "pptx"
    PDF = "pdf"
    PNG = "png"
    JPEG = "jpeg"


MEDIA_TYPES: dict[ArtifactKind, str] = {
    ArtifactKind.XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ArtifactKind.PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ArtifactKind.PDF: "application/pdf",
    ArtifactKind.PNG: "image/png",
    ArtifactKind.JPEG: "image/jpeg",
}
_OPAQUE_ARTIFACT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")


def parse_artifact_kind(value: ArtifactKind | str) -> ArtifactKind:
    try:
        normalized = str(value).strip().lower()
        if normalized == "jpg":
            normalized = "jpeg"
        return ArtifactKind(normalized)
    except (TypeError, ValueError):
        raise ArtifactError(
            "protocol_invalid",
            "The requested input kind is unsupported.",
            "Use one of: xlsx, pptx, pdf, png, or jpeg.",
        ) from None


def _regular_file_size(path: Path, *, max_bytes: int) -> int:
    """Return a file size without following a caller-controlled symlink."""

    try:
        info = path.lstat()
    except FileNotFoundError:
        raise ArtifactError(
            "input_not_found",
            "The input artifact was not found.",
            "Select the artifact again and retry.",
        ) from None
    except OSError:
        raise ArtifactError(
            "input_format_invalid",
            "The input artifact could not be inspected.",
            "Select a readable regular file and retry.",
        ) from None
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ArtifactError(
            "input_format_invalid",
            "The input artifact must be a regular file, not a link or special file.",
            "Copy the artifact into the authorised workspace and retry.",
        )
    if info.st_size <= 0:
        raise ArtifactError(
            "input_format_invalid",
            "The input artifact is empty.",
            "Provide a non-empty artifact.",
        )
    if info.st_size > max_bytes:
        raise ArtifactError(
            "archive_limit_exceeded",
            "The input artifact exceeds the configured byte limit.",
            "Use a smaller artifact or an explicitly reviewed higher worker limit.",
            {"limitBytes": max_bytes, "actualBytes": info.st_size},
        )
    return info.st_size


def sha256_file(
    path: Path | str,
    *,
    max_bytes: int | None = None,
    limits: ArtifactLimits = DEFAULT_LIMITS,
) -> tuple[str, int]:
    """Hash a bounded regular file through a no-follow, identity-checked FD."""

    candidate = Path(path)
    byte_limit = limits.max_input_bytes if max_bytes is None else max_bytes
    initial_size = _regular_file_size(candidate, max_bytes=byte_limit)
    try:
        before = candidate.lstat()
    except OSError:
        raise ArtifactError(
            "input_format_invalid",
            "The input artifact could not be inspected.",
            "Select a stable regular file and retry.",
        ) from None
    digest = hashlib.sha256()
    consumed = 0
    descriptor: int | None = None
    try:
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(candidate, flags)
        opened = os.fstat(descriptor)
        before_identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        opened_identity = (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns)
        if not stat.S_ISREG(opened.st_mode) or before_identity != opened_identity:
            raise ArtifactError(
                "input_format_invalid",
                "The input artifact changed before it could be opened safely.",
                "Wait for filesystem activity to finish and retry.",
            )
        with os.fdopen(descriptor, "rb", closefd=True) as stream:
            descriptor = None
            while chunk := stream.read(1024 * 1024):
                consumed += len(chunk)
                if consumed > byte_limit:
                    raise ArtifactError(
                        "archive_limit_exceeded",
                        "The input artifact grew beyond the configured byte limit while being read.",
                        "Retry with a stable, smaller artifact.",
                        {"limitBytes": byte_limit},
                    )
                digest.update(chunk)
    except ArtifactError:
        raise
    except OSError:
        raise ArtifactError(
            "input_format_invalid",
            "The input artifact could not be read.",
            "Ensure the artifact is stable and readable, then retry.",
        ) from None
    finally:
        if descriptor is not None:
            os.close(descriptor)
    try:
        after = candidate.lstat()
    except OSError:
        raise ArtifactError(
            "input_format_invalid",
            "The input artifact changed while it was inspected.",
            "Wait for the producing process to finish and retry.",
        ) from None
    after_identity = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    if consumed != initial_size or before_identity != after_identity:
        raise ArtifactError(
            "input_format_invalid",
            "The input artifact changed while it was being inspected.",
            "Wait for the producing process to finish and retry.",
        )
    return digest.hexdigest(), consumed


def verify_expected_sha256(actual: str, expected: str | None) -> None:
    if expected is None:
        return
    normalized = expected.strip().lower()
    if len(normalized) != 64 or any(character not in "0123456789abcdef" for character in normalized):
        raise ArtifactError(
            "protocol_invalid",
            "The expected input SHA-256 is malformed.",
            "Provide a lowercase or uppercase 64-character hexadecimal SHA-256.",
        )
    if not hmac.compare_digest(actual, normalized):
        raise ArtifactError(
            "input_hash_mismatch",
            "The input artifact hash does not match the admitted artifact.",
            "Re-admit the artifact and submit the request with its current SHA-256.",
        )


@dataclass(frozen=True, slots=True)
class LocalArtifact:
    """A worker-local file reference that cannot serialise its path by accident."""

    _path: Path = field(repr=False)
    sha256: str
    size_bytes: int
    media_type: str
    kind: str
    width: int | None = None
    height: int | None = None
    index: int | None = None

    @classmethod
    def from_path(
        cls,
        path: Path | str,
        *,
        kind: str,
        media_type: str | None = None,
        width: int | None = None,
        height: int | None = None,
        index: int | None = None,
        limits: ArtifactLimits = DEFAULT_LIMITS,
    ) -> "LocalArtifact":
        candidate = Path(path)
        digest, size = sha256_file(candidate, max_bytes=limits.max_output_bytes, limits=limits)
        detected_media = media_type or mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        return cls(candidate, digest, size, detected_media, kind, width, height, index)

    @property
    def path(self) -> Path:
        """Internal-only path used by the Orca-side artifact registrar."""

        return self._path

    def to_public_dict(self, artifact_id: str) -> dict[str, Any]:
        if not isinstance(artifact_id, str) or not _OPAQUE_ARTIFACT_ID.fullmatch(artifact_id):
            raise ValueError("a canonical opaque artifactId is required")
        result: dict[str, Any] = {
            "artifactId": artifact_id,
            "sha256": self.sha256,
            "sizeBytes": self.size_bytes,
            "mediaType": self.media_type,
            "kind": self.kind,
        }
        if self.width is not None:
            result["width"] = self.width
        if self.height is not None:
            result["height"] = self.height
        if self.index is not None:
            result["index"] = self.index
        return result


@dataclass(frozen=True, slots=True)
class PreviewBundle:
    """Rendered artifacts plus a path-free public projection."""

    source_kind: ArtifactKind
    items: tuple[LocalArtifact, ...]
    contact_sheet: LocalArtifact | None = None
    warnings: tuple[dict[str, Any], ...] = ()

    @property
    def local_artifacts(self) -> tuple[LocalArtifact, ...]:
        if self.contact_sheet is None:
            return self.items
        return (*self.items, self.contact_sheet)

    def to_public_dict(self, register: Callable[[Path], str]) -> dict[str, Any]:
        """Register paths locally and return only opaque handles to the caller."""

        previews = [item.to_public_dict(register(item.path)) for item in self.items]
        result: dict[str, Any] = {
            "sourceKind": self.source_kind.value,
            "previews": previews,
            "warnings": list(self.warnings),
        }
        if self.contact_sheet is not None:
            result["contactSheet"] = self.contact_sheet.to_public_dict(register(self.contact_sheet.path))
        return result


def total_artifact_bytes(artifacts: Iterable[LocalArtifact]) -> int:
    return sum(item.size_bytes for item in artifacts)


def ensure_private_directory(path: Path | str) -> Path:
    """Create or validate a worker-owned output directory without following a link."""

    candidate = Path(path)
    try:
        candidate.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = candidate.lstat()
    except OSError:
        raise ArtifactError(
            "output_path_invalid",
            "The preview output directory is unavailable.",
            "Select a writable worker-owned artifact directory.",
        ) from None
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise ArtifactError(
            "output_path_invalid",
            "The preview output location must be a real directory.",
            "Use a worker-owned directory that is not a symbolic link.",
        )
    try:
        os.chmod(candidate, 0o700)
    except OSError:
        # Windows and some mounted filesystems do not implement POSIX permissions.
        pass
    return candidate
