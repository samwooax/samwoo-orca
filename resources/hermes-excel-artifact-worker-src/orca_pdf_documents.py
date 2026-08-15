"""Bounded PDF creation and editing for the Orca-owned worker."""

from __future__ import annotations

import hashlib
import io
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from pypdf import PdfReader, PdfWriter, Transformation
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, LETTER
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from orca_excel_artifact.inputs import inspect_input


MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_OPERATIONS = 256


def _record(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _list(value: object, name: str, maximum: int) -> list[Any]:
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f"{name} must be a bounded array")
    return value


def _number(value: object, default: float) -> float:
    result = default if value is None else float(value)
    if not 0 <= result <= 100:
        raise ValueError("document coordinate is outside bounds")
    return result


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_source(request: Mapping[str, Any]) -> Path:
    source = Path(str(request.get("sourcePath")))
    if not source.is_absolute() or not source.is_file() or source.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("source document is unavailable")
    if _sha256(source) != str(request.get("expectedSha256")):
        raise ValueError("source document hash mismatch")
    inspect_input(source, "pdf")
    return source


@lru_cache(maxsize=1)
def _pdf_fonts() -> tuple[str, str]:
    windows_fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    candidates = [
        (windows_fonts / "malgun.ttf", windows_fonts / "malgunbd.ttf"),
        (
            Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"),
            Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"),
        ),
        (
            Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
            Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
        ),
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ),
    ]
    for regular_path, bold_path in candidates:
        if not regular_path.is_file():
            continue
        try:
            pdfmetrics.registerFont(TTFont("OrcaDocumentFont", regular_path))
            bold_name = "OrcaDocumentFont"
            if bold_path.is_file():
                pdfmetrics.registerFont(TTFont("OrcaDocumentFontBold", bold_path))
                bold_name = "OrcaDocumentFontBold"
            return "OrcaDocumentFont", bold_name
        except Exception:
            continue
    return "Helvetica", "Helvetica-Bold"


def _wrapped_lines(text: str, font: str, font_size: float, width: float) -> list[str]:
    result: list[str] = []
    for logical_line in text.splitlines():
        if not logical_line:
            result.append("")
            continue
        current = ""
        for character in logical_line:
            candidate = current + character
            if current and pdfmetrics.stringWidth(candidate, font, font_size) > width:
                result.append(current.rstrip())
                current = character.lstrip()
            else:
                current = candidate
        result.append(current.rstrip())
    return result or [""]


def _fit_text(
    text: str,
    font: str,
    font_size: float,
    line_height: float,
    width: float,
    height: float,
) -> tuple[float, float, list[str]]:
    fitted_size = font_size
    while True:
        fitted_line_height = max(fitted_size, line_height * fitted_size / font_size)
        lines = _wrapped_lines(text, font, fitted_size, width)
        if fitted_size + (len(lines) - 1) * fitted_line_height <= height:
            return fitted_size, fitted_line_height, lines
        if fitted_size <= 6:
            raise ValueError("PDF text exceeds its element height")
        fitted_size = max(6, fitted_size - 0.25)


def _draw_text_element(
    target: Any,
    element: Mapping[str, Any],
    page_size: tuple[float, float],
) -> None:
    page_width, page_height = page_size
    x = _number(element.get("x"), 0.75) * inch
    y = _number(element.get("y"), 0.75) * inch
    width = _number(element.get("width"), (page_width / inch) - 1.5) * inch
    height = _number(element.get("height"), (page_height / inch) - 1.5) * inch
    if width <= 0 or height <= 0 or x + width > page_width or y + height > page_height:
        raise ValueError("PDF text element is outside the page")
    text = str(element.get("text", ""))
    if not text.strip():
        raise ValueError("PDF text elements cannot be empty")
    font_size = float(element.get("fontSize", 11))
    line_height = float(element.get("lineHeight", font_size * 1.35))
    if not 6 <= font_size <= 72 or line_height < font_size:
        raise ValueError("PDF text sizing is invalid")
    regular_font, bold_font = _pdf_fonts()
    font = bold_font if element.get("bold") else regular_font
    font_size, line_height, lines = _fit_text(
        text, font, font_size, line_height, width, height
    )
    baseline = page_height - y - font_size
    bottom = page_height - y - height
    if baseline - (len(lines) - 1) * line_height < bottom - 0.01:
        raise ValueError("PDF text layout is outside its element")
    target.setFont(font, font_size)
    target.setFillColor(HexColor(str(element.get("color", "#111111"))))
    align = str(element.get("align", "left"))
    for line in lines:
        if align == "center":
            target.drawCentredString(x + width / 2, baseline, line)
        elif align == "right":
            target.drawRightString(x + width, baseline, line)
        else:
            target.drawString(x, baseline, line)
        baseline -= line_height


