"""Strict, path-free inspection of admitted PPTX, PDF, PNG, and JPEG inputs."""

from __future__ import annotations

import math
import posixpath
import json
import warnings as python_warnings
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import unquote, urlsplit
from xml.etree.ElementTree import Element, ParseError

from defusedxml import ElementTree as SafeET
from defusedxml.common import DefusedXmlException

from .archive import ZipInspection, inspect_zip, inspect_zip_bytes, safe_read_member
from .artifacts import (
    MEDIA_TYPES,
    ArtifactKind,
    parse_artifact_kind,
    sha256_file,
    verify_expected_sha256,
)
from .errors import ArtifactError
from .limits import ArtifactLimits, DEFAULT_LIMITS


NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}

PPTX_MAIN_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
)
XLSX_MAIN_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
)
XLSX_PACKAGE_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)
MAX_XML_BYTES = 8 * 1024 * 1024
MAX_TEXT_PER_ITEM = 16_384
MAX_TEXT_TOTAL = 512_000
MAX_METADATA_ITEMS = 20_000
MAX_UNSUPPORTED_OBJECT_TYPES = 256
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

_FORBIDDEN_CONTENT_TYPE_FRAGMENTS = (
    "macroenabled",
    "vbaproject",
    "activex",
    "oleobject",
    "ms-office.active",
)
_FORBIDDEN_PART_FRAGMENTS = (
    "/activex/",
    "vbaproject.bin",
    "encryptedpackage",
    "encryptioninfo",
)
_FORBIDDEN_XLSX_PART_FRAGMENTS = (
    "/activex/",
    "/embeddings/",
    "/externallinks/",
    "vbaproject.bin",
    "encryptedpackage",
    "encryptioninfo",
)
_FORBIDDEN_RELATIONSHIP_FRAGMENTS = (
    "/oleobject",
    "/activex",
    "/vbaproject",
    "/attachedtemplate",
)
_REMOTE_SCHEMES = frozenset(
    {"data", "file", "ftp", "ftps", "http", "https", "ldap", "mailto", "smb", "telnet"}
)


def _read_magic(path: Path, length: int = 16) -> bytes:
    try:
        with path.open("rb") as stream:
            return stream.read(length)
    except OSError:
        raise ArtifactError(
            "input_format_invalid",
            "The input artifact could not be read.",
            "Select a stable, readable artifact and retry.",
        ) from None


