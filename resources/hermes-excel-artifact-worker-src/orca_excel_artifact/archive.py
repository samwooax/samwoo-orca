"""Bounded ZIP/OPC primitives used by the presentation inspector.

The worker never extracts an input archive.  Every member is addressed through a
validated canonical OPC part name and is read through an explicit byte bound.
"""

from __future__ import annotations

import os
import io
import re
import stat
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from types import MappingProxyType
from typing import Mapping
from urllib.parse import unquote

from .artifacts import sha256_file
from .errors import ArtifactError
from .limits import ArtifactLimits, DEFAULT_LIMITS


ZIP_MAGICS = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")
_DRIVE_PREFIX = re.compile(r"^[A-Za-z]:")


@dataclass(frozen=True, slots=True)
class ZipMember:
    name: str
    size_bytes: int
    compressed_bytes: int
    crc32: int
    compression: int


@dataclass(frozen=True, slots=True)
class ZipInspection:
    _path: Path | None = field(repr=False)
    _payload: bytes | None = field(repr=False)
    members: tuple[ZipMember, ...]
    total_uncompressed_bytes: int
    total_compressed_bytes: int
    _by_name: Mapping[str, ZipMember] = field(repr=False)

    @property
    def path(self) -> Path:
        """Internal-only archive path; never include it in a public result."""

        if self._path is None:
            raise RuntimeError("in-memory archive has no local path")
        return self._path

    def get(self, name: str) -> ZipMember | None:
        return self._by_name.get(name)

    def require(self, name: str) -> ZipMember:
        member = self.get(name)
        if member is None:
            raise ArtifactError(
                "input_format_invalid",
                "The presentation package is missing a required part.",
                "Open and re-save the file as a standard non-encrypted PPTX.",
                {"missingPart": name},
            )
        return member

    @property
    def names(self) -> frozenset[str]:
        return frozenset(self._by_name)


def _canonical_member_name(raw_name: str) -> str:
    # Decoding catches percent-encoded traversal before a future consumer turns
    # the OPC URI into a filesystem path.  Encoded separators are rejected too.
    decoded = raw_name
    for _ in range(3):
        expanded = unquote(decoded)
        if expanded == decoded:
            break
        decoded = expanded
    decoded = decoded.replace("\\", "/")
    if not decoded or "\x00" in decoded:
        raise ArtifactError(
            "archive_traversal_detected",
            "The archive contains an invalid member name.",
            "Re-export the presentation with a trusted Office application.",
        )
    if decoded.startswith(("/", "//")) or _DRIVE_PREFIX.match(decoded):
        raise ArtifactError(
            "archive_traversal_detected",
            "The archive contains an absolute member path.",
            "Re-export the presentation with a trusted Office application.",
        )
    parts = PurePosixPath(decoded).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise ArtifactError(
            "archive_traversal_detected",
            "The archive contains a member path that escapes its package root.",
            "Re-export the presentation with a trusted Office application.",
        )
    canonical = "/".join(parts)
    if raw_name.endswith(("/", "\\")):
        canonical += "/"
    return canonical


def _reject_special_member(info: zipfile.ZipInfo) -> None:
    unix_mode = (info.external_attr >> 16) & 0xFFFF
    file_type = stat.S_IFMT(unix_mode)
    if file_type == stat.S_IFLNK:
        raise ArtifactError(
            "archive_traversal_detected",
            "The archive contains a symbolic-link member.",
            "Remove linked members and re-export the presentation.",
        )
    if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
        raise ArtifactError(
            "archive_traversal_detected",
            "The archive contains a special filesystem member.",
            "Remove special members and re-export the presentation.",
        )


def _check_ratio(info: zipfile.ZipInfo, limits: ArtifactLimits) -> None:
    if info.file_size == 0:
        return
    if info.compress_size <= 0 or info.file_size / info.compress_size > limits.max_compression_ratio:
        raise ArtifactError(
            "archive_limit_exceeded",
            "An archive member exceeds the configured compression-ratio limit.",
            "Re-export the presentation without highly compressed or padded content.",
            {"limitRatio": limits.max_compression_ratio},
        )