def _page_elements(page: Mapping[str, Any], page_size: tuple[float, float]) -> list[Mapping[str, Any]]:
    if "elements" in page:
        elements = [_record(value, "PDF element") for value in _list(page["elements"], "elements", 128)]
        if not elements:
            raise ValueError("PDF pages require at least one text element")
        return elements
    page_height = page_size[1] / inch
    elements: list[Mapping[str, Any]] = []
    if str(page.get("title", "")).strip():
        elements.append(
            {
                "type": "text",
                "x": 0.75,
                "y": 0.75,
                "width": (page_size[0] / inch) - 1.5,
                "height": 0.5,
                "fontSize": 18,
                "bold": True,
                "text": str(page["title"]),
            }
        )
    if str(page.get("text", "")).strip():
        elements.append(
            {
                "type": "text",
                "x": 0.75,
                "y": 1.4 if elements else 0.75,
                "width": (page_size[0] / inch) - 1.5,
                "height": page_height - (2.15 if elements else 1.5),
                "fontSize": page.get("fontSize", 11),
                "lineHeight": page.get("lineHeight", 16),
                "text": str(page["text"]),
            }
        )
    if not elements:
        raise ValueError("PDF pages require visible text")
    return elements


def _draw_page(target: Any, page: Mapping[str, Any], size: tuple[float, float]) -> None:
    for element in _page_elements(page, size):
        if element.get("type") != "text":
            raise ValueError("PDF element type is unsupported")
        _draw_text_element(target, element, size)
    target.showPage()


def create_pdf(request: Mapping[str, Any], output: Path) -> dict[str, Any]:
    spec = _record(request.get("documentSpec"), "documentSpec")
    pages = _list(spec.get("pages"), "pages", 1000)
    if not pages:
        raise ValueError("PDF requires at least one page")
    page_size = LETTER if str(spec.get("pageSize", "A4")).lower() == "letter" else A4
    document = canvas.Canvas(str(output), pagesize=page_size, pageCompression=1)
    for page in pages:
        _draw_page(document, _record(page, "page"), page_size)
    document.save()
    rendered_pages = PdfReader(output).pages
    if len(rendered_pages) != len(pages):
        raise ValueError("PDF page validation failed")
    text_counts = [len((page.extract_text() or "").strip()) for page in rendered_pages]
    if any(count < 1 for count in text_counts):
        raise ValueError("PDF page validation found missing text")
    return {
        "pageCount": len(rendered_pages),
        "appliedCount": len(pages),
        "textCharacterCount": sum(text_counts),
    }


def _watermark(text: str, width: float, height: float) -> Any:
    stream = io.BytesIO()
    layer = canvas.Canvas(stream, pagesize=(width, height))
    layer.setFont(_pdf_fonts()[0], 36)
    layer.setFillAlpha(0.2)
    layer.saveState()
    layer.translate(width / 2, height / 2)
    layer.rotate(35)
    layer.drawCentredString(0, 0, text[:200])
    layer.restoreState()
    layer.save()
    stream.seek(0)
    return PdfReader(stream).pages[0]


def edit_pdf(request: Mapping[str, Any], output: Path, artifacts: Mapping[str, Path]) -> dict[str, Any]:
    pages = list(PdfReader(_verify_source(request)).pages)
    metadata: dict[str, str] = {}
    applied = 0
    for raw in _list(request.get("operations"), "operations", MAX_OPERATIONS):
        operation = _record(raw, "operation")
        kind = operation.get("kind")
        if kind == "delete_pages":
            removed = {int(value) for value in _list(operation.get("pages"), "pages", 1000)}
            pages = [page for index, page in enumerate(pages, 1) if index not in removed]
        elif kind == "reorder_pages":
            order = [int(value) for value in _list(operation.get("pages"), "pages", 1000)]
            pages = [pages[index - 1] for index in order]
        elif kind == "rotate_pages":
            selected = {int(value) for value in _list(operation.get("pages"), "pages", 1000)}
            angle = int(operation.get("degrees", 0))
            for index, page in enumerate(pages, 1):
                if index in selected:
                    page.rotate(angle)
        elif kind == "merge_pdf":
            artifact = artifacts.get(str(operation.get("artifactId", "")))
            if artifact is None:
                raise ValueError("merged PDF artifact is unavailable")
            inspect_input(artifact, "pdf")
            pages.extend(PdfReader(artifact).pages)
        elif kind == "watermark":
            for page in pages:
                page.merge_transformed_page(
                    _watermark(
                        str(operation.get("text", "")),
                        float(page.mediabox.width),
                        float(page.mediabox.height),
                    ),
                    Transformation(),
                )
        elif kind == "metadata":
            values = _record(operation.get("values"), "metadata")
            metadata = {f"/{key.title()}": str(value) for key, value in values.items()}
        else:
            raise ValueError("PDF edit operation is unsupported")
        applied += 1
    if not pages:
        raise ValueError("PDF cannot be empty")
    writer = PdfWriter()
    for page in pages:
        writer.add_page(page)
    if metadata:
        writer.add_metadata(metadata)
    with output.open("xb") as stream:
        writer.write(stream)
        stream.flush()
        os.fsync(stream.fileno())
    PdfReader(output)
    return {"pageCount": len(pages), "appliedCount": applied}