def _check_magic(path: Path, kind: ArtifactKind) -> None:
    magic = _read_magic(path)
    expected = {
        ArtifactKind.PPTX: (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
        ArtifactKind.XLSX: (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
        ArtifactKind.PDF: (b"%PDF-",),
        ArtifactKind.PNG: (b"\x89PNG\r\n\x1a\n",),
        ArtifactKind.JPEG: (b"\xff\xd8\xff",),
    }[kind]
    if kind is ArtifactKind.PPTX and magic.startswith(_OLE_MAGIC):
        raise ArtifactError(
            "input_encrypted",
            "The presentation is an encrypted or legacy compound document.",
            "Remove password protection and export it as a standard .pptx file.",
        )
    if not any(magic.startswith(signature) for signature in expected):
        raise ArtifactError(
            "input_format_invalid",
            "The input signature does not match the declared artifact kind.",
            "Provide the original file and declare its real format.",
            {"declaredKind": kind.value},
        )


def _normalize_selection(
    selection: Mapping[str, Any] | Sequence[int] | None,
    total: int,
    *,
    plural: str,
) -> list[int]:
    if selection is None:
        return list(range(1, total + 1))
    raw: Any = selection
    if isinstance(selection, Mapping):
        allowed = {plural, "indices"}
        if not set(selection).issubset(allowed) or len(selection) != 1:
            raise ArtifactError(
                "protocol_invalid",
                "The input selection has unsupported fields.",
                f"Provide a single '{plural}' array of one-based indices.",
            )
        raw = selection.get(plural, selection.get("indices"))
    if isinstance(raw, (str, bytes)) or not isinstance(raw, Sequence) or not raw:
        raise ArtifactError(
            "protocol_invalid",
            "The input selection must be a non-empty array.",
            "Provide unique one-based integer indices.",
        )
    result: list[int] = []
    seen: set[int] = set()
    for value in raw:
        if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > total:
            raise ArtifactError(
                "protocol_invalid",
                "The input selection contains an out-of-range index.",
                f"Use one-based indices between 1 and {total}.",
            )
        if value in seen:
            raise ArtifactError(
                "protocol_invalid",
                "The input selection contains a duplicate index.",
                "List every selected page or slide once.",
            )
        seen.add(value)
        result.append(value)
    return result


def _parse_xml(payload: bytes, *, part: str) -> Element:
    try:
        return SafeET.fromstring(payload)
    except (DefusedXmlException, ParseError, ValueError):
        raise ArtifactError(
            "input_format_invalid",
            "A presentation XML part is malformed or contains forbidden XML features.",
            "Open and re-save the presentation with a trusted Office application.",
            {"part": part},
        ) from None


def _xml_part(archive: ZipInspection, name: str, limits: ArtifactLimits) -> Element:
    return _parse_xml(
        safe_read_member(archive, name, max_bytes=MAX_XML_BYTES, limits=limits),
        part=name,
    )


def _content_types(archive: ZipInspection, limits: ArtifactLimits) -> tuple[dict[str, str], dict[str, str]]:
    root = _xml_part(archive, "[Content_Types].xml", limits)
    overrides: dict[str, str] = {}
    defaults: dict[str, str] = {}
    for node in root:
        content_type = (node.attrib.get("ContentType") or "").strip()
        lowered = content_type.casefold()
        if any(fragment in lowered for fragment in _FORBIDDEN_CONTENT_TYPE_FRAGMENTS):
            raise ArtifactError(
                "input_format_invalid",
                "The presentation contains macro, OLE, or ActiveX content.",
                "Remove active content and export a standard non-macro PPTX.",
            )
        if node.tag == f"{{{NS['ct']}}}Override":
            part = (node.attrib.get("PartName") or "").lstrip("/")
            if part:
                overrides[part] = content_type
        elif node.tag == f"{{{NS['ct']}}}Default":
            extension = (node.attrib.get("Extension") or "").casefold()
            if extension:
                defaults[extension] = content_type
    if overrides.get("ppt/presentation.xml") != PPTX_MAIN_CONTENT_TYPE:
        raise ArtifactError(
            "input_format_invalid",
            "The ZIP package is not a standard PPTX presentation.",
            "Export the source as a non-macro PowerPoint .pptx file.",
        )
    return overrides, defaults


def _relationship_source(rels_part: str) -> str:
    if rels_part == "_rels/.rels":
        return ""
    marker = "/_rels/"
    if marker not in rels_part or not rels_part.endswith(".rels"):
        raise ArtifactError(
            "input_format_invalid",
            "The presentation contains a malformed relationship part name.",
            "Re-export the presentation with a trusted Office application.",
        )
    prefix, filename = rels_part.split(marker, 1)
    return f"{prefix}/{filename[:-5]}"


def _resolve_relationship_target(source: str, raw_target: str, *, known: frozenset[str]) -> str:
    target = raw_target.strip()
    if not target:
        raise ArtifactError(
            "input_format_invalid",
            "The presentation contains an empty relationship target.",
            "Re-export the presentation with a trusted Office application.",
        )
    decoded = target
    for _ in range(3):
        expanded = unquote(decoded)
        if expanded == decoded:
            break
        decoded = expanded
    if "\\" in decoded or "\x00" in decoded:
        raise ArtifactError(
            "archive_traversal_detected",
            "A presentation relationship contains an unsafe path.",
            "Remove the unsafe relationship and re-export the presentation.",
        )
    parsed = urlsplit(decoded)
    if parsed.scheme.casefold() in _REMOTE_SCHEMES or parsed.netloc or decoded.startswith("//"):
        raise ArtifactError(
            "input_format_invalid",
            "The presentation contains a remote or external relationship.",
            "Embed required assets locally and remove external links before retrying.",
        )
    if parsed.scheme:
        raise ArtifactError(
            "input_format_invalid",
            "The presentation contains an unsupported relationship URI.",
            "Use package-internal relationships only.",
        )
    if not parsed.path and parsed.fragment:
        return f"#{parsed.fragment}"
    if parsed.path.startswith("/"):
        normalized = posixpath.normpath(parsed.path.lstrip("/"))
    else:
        normalized = posixpath.normpath(posixpath.join(posixpath.dirname(source), parsed.path))
    if normalized in {"", ".", ".."} or normalized.startswith("../"):
        raise ArtifactError(
            "archive_traversal_detected",
            "A presentation relationship escapes the package root.",
            "Remove the unsafe relationship and re-export the presentation.",
        )
    if normalized not in known:
        raise ArtifactError(
            "input_format_invalid",
            "A presentation relationship points to a missing package part.",
            "Open and re-save the presentation to repair broken relationships.",
            {"missingPart": normalized},
        )
    return normalized


def _inspect_relationships(
    archive: ZipInspection,
    limits: ArtifactLimits,
) -> dict[str, dict[str, dict[str, str]]]:
    result: dict[str, dict[str, dict[str, str]]] = {}
    for rels_part in sorted(name for name in archive.names if name.endswith(".rels")):
        source = _relationship_source(rels_part)
        root = _xml_part(archive, rels_part, limits)
        relationships: dict[str, dict[str, str]] = {}
        for node in root.findall("pr:Relationship", NS):
            rel_id = (node.attrib.get("Id") or "").strip()
            rel_type = (node.attrib.get("Type") or "").strip()
            target = (node.attrib.get("Target") or "").strip()
            if not rel_id or rel_id in relationships:
                raise ArtifactError(
                    "input_format_invalid",
                    "A presentation relationship ID is missing or duplicated.",
                    "Re-export the presentation with a trusted Office application.",
                )
            if (node.attrib.get("TargetMode") or "").casefold() == "external":
                raise ArtifactError(
                    "input_format_invalid",
                    "The presentation contains an external relationship.",
                    "Embed linked content and remove external links before retrying.",
                )
            lowered_type = rel_type.casefold()
            if any(fragment in lowered_type for fragment in _FORBIDDEN_RELATIONSHIP_FRAGMENTS):
                raise ArtifactError(
                    "input_format_invalid",
                    "The presentation contains an OLE, ActiveX, or macro relationship.",
                    "Remove active or embedded executable content and retry.",
                )
            relationships[rel_id] = {
                "type": rel_type,
                "target": _resolve_relationship_target(source, target, known=archive.names),
            }
        result[source] = relationships
    return result


def _reject_forbidden_parts(archive: ZipInspection) -> None:
    for member in archive.members:
        lowered = f"/{member.name.casefold().strip('/')}"
        if any(fragment in lowered for fragment in _FORBIDDEN_PART_FRAGMENTS):
            raise ArtifactError(
                "input_format_invalid",
                "The presentation contains encrypted, macro, OLE, or ActiveX package parts.",
                "Remove active and embedded executable content, then export a clean PPTX.",
            )


def _inspect_embedded_workbooks(
    archive: ZipInspection,
    relationships: Mapping[str, Mapping[str, Mapping[str, str]]],
    overrides: Mapping[str, str],
    defaults: Mapping[str, str],
    limits: ArtifactLimits,
) -> list[dict[str, Any]]:
    """Allow only native chart-data XLSX packages after nested OPC inspection."""

    embeddings = sorted(
        name for name in archive.names if name.casefold().startswith("ppt/embeddings/")
    )
    if not embeddings:
        return []
    target_relationships: dict[str, list[tuple[str, str]]] = {}
    for source, relations in relationships.items():
        for relation in relations.values():
            target_relationships.setdefault(relation["target"], []).append(
                (source, relation["type"])
            )
    inspected: list[dict[str, Any]] = []
    for part in embeddings:
        content_type = _content_type_for(part, overrides, defaults)
        relationship_sources = target_relationships.get(part, [])
        if (
            not part.casefold().endswith(".xlsx")
            or content_type != XLSX_PACKAGE_CONTENT_TYPE
            or not relationship_sources
            or any(
                not source.casefold().startswith("ppt/charts/")
                or not rel_type.casefold().endswith("/package")
                for source, rel_type in relationship_sources
            )
        ):
            raise ArtifactError(
                "input_format_invalid",
                "The presentation contains an unknown or OLE embedded object.",
                "Remove embedded objects; native chart-data XLSX packages are the only supported embedding.",
            )
        payload = safe_read_member(archive, part, limits=limits)
        nested = inspect_zip_bytes(payload, limits=limits)
        for member in nested.members:
            lowered = f"/{member.name.casefold().strip('/')}"
            if any(fragment in lowered for fragment in _FORBIDDEN_XLSX_PART_FRAGMENTS):
                raise ArtifactError(
                    "input_format_invalid",
                    "An embedded chart workbook contains active or external package parts.",
                    "Replace it with a standard non-macro XLSX workbook.",
                )
        root = _xml_part(nested, "[Content_Types].xml", limits)
        nested_main_type = ""
        for node in root:
            content = (node.attrib.get("ContentType") or "").strip()
            if any(fragment in content.casefold() for fragment in _FORBIDDEN_CONTENT_TYPE_FRAGMENTS):
                raise ArtifactError(
                    "input_format_invalid",
                    "An embedded chart workbook contains active content types.",
                    "Replace it with a standard non-macro XLSX workbook.",
                )
            if (
                node.tag == f"{{{NS['ct']}}}Override"
                and (node.attrib.get("PartName") or "").lstrip("/") == "xl/workbook.xml"
            ):
                nested_main_type = content
        if nested_main_type != XLSX_MAIN_CONTENT_TYPE:
            raise ArtifactError(
                "input_format_invalid",
                "An embedded chart data package is not a standard XLSX workbook.",
                "Replace it with a standard non-macro XLSX workbook.",
            )
        # This validates every internal target, rejects TargetMode=External and
        # active relationship types, and parses relationship XML with defusedxml.
        _inspect_relationships(nested, limits)
        spreadsheet_ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        for worksheet in sorted(
            name
            for name in nested.names
            if name.startswith("xl/worksheets/") and name.endswith(".xml")
        ):
            worksheet_root = _xml_part(nested, worksheet, limits)
            if worksheet_root.find(f".//{{{spreadsheet_ns}}}f") is not None:
                raise ArtifactError(
                    "input_format_invalid",
                    "An embedded chart workbook contains executable formulas.",
                    "Replace chart data with cached values in a standard XLSX package.",
                )
        inspected.append(
            {
                "mediaType": XLSX_PACKAGE_CONTENT_TYPE,
                "sizeBytes": len(payload),
                "warning": "Embedded chart workbook was inspected but its cells were not imported into slide text.",
            }
        )
    return inspected


def _safe_int(value: str | None, *, default: int = 0) -> int:
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError, OverflowError):
        return default


def _bbox(node: Element) -> dict[str, int] | None:
    transform = node.find(".//a:xfrm", NS)
    if transform is None:
        transform = node.find(".//p:xfrm", NS)
    if transform is None:
        return None
    offset = transform.find("a:off", NS)
    extent = transform.find("a:ext", NS)
    if offset is None:
        offset = transform.find("p:off", NS)
    if extent is None:
        extent = transform.find("p:ext", NS)
    if offset is None or extent is None:
        return None
    width = _safe_int(extent.attrib.get("cx"))
    height = _safe_int(extent.attrib.get("cy"))
    if width < 0 or height < 0:
        return None
    return {
        "xEmu": _safe_int(offset.attrib.get("x")),
        "yEmu": _safe_int(offset.attrib.get("y")),
        "widthEmu": width,
        "heightEmu": height,
    }


def _color_hint(node: Element) -> dict[str, str]:
    srgb = node.find(".//a:srgbClr", NS)
    if srgb is not None:
        value = (srgb.attrib.get("val") or "").strip()
        if len(value) in {6, 8} and all(character in "0123456789abcdefABCDEF" for character in value):
            return {"color": f"#{value.upper()}"}
    system = node.find(".//a:sysClr", NS)
    if system is not None:
        value = (system.attrib.get("lastClr") or "").strip()
        if len(value) == 6 and all(character in "0123456789abcdefABCDEF" for character in value):
            return {"color": f"#{value.upper()}"}
    preset = node.find(".//a:prstClr", NS)
    if preset is not None and (value := (preset.attrib.get("val") or "").strip()):
        return {"color": value[:64]}
    scheme = node.find(".//a:schemeClr", NS)
    if scheme is not None and (value := (scheme.attrib.get("val") or "").strip()):
        return {"themeColor": value[:64]}
    return {}


def _background_metadata(root: Element) -> dict[str, str] | None:
    """Project only an explicit slide background; inherited layout is unknown."""

    background = root.find("p:cSld/p:bg", NS)
    if background is None:
        return None
    reference = background.find("p:bgRef", NS)
    if reference is not None:
        return {"kind": "theme", **_color_hint(reference)}
    properties = background.find("p:bgPr", NS)
    if properties is None:
        return {"kind": "unknown"}
    for tag, kind in (
        ("a:solidFill", "solid"),
        ("a:gradFill", "gradient"),
        ("a:pattFill", "pattern"),
        ("a:blipFill", "image"),
    ):
        fill = properties.find(tag, NS)
        if fill is not None:
            return {"kind": kind, **_color_hint(fill)}
    return {"kind": "unknown"}


def _initial_unsupported_objects(
    root: Element,
    relationships: Mapping[str, Mapping[str, str]],
) -> set[str]:
    """Collect bounded type labels only; never dereference unsupported objects."""

    result: set[str] = set()

    def add(value: str) -> None:
        if len(result) < MAX_UNSUPPORTED_OBJECT_TYPES:
            result.add(value)

    local_media = {
        "audioFile": "audio",
        "wavAudioFile": "audio",
        "videoFile": "video",
        "quickTimeFile": "video",
        "media": "media",
    }
    for node in root.iter():
        local_name = node.tag.rsplit("}", 1)[-1]
        if local_name in local_media:
            add(local_media[local_name])
        elif local_name == "AlternateContent":
            add("alternateContent")
    for relation in relationships.values():
        relation_kind = relation["type"].rsplit("/", 1)[-1].casefold()
        if relation_kind in {"audio", "video", "media"}:
            add(relation_kind)
    shape_tree = root.find("p:cSld/p:spTree", NS)
    allowed_children = {
        "nvGrpSpPr",
        "grpSpPr",
        "sp",
        "grpSp",
        "graphicFrame",
        "cxnSp",
        "pic",
    }
    if shape_tree is not None:
        for child in shape_tree:
            if child.tag.startswith(f"{{{NS['p']}}}"):
                local_name = child.tag.rsplit("}", 1)[-1]
                if local_name not in allowed_children:
                    add("contentPart" if local_name == "contentPart" else "unknownShape")
    return result


def _text(node: Element, state: dict[str, int], warnings: list[dict[str, Any]], slide: int) -> str:
    chunks = [item.text or "" for item in node.findall(".//a:t", NS)]
    text = "\n".join(chunk for chunk in chunks if chunk)
    if len(text) > MAX_TEXT_PER_ITEM:
        text = text[:MAX_TEXT_PER_ITEM]
        warnings.append(
            {
                "code": "text_truncated",
                "message": "Shape text was truncated in metadata.",
                "details": {"stage": "pptx_metadata", "feature": f"slide:{slide}"},
            }
        )
    remaining = MAX_TEXT_TOTAL - state["text"]
    if remaining <= 0:
        if not state.get("totalWarning"):
            warnings.append(
                {"code": "text_limit", "message": "Presentation text metadata reached its limit."}
            )
            state["totalWarning"] = 1
        return ""
    if len(text) > remaining:
        text = text[:remaining]
        warnings.append(
            {"code": "text_truncated", "message": "Presentation text metadata was truncated."}
        )
    state["text"] += len(text)
    return text


def _content_type_for(part: str, overrides: Mapping[str, str], defaults: Mapping[str, str]) -> str:
    explicit = overrides.get(part)
    if explicit:
        return explicit
    extension = PurePosixPath(part).suffix.lstrip(".").casefold()
    return defaults.get(extension, "application/octet-stream")


def _image_metadata(
    archive: ZipInspection,
    target: str,
    *,
    overrides: Mapping[str, str],
    defaults: Mapping[str, str],
    limits: ArtifactLimits,
) -> dict[str, Any]:
    member = archive.require(target)
    result: dict[str, Any] = {
        "mediaType": _content_type_for(target, overrides, defaults),
        "sizeBytes": member.size_bytes,
    }
    media_type = result["mediaType"]
    if media_type in {"image/png", "image/jpeg"}:
        from io import BytesIO

        from PIL import Image, UnidentifiedImageError

        payload = safe_read_member(archive, target, limits=limits)
        try:
            with Image.open(BytesIO(payload)) as image:
                width, height = image.size
                image_format = image.format
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
            raise ArtifactError(
                "input_format_invalid",
                "The presentation contains a corrupt embedded image.",
                "Replace the image and re-export the presentation.",
            ) from None
        if image_format not in {"PNG", "JPEG"}:
            raise ArtifactError(
                "input_format_invalid",
                "An embedded image signature does not match its declared type.",
                "Replace the image and re-export the presentation.",
            )
        if (
            width <= 0
            or height <= 0
            or width > limits.max_image_dimension
            or height > limits.max_image_dimension
            or width * height > limits.max_image_pixels
        ):
            raise ArtifactError(
                "archive_limit_exceeded",
                "An embedded image exceeds the configured pixel limits.",
                "Resize the image and re-export the presentation.",
            )
        result.update({"pixelWidth": width, "pixelHeight": height})
    return result


def _theme_metadata(archive: ZipInspection, limits: ArtifactLimits) -> tuple[dict[str, Any], set[str]]:
    themes = sorted(name for name in archive.names if name.startswith("ppt/theme/") and name.endswith(".xml"))
    if not themes:
        return {}, set()
    root = _xml_part(archive, themes[0], limits)
    theme: dict[str, Any] = {"name": root.attrib.get("name", "")}
    colors = root.find(".//a:clrScheme", NS)
    fonts = root.find(".//a:fontScheme", NS)
    if colors is not None:
        theme["colorScheme"] = colors.attrib.get("name", "")
    if fonts is not None:
        theme["fontScheme"] = fonts.attrib.get("name", "")
    typefaces = {
        node.attrib["typeface"]
        for node in root.findall(".//*[@typeface]")
        if node.attrib.get("typeface")
    }
    return theme, typefaces


def _chart_metadata(archive: ZipInspection, target: str, limits: ArtifactLimits) -> dict[str, Any]:
    root = _xml_part(archive, target, limits)
    chart_types: list[str] = []
    for node in root.iter():
        if node.tag.startswith(f"{{{NS['c']}}}"):
            local = node.tag.rsplit("}", 1)[-1]
            if local.endswith("Chart") and local not in chart_types:
                chart_types.append(local)
    title = "\n".join(item.text or "" for item in root.findall(".//c:title//a:t", NS))
    return {"types": chart_types[:32], "title": title[:MAX_TEXT_PER_ITEM]}


def _slide_metadata(
    archive: ZipInspection,
    part: str,
    index: int,
    relationships: Mapping[str, Mapping[str, Mapping[str, str]]],
    overrides: Mapping[str, str],
    defaults: Mapping[str, str],
    limits: ArtifactLimits,
    state: dict[str, int],
    warnings: list[dict[str, Any]],
) -> dict[str, Any]:
    root = _xml_part(archive, part, limits)
    rels = relationships.get(part, {})
    slide: dict[str, Any] = {
        "index": index,
        "text": [],
        "shapes": [],
        "tables": [],
        "charts": [],
        "images": [],
    }
    background = _background_metadata(root)
    if background is not None:
        slide["background"] = background
    unsupported_objects = _initial_unsupported_objects(root, rels)
    shape_tags = {
        f"{{{NS['p']}}}sp": "shape",
        f"{{{NS['p']}}}cxnSp": "connector",
        f"{{{NS['p']}}}grpSp": "group",
    }
    for node in root.iter():
        if state["items"] >= MAX_METADATA_ITEMS:
            if not state.get("itemWarning"):
                warnings.append(
                    {
                        "code": "metadata_limit",
                        "message": "Shape metadata reached its item limit.",
                        "details": {"stage": "pptx_metadata", "count": MAX_METADATA_ITEMS},
                    }
                )
                state["itemWarning"] = 1
            break
        if node.tag in shape_tags:
            descriptor = node.find(".//p:cNvPr", NS)
            shape: dict[str, Any] = {
                "type": shape_tags[node.tag],
                "name": descriptor.attrib.get("name", "") if descriptor is not None else "",
            }
            bounds = _bbox(node)
            if bounds is not None:
                shape["bbox"] = bounds
            else:
                warnings.append(
                    {
                        "code": "bbox_unavailable",
                        "message": "A shape has no direct bounding box.",
                        "details": {"stage": "pptx_metadata", "feature": f"slide:{index}"},
                    }
                )
            text = _text(node, state, warnings, index)
            if text:
                shape["text"] = text
                slide["text"].append({"text": text, **({"bbox": bounds} if bounds else {})})
            slide["shapes"].append(shape)
            state["items"] += 1
        elif node.tag == f"{{{NS['p']}}}graphicFrame":
            bounds = _bbox(node)
            table = node.find(".//a:tbl", NS)
            chart = node.find(".//c:chart", NS)
            if table is not None:
                rows = []
                for row in table.findall("a:tr", NS):
                    rows.append([_text(cell, state, warnings, index) for cell in row.findall("a:tc", NS)])
                entry: dict[str, Any] = {
                    "rows": len(rows),
                    "columns": max((len(row) for row in rows), default=0),
                    "cells": rows,
                }
                if bounds:
                    entry["bbox"] = bounds
                slide["tables"].append(entry)
                state["items"] += 1
            if chart is not None:
                rel_id = chart.attrib.get(f"{{{NS['r']}}}id", "")
                relation = rels.get(rel_id)
                if relation is None or "/chart" not in relation["type"].casefold():
                    raise ArtifactError(
                        "input_format_invalid",
                        "A chart relationship is missing or malformed.",
                        "Open and re-save the presentation to repair the chart.",
                    )
                entry = _chart_metadata(archive, relation["target"], limits)
                if bounds:
                    entry["bbox"] = bounds
                slide["charts"].append(entry)
                state["items"] += 1
            if table is None and chart is None:
                graphic_data = node.find(".//a:graphicData", NS)
                uri = (graphic_data.attrib.get("uri") or "").casefold() if graphic_data is not None else ""
                if "diagram" in uri or "smartart" in uri:
                    unsupported_objects.add("diagram")
                elif "media" in uri:
                    unsupported_objects.add("media")
                else:
                    unsupported_objects.add("unknownGraphicFrame")
        elif node.tag == f"{{{NS['p']}}}pic":
            bounds = _bbox(node)
            blip = node.find(".//a:blip", NS)
            rel_id = blip.attrib.get(f"{{{NS['r']}}}embed", "") if blip is not None else ""
            relation = rels.get(rel_id)
            if relation is None or "/image" not in relation["type"].casefold():
                raise ArtifactError(
                    "input_format_invalid",
                    "An image relationship is missing or malformed.",
                    "Replace the image and re-export the presentation.",
                )
            entry = _image_metadata(
                archive,
                relation["target"],
                overrides=overrides,
                defaults=defaults,
                limits=limits,
            )
            if bounds:
                entry["bbox"] = bounds
            slide["images"].append(entry)
            state["items"] += 1
    slide["unsupportedObjects"] = sorted(unsupported_objects)[:MAX_UNSUPPORTED_OBJECT_TYPES]
    return slide


def _inspect_pptx(
    path: Path,
    *,
    selection: Mapping[str, Any] | Sequence[int] | None,
    limits: ArtifactLimits,
) -> dict[str, Any]:
    archive = inspect_zip(path, limits=limits)
    _reject_forbidden_parts(archive)
    overrides, defaults = _content_types(archive, limits)
    relationships = _inspect_relationships(archive, limits)
    embedded_workbooks = _inspect_embedded_workbooks(
        archive, relationships, overrides, defaults, limits
    )
    presentation = _xml_part(archive, "ppt/presentation.xml", limits)
    presentation_rels = relationships.get("ppt/presentation.xml", {})
    slide_parts: list[str] = []
    for slide_id in presentation.findall(".//p:sldId", NS):
        rel_id = slide_id.attrib.get(f"{{{NS['r']}}}id", "")
        relation = presentation_rels.get(rel_id)
        if relation is None or not relation["type"].casefold().endswith("/slide"):
            raise ArtifactError(
                "input_format_invalid",
                "The presentation slide order contains a broken relationship.",
                "Open and re-save the presentation to repair its slide order.",
            )
        slide_parts.append(relation["target"])
    if not slide_parts:
        raise ArtifactError(
            "input_format_invalid",
            "The presentation contains no slides.",
            "Provide a presentation with at least one slide.",
        )
    if len(slide_parts) > limits.max_slides:
        raise ArtifactError(
            "archive_limit_exceeded",
            "The presentation contains too many slides.",
            "Split the presentation into smaller files.",
            {"limitSlides": limits.max_slides, "actualSlides": len(slide_parts)},
        )
    selected = _normalize_selection(selection, len(slide_parts), plural="slides")
    slide_size = presentation.find("p:sldSz", NS)
    width = _safe_int(slide_size.attrib.get("cx")) if slide_size is not None else 0
    height = _safe_int(slide_size.attrib.get("cy")) if slide_size is not None else 0
    warning_items: list[dict[str, Any]] = []
    if embedded_workbooks:
        warning_items.append(
            {
                "code": "embedded_chart_workbook",
                "message": "Native chart-data workbooks were safety-inspected; cell content is not projected.",
                "details": {
                    "stage": "pptx_metadata",
                    "feature": "embedded_chart_workbook",
                    "count": len(embedded_workbooks),
                },
            }
        )
    if width <= 0 or height <= 0:
        warning_items.append(
            {"code": "slide_size_unavailable", "message": "The presentation has no valid slide size metadata."}
        )
    theme, fonts = _theme_metadata(archive, limits)
    for name in archive.names:
        if name.endswith(".xml"):
            root = _xml_part(archive, name, limits)
            fonts.update(
                node.attrib["typeface"]
                for node in root.findall(".//*[@typeface]")
                if node.attrib.get("typeface")
            )
    state = {"text": 0, "items": 0}
    slides = [
        _slide_metadata(
            archive,
            slide_parts[index - 1],
            index,
            relationships,
            overrides,
            defaults,
            limits,
            state,
            warning_items,
        )
        for index in selected
    ]
    return {
        "slideCount": len(slide_parts),
        "selection": selected,
        "presentation": {
            "widthEmu": width,
            "heightEmu": height,
            "theme": theme,
            "fonts": sorted(fonts),
            "slides": slides,
            "embeddedWorkbooks": embedded_workbooks,
        },
        "warnings": warning_items,
    }


_FORBIDDEN_PDF_NAMES = frozenset(
    {
        "/AA",
        "/EmbeddedFile",
        "/EmbeddedFiles",
        "/JavaScript",
        "/JS",
        "/Launch",
        "/GoToE",
        "/GoToR",
        "/ImportData",
        "/Movie",
        "/OpenAction",
        "/Rendition",
        "/RichMedia",
        "/Sound",
        "/SubmitForm",
        "/URI",
        "/XFA",
    }
)


def _reject_active_pdf(reader: Any) -> None:
    root = reader.trailer.get("/Root")
    stack: list[tuple[Any, int]] = [(root, 0)]
    seen: set[int] = set()
    visited = 0
    while stack:
        value, depth = stack.pop()
        if value is None:
            continue
        try:
            value = value.get_object() if hasattr(value, "get_object") else value
        except Exception:
            raise ArtifactError(
                "input_format_invalid",
                "The PDF contains an unreadable object graph.",
                "Open and re-save it as a flattened PDF.",
            ) from None
        identity = id(value)
        if identity in seen:
            continue
        seen.add(identity)
        visited += 1
        if visited > 50_000 or depth > 64:
            raise ArtifactError(
                "archive_limit_exceeded",
                "The PDF object graph exceeds the configured inspection limit.",
                "Flatten or split the PDF before retrying.",
            )
        if isinstance(value, Mapping):
            for key, child in value.items():
                if str(key) in _FORBIDDEN_PDF_NAMES or str(child) in _FORBIDDEN_PDF_NAMES:
                    raise ArtifactError(
                        "input_format_invalid",
                        "The PDF contains active, embedded, or remote content.",
                        "Flatten the PDF and remove scripts, attachments, actions, and remote links.",
                    )
                stack.append((child, depth + 1))
        elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            stack.extend((child, depth + 1) for child in value)


def _inspect_pdf(
    path: Path,
    *,
    selection: Mapping[str, Any] | Sequence[int] | None,
    limits: ArtifactLimits,
) -> dict[str, Any]:
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(path), strict=True)
        if reader.is_encrypted:
            raise ArtifactError(
                "input_encrypted",
                "The PDF is encrypted.",
                "Remove password protection and provide a decrypted PDF.",
            )
        page_count = len(reader.pages)
        _reject_active_pdf(reader)
    except ArtifactError:
        raise
    except Exception:
        raise ArtifactError(
            "input_format_invalid",
            "The PDF is corrupt or unsupported.",
            "Open and re-save it as a standard, flattened PDF.",
        ) from None
    if page_count <= 0:
        raise ArtifactError(
            "input_format_invalid",
            "The PDF contains no pages.",
            "Provide a PDF with at least one page.",
        )
    if page_count > limits.max_pdf_pages:
        raise ArtifactError(
            "archive_limit_exceeded",
            "The PDF contains too many pages.",
            "Split the PDF into smaller documents.",
            {"limitPages": limits.max_pdf_pages, "actualPages": page_count},
        )
    selected = _normalize_selection(selection, page_count, plural="pages")
    warning_items: list[dict[str, Any]] = []
    pages: list[dict[str, Any]] = []
    try:
        for index in selected:
            page = reader.pages[index - 1]
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            rotation = int(page.rotation or 0) % 360
            if not all(math.isfinite(value) and 0 < value <= limits.max_image_dimension for value in (width, height)):
                raise ArtifactError(
                    "archive_limit_exceeded",
                    "A PDF page has unsafe or excessive dimensions.",
                    "Resize or flatten the PDF and retry.",
                )
            if rotation not in {0, 90, 180, 270}:
                warning_items.append(
                    {
                        "code": "unusual_rotation",
                        "message": "A PDF page has an unusual rotation.",
                        "details": {"stage": "pdf_metadata", "feature": f"page:{index}"},
                    }
                )
            pages.append(
                {"index": index, "widthPoints": width, "heightPoints": height, "rotation": rotation}
            )
    except ArtifactError:
        raise
    except Exception:
        raise ArtifactError(
            "input_format_invalid",
            "A selected PDF page could not be inspected.",
            "Flatten the PDF and retry.",
        ) from None
    return {"pageCount": page_count, "selection": selected, "pages": pages, "warnings": warning_items}


