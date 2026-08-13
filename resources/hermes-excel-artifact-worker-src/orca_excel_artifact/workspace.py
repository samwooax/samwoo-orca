"""Workspace-confined staging and atomic workbook commits.

The model-facing protocol never supplies an absolute path.  Orca resolves the
selected project first and constructs this object on the trusted side of the
boundary.  Staging files stay beside their destination so the final rename is
on the same filesystem.
"""

from __future__ import annotations

import hashlib
import os
import re
import stat
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Iterator

from .errors import ArtifactError
from .limits import DEFAULT_LIMITS, ArtifactLimits


_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_WINDOWS_RESERVED_NAMES = frozenset(
    {"con", "prn", "aux", "nul"}
    | {f"com{index}" for index in range(1, 10)}
    | {f"lpt{index}" for index in range(1, 10)}
)


def _output_error(message: str, relative_path: str | None = None) -> ArtifactError:
    details = {"relativePath": relative_path} if relative_path else {}
    return ArtifactError(
        "output_path_invalid",
        message,
        "Choose a new .xlsx path inside the selected project.",
        details,
    )


def _validate_relative_path(value: str, *, require_xlsx: bool) -> PurePosixPath:
    if not isinstance(value, str) or not value or len(value) > 512:
        raise _output_error("The workbook output path is invalid.")
    if (
        "\x00" in value
        or "\\" in value
        or "//" in value
        or value.startswith("./")
        or value.endswith("/")
        or any(ord(char) < 32 for char in value)
    ):
        raise _output_error("The workbook output path contains unsafe characters.", value)
    components = value.split("/")
    if any(component in {"", ".", ".."} for component in components):
        raise _output_error("The workbook output path cannot traverse directories.", value)
    for component in components:
        if ":" in component:
            raise _output_error("Windows alternate data stream paths are forbidden.", value)
        if component.endswith((".", " ")):
            raise _output_error("Path components cannot end with a dot or space.", value)
        device_basename = component.split(".", 1)[0].rstrip(" .").casefold()
        if device_basename in _WINDOWS_RESERVED_NAMES:
            raise _output_error("Windows reserved device names are forbidden.", value)

    windows = PureWindowsPath(value)
    pure = PurePosixPath(value)
    if windows.is_absolute() or windows.drive or pure.is_absolute():
        raise _output_error("The workbook output path must be relative.", value)
    if any(part.casefold() == ".git" for part in pure.parts):
        raise _output_error("Workbook output inside Git metadata is forbidden.", value)
    if require_xlsx and pure.suffix.casefold() != ".xlsx":
        raise _output_error("Workbook output must use the .xlsx extension.", value)
    return pure


def validate_relative_xlsx_path(value: str) -> PurePosixPath:
    """Parse the protocol's platform-neutral relative workbook output path."""

    return _validate_relative_path(value, require_xlsx=True)


def _validate_sha256(value: str | None, *, required: bool) -> str | None:
    if value is None:
        if required:
            raise ArtifactError(
                "protocol_invalid",
                "Overwrite requires the admitted destination SHA-256.",
                "Read the current output receipt and retry with expectedSha256.",
            )
        return None
    normalized = value.casefold()
    if not _SHA256.fullmatch(normalized):
        raise ArtifactError(
            "protocol_invalid",
            "The expected output SHA-256 is malformed.",
            "Provide a 64-character hexadecimal SHA-256.",
        )
    return normalized


