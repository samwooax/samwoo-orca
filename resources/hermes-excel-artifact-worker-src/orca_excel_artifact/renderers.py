"""Bounded preview renderers with cancellable LibreOffice conversion.

Rendered paths remain worker-internal ``LocalArtifact`` values.  Callers must
register them and return opaque handles through ``PreviewBundle.to_public_dict``.
"""

from __future__ import annotations

import math
import multiprocessing
import os
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from queue import Empty
from typing import Any

from .artifacts import (
    ArtifactKind,
    LocalArtifact,
    PreviewBundle,
    ensure_private_directory,
    sha256_file,
    total_artifact_bytes,
)
from .errors import ArtifactError
from .inputs import inspect_input
from .limits import ArtifactLimits, DEFAULT_LIMITS


# The PDF parser/render native library runs in a child process.  On POSIX that
# child also applies RLIMIT_AS below.  This is not a complete OS sandbox: the
# Orca integration must additionally remove network access from LibreOffice and
# place Windows children in a memory-limited Job Object before they execute.
PDF_RENDER_MEMORY_LIMIT_BYTES = 768 * 1024 * 1024


def find_libreoffice() -> Path | None:
    """Find a conventional LibreOffice executable and return its resolved path."""

    candidates = [
        Path("/usr/bin/libreoffice"),
        Path("/usr/bin/soffice"),
        Path("/usr/local/bin/libreoffice"),
        Path("/opt/libreoffice/program/soffice"),
        Path("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
        Path(r"C:\Program Files\LibreOffice\program\soffice.exe"),
        Path(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
    ]
    for program in ("libreoffice", "soffice"):
        located = shutil.which(program)
        if located:
            candidates.append(Path(located))
    seen: set[Path] = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved.is_file() and os.access(resolved, os.X_OK):
            return resolved
    return None


def _validated_executable(value: Path | str | None) -> Path:
    executable = Path(value) if value is not None else find_libreoffice()
    if executable is None:
        raise ArtifactError(
            "render_unavailable",
            "LibreOffice is unavailable for PPTX preview conversion.",
            "Install a supported LibreOffice build in the isolated worker environment.",
        )
    try:
        executable = executable.resolve(strict=True)
        info = executable.stat()
    except OSError:
        raise ArtifactError(
            "render_unavailable",
            "The configured LibreOffice executable is unavailable.",
            "Correct the worker dependency configuration and retry.",
        ) from None
    if not stat.S_ISREG(info.st_mode) or not os.access(executable, os.X_OK):
        raise ArtifactError(
            "render_unavailable",
            "The configured LibreOffice dependency is not executable.",
            "Configure an executable LibreOffice binary.",
        )
    return executable


def build_libreoffice_argv(
    executable: Path,
    input_path: Path,
    output_directory: Path,
    profile_directory: Path,
) -> list[str]:
    """Return the fixed, shell-free conversion argument vector."""

    return [
        str(executable),
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--norestore",
        f"-env:UserInstallation={profile_directory.resolve().as_uri()}",
        "--infilter=Impress MS PowerPoint 2007 XML",
        "--convert-to",
        "pdf:impress_pdf_Export",
        "--outdir",
        str(output_directory),
        str(input_path),
    ]


def _check_cancel(cancel: Any) -> None:
    if cancel is None:
        return
    check = getattr(cancel, "check", None)
    if callable(check):
        check()
        return
    is_set = getattr(cancel, "is_set", None)
    cancelled = bool(is_set()) if callable(is_set) else bool(cancel() if callable(cancel) else cancel)
    if cancelled:
        raise ArtifactError(
            "cancelled",
            "The preview operation was cancelled.",
            "Submit a new artifact request to retry.",
        )


def _deadline(timeout_seconds: float, limits: ArtifactLimits) -> float:
    if (
        isinstance(timeout_seconds, bool)
        or not isinstance(timeout_seconds, (int, float))
        or not math.isfinite(float(timeout_seconds))
        or timeout_seconds <= 0
        or timeout_seconds > limits.max_timeout_seconds
    ):
        raise ArtifactError(
            "protocol_invalid",
            "The preview timeout is outside the supported range.",
            f"Use a timeout greater than zero and at most {limits.max_timeout_seconds} seconds.",
        )
    return time.monotonic() + float(timeout_seconds)


def _remaining(deadline: float) -> float:
    return max(0.0, deadline - time.monotonic())


def _check_deadline(deadline: float) -> None:
    if _remaining(deadline) <= 0:
        raise ArtifactError(
            "timeout",
            "The preview operation exceeded its timeout.",
            "Retry with a smaller input or a reviewed longer timeout.",
        )


def _terminate_process_tree(process: subprocess.Popen[Any]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        process.wait(timeout=1.5)
    except (OSError, subprocess.TimeoutExpired):
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.wait(timeout=1.5)
        except (OSError, subprocess.TimeoutExpired):
            pass


def _minimal_conversion_environment(profile: Path, scratch: Path) -> dict[str, str]:
    environment = {
        "HOME": str(profile),
        "TMPDIR": str(scratch),
        "TEMP": str(scratch),
        "TMP": str(scratch),
        "PATH": os.defpath,
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "SAL_USE_VCLPLUGIN": "svp",
        # This is defence in depth.  OPC relationship inspection is the primary
        # remote-resource gate because LibreOffice is not an OS network sandbox.
        "http_proxy": "http://127.0.0.1:9",
        "https_proxy": "http://127.0.0.1:9",
        "ALL_PROXY": "http://127.0.0.1:9",
        "NO_PROXY": "",
    }
    if os.name == "nt":
        for key in ("SystemRoot", "WINDIR"):
            if value := os.environ.get(key):
                environment[key] = value
    return environment


def _run_libreoffice(
    executable: Path,
    source: Path,
    output_directory: Path,
    profile_directory: Path,
    scratch_directory: Path,
    *,
    cancel: Any,
    deadline: float,
) -> None:
    argv = build_libreoffice_argv(executable, source, output_directory, profile_directory)
    log_path = scratch_directory / "conversion.log"
    popen_options: dict[str, Any] = {
        "args": argv,
        "cwd": str(scratch_directory),
        "env": _minimal_conversion_environment(profile_directory, scratch_directory),
        "stdin": subprocess.DEVNULL,
        "shell": False,
    }
    if os.name == "posix":
        popen_options["start_new_session"] = True
    elif os.name == "nt":
        popen_options["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    try:
        with log_path.open("wb") as log:
            popen_options["stdout"] = log
            popen_options["stderr"] = subprocess.STDOUT
            process = subprocess.Popen(**popen_options)
            try:
                while process.poll() is None:
                    _check_cancel(cancel)
                    _check_deadline(deadline)
                    time.sleep(min(0.05, max(0.005, _remaining(deadline))))
            except ArtifactError:
                _terminate_process_tree(process)
                raise
    except ArtifactError:
        raise
    except OSError:
        raise ArtifactError(
            "conversion_failed",
            "LibreOffice could not be started in the isolated worker profile.",
            "Verify the worker dependency and filesystem permissions.",
        ) from None
    if process.returncode != 0:
        raise ArtifactError(
            "conversion_failed",
            "LibreOffice failed to convert the presentation.",
            "Open and re-save the PPTX, then retry with the sanitized source.",
            {"exitCode": process.returncode},
        )


def _copy_admitted_file(source: Path, destination: Path, *, max_bytes: int) -> None:
    try:
        source_info = source.lstat()
        if stat.S_ISLNK(source_info.st_mode) or not stat.S_ISREG(source_info.st_mode):
            raise OSError("not a regular file")
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(source, flags)
        try:
            opened_info = os.fstat(descriptor)
            if not stat.S_ISREG(opened_info.st_mode):
                raise OSError("not a regular file")
            if os.name == "posix" and (
                opened_info.st_dev != source_info.st_dev or opened_info.st_ino != source_info.st_ino
            ):
                raise OSError("input changed")
            consumed = 0
            with os.fdopen(descriptor, "rb", closefd=False) as incoming, destination.open("xb") as outgoing:
                while chunk := incoming.read(1024 * 1024):
                    consumed += len(chunk)
                    if consumed > max_bytes:
                        raise ArtifactError(
                            "archive_limit_exceeded",
                            "The staged input exceeds the configured byte limit.",
                            "Retry with a smaller stable artifact.",
                        )
                    outgoing.write(chunk)
                outgoing.flush()
                os.fsync(outgoing.fileno())
        finally:
            os.close(descriptor)
    except ArtifactError:
        destination.unlink(missing_ok=True)
        raise
    except OSError:
        destination.unlink(missing_ok=True)
        raise ArtifactError(
            "input_format_invalid",
            "The input changed while it was being staged for preview.",
            "Wait for the producing application to finish and retry.",
        ) from None


def _pdfium_render_worker(
    source: str,
    outputs: list[tuple[int, str]],
    max_dimension: int,
    result_queue: Any,
) -> None:
    """Child-process entry point: crashes and native hangs stay outside the host."""

    try:
        isolation = _apply_posix_child_limits(PDF_RENDER_MEMORY_LIMIT_BYTES)
        from PIL import Image
        import pypdfium2 as pdfium

        document = pdfium.PdfDocument(source)
        dimensions: list[tuple[int, int, int]] = []
        try:
            for one_based_index, output in outputs:
                page = document[one_based_index - 1]
                try:
                    width_points, height_points = page.get_size()
                    scale = min(2.0, max_dimension / max(width_points, height_points))
                    scale = max(scale, 0.05)
                    bitmap = page.render(scale=scale)
                    try:
                        image = bitmap.to_pil()
                        if image.mode not in {"RGB", "RGBA"}:
                            image = image.convert("RGB")
                        if max(image.size) > max_dimension:
                            image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
                        image.save(output, format="PNG", optimize=True)
                        dimensions.append((one_based_index, image.width, image.height))
                        image.close()
                    finally:
                        bitmap.close()
                finally:
                    page.close()
        finally:
            document.close()
        result_queue.put(("ok", dimensions, isolation))
    except BaseException:
        # Never marshal an exception/path from the parser process across the
        # boundary.  The parent emits a stable sanitized error.
        try:
            result_queue.put(("error", None, "unknown"))
        except BaseException:
            pass


def _apply_posix_child_limits(memory_bytes: int) -> str:
    """Apply child-only resource limits, returning a non-claiming boundary label.

    Windows has no ``resource`` equivalent.  The SAMWOO-ORCA main integration
    must put its worker process tree in a Job Object with memory/process limits;
    this reference function intentionally reports that external responsibility.
    """

    if os.name != "posix":
        return "windows_job_object_required"
    try:
        import resource

        current_soft, current_hard = resource.getrlimit(resource.RLIMIT_AS)
        infinity = resource.RLIM_INFINITY
        if current_hard == infinity:
            target = memory_bytes
        else:
            target = min(memory_bytes, current_hard)
        if target <= 0:
            return "posix_rlimit_unavailable"
        resource.setrlimit(resource.RLIMIT_AS, (target, target))
        if hasattr(resource, "RLIMIT_CORE"):
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        return "posix_rlimit_as"
    except (ImportError, AttributeError, OSError, ValueError):
        return "posix_rlimit_unavailable"


def _render_pdf_pages(
    source: Path,
    selected: Sequence[int],
    work_directory: Path,
    *,
    limits: ArtifactLimits,
    cancel: Any,
    deadline: float,
) -> tuple[list[tuple[int, Path, int, int]], str]:
    outputs = [(index, str(work_directory / f"page-{ordinal:04d}.png")) for ordinal, index in enumerate(selected, 1)]
    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue(maxsize=1)
    process = context.Process(
        target=_pdfium_render_worker,
        args=(str(source), outputs, limits.max_preview_dimension, result_queue),
        name="excel-artifact-pdf-render",
        daemon=True,
    )
    process.start()
    try:
        while process.is_alive():
            _check_cancel(cancel)
            _check_deadline(deadline)
            process.join(timeout=min(0.05, max(0.005, _remaining(deadline))))
    except ArtifactError:
        process.terminate()
        process.join(timeout=1.5)
        if process.is_alive() and hasattr(process, "kill"):
            process.kill()
            process.join(timeout=1.5)
        raise
    process.join(timeout=0.2)
    try:
        status, dimensions, isolation = result_queue.get(timeout=0.5)
    except Empty:
        status, dimensions, isolation = "error", None, "unknown"
    finally:
        result_queue.close()
        result_queue.join_thread()
    if process.exitcode != 0 or status != "ok" or not isinstance(dimensions, list):
        raise ArtifactError(
            "render_failed",
            "The isolated PDF renderer could not produce a preview.",
            "Flatten the source document or use a supported PDF/PPTX export.",
        )
    by_index = {int(index): (int(width), int(height)) for index, width, height in dimensions}
    rendered: list[tuple[int, Path, int, int]] = []
    for index, raw_path in outputs:
        path = Path(raw_path)
        if index not in by_index or not path.is_file():
            raise ArtifactError(
                "render_failed",
                "The isolated PDF renderer returned an incomplete preview set.",
                "Retry with a flattened document.",
            )
        width, height = by_index[index]
        rendered.append((index, path, width, height))
    return rendered, isolation


def _build_contact_sheet(
    rendered: Sequence[tuple[int, Path, int, int]],
    destination: Path,
    *,
    max_dimension: int,
    label: str,
) -> tuple[int, int]:
    from PIL import Image, ImageDraw, ImageOps

    count = len(rendered)
    columns = max(1, math.ceil(math.sqrt(count * 4 / 3)))
    rows = math.ceil(count / columns)
    cell_width = max(96, min(480, max_dimension // columns))
    cell_height = max(80, min(360, max_dimension // rows))
    label_height = min(28, max(18, cell_height // 8))
    sheet = Image.new("RGB", (cell_width * columns, cell_height * rows), "white")
    draw = ImageDraw.Draw(sheet)
    for ordinal, (index, path, _width, _height) in enumerate(rendered):
        row, column = divmod(ordinal, columns)
        with Image.open(path) as source:
            preview = ImageOps.contain(
                source.convert("RGB"),
                (cell_width - 12, cell_height - label_height - 12),
                Image.Resampling.LANCZOS,
            )
            left = column * cell_width + (cell_width - preview.width) // 2
            top = row * cell_height + label_height + (cell_height - label_height - preview.height) // 2
            sheet.paste(preview, (left, top))
        draw.text((column * cell_width + 6, row * cell_height + 4), f"{label} {index}", fill="black")
    sheet.save(destination, format="PNG", optimize=True)
    dimensions = sheet.size
    sheet.close()
    return dimensions


def _commit_previews(
    rendered: Sequence[tuple[int, Path, int, int]],
    contact: tuple[Path, int, int] | None,
    output_directory: Path,
    *,
    source_kind: ArtifactKind,
    limits: ArtifactLimits,
    warnings: Sequence[dict[str, Any]] = (),
) -> PreviewBundle:
    staged = [entry[1] for entry in rendered]
    if contact:
        staged.append(contact[0])
    aggregate = sum(path.stat().st_size for path in staged)
    if aggregate > limits.max_output_bytes:
        raise ArtifactError(
            "archive_limit_exceeded",
            "The rendered preview set exceeds the configured output byte limit.",
            "Select fewer pages or slides, or reduce the preview dimension.",
            {"limitBytes": limits.max_output_bytes, "actualBytes": aggregate},
        )
    committed: list[Path] = []
    try:
        items: list[LocalArtifact] = []
        for index, staged_path, width, height in rendered:
            final = output_directory / f"preview-{uuid.uuid4().hex}.png"
            os.replace(staged_path, final)
            committed.append(final)
            items.append(
                LocalArtifact.from_path(
                    final,
                    kind="preview",
                    media_type="image/png",
                    width=width,
                    height=height,
                    index=index,
                    limits=limits,
                )
            )
        contact_artifact = None
        if contact:
            staged_path, width, height = contact
            final = output_directory / f"contact-{uuid.uuid4().hex}.png"
            os.replace(staged_path, final)
            committed.append(final)
            contact_artifact = LocalArtifact.from_path(
                final,
                kind="contactSheet",
                media_type="image/png",
                width=width,
                height=height,
                limits=limits,
            )
        bundle = PreviewBundle(source_kind, tuple(items), contact_artifact, tuple(warnings))
        if total_artifact_bytes(bundle.local_artifacts) > limits.max_output_bytes:
            raise ArtifactError(
                "archive_limit_exceeded",
                "The rendered preview set exceeds the configured output byte limit.",
                "Select fewer pages or slides.",
            )
        return bundle
    except Exception:
        for path in committed:
            path.unlink(missing_ok=True)
        raise


def render_pdf(
    path: Path | str,
    output_directory: Path | str,
    selection: Mapping[str, Any] | Sequence[int] | None = None,
    *,
    expected_sha256: str | None = None,
    limits: ArtifactLimits = DEFAULT_LIMITS,
    cancel: Any = None,
    timeout_seconds: float = 120,
) -> PreviewBundle:
    """Render selected PDF pages in a killable child process."""

    deadline = _deadline(timeout_seconds, limits)
    _check_cancel(cancel)
    metadata = inspect_input(
        path,
        ArtifactKind.PDF,
        selection,
        expected_sha256=expected_sha256,
        limits=limits,
    )
    _check_deadline(deadline)
    output_root = ensure_private_directory(output_directory)
    with tempfile.TemporaryDirectory(prefix="pdf-preview-", dir=output_root) as temporary:
        work = Path(temporary)
        rendered, isolation = _render_pdf_pages(
            Path(path), metadata["selection"], work, limits=limits, cancel=cancel, deadline=deadline
        )
        _check_cancel(cancel)
        contact: tuple[Path, int, int] | None = None
        if len(rendered) > 1:
            contact_path = work / "contact.png"
            width, height = _build_contact_sheet(
                rendered,
                contact_path,
                max_dimension=limits.max_preview_dimension,
                label="Page",
            )
            contact = contact_path, width, height
        _check_deadline(deadline)
        return _commit_previews(
            rendered,
            contact,
            output_root,
            source_kind=ArtifactKind.PDF,
            limits=limits,
            warnings=[
                *metadata["warnings"],
                {
                    "code": "memory_isolation_boundary",
                    "message": (
                        "The native PDF renderer used a POSIX address-space limit."
                        if isolation == "posix_rlimit_as"
                        else "Native renderer memory enforcement remains an Orca host sandbox responsibility."
                    ),
                    "details": {"stage": "render", "feature": isolation},
                },
            ],
        )


def render_pptx(
    path: Path | str,
    output_directory: Path | str,
    selection: Mapping[str, Any] | Sequence[int] | None = None,
    *,
    expected_sha256: str | None = None,
    limits: ArtifactLimits = DEFAULT_LIMITS,
    cancel: Any = None,
    timeout_seconds: float = 120,
    libreoffice: Path | str | None = None,
) -> PreviewBundle:
    """Inspect, stage, convert, and render selected PPTX slides."""

    deadline = _deadline(timeout_seconds, limits)
    _check_cancel(cancel)
    metadata = inspect_input(
        path,
        ArtifactKind.PPTX,
        selection,
        expected_sha256=expected_sha256,
        limits=limits,
    )
    executable = _validated_executable(libreoffice)
    output_root = ensure_private_directory(output_directory)
    with tempfile.TemporaryDirectory(prefix="pptx-preview-", dir=output_root) as temporary:
        work = Path(temporary)
        profile = work / "profile"
        conversion = work / "converted"
        profile.mkdir(mode=0o700)
        conversion.mkdir(mode=0o700)
        staged_source = work / "input.pptx"
        _copy_admitted_file(Path(path), staged_source, max_bytes=limits.max_input_bytes)
        staged_hash, _ = sha256_file(staged_source, limits=limits)
        if staged_hash != metadata["sha256"]:
            raise ArtifactError(
                "input_hash_mismatch",
                "The input changed while it was staged for conversion.",
                "Wait for the source file to become stable and retry.",
            )
        _run_libreoffice(
            executable,
            staged_source,
            conversion,
            profile,
            work,
            cancel=cancel,
            deadline=deadline,
        )
        converted_pdf = conversion / "input.pdf"
        if not converted_pdf.is_file() or converted_pdf.is_symlink():
            raise ArtifactError(
                "conversion_failed",
                "LibreOffice did not produce the expected PDF artifact.",
                "Verify the LibreOffice build and retry with a standard PPTX.",
            )
        converted_metadata = inspect_input(
            converted_pdf,
            ArtifactKind.PDF,
            metadata["selection"],
            limits=limits,
        )
        if converted_metadata["pageCount"] != metadata["slideCount"]:
            raise ArtifactError(
                "validation_failed",
                "The converted PDF page count does not match the PPTX slide count.",
                "Open and re-save the presentation, then retry.",
                {
                    "slideCount": metadata["slideCount"],
                    "pageCount": converted_metadata["pageCount"],
                },
            )
        render_work = work / "rendered"
        render_work.mkdir(mode=0o700)
        rendered, isolation = _render_pdf_pages(
            converted_pdf,
            metadata["selection"],
            render_work,
            limits=limits,
            cancel=cancel,
            deadline=deadline,
        )
        contact: tuple[Path, int, int] | None = None
        if len(rendered) > 1:
            contact_path = render_work / "contact.png"
            width, height = _build_contact_sheet(
                rendered,
                contact_path,
                max_dimension=limits.max_preview_dimension,
                label="Slide",
            )
            contact = contact_path, width, height
        _check_cancel(cancel)
        _check_deadline(deadline)
        return _commit_previews(
            rendered,
            contact,
            output_root,
            source_kind=ArtifactKind.PPTX,
            limits=limits,
            warnings=[
                *metadata["warnings"],
                {
                    "code": "memory_isolation_boundary",
                    "message": (
                        "The native PDF renderer used a POSIX address-space limit; LibreOffice network/process sandboxing remains an Orca host responsibility."
                        if isolation == "posix_rlimit_as"
                        else "LibreOffice and renderer memory/network enforcement remains an Orca host sandbox responsibility."
                    ),
                    "details": {"stage": "render", "feature": isolation},
                },
            ],
        )


def render_image(
    path: Path | str,
    output_directory: Path | str,
    kind: ArtifactKind | str,
    *,
    expected_sha256: str | None = None,
    limits: ArtifactLimits = DEFAULT_LIMITS,
    cancel: Any = None,
    timeout_seconds: float = 120,
) -> PreviewBundle:
    """Decode and re-encode one image, stripping metadata from the preview."""

    parsed = ArtifactKind(str(kind).lower().replace("jpg", "jpeg"))
    if parsed not in {ArtifactKind.PNG, ArtifactKind.JPEG}:
        raise ArtifactError(
            "protocol_invalid",
            "The image renderer accepts only PNG or JPEG inputs.",
            "Use render_pdf or render_pptx for document inputs.",
        )
    deadline = _deadline(timeout_seconds, limits)
    _check_cancel(cancel)
    metadata = inspect_input(path, parsed, expected_sha256=expected_sha256, limits=limits)
    output_root = ensure_private_directory(output_directory)
    from PIL import Image, ImageOps

    with tempfile.TemporaryDirectory(prefix="image-preview-", dir=output_root) as temporary:
        staged = Path(temporary) / "image.png"
        try:
            with Image.open(path) as source:
                normalized = ImageOps.exif_transpose(source)
                try:
                    preview = normalized.convert(
                        "RGBA" if metadata["image"]["hasAlpha"] else "RGB"
                    )
                    try:
                        preview.thumbnail(
                            (limits.max_preview_dimension, limits.max_preview_dimension),
                            Image.Resampling.LANCZOS,
                        )
                        preview.save(staged, format="PNG", optimize=True)
                        width, height = preview.size
                    finally:
                        preview.close()
                finally:
                    if normalized is not source:
                        normalized.close()
        except (OSError, ValueError):
            raise ArtifactError(
                "render_failed",
                "The image could not be rendered safely.",
                "Re-export it as a standard PNG or JPEG and retry.",
            ) from None
        _check_cancel(cancel)
        _check_deadline(deadline)
        return _commit_previews(
            [(1, staged, width, height)],
            None,
            output_root,
            source_kind=parsed,
            limits=limits,
        )


def render_preview(
    path: Path | str,
    kind: ArtifactKind | str,
    output_directory: Path | str,
    selection: Mapping[str, Any] | Sequence[int] | None = None,
    **kwargs: Any,
) -> PreviewBundle:
    """Dispatch to the explicit format renderer without extension guessing."""

    try:
        parsed = ArtifactKind(str(kind).lower().replace("jpg", "jpeg"))
    except ValueError:
        raise ArtifactError(
            "protocol_invalid",
            "The requested preview kind is unsupported.",
            "Use pptx, pdf, png, or jpeg for preview rendering.",
        ) from None
    if parsed is ArtifactKind.PPTX:
        return render_pptx(path, output_directory, selection, **kwargs)
    if parsed is ArtifactKind.PDF:
        return render_pdf(path, output_directory, selection, **kwargs)
    if selection not in (None, [1], (1,)):
        raise ArtifactError(
            "protocol_invalid",
            "A single image only supports selection index 1.",
            "Omit selection or select image index 1.",
        )
    return render_image(path, output_directory, parsed, **kwargs)