def _inspect_image(path: Path, kind: ArtifactKind, limits: ArtifactLimits) -> dict[str, Any]:
    warning_items: list[dict[str, Any]] = []
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError

        with python_warnings.catch_warnings():
            python_warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                source_width, source_height = image.size
                detected = image.format
                frames = int(getattr(image, "n_frames", 1))
                has_icc = bool(image.info.get("icc_profile"))
                if (
                    source_width <= 0
                    or source_height <= 0
                    or source_width > limits.max_image_dimension
                    or source_height > limits.max_image_dimension
                    or source_width * source_height > limits.max_image_pixels
                ):
                    raise ArtifactError(
                        "archive_limit_exceeded",
                        "The image exceeds the configured dimension or pixel limit.",
                        "Resize the image and retry.",
                        {
                            "maxDimension": limits.max_image_dimension,
                            "maxPixels": limits.max_image_pixels,
                        },
                    )
                if frames != 1:
                    raise ArtifactError(
                        "input_format_invalid",
                        "Animated or multi-frame images are not supported.",
                        "Flatten the image to a single PNG or JPEG frame.",
                    )

                raw_orientation = image.getexif().get(274)
                if raw_orientation is None:
                    exif_orientation = 1
                elif type(raw_orientation) is int and 1 <= raw_orientation <= 8:
                    exif_orientation = raw_orientation
                else:
                    exif_orientation = 1
                    warning_items.append(
                        {
                            "code": "exif_orientation_invalid",
                            "message": "An invalid EXIF orientation value was ignored.",
                            "details": {
                                "stage": "image_metadata",
                                "feature": "exif_orientation",
                            },
                        }
                    )

                normalized = ImageOps.exif_transpose(image)
                try:
                    normalized.load()
                    width, height = normalized.size
                    mode = normalized.mode
                finally:
                    if normalized is not image:
                        normalized.close()
    except Image.DecompressionBombError:
        raise ArtifactError(
            "archive_limit_exceeded",
            "The image exceeds safe decompression limits.",
            "Resize the image and retry.",
        ) from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise ArtifactError(
            "input_format_invalid",
            "The image is corrupt or unsupported.",
            "Re-export it as a standard PNG or JPEG.",
        ) from None
    expected_format = "PNG" if kind is ArtifactKind.PNG else "JPEG"
    if detected != expected_format:
        raise ArtifactError(
            "input_format_invalid",
            "The image signature does not match its declared format.",
            "Declare the real format or re-export the image.",
        )
    orientation_applied = exif_orientation != 1
    if orientation_applied:
        warning_items.append(
            {
                "code": "exif_orientation_applied",
                "message": "EXIF orientation was applied to normalize image display.",
                "details": {
                    "stage": "image_metadata",
                    "feature": f"exif_orientation:{exif_orientation}",
                },
            }
        )
    return {
        "selection": [1],
        "image": {
            "width": width,
            "height": height,
            "mode": mode,
            "hasAlpha": "A" in mode,
            "iccProfilePresent": has_icc,
            "exifOrientation": exif_orientation,
            "orientationApplied": orientation_applied,
        },
        "warnings": warning_items,
    }