def hash_regular_file(path: Path, *, max_bytes: int) -> tuple[str, int]:
    """Hash a bounded regular file without following a symlink."""

    try:
        before = path.lstat()
    except FileNotFoundError:
        raise ArtifactError("input_not_found", "The workbook input was not found.", "Attach it again.") from None
    except OSError:
        raise ArtifactError(
            "input_format_invalid",
            "The workbook input could not be inspected.",
            "Use a stable regular .xlsx file.",
        ) from None
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
        raise ArtifactError(
            "input_format_invalid",
            "The workbook input must be a regular file, not a link or special file.",
            "Copy it to a regular file and attach that copy.",
        )
    if before.st_size <= 0 or before.st_size > max_bytes:
        raise ArtifactError(
            "archive_limit_exceeded",
            "The workbook exceeds the configured byte limit.",
            "Use a smaller workbook.",
            {"limit": max_bytes, "observed": before.st_size},
        )

    digest = hashlib.sha256()
    consumed = 0
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor: int | None = None
    try:
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
        identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        identity_opened = (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns)
        if not stat.S_ISREG(opened.st_mode) or identity_opened != identity_before:
            raise ArtifactError(
                "input_format_invalid",
                "The workbook path changed before it could be opened safely.",
                "Wait for other filesystem activity to finish and retry.",
            )
        with os.fdopen(descriptor, "rb", closefd=True) as stream:
            descriptor = None
            while chunk := stream.read(1024 * 1024):
                consumed += len(chunk)
                if consumed > max_bytes:
                    raise ArtifactError(
                        "archive_limit_exceeded",
                        "The workbook grew beyond the byte limit while it was read.",
                        "Wait for the producing process to finish and retry.",
                        {"limit": max_bytes, "observed": consumed},
                    )
                digest.update(chunk)
    except ArtifactError:
        raise
    except OSError:
        raise ArtifactError(
            "input_format_invalid",
            "The workbook could not be read.",
            "Use a stable readable workbook.",
        ) from None
    finally:
        if descriptor is not None:
            os.close(descriptor)
    try:
        after = path.lstat()
    except OSError:
        raise ArtifactError(
            "input_format_invalid",
            "The workbook changed while it was read.",
            "Wait for the producing process to finish and retry.",
        ) from None
    identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    if consumed != before.st_size or identity_before != identity_after:
        raise ArtifactError(
            "input_format_invalid",
            "The workbook changed while it was read.",
            "Wait for the producing process to finish and retry.",
        )
    return digest.hexdigest(), consumed


def snapshot_regular_file(
    source: Path | str,
    destination: Path | str,
    *,
    expected_sha256: str | None = None,
    max_bytes: int,
) -> tuple[str, int]:
    """Copy one stable, no-follow input into a worker-private immutable snapshot.

    Parsers and external converters must consume the returned snapshot rather
    than reopening the admitted workspace or artifact path.  The source is
    opened once with ``O_NOFOLLOW`` where available, its descriptor identity is
    checked against ``lstat``, and the admitted digest is verified while the
    private copy is written.
    """

    source_path = Path(source)
    target_path = Path(destination)
    expected = _validate_sha256(expected_sha256, required=False)
    try:
        before = source_path.lstat()
    except FileNotFoundError:
        raise ArtifactError("input_not_found", "The input was not found.", "Attach it again.") from None
    except OSError:
        raise ArtifactError(
            "input_format_invalid",
            "The input could not be inspected safely.",
            "Use a stable regular file and retry.",
        ) from None
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
        raise ArtifactError(
            "input_format_invalid",
            "The input must be a regular file, not a link or special file.",
            "Copy it to a regular file and attach that copy.",
        )
    if before.st_size <= 0 or before.st_size > max_bytes:
        raise ArtifactError(
            "archive_limit_exceeded",
            "The input exceeds the configured byte limit.",
            "Use a smaller input.",
            {"limit": max_bytes, "observed": before.st_size},
        )

    source_descriptor: int | None = None
    target_descriptor: int | None = None
    digest = hashlib.sha256()
    copied = 0
    try:
        source_flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        source_descriptor = os.open(source_path, source_flags)
        opened = os.fstat(source_descriptor)
        identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        identity_opened = (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns)
        if not stat.S_ISREG(opened.st_mode) or identity_before != identity_opened:
            raise ArtifactError(
                "input_format_invalid",
                "The input changed before it could be snapshotted safely.",
                "Wait for filesystem activity to finish and retry.",
            )
        target_flags = (
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_BINARY", 0)
            | getattr(os, "O_NOFOLLOW", 0)
        )
        target_descriptor = os.open(target_path, target_flags, 0o600)
        with (
            os.fdopen(source_descriptor, "rb", closefd=True) as input_stream,
            os.fdopen(target_descriptor, "wb", closefd=True) as output_stream,
        ):
            source_descriptor = None
            target_descriptor = None
            while chunk := input_stream.read(1024 * 1024):
                copied += len(chunk)
                if copied > max_bytes:
                    raise ArtifactError(
                        "archive_limit_exceeded",
                        "The input grew beyond the byte limit while it was snapshotted.",
                        "Wait for the producing process to finish and retry.",
                        {"limit": max_bytes, "observed": copied},
                    )
                digest.update(chunk)
                output_stream.write(chunk)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        try:
            after = source_path.lstat()
        except OSError:
            raise ArtifactError(
                "input_format_invalid",
                "The input changed while it was snapshotted.",
                "Wait for filesystem activity to finish and retry.",
            ) from None
        identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        actual = digest.hexdigest()
        if copied != before.st_size or identity_after != identity_before:
            raise ArtifactError(
                "input_format_invalid",
                "The input changed while it was snapshotted.",
                "Wait for filesystem activity to finish and retry.",
            )
        if expected is not None and actual != expected:
            raise ArtifactError(
                "input_hash_mismatch",
                "The input hash does not match the admitted artifact.",
                "Attach the current input and retry.",
                {"expectedSha256": expected, "actualSha256": actual},
            )
        return actual, copied
    except ArtifactError:
        try:
            target_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    except OSError:
        try:
            target_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise ArtifactError(
            "input_format_invalid",
            "The input could not be copied into private worker storage.",
            "Use a stable readable input and retry.",
        ) from None
    finally:
        if source_descriptor is not None:
            os.close(source_descriptor)
        if target_descriptor is not None:
            os.close(target_descriptor)


