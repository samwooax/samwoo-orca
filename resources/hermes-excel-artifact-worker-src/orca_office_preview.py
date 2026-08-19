"""Bounded XLSX/PPTX visual previews for the exact local Hermes bridge."""

from __future__ import annotations

import base64
import io
import time
from pathlib import Path
from typing import Any, Mapping

from PIL import Image

from orca_excel_artifact.artifact_temporary_directory import artifact_temporary_directory
from orca_excel_artifact.artifacts import ArtifactKind, PreviewBundle, sha256_file
from orca_excel_artifact.errors import ArtifactError
from orca_excel_artifact.inputs import inspect_input
from orca_excel_artifact.limits import ArtifactLimits
from orca_excel_artifact.renderers import _copy_admitted_file, render_pdf, render_pptx
from orca_excel_artifact.validation import inspect_xlsx, render_workbook_pdf


MAX_SELECTION_COUNT = 4
MAX_RESULT_BYTES = 700 * 1024
OFFICE_PREVIEW_TIMEOUT_SECONDS = 120.0
PREVIEW_LIMITS = ArtifactLimits(
    max_output_bytes=16 * 1024 * 1024,
    max_preview_dimension=1600,
)


def _positive_integer(value: object, name: str, default: int) -> int:
    parsed = default if value is None else value
    if isinstance(parsed, bool) or not isinstance(parsed, int) or parsed < 1:
        raise ValueError(f"{name} must be a positive integer")
    return parsed


def _selection(start: int, count: int, total: int) -> list[int]:
    if count > MAX_SELECTION_COUNT:
        raise ValueError(f"count must be at most {MAX_SELECTION_COUNT}")
    if start > total:
        raise ValueError("startIndex is outside the rendered document")
    return list(range(start, min(start + count, total + 1)))


def _remaining_timeout(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ArtifactError(
            "timeout",
            "The workbook preview exceeded its end-to-end timeout.",
            "Retry with a smaller workbook or a narrower page selection.",
            {"stage": "render"},
        )
    return remaining


def _preview_artifact(bundle: PreviewBundle) -> Path:
    selected = bundle.contact_sheet or (bundle.items[0] if bundle.items else None)
    if selected is None:
        raise ValueError("document renderer returned no preview")
    return selected.path


def _flatten(image: Image.Image) -> Image.Image:
    converted = image.convert("RGBA")
    flattened = Image.new("RGB", converted.size, "white")
    flattened.paste(converted, mask=converted.getchannel("A"))
    converted.close()
    return flattened


def _encoded_image(path: Path) -> tuple[str, bytes, int, int]:
    with Image.open(path) as source:
        source.load()
        image = _flatten(source)
    try:
        image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        png = io.BytesIO()
        image.save(png, format="PNG", optimize=True)
        if png.tell() <= MAX_RESULT_BYTES:
            return "image/png", png.getvalue(), image.width, image.height
        quality = 88
        while True:
            jpeg = io.BytesIO()
            image.save(jpeg, format="JPEG", quality=quality, optimize=True)
            if jpeg.tell() <= MAX_RESULT_BYTES:
                return "image/jpeg", jpeg.getvalue(), image.width, image.height
            if quality > 52:
                quality -= 8
                continue
            width = max(1, int(image.width * 0.8))
            height = max(1, int(image.height * 0.8))
            if (width, height) == image.size:
                raise ValueError("rendered preview exceeds its byte limit")
            image.thumbnail((width, height), Image.Resampling.LANCZOS)
            quality = 80
    finally:
        image.close()


def _render_presentation(
    source: Path,
    office: Path,
    start: int,
    count: int,
    output: Path,
) -> tuple[PreviewBundle, list[int], int]:
    identity, _ = sha256_file(source, limits=PREVIEW_LIMITS)
    metadata = inspect_input(source, ArtifactKind.PPTX, limits=PREVIEW_LIMITS)
    total = int(metadata["slideCount"])
    selected = _selection(start, count, total)
    bundle = render_pptx(
        source,
        output,
        selected,
        expected_sha256=identity,
        limits=PREVIEW_LIMITS,
        timeout_seconds=OFFICE_PREVIEW_TIMEOUT_SECONDS,
        libreoffice=office,
    )
    return bundle, selected, total


def _render_workbook(
    source: Path,
    office: Path,
    start: int,
    count: int,
    work: Path,
) -> tuple[PreviewBundle, list[int], int]:
    deadline = time.monotonic() + OFFICE_PREVIEW_TIMEOUT_SECONDS
    identity, _ = sha256_file(source, limits=PREVIEW_LIMITS)
    inspect_xlsx(
        source,
        expected_sha256=identity,
        limits=PREVIEW_LIMITS,
        reject_unsafe_preview_content=True,
    )
    staged = work / "input.xlsx"
    _copy_admitted_file(source, staged, max_bytes=PREVIEW_LIMITS.max_input_bytes)
    staged_identity, _ = sha256_file(staged, limits=PREVIEW_LIMITS)
    if staged_identity != identity:
        raise ValueError("source document changed while it was staged")
    converted = render_workbook_pdf(
        staged,
        work / "converted",
        timeout_seconds=_remaining_timeout(deadline),
        executable=office,
    )
    metadata = inspect_input(converted, ArtifactKind.PDF, limits=PREVIEW_LIMITS)
    total = int(metadata["pageCount"])
    selected = _selection(start, count, total)
    bundle = render_pdf(
        converted,
        work / "rendered",
        selected,
        limits=PREVIEW_LIMITS,
        timeout_seconds=_remaining_timeout(deadline),
    )
    return bundle, selected, total


def run_office_preview(value: Mapping[str, Any]) -> dict[str, Any]:
    source = Path(str(value.get("sourcePath", "")))
    office = Path(str(value.get("libreOfficePath", "")))
    kind = str(value.get("kind", "")).lower()
    start = _positive_integer(value.get("startIndex"), "startIndex", 1)
    count = _positive_integer(value.get("count"), "count", MAX_SELECTION_COUNT)
    if not source.is_absolute() or source.is_symlink() or not source.is_file():
        raise ValueError("sourcePath must be an absolute regular file")
    if kind not in {"xlsx", "pptx"}:
        raise ValueError("office preview kind must be xlsx or pptx")
    with artifact_temporary_directory(prefix="orca-office-preview-") as work:
        if kind == "pptx":
            bundle, selected, total = _render_presentation(
                source, office, start, count, work / "rendered"
            )
        else:
            bundle, selected, total = _render_workbook(source, office, start, count, work)
        media_type, encoded, width, height = _encoded_image(_preview_artifact(bundle))
    next_index = selected[-1] + 1 if selected[-1] < total else None
    return {
        "ok": True,
        "kind": kind,
        "mediaType": media_type,
        "imageBase64": base64.b64encode(encoded).decode("ascii"),
        "width": width,
        "height": height,
        "startIndex": selected[0],
        "endIndex": selected[-1],
        "totalCount": total,
        "nextIndex": next_index,
    }