def _path_free_workbook_metadata(value: Mapping[str, Any]) -> dict[str, Any]:
    """Validate that a delegated inspector returned bounded JSON metadata, not authority."""

    forbidden_keys = {"path", "localpath", "filepath", "sourcepath", "absolutepath"}

    def visit(item: Any, depth: int = 0) -> None:
        if depth > 64:
            raise ValueError("metadata nesting limit")
        if item is None or type(item) in {bool, int, str}:
            return
        if type(item) is float:
            if not math.isfinite(item):
                raise ValueError("non-finite number")
            return
        if isinstance(item, Path):
            raise ValueError("local path value")
        if type(item) is list:
            for child in item:
                visit(child, depth + 1)
            return
        if type(item) is dict:
            for key, child in item.items():
                if type(key) is not str or key.casefold() in forbidden_keys:
                    raise ValueError("forbidden metadata key")
                visit(child, depth + 1)
            return
        raise ValueError("non-JSON metadata")

    copied = dict(value)
    try:
        visit(copied)
        encoded = json.dumps(copied, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        raise ArtifactError(
            "validation_failed",
            "The workbook inspection engine returned unsafe metadata.",
            "Update the workbook worker to return bounded, path-free JSON metadata.",
        ) from None
    if len(encoded) > 2 * 1024 * 1024:
        raise ArtifactError(
            "archive_limit_exceeded",
            "The workbook inspection metadata exceeds its byte limit.",
            "Reduce workbook metadata or update the inspector to summarize it.",
        )
    return copied


def _default_workbook_inspector() -> Callable[..., Mapping[str, Any]] | None:
    try:
        from .validation import inspect_xlsx
    except ImportError:
        return None
    return inspect_xlsx


def inspect_input(
    path: Path | str,
    kind: ArtifactKind | str,
    selection: Mapping[str, Any] | Sequence[int] | None = None,
    *,
    expected_sha256: str | None = None,
    limits: ArtifactLimits = DEFAULT_LIMITS,
    workbook_inspector: Callable[..., Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Inspect one admitted binary input and return metadata with no local path.

    ``kind`` is mandatory: guessing from a filename would make extension spoofing
    part of the trust boundary.  The signature and format parser must also agree.
    """

    parsed_kind = parse_artifact_kind(kind)
    candidate = Path(path)
    digest, size = sha256_file(candidate, limits=limits)
    verify_expected_sha256(digest, expected_sha256)
    _check_magic(candidate, parsed_kind)
    if parsed_kind is ArtifactKind.XLSX:
        if selection is not None:
            raise ArtifactError(
                "protocol_invalid",
                "XLSX inspection does not accept page or slide selection.",
                "Omit input selection; use the workbook action specification for sheet scope.",
            )
        if workbook_inspector is None:
            workbook_inspector = _default_workbook_inspector()
        if workbook_inspector is None:
            raise ArtifactError(
                "capability_unsupported",
                "XLSX inspection requires the workbook inspection engine.",
                "Install or inject the advertised workbook inspector on this execution host.",
            )
        try:
            workbook_detail = workbook_inspector(candidate, limits=limits)
        except ArtifactError:
            raise
        except Exception:
            raise ArtifactError(
                "validation_failed",
                "The workbook inspection engine could not inspect the XLSX input.",
                "Open and re-save the workbook, then retry.",
            ) from None
        if not isinstance(workbook_detail, Mapping):
            raise ArtifactError(
                "validation_failed",
                "The workbook inspection engine returned an invalid result.",
                "Use a compatible Excel Artifact workbook worker.",
            )
        detail = _path_free_workbook_metadata(workbook_detail)
        reserved = {
            "kind": parsed_kind.value,
            "mediaType": MEDIA_TYPES[parsed_kind],
            "sha256": digest,
            "sizeBytes": size,
        }
        for field, expected in reserved.items():
            if field in detail and detail[field] != expected:
                raise ArtifactError(
                    "validation_failed",
                    "The workbook inspection engine returned conflicting identity metadata.",
                    "Use a compatible workbook inspector for the admitted artifact.",
                )
            detail.pop(field, None)
    elif parsed_kind is ArtifactKind.PPTX:
        detail = _inspect_pptx(candidate, selection=selection, limits=limits)
    elif parsed_kind is ArtifactKind.PDF:
        detail = _inspect_pdf(candidate, selection=selection, limits=limits)
    else:
        if selection not in (None, [1], (1,), {"indices": [1]}):
            raise ArtifactError(
                "protocol_invalid",
                "A single image only supports selection index 1.",
                "Omit selection or select image index 1.",
            )
        detail = _inspect_image(candidate, parsed_kind, limits)
    return {
        "kind": parsed_kind.value,
        "mediaType": MEDIA_TYPES[parsed_kind],
        "sha256": digest,
        "sizeBytes": size,
        **detail,
    }