@dataclass(frozen=True, slots=True)
class CommitReceipt:
    relative_path: str
    sha256: str
    size_bytes: int
    replaced: bool
    previous_sha256: str | None

    def public_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            "relativePath": self.relative_path,
            "sha256": self.sha256,
            "sizeBytes": self.size_bytes,
            "replaced": self.replaced,
        }
        if self.previous_sha256 is not None:
            result["previousSha256"] = self.previous_sha256
        return result


@dataclass(slots=True)
class OutputTransaction:
    """One validated destination plus a private same-directory staging file."""

    workspace: "Workspace"
    relative_path: str
    destination: Path
    overwrite: bool
    expected_sha256: str | None
    admitted_sha256: str | None
    staged_path: Path
    _finished: bool = False

    def commit(self) -> CommitReceipt:
        if self._finished:
            raise ArtifactError("commit_failed", "The output transaction is closed.", "Start a new job.")
        staged_hash, staged_size = hash_regular_file(
            self.staged_path,
            max_bytes=self.workspace.limits.max_output_bytes,
        )
        self.workspace._recheck_parent(self.destination.parent)
        current_hash = self.workspace._current_destination_hash(self.destination)
        if current_hash != self.admitted_sha256:
            raise ArtifactError(
                "commit_failed",
                "The destination changed after the job was admitted.",
                "Refresh the output hash and retry.",
                {
                    "relativePath": self.relative_path,
                    **({"expectedSha256": self.admitted_sha256} if self.admitted_sha256 else {}),
                    **({"actualSha256": current_hash} if current_hash else {}),
                },
            )
        try:
            # Windows requires a writable handle for FlushFileBuffers.
            with self.staged_path.open("r+b") as stream:
                os.fsync(stream.fileno())
            if self.overwrite:
                os.replace(self.staged_path, self.destination)
            else:
                # A hard link provides create-if-absent semantics; unlike replace it
                # cannot clobber a file created by another process after admission.
                os.link(self.staged_path, self.destination, follow_symlinks=False)
                self.staged_path.unlink()
            self.workspace._fsync_directory(self.destination.parent)
        except FileExistsError:
            raise ArtifactError(
                "output_already_exists",
                "The workbook output appeared before commit.",
                "Choose a new path or retry with explicit hash-guarded overwrite.",
                {"relativePath": self.relative_path},
            ) from None
        except ArtifactError:
            raise
        except OSError:
            raise ArtifactError(
                "commit_failed",
                "The workbook could not be committed atomically.",
                "Check project permissions and retry; the prior destination was not intentionally edited.",
                {"relativePath": self.relative_path},
            ) from None
        self._finished = True
        return CommitReceipt(
            relative_path=self.relative_path,
            sha256=staged_hash,
            size_bytes=staged_size,
            replaced=self.overwrite,
            previous_sha256=self.admitted_sha256,
        )

    def cleanup(self) -> None:
        if not self._finished:
            try:
                self.staged_path.unlink(missing_ok=True)
            except OSError:
                pass
            self._finished = True


