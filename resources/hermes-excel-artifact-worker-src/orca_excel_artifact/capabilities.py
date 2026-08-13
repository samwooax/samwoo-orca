"""Runtime-derived Excel Artifact capability advertisement."""

from __future__ import annotations

import importlib.metadata
import platform
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from .errors import ArtifactError
from .limits import DEFAULT_LIMITS, ArtifactLimits


@dataclass(frozen=True, slots=True)
class EngineCapability:
    name: str
    version: str
    available: bool


@dataclass(frozen=True, slots=True)
class ExcelArtifactCapability:
    protocol_versions: tuple[int, ...]
    workbook_spec_versions: tuple[int, ...]
    workbook_features: tuple[str, ...]
    actions: tuple[str, ...]
    input_kinds: tuple[str, ...]
    execution_hosts: tuple[str, ...]
    create: EngineCapability
    modify: EngineCapability
    validate: EngineCapability
    render: EngineCapability
    pptx_inspect: bool
    pdf_inspect: bool
    max_input_bytes: int
    max_timeout_seconds: int

    def public_dict(self) -> dict[str, object]:
        value = asdict(self)
        value["name"] = "excelArtifact"
        value["protocolVersions"] = list(value.pop("protocol_versions"))
        value["workbookSpecVersions"] = list(value.pop("workbook_spec_versions"))
        value["workbookFeatures"] = list(value.pop("workbook_features"))
        value["actions"] = list(value["actions"])
        value["inputKinds"] = list(value.pop("input_kinds"))
        value["executionHosts"] = list(value.pop("execution_hosts"))
        value["pptxInspect"] = value.pop("pptx_inspect")
        value["pdfInspect"] = value.pop("pdf_inspect")
        value["maxInputBytes"] = value.pop("max_input_bytes")
        value["maxTimeoutSeconds"] = value.pop("max_timeout_seconds")
        return value


def _package(name: str) -> EngineCapability:
    try:
        return EngineCapability(name=name, version=importlib.metadata.version(name), available=True)
    except importlib.metadata.PackageNotFoundError:
        return EngineCapability(name=name, version="unavailable", available=False)


def _packages_available(*names: str) -> bool:
    return all(_package(name).available for name in names)


def _libreoffice(
    finder: Callable[[], Path | None] | None,
    version_reader: Callable[[Path], str] | None,
) -> EngineCapability:
    if finder is None:
        try:
            from .renderers import find_libreoffice

            finder = find_libreoffice
        except ImportError:
            return EngineCapability("libreoffice", "unavailable", False)
    executable = finder()
    if executable is None:
        return EngineCapability("libreoffice", "unavailable", False)
    if version_reader is None:
        try:
            from .renderers import libreoffice_version

            version_reader = libreoffice_version
        except ImportError:
            return EngineCapability("libreoffice", "detected", True)
    try:
        version = version_reader(executable)
    except Exception:
        version = "detected"
    return EngineCapability("libreoffice", version, True)


def detect_capability(
    *,
    limits: ArtifactLimits = DEFAULT_LIMITS,
    libreoffice_finder: Callable[[], Path | None] | None = None,
    libreoffice_version_reader: Callable[[Path], str] | None = None,
    render_sandbox_verified: bool = False,
) -> ExcelArtifactCapability:
    """Advertise only features present on the execution host.

    Version 1 deliberately supports local native workspaces only. WSL, SSH,
    and paired runtimes must not silently fall back to this host.
    """

    create = _package("xlsxwriter")
    modify = _package("openpyxl")
    validate = _package("openpyxl")
    detected_render = _libreoffice(libreoffice_finder, libreoffice_version_reader)
    # A LibreOffice binary alone is not a safe capability.  Main must also
    # prove that the converter runs in its platform-specific no-network,
    # resource-bounded process sandbox (Job Object/sandbox/container, etc.).
    render = (
        detected_render
        if render_sandbox_verified
        else EngineCapability("libreoffice", "unavailable", False)
    )
    # Protocol v1 defines PPTX inspection as metadata plus a rendered visual
    # source of truth.  Therefore a parser alone is not sufficient to advertise
    # it; the complete LibreOffice/PDF/image render chain must be available.
    pptx_inspect = render.available and _packages_available(
        "defusedxml", "pypdf", "pypdfium2", "pillow"
    )
    pdf_inspect_ready = _packages_available("pypdf", "pypdfium2")
    image_inspect = _packages_available("pillow")
    inspect_available = pptx_inspect and pdf_inspect_ready and image_inspect and validate.available
    # v1 advertises the unified inspect action only when the full mandatory
    # PPTX/PDF/image/XLSX chain is available.  Do not expose a dangling
    # per-format flag when there is no invokable inspect action.
    pdf_inspect = inspect_available
    actions = ["cancel"]
    if inspect_available:
        actions.append("inspect")
    if create.available:
        actions.append("create")
    if modify.available:
        actions.append("modify")
    if validate.available:
        actions.append("validate")
    if render.available:
        actions.append("render")
    return ExcelArtifactCapability(
        protocol_versions=(1,),
        workbook_spec_versions=(1,),
        workbook_features=(
            "workbookProperties",
            "formats",
            "sheets",
            "sheetState",
            "cells",
            "formulas",
            "namedRanges",
            "tables",
            "autoFilter",
            "freezePane",
            "mergedRanges",
            "rowHeight",
            "columnWidth",
            "numberFormat",
            "font",
            "fill",
            "border",
            "alignment",
            "conditionalFormatting",
            "dataValidation",
            "nativeCharts",
            "images",
            "printArea",
            "pageOrientation",
            "pageMargins",
            "headerFooter",
        ),
        actions=tuple(actions),
        input_kinds=("pptx", "pdf", "png", "jpeg", "xlsx"),
        execution_hosts=("local",),
        create=create,
        modify=modify,
        validate=validate,
        render=render,
        pptx_inspect=pptx_inspect,
        pdf_inspect=pdf_inspect,
        max_input_bytes=limits.max_input_bytes,
        max_timeout_seconds=limits.max_timeout_seconds,
    )


def assert_host_supported(execution_host: str, *, project_runtime: str = "native") -> None:
    """Fail closed instead of treating a remote/WSL path as local."""

    if execution_host != "local" or project_runtime != "native":
        raise ArtifactError(
            "capability_unsupported",
            "Excel Artifact v1 is unavailable on the selected execution host.",
            f"Select a native {platform.system()} local workspace or use a future Orca version "
            "that advertises this host.",
            {"executionHost": execution_host, "projectRuntime": project_runtime},
        )
