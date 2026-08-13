"""Conversation-scoped binary artifact registry with opaque public handles."""

from __future__ import annotations

import hashlib
import os
import shutil
import stat as stat_module
import tempfile
import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .errors import ArtifactError
from .limits import DEFAULT_LIMITS, ArtifactLimits
from .protocol import validate_artifact


MAX_ARTIFACT_TTL = timedelta(hours=24)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def _safe_display_name(name: str) -> str:
    clean = Path(name.replace("\\", "/")).name.strip()
    if not clean or "\x00" in clean or len(clean) > 255:
        raise ArtifactError(
            "input_format_invalid",
            "The artifact display name is invalid.",
            "Attach the file again with a short filename.",
        )
    return clean


@dataclass(slots=True)
class ArtifactRecord:
    artifact_id: str
    display_name: str
    mime_type: str
    size: int
    sha256: str
    owner: str
    conversation_id: str
    request_id: str
    consumers: tuple[str, ...]
    operations: tuple[str, ...]
    source: str
    created_at: str
    expires_at: str
    cleanup_status: str = "pending"
    _path: Path = field(repr=False, default=Path())

    def public_dict(self) -> dict[str, object]:
        """Return metadata without the device-local storage path."""

        return {
            "artifactId": self.artifact_id,
            "displayName": self.display_name,
            "mimeType": self.mime_type,
            "size": self.size,
            "sha256": self.sha256,
            "owner": self.owner,
            "conversationId": self.conversation_id,
            "requestId": self.request_id,
            "allowedConsumers": list(self.consumers),
            "allowedOperations": list(self.operations),
            "source": self.source,
            "createdAt": self.created_at,
            "expiresAt": self.expires_at,
            "cleanupStatus": self.cleanup_status,
        }


@dataclass(frozen=True, slots=True)
class ResolvedArtifact:
    """Trusted immutable identity returned with a private artifact path."""

    path: Path = field(repr=False)
    sha256: str
    size: int
    artifact_id: str