class Workspace:
    """Trusted selected-project authority for workbook outputs."""

    def __init__(self, root: Path | str, *, limits: ArtifactLimits = DEFAULT_LIMITS) -> None:
        candidate = Path(root)
        try:
            info = candidate.lstat()
        except OSError:
            raise ArtifactError(
                "workspace_unauthorized",
                "The selected project root is unavailable.",
                "Select an existing local project.",
            ) from None
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise ArtifactError(
                "workspace_unauthorized",
                "The selected project root must be a real directory.",
                "Select a local project that is not a symbolic link.",
            )
        self.root = candidate.resolve(strict=True)
        self.limits = limits

    def _recheck_parent(self, parent: Path) -> None:
        try:
            resolved = parent.resolve(strict=True)
            resolved.relative_to(self.root)
        except (OSError, ValueError):
            raise _output_error("The workbook output parent escaped the selected project.") from None
        cursor = self.root
        for part in resolved.relative_to(self.root).parts:
            cursor = cursor / part
            info = cursor.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise _output_error("The workbook output path crosses a symbolic link or non-directory.")

    def _ensure_parent(self, pure: PurePosixPath) -> Path:
        cursor = self.root
        for part in pure.parent.parts:
            cursor = cursor / part
            try:
                cursor.mkdir(mode=0o700)
            except FileExistsError:
                pass
            except OSError:
                raise _output_error("The workbook output directory could not be created.", str(pure)) from None
            try:
                info = cursor.lstat()
            except OSError:
                raise _output_error("The workbook output directory is unstable.", str(pure)) from None
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise _output_error("The workbook output path crosses a symbolic link.", str(pure))
        self._recheck_parent(cursor)
        return cursor

    def _current_destination_hash(self, destination: Path) -> str | None:
        try:
            destination.lstat()
        except FileNotFoundError:
            return None
        digest, _ = hash_regular_file(destination, max_bytes=self.limits.max_output_bytes)
        return digest

    def resolve_input(
        self,
        relative_path: str,
        *,
        expected_sha256: str | None = None,
    ) -> tuple[Path, str, int]:
        """Resolve and hash an existing regular input inside this project."""

        pure = _validate_relative_path(relative_path, require_xlsx=False)
        candidate = self.root.joinpath(*pure.parts)
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(self.root)
        except (OSError, ValueError):
            raise ArtifactError(
                "workspace_unauthorized",
                "The input path is outside the selected project or unavailable.",
                "Select an existing regular project file.",
                {"relativePath": str(pure)},
            ) from None
        cursor = self.root
        for part in pure.parts[:-1]:
            cursor = cursor / part
            try:
                info = cursor.lstat()
            except OSError:
                raise ArtifactError(
                    "workspace_unauthorized",
                    "The input path is unstable.",
                    "Retry after filesystem activity has stopped.",
                ) from None
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise ArtifactError(
                    "workspace_unauthorized",
                    "The input path crosses a symbolic link.",
                    "Use a regular file directly inside the selected project.",
                )
        digest, size = hash_regular_file(resolved, max_bytes=self.limits.max_input_bytes)
        expected = _validate_sha256(expected_sha256, required=False)
        if expected is not None and expected != digest:
            raise ArtifactError(
                "input_hash_mismatch",
                "The project input hash does not match the request.",
                "Refresh the file metadata and retry.",
                {"expectedSha256": expected, "actualSha256": digest},
            )
        return resolved, digest, size

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        if os.name == "nt":
            return
        try:
            descriptor = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        except OSError:
            pass

    @contextmanager
    def output_transaction(
        self,
        relative_path: str,
        *,
        overwrite: bool = False,
        expected_sha256: str | None = None,
    ) -> Iterator[OutputTransaction]:
        pure = validate_relative_xlsx_path(relative_path)
        expected = _validate_sha256(expected_sha256, required=overwrite)
        if not overwrite and expected is not None:
            raise ArtifactError(
                "protocol_invalid",
                "expectedSha256 is only valid with overwrite.",
                "Remove expectedSha256 or enable explicit overwrite.",
            )
        parent = self._ensure_parent(pure)
        destination = parent / pure.name
        admitted = self._current_destination_hash(destination)
        if admitted is not None and not overwrite:
            raise ArtifactError(
                "output_already_exists",
                "The workbook output already exists.",
                "Choose a new path or use hash-guarded overwrite.",
                {"relativePath": str(pure)},
            )
        if overwrite and admitted is None:
            raise ArtifactError(
                "output_already_exists",
                "The requested overwrite target does not exist.",
                "Create it without overwrite or refresh the destination.",
                {"relativePath": str(pure)},
            )
        if overwrite and admitted != expected:
            raise ArtifactError(
                "input_hash_mismatch",
                "The destination hash does not match expectedSha256.",
                "Refresh the destination receipt before overwriting.",
                {
                    "relativePath": str(pure),
                    "expectedSha256": expected,
                    "actualSha256": admitted,
                },
            )
        descriptor, staged_name = tempfile.mkstemp(prefix=".orca-excel-", suffix=".tmp.xlsx", dir=parent)
        os.close(descriptor)
        staged = Path(staged_name)
        try:
            os.chmod(staged, 0o600)
        except OSError:
            pass
        transaction = OutputTransaction(
            workspace=self,
            relative_path=str(pure),
            destination=destination,
            overwrite=overwrite,
            expected_sha256=expected,
            admitted_sha256=admitted,
            staged_path=staged,
        )
        try:
            yield transaction
        finally:
            transaction.cleanup()