def _inspect_open_zip(
    source: Path | io.BytesIO,
    *,
    path: Path | None,
    payload: bytes | None,
    limits: ArtifactLimits,
) -> ZipInspection:
    members: list[ZipMember] = []
    by_name: dict[str, ZipMember] = {}
    casefold_names: set[str] = set()
    total_uncompressed = 0
    total_compressed = 0
    try:
        with zipfile.ZipFile(source, "r") as archive:
            infos = archive.infolist()
            if len(infos) > limits.max_archive_entries:
                raise ArtifactError(
                    "archive_limit_exceeded",
                    "The archive contains too many members.",
                    "Use a smaller presentation.",
                    {"limitEntries": limits.max_archive_entries, "actualEntries": len(infos)},
                )
            for info in infos:
                if info.flag_bits & 0x1:
                    raise ArtifactError(
                        "input_encrypted",
                        "The archive contains an encrypted member.",
                        "Remove password protection and re-export the presentation.",
                    )
                _reject_special_member(info)
                canonical = _canonical_member_name(info.orig_filename)
                folded = canonical.casefold()
                if canonical in by_name or folded in casefold_names:
                    raise ArtifactError(
                        "input_format_invalid",
                        "The archive contains duplicate or case-conflicting member names.",
                        "Re-export the presentation with unique package part names.",
                    )
                if info.file_size > limits.max_archive_entry_bytes:
                    raise ArtifactError(
                        "archive_limit_exceeded",
                        "An archive member exceeds the configured byte limit.",
                        "Reduce embedded media and re-export the presentation.",
                        {"limitBytes": limits.max_archive_entry_bytes},
                    )
                _check_ratio(info, limits)
                total_uncompressed += info.file_size
                total_compressed += info.compress_size
                if total_uncompressed > limits.max_archive_uncompressed_bytes:
                    raise ArtifactError(
                        "archive_limit_exceeded",
                        "The expanded archive exceeds the configured byte limit.",
                        "Reduce embedded content and re-export the presentation.",
                        {"limitBytes": limits.max_archive_uncompressed_bytes},
                    )
                member = ZipMember(
                    name=canonical,
                    size_bytes=info.file_size,
                    compressed_bytes=info.compress_size,
                    crc32=info.CRC,
                    compression=info.compress_type,
                )
                members.append(member)
                by_name[canonical] = member
                casefold_names.add(folded)
    except ArtifactError:
        raise
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, OSError):
        raise ArtifactError(
            "input_format_invalid",
            "The ZIP package is corrupt or uses an unsupported compression method.",
            "Open and re-save the file as a standard PPTX.",
        ) from None

    if not members:
        raise ArtifactError(
            "input_format_invalid",
            "The presentation package is empty.",
            "Provide a valid PPTX file.",
        )
    return ZipInspection(
        path,
        payload,
        tuple(members),
        total_uncompressed,
        total_compressed,
        MappingProxyType(by_name),
    )


def inspect_zip(path: Path | str, *, limits: ArtifactLimits = DEFAULT_LIMITS) -> ZipInspection:
    """Validate ZIP structure and declared resource use without extracting it."""

    candidate = Path(path)
    # This independently enforces regular-file/no-symlink/size checks so callers
    # cannot accidentally use this lower-level API without input admission.
    sha256_file(candidate, max_bytes=limits.max_input_bytes, limits=limits)
    try:
        with candidate.open("rb") as stream:
            magic = stream.read(4)
    except OSError:
        raise ArtifactError(
            "input_format_invalid",
            "The archive could not be read.",
            "Select a readable PPTX file and retry.",
        ) from None
    if magic not in ZIP_MAGICS:
        raise ArtifactError(
            "input_format_invalid",
            "The presentation does not have a ZIP package signature.",
            "Provide a genuine .pptx file rather than a renamed or legacy document.",
        )
    return _inspect_open_zip(candidate, path=candidate, payload=None, limits=limits)


def inspect_zip_bytes(payload: bytes, *, limits: ArtifactLimits = DEFAULT_LIMITS) -> ZipInspection:
    """Inspect a bounded nested OPC package entirely in memory, without extraction."""

    if not isinstance(payload, bytes) or not payload.startswith(ZIP_MAGICS):
        raise ArtifactError(
            "input_format_invalid",
            "An embedded package does not have a ZIP signature.",
            "Replace the embedded workbook with a standard XLSX package.",
        )
    if len(payload) > limits.max_archive_entry_bytes:
        raise ArtifactError(
            "archive_limit_exceeded",
            "An embedded package exceeds the configured byte limit.",
            "Reduce the embedded workbook size and retry.",
            {"limitBytes": limits.max_archive_entry_bytes},
        )
    return _inspect_open_zip(io.BytesIO(payload), path=None, payload=payload, limits=limits)


def safe_read_member(
    inspection: ZipInspection,
    name: str,
    *,
    max_bytes: int | None = None,
    limits: ArtifactLimits = DEFAULT_LIMITS,
) -> bytes:
    """Read one admitted member, verifying its actual length and CRC."""

    member = inspection.require(name)
    byte_limit = limits.max_archive_entry_bytes if max_bytes is None else min(
        max_bytes, limits.max_archive_entry_bytes
    )
    if member.size_bytes > byte_limit:
        raise ArtifactError(
            "archive_limit_exceeded",
            "An archive part exceeds its parser-specific byte limit.",
            "Reduce the corresponding presentation content.",
            {"part": name, "limitBytes": byte_limit},
        )
    try:
        source: Path | io.BytesIO
        source = inspection.path if inspection._payload is None else io.BytesIO(inspection._payload)
        with zipfile.ZipFile(source, "r") as archive:
            with archive.open(name, "r") as stream:
                payload = stream.read(byte_limit + 1)
                if len(payload) > byte_limit:
                    raise ArtifactError(
                        "archive_limit_exceeded",
                        "An archive part expanded beyond its parser-specific byte limit.",
                        "Reduce the corresponding presentation content.",
                        {"part": name, "limitBytes": byte_limit},
                    )
                # Force ZipExtFile to consume the CRC trailer even for a forged
                # central-directory size of zero.
                if stream.read(1):
                    raise ArtifactError(
                        "archive_limit_exceeded",
                        "An archive part is larger than its declared size.",
                        "Re-export the presentation with a trusted Office application.",
                    )
    except ArtifactError:
        raise
    except (KeyError, zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError):
        raise ArtifactError(
            "input_format_invalid",
            "An archive part is corrupt or unreadable.",
            "Open and re-save the file as a standard PPTX.",
            {"part": name},
        ) from None
    if len(payload) != member.size_bytes:
        raise ArtifactError(
            "input_format_invalid",
            "An archive part does not match its declared size.",
            "Re-export the presentation with a trusted Office application.",
            {"part": name},
        )
    return payload