class ArtifactStore:
    """Store immutable binary inputs in a private Orca-owned temp root."""

    def __init__(
        self,
        root: Path | None = None,
        *,
        limits: ArtifactLimits = DEFAULT_LIMITS,
        ttl: timedelta = timedelta(hours=1),
    ) -> None:
        if ttl <= timedelta(0) or ttl > MAX_ARTIFACT_TTL:
            raise ValueError("artifact TTL must be positive and no more than 24 hours")
        self._owns_root = root is None
        self.root = Path(root or tempfile.mkdtemp(prefix="orca-excel-artifacts-"))
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            root_info = self.root.lstat()
        except OSError:
            raise ValueError("artifact root must be an existing private directory") from None
        if stat_module.S_ISLNK(root_info.st_mode) or not stat_module.S_ISDIR(root_info.st_mode):
            raise ValueError("artifact root must be a real directory, not a symbolic link")
        self.root = self.root.resolve(strict=True)
        try:
            os.chmod(self.root, 0o700)
        except OSError:
            pass
        self._limits = limits
        self._ttl = ttl
        self._records: dict[str, ArtifactRecord] = {}
        self._lock = threading.RLock()

    def ingest(
        self,
        source_path: Path,
        *,
        display_name: str,
        mime_type: str,
        owner: str,
        conversation_id: str,
        request_id: str,
        consumers: tuple[str, ...] = ("excel-artifact-v1",),
        operations: tuple[str, ...] = ("inspect", "create", "modify", "validate", "render"),
        source: str = "attachment",
    ) -> ArtifactRecord:
        path = Path(source_path)
        safe_display_name = _safe_display_name(display_name)
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        try:
            path_stat = path.lstat()
            if stat_module.S_ISLNK(path_stat.st_mode) or not stat_module.S_ISREG(path_stat.st_mode):
                raise OSError("not a regular file")
            source_fd = os.open(path, flags)
        except FileNotFoundError:
            raise ArtifactError("input_not_found", "The binary input was not found.", "Attach it again.") from None
        except OSError:
            raise ArtifactError(
                "input_format_invalid",
                "The binary input must be a regular file.",
                "Attach a regular file instead of a link or directory.",
            ) from None
        source_stream = os.fdopen(source_fd, "rb")
        source_stat = os.fstat(source_stream.fileno())
        source_identity = (
            source_stat.st_dev,
            source_stat.st_ino,
            source_stat.st_size,
            source_stat.st_mtime_ns,
        )
        if (
            not stat_module.S_ISREG(source_stat.st_mode)
            or source_stat.st_dev != path_stat.st_dev
            or source_stat.st_ino != path_stat.st_ino
        ):
            source_stream.close()
            raise ArtifactError(
                "input_format_invalid",
                "The binary input must be a regular file.",
                "Attach a regular file instead of a link or directory.",
            )
        if source_stat.st_size <= 0 or source_stat.st_size > self._limits.max_input_bytes:
            source_stream.close()
            raise ArtifactError(
                "archive_limit_exceeded",
                "The binary input exceeds the configured size budget.",
                "Use a smaller input artifact.",
                {"maxBytes": self._limits.max_input_bytes},
            )

        artifact_id = f"art_{uuid.uuid4().hex}"
        destination = self.root / artifact_id
        digest = hashlib.sha256()
        written = 0
        try:
            with source_stream, destination.open("xb") as target_stream:
                while chunk := source_stream.read(1024 * 1024):
                    written += len(chunk)
                    if written > self._limits.max_input_bytes:
                        raise ArtifactError(
                            "archive_limit_exceeded",
                            "The binary input grew beyond the size budget while it was read.",
                            "Attach a stable, smaller file.",
                        )
                    digest.update(chunk)
                    target_stream.write(chunk)
                final_source_stat = os.fstat(source_stream.fileno())
                final_source_identity = (
                    final_source_stat.st_dev,
                    final_source_stat.st_ino,
                    final_source_stat.st_size,
                    final_source_stat.st_mtime_ns,
                )
                if written != source_stat.st_size or final_source_identity != source_identity:
                    raise ArtifactError(
                        "input_hash_mismatch",
                        "The binary input changed while it was ingested.",
                        "Wait for the producing application to finish and attach it again.",
                    )
                target_stream.flush()
                os.fsync(target_stream.fileno())
            try:
                os.chmod(destination, 0o600)
            except OSError:
                pass
        except Exception:
            destination.unlink(missing_ok=True)
            raise

        now = datetime.now(UTC)
        record = ArtifactRecord(
            artifact_id=artifact_id,
            display_name=safe_display_name,
            mime_type=str(mime_type),
            size=written,
            sha256=digest.hexdigest(),
            owner=str(owner),
            conversation_id=str(conversation_id),
            request_id=str(request_id),
            consumers=tuple(consumers),
            operations=tuple(operations),
            source=str(source),
            created_at=_iso(now),
            expires_at=_iso(now + self._ttl),
            _path=destination,
        )
        try:
            validate_artifact(record.public_dict())
        except ArtifactError:
            destination.unlink(missing_ok=True)
            raise
        with self._lock:
            self._records[artifact_id] = record
        return record

    def resolve(
        self,
        artifact_id: str,
        *,
        owner: str,
        conversation_id: str,
        request_id: str,
        consumer: str,
        operation: str,
        expected_sha256: str | None = None,
    ) -> tuple[ArtifactRecord, ResolvedArtifact]:
        with self._lock:
            record = self._records.get(artifact_id)
            if record is None or record.cleanup_status != "pending":
                raise ArtifactError("input_not_found", "The artifact is unavailable.", "Attach it again.")
            if record.conversation_id != conversation_id:
                raise ArtifactError(
                    "workspace_unauthorized",
                    "The artifact belongs to another conversation.",
                    "Use an artifact attached to the current conversation.",
                )
            if record.owner != owner or record.request_id != request_id:
                raise ArtifactError(
                    "workspace_unauthorized",
                    "The artifact is not owned by the current request principal.",
                    "Use the attachment admitted for this owner and request.",
                )
            if consumer not in record.consumers or operation not in record.operations:
                raise ArtifactError(
                    "workspace_unauthorized",
                    "The artifact is not authorized for this operation.",
                    "Choose an authorized artifact and action.",
                )
            if datetime.now(UTC) >= datetime.fromisoformat(record.expires_at):
                self._cleanup_record(record)
                raise ArtifactError("input_not_found", "The artifact expired.", "Attach it again.")
            try:
                path_stat = record._path.lstat()
                flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
                descriptor = os.open(record._path, flags)
                stream = os.fdopen(descriptor, "rb")
                current_stat = os.fstat(stream.fileno())
                if (
                    stat_module.S_ISLNK(path_stat.st_mode)
                    or not stat_module.S_ISREG(current_stat.st_mode)
                    or current_stat.st_size != record.size
                    or current_stat.st_dev != path_stat.st_dev
                    or current_stat.st_ino != path_stat.st_ino
                ):
                    stream.close()
                    raise OSError("artifact identity changed")
                digest = hashlib.sha256()
                with stream:
                    while chunk := stream.read(1024 * 1024):
                        digest.update(chunk)
                if digest.hexdigest() != record.sha256:
                    raise OSError("artifact content changed")
            except OSError:
                self._cleanup_record(record)
                raise ArtifactError(
                    "input_hash_mismatch",
                    "The stored artifact changed after ingestion.",
                    "Attach the original file again.",
                ) from None
            if expected_sha256 and expected_sha256.lower() != record.sha256:
                raise ArtifactError(
                    "input_hash_mismatch",
                    "The artifact hash does not match the request.",
                    "Refresh the attachment metadata and retry.",
                )
            return record, ResolvedArtifact(
                path=record._path,
                sha256=record.sha256,
                size=record.size,
                artifact_id=record.artifact_id,
            )

    def cleanup(
        self,
        artifact_id: str,
        *,
        owner: str,
        conversation_id: str,
        request_id: str,
    ) -> str:
        with self._lock:
            record = self._records.get(artifact_id)
            if not record:
                return "already_removed"
            if (
                record.owner != owner
                or record.conversation_id != conversation_id
                or record.request_id != request_id
            ):
                raise ArtifactError(
                    "workspace_unauthorized",
                    "The artifact cannot be cleaned by this request principal.",
                    "Clean up only artifacts owned by the current owner, conversation, and request.",
                )
            self._cleanup_record(record)
            return record.cleanup_status

    def cleanup_expired(self) -> int:
        cleaned = 0
        now = datetime.now(UTC)
        with self._lock:
            for record in self._records.values():
                if record.cleanup_status == "pending" and now >= datetime.fromisoformat(record.expires_at):
                    self._cleanup_record(record)
                    cleaned += 1
        return cleaned

    def _cleanup_record(self, record: ArtifactRecord) -> None:
        try:
            record._path.unlink(missing_ok=True)
            record.cleanup_status = "removed"
        except OSError:
            record.cleanup_status = "failed"

    def close(self) -> None:
        with self._lock:
            for record in self._records.values():
                if record.cleanup_status == "pending":
                    self._cleanup_record(record)
        if self._owns_root:
            shutil.rmtree(self.root, ignore_errors=True)