def copy_preserving_source(
    source: Path | str,
    destination: Path | str,
    *,
    expected_sha256: str | None = None,
    limits: ArtifactLimits = DEFAULT_LIMITS,
) -> tuple[str, int]:
    """Copy an admitted workbook while proving the source remained unchanged."""

    source_path = Path(source)
    target_path = Path(destination)
    before_hash, before_size = hash_regular_file(source_path, max_bytes=limits.max_input_bytes)
    expected = _validate_sha256(expected_sha256, required=False)
    if expected is not None and before_hash != expected:
        raise ArtifactError(
            "input_hash_mismatch",
            "The source workbook hash does not match the admitted artifact.",
            "Attach the current workbook and retry.",
            {"expectedSha256": expected, "actualSha256": before_hash},
        )
    digest = hashlib.sha256()
    copied = 0
    descriptor: int | None = None
    try:
        before = source_path.lstat()
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(source_path, flags)
        opened = os.fstat(descriptor)
        identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        identity_opened = (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns)
        if not stat.S_ISREG(opened.st_mode) or identity_before != identity_opened:
            raise ArtifactError(
                "input_hash_mismatch",
                "The source workbook changed before private staging.",
                "Wait for other filesystem activity to finish and retry.",
            )
        with os.fdopen(descriptor, "rb", closefd=True) as input_stream, target_path.open("wb") as output_stream:
            descriptor = None
            while chunk := input_stream.read(1024 * 1024):
                copied += len(chunk)
                if copied > limits.max_input_bytes:
                    raise ArtifactError(
                        "archive_limit_exceeded",
                        "The source workbook grew beyond the input limit.",
                        "Wait for it to finish saving and retry.",
                    )
                digest.update(chunk)
                output_stream.write(chunk)
            output_stream.flush()
            os.fsync(output_stream.fileno())
    except ArtifactError:
        raise
    except OSError:
        raise ArtifactError(
            "modification_failed",
            "The source workbook could not be copied into private staging.",
            "Check that the admitted workbook is stable and readable.",
        ) from None
    finally:
        if descriptor is not None:
            os.close(descriptor)
    after_hash, after_size = hash_regular_file(source_path, max_bytes=limits.max_input_bytes)
    if (
        copied != before_size
        or copied != after_size
        or digest.hexdigest() != before_hash
        or after_hash != before_hash
    ):
        target_path.unlink(missing_ok=True)
        raise ArtifactError(
            "input_hash_mismatch",
            "The source workbook changed during staging.",
            "Wait for other editors to finish and retry from the new hash.",
        )
    return before_hash, before_size
