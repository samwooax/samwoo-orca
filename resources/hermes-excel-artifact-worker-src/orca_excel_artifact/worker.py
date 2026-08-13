"""Synchronous reference orchestration for Excel Artifact protocol v1.

Production Orca should place this runner behind its existing job registry and
process isolation.  The trusted context resolves workspace and artifact
authority; no absolute model-supplied path crosses that boundary.
"""

from __future__ import annotations

import importlib.metadata
import re
import tempfile
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .artifact_store import ResolvedArtifact
from .artifacts import LocalArtifact
from .capabilities import ExcelArtifactCapability, EngineCapability
from .errors import ArtifactError
from .inputs import inspect_input
from .limits import DEFAULT_LIMITS, ArtifactLimits
from .protocol import parse_job_request, validate_result
from .renderers import render_preview
from .validation import (
    compare_feature_inventories,
    inspect_ooxml,
    preflight_unsupported_features,
    render_workbook_pdf,
    validate_workbook,
)
from .workbooks import create_workbook, modify_workbook
from .workspace import (
    Workspace,
    copy_preserving_source,
    hash_regular_file,
    snapshot_regular_file,
)


ArtifactResolver = Callable[[str], ResolvedArtifact | tuple[Any, ResolvedArtifact]]
LegacyReferenceArtifactResolver = Callable[[str], Path]
ArtifactRegistrar = Callable[[Path, str], str]
CancellationCheck = Callable[[], None]
_SHA256 = re.compile(r"^[a-f0-9]{64}$")

_ERROR_DETAIL_KEYS = frozenset(
    {
        "stage", "artifactId", "relativePath", "expectedSha256", "actualSha256", "limit",
        "observed", "maxBytes", "limitBytes", "actualBytes", "limitEntries", "actualEntries",
        "limitRatio", "part", "retryable", "field", "feature", "reason",
    }
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "unavailable"


def _engine(name: str, role: str) -> dict[str, str]:
    distribution = "Pillow" if name == "pillow" else name
    return {"name": name, "version": _version(distribution), "role": role}


def _sanitize_error(error: ArtifactError) -> dict[str, Any]:
    value = error.to_dict()
    value["details"] = {
        key: detail
        for key, detail in value["details"].items()
        if key in _ERROR_DETAIL_KEYS and isinstance(detail, (str, int, float, bool))
    }
    return value


def _capability_error(feature: str, message: str) -> ArtifactError:
    return ArtifactError(
        "capability_unsupported",
        message,
        "Renegotiate Excel Artifact capabilities on this execution host and retry.",
        {"feature": feature[:128]},
    )


def _append_engine(result: dict[str, Any], engine: dict[str, str]) -> None:
    identity = (engine["name"], engine["role"])
    if all((item["name"], item["role"]) != identity for item in result["engines"]):
        result["engines"].append(engine)


def _capability_engine(
    context: "WorkerContext",
    capability_field: str,
    role: str,
    fallback_name: str,
) -> dict[str, str]:
    capability = context.negotiated_capability
    if capability is not None:
        advertised = getattr(capability, capability_field)
        return {"name": advertised.name, "version": advertised.version, "role": role}
    return _engine(fallback_name, role)


def _record_input_inspection_engines(
    result: dict[str, Any],
    kinds: set[str],
    context: "WorkerContext",
) -> None:
    if kinds & {"xlsx"}:
        _append_engine(result, _capability_engine(context, "validate", "inspect", "openpyxl"))
        _append_engine(result, _engine("defusedxml", "inspect"))
    if kinds & {"pptx"}:
        _append_engine(result, _engine("defusedxml", "inspect"))
        _append_engine(result, _engine("pillow", "inspect"))
    if kinds & {"pdf"}:
        _append_engine(result, _engine("pypdf", "inspect"))
    if kinds & {"png", "jpeg"}:
        _append_engine(result, _engine("pillow", "inspect"))


def _record_preview_engines(
    result: dict[str, Any],
    kinds: set[str],
    context: "WorkerContext",
) -> None:
    if kinds & {"xlsx", "pptx"}:
        _append_engine(result, _capability_engine(context, "render", "render", "libreoffice"))
    if kinds & {"pptx", "pdf"}:
        _append_engine(result, _engine("pypdfium2", "render"))
        _append_engine(result, _engine("pillow", "render"))
    if kinds & {"png", "jpeg"}:
        _append_engine(result, _engine("pillow", "render"))


def _enforce_negotiated_capability(
    request: Mapping[str, Any],
    context: "WorkerContext",
) -> None:
    """Admit a request only within the exact host capability negotiation.

    ``reference_test_mode`` is the sole opt-out and exists for an isolated
    reference harness.  WorkerContext defaults to strict mode, so the CLI and
    production integrations fail closed when no negotiated capability exists.
    """

    capability = context.negotiated_capability
    if capability is None:
        if context.reference_test_mode:
            return
        raise _capability_error(
            "negotiated_capability",
            "No negotiated Excel Artifact capability was supplied to the worker.",
        )
    if not isinstance(capability, ExcelArtifactCapability):
        raise _capability_error(
            "negotiated_capability",
            "The negotiated Excel Artifact capability has an invalid trusted-host shape.",
        )
    if request["version"] not in capability.protocol_versions:
        raise _capability_error(
            f"protocol_v{request['version']}",
            "The requested protocol version was not negotiated on this host.",
        )
    action = str(request["action"])
    if action not in capability.actions:
        raise _capability_error(action, "The requested action was not negotiated on this host.")
    timeout = request.get("timeoutSeconds")
    if timeout is not None and (
        not isinstance(capability.max_timeout_seconds, int)
        or isinstance(capability.max_timeout_seconds, bool)
        or capability.max_timeout_seconds <= 0
        or timeout > capability.max_timeout_seconds
    ):
        raise _capability_error(
            "timeoutSeconds",
            "The requested timeout exceeds the negotiated host maximum.",
        )
    if (
        not isinstance(capability.max_input_bytes, int)
        or isinstance(capability.max_input_bytes, bool)
        or capability.max_input_bytes <= 0
    ):
        raise _capability_error(
            "maxInputBytes",
            "The negotiated input-size limit is invalid.",
        )
    for reference in request.get("inputs", []):
        kind = str(reference["kind"])
        if kind not in capability.input_kinds:
            raise _capability_error(
                f"input_{kind}",
                "An input kind was not negotiated on this host.",
            )
    workbook_spec = request.get("workbookSpec")
    if workbook_spec is not None and workbook_spec["version"] not in capability.workbook_spec_versions:
        raise _capability_error(
            f"workbook_spec_v{workbook_spec['version']}",
            "The requested Workbook Spec version was not negotiated on this host.",
        )
    action_engines: dict[str, EngineCapability] = {
        "create": capability.create,
        "modify": capability.modify,
        "validate": capability.validate,
        "render": capability.render,
    }
    expected_engine_names = {
        "create": "xlsxwriter",
        "modify": "openpyxl",
        "validate": "openpyxl",
        "render": "libreoffice",
    }
    for field_name, advertised in action_engines.items():
        if (
            not isinstance(advertised, EngineCapability)
            or advertised.name != expected_engine_names[field_name]
            or not isinstance(advertised.version, str)
            or not advertised.version
        ):
            raise _capability_error(
                f"engine_{field_name}",
                "The negotiated engine identity is invalid for this worker.",
            )
    required_engine = action_engines.get(action)
    if required_engine is not None and not required_engine.available:
        raise _capability_error(
            f"engine_{required_engine.name}",
            "The engine required for this action is unavailable on the negotiated host.",
        )
    if action in {"create", "modify"} and not capability.validate.available:
        raise _capability_error(
            "engine_validate",
            "Create and modify require the negotiated validation engine before commit.",
        )
    if action in {"inspect", "render"} and any(
        reference["kind"] == "xlsx" for reference in request.get("inputs", [])
    ) and not capability.validate.available:
        raise _capability_error(
            "engine_validate",
            "XLSX inspection and rendering require the negotiated workbook validation engine.",
        )
    if request.get("validation", {}).get("renderPreview") and not capability.render.available:
        raise _capability_error(
            "renderPreview",
            "Preview validation was requested without a negotiated render engine.",
        )
    if action == "inspect":
        for reference in request.get("inputs", []):
            kind = reference["kind"]
            if kind == "pptx" and not capability.pptx_inspect:
                raise _capability_error("pptx_inspect", "PPTX inspect was not negotiated on this host.")
            if kind == "pdf" and not capability.pdf_inspect:
                raise _capability_error("pdf_inspect", "PDF inspect was not negotiated on this host.")


@dataclass(slots=True)
class WorkerContext:
    """Trusted host-owned resources for one reference worker invocation."""

    workspace: Workspace
    artifact_resolver: ArtifactResolver | None = None
    legacy_reference_artifact_resolver: LegacyReferenceArtifactResolver | None = None
    artifact_registrar: ArtifactRegistrar | None = None
    limits: ArtifactLimits = DEFAULT_LIMITS
    cancellation_check: CancellationCheck | None = None
    negotiated_capability: ExcelArtifactCapability | None = None
    reference_test_mode: bool = False
    _resolved_artifacts: dict[str, ResolvedArtifact] = field(default_factory=dict, init=False, repr=False)
    _request_inputs: list[dict[str, Any]] = field(default_factory=list, init=False, repr=False)
    _snapshot_root: Path | None = field(default=None, init=False, repr=False)
    _input_snapshots: dict[str, tuple[Path, str, int]] = field(default_factory=dict, init=False, repr=False)
    _input_origins: dict[str, Path] = field(default_factory=dict, init=False, repr=False)
    _registered_artifacts: int = field(default=0, init=False, repr=False)

    @classmethod
    def for_workspace(
        cls,
        root: Path | str,
        *,
        artifact_resolver: ArtifactResolver | None = None,
        legacy_reference_artifact_resolver: LegacyReferenceArtifactResolver | None = None,
        artifact_registrar: ArtifactRegistrar | None = None,
        limits: ArtifactLimits = DEFAULT_LIMITS,
        cancellation_check: CancellationCheck | None = None,
        negotiated_capability: ExcelArtifactCapability | None = None,
        reference_test_mode: bool = False,
    ) -> "WorkerContext":
        return cls(
            Workspace(root, limits=limits),
            artifact_resolver=artifact_resolver,
            legacy_reference_artifact_resolver=legacy_reference_artifact_resolver,
            artifact_registrar=artifact_registrar,
            limits=limits,
            cancellation_check=cancellation_check,
            negotiated_capability=negotiated_capability,
            reference_test_mode=reference_test_mode,
        )

    def check_cancelled(self) -> None:
        if self.cancellation_check is not None:
            self.cancellation_check()

    def input_byte_limit(self) -> int:
        if self.negotiated_capability is None:
            return self.limits.max_input_bytes
        return min(self.limits.max_input_bytes, self.negotiated_capability.max_input_bytes)

    def resolve_artifact(self, artifact_id: str) -> ResolvedArtifact:
        if artifact_id in self._resolved_artifacts:
            return self._resolved_artifacts[artifact_id]
        if self.artifact_resolver is None and not (
            self.reference_test_mode and self.legacy_reference_artifact_resolver is not None
        ):
            raise ArtifactError(
                "workspace_unauthorized",
                "An artifact handle lacks an authoritative registry resolution.",
                "Have Orca main resolve it with its admitted SHA-256 and byte size.",
                {"artifactId": artifact_id},
            )
        try:
            if self.artifact_resolver is not None:
                raw = self.artifact_resolver(artifact_id)
                if (
                    isinstance(raw, tuple)
                    and len(raw) == 2
                    and isinstance(raw[1], ResolvedArtifact)
                ):
                    # ArtifactStore.resolve currently returns its internal
                    # record plus the path-safe public handoff. The worker
                    # intentionally consumes only the latter.
                    raw = raw[1]
                if not isinstance(raw, ResolvedArtifact):
                    raise ArtifactError(
                        "workspace_unauthorized",
                        "The artifact resolver did not return authoritative hash-bound metadata.",
                        "Return ResolvedArtifact(path, sha256, size, artifact_id) from the Orca registry.",
                        {"artifactId": artifact_id},
                    )
                resolved = raw
            else:
                # Deliberately isolated compatibility path for unit/reference
                # harnesses. Production and the CLI never enable this flag.
                assert self.legacy_reference_artifact_resolver is not None
                path = Path(self.legacy_reference_artifact_resolver(artifact_id))
                digest, size = hash_regular_file(path, max_bytes=self.input_byte_limit())
                resolved = ResolvedArtifact(path, digest, size, artifact_id)
        except ArtifactError:
            raise
        except Exception:
            raise ArtifactError(
                "input_not_found",
                "The artifact handle is unavailable.",
                "Attach the artifact again.",
                {"artifactId": artifact_id},
            ) from None
        digest = str(resolved.sha256).casefold()
        if (
            not _SHA256.fullmatch(digest)
            or not isinstance(resolved.size, int)
            or isinstance(resolved.size, bool)
            or resolved.size <= 0
            or resolved.size > self.input_byte_limit()
            or resolved.artifact_id != artifact_id
        ):
            raise ArtifactError(
                "workspace_unauthorized",
                "The artifact registry returned invalid integrity metadata.",
                "Re-admit the artifact through Orca's trusted artifact registry.",
                {"artifactId": artifact_id},
            )
        normalized = ResolvedArtifact(Path(resolved.path), digest, resolved.size, artifact_id)
        self._resolved_artifacts[artifact_id] = normalized
        return normalized

    def resolve_input(self, reference: Mapping[str, Any]) -> tuple[Path, str, int]:
        cache_key = (
            f"artifact:{reference['artifactId']}"
            if "artifactId" in reference
            else f"workspace:{reference['path']}"
        )
        cached = self._input_snapshots.get(cache_key)
        if cached is not None:
            expected = reference.get("sha256")
            if expected is not None and cached[1] != str(expected).casefold():
                raise ArtifactError(
                    "input_hash_mismatch",
                    "The repeated input reference does not match its immutable snapshot.",
                    "Use one consistent SHA-256 for each input reference.",
                    {"expectedSha256": str(expected).casefold(), "actualSha256": cached[1]},
                )
            return cached
        if self._snapshot_root is None:
            raise ArtifactError(
                "workspace_unauthorized",
                "The worker input snapshot boundary is not active.",
                "Run the request through the reference job runner.",
            )
        if "artifactId" in reference:
            admitted = self.resolve_artifact(str(reference["artifactId"]))
            source_path = admitted.path
            requested = reference.get("sha256")
            if requested is not None and str(requested).casefold() != admitted.sha256:
                raise ArtifactError(
                    "input_hash_mismatch",
                    "The request hash does not match the artifact registry record.",
                    "Refresh the admitted artifact metadata and retry.",
                    {
                        "artifactId": str(reference["artifactId"]),
                        "expectedSha256": str(requested).casefold(),
                        "actualSha256": admitted.sha256,
                    },
                )
            expected = admitted.sha256
        else:
            source_path, admitted_digest, _ = self.workspace.resolve_input(
                str(reference["path"]),
                expected_sha256=reference.get("sha256"),
            )
            expected = admitted_digest
        suffix = f".{str(reference.get('kind', 'input')).casefold()}"
        snapshot = self._snapshot_root / f"input-{len(self._input_snapshots):03d}{suffix}"
        digest, size = snapshot_regular_file(
            source_path,
            snapshot,
            expected_sha256=str(expected).casefold() if expected is not None else None,
            max_bytes=self.input_byte_limit(),
        )
        if "artifactId" in reference and size != admitted.size:
            snapshot.unlink(missing_ok=True)
            raise ArtifactError(
                "input_hash_mismatch",
                "The artifact byte size does not match the registry record.",
                "Re-admit the artifact and retry.",
                {
                    "artifactId": str(reference["artifactId"]),
                    "expectedSha256": admitted.sha256,
                    "actualSha256": digest,
                },
            )
        value = (snapshot, digest, size)
        self._input_snapshots[cache_key] = value
        self._input_origins[cache_key] = source_path
        return value

    def input_origin(self, reference: Mapping[str, Any]) -> Path:
        cache_key = (
            f"artifact:{reference['artifactId']}"
            if "artifactId" in reference
            else f"workspace:{reference['path']}"
        )
        if cache_key not in self._input_origins:
            self.resolve_input(reference)
        return self._input_origins[cache_key]

    def resolve_image(self, artifact_id: str) -> Path:
        allowed = {
            str(item["artifactId"])
            for item in self._request_inputs
            if "artifactId" in item and item.get("kind") in {"png", "jpeg"}
        }
        if artifact_id not in allowed:
            raise ArtifactError(
                "workspace_unauthorized",
                "The image is not an admitted image input for this job.",
                "Include the opaque PNG/JPEG artifact in inputs and retry.",
                {"artifactId": artifact_id},
            )
        reference = next(item for item in self._request_inputs if item.get("artifactId") == artifact_id)
        path, _, _ = self.resolve_input(reference)
        inspect_input(path, reference["kind"], expected_sha256=reference.get("sha256"), limits=self.limits)
        return path

    def register_artifact(self, path: Path, kind: str) -> str:
        if self.artifact_registrar is None:
            raise ArtifactError(
                "workspace_unauthorized",
                "Preview generation requires an Orca-owned artifact registrar.",
                "Run the action through the integrated Orca artifact registry.",
            )
        artifact_id = self.artifact_registrar(path, kind)
        self._registered_artifacts += 1
        return artifact_id

    def _begin_snapshot_run(self, root: Path) -> None:
        self._snapshot_root = root
        self._resolved_artifacts.clear()
        self._input_snapshots.clear()
        self._input_origins.clear()
        self._registered_artifacts = 0

    def _end_snapshot_run(self) -> None:
        self._snapshot_root = None
        self._resolved_artifacts.clear()
        self._input_snapshots.clear()
        self._input_origins.clear()
        self._request_inputs = []


def _base_result(request: Mapping[str, Any], job_id: str, started_at: str) -> dict[str, Any]:
    return {
        "version": 1,
        "operationId": request["operationId"],
        "idempotencyKey": request["idempotencyKey"],
        "jobId": job_id,
        "action": request["action"],
        "state": "completed",
        "inputs": [],
        "engines": [],
        "sheets": [],
        "tables": [],
        "charts": [],
        "previews": [],
        "warnings": [],
        "committed": False,
        "cleanup": {"status": "removed", "warnings": []},
        "startedAt": started_at,
        "completedAt": _now(),
    }


def _input_result(reference: Mapping[str, Any], digest: str, size: int) -> dict[str, Any]:
    result: dict[str, Any] = {"kind": reference["kind"], "sha256": digest, "sizeBytes": size}
    if "artifactId" in reference:
        result["artifactId"] = reference["artifactId"]
    else:
        result["path"] = reference["path"]
    return result


def _inspect_inputs(
    request: Mapping[str, Any], context: WorkerContext
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    identities: list[dict[str, Any]] = []
    details: list[dict[str, Any]] = []
    for reference in request.get("inputs", []):
        context.check_cancelled()
        path, digest, size = context.resolve_input(reference)
        selection: dict[str, Any] | None = None
        if "slides" in reference:
            selection = {"slides": reference["slides"]}
        elif "pages" in reference:
            selection = {"pages": reference["pages"]}
        detail = inspect_input(
            path,
            reference["kind"],
            selection,
            expected_sha256=digest,
            limits=context.limits,
        )
        identity = _input_result(reference, digest, size)
        if (
            detail.get("kind") != identity["kind"]
            or detail.get("sha256") != identity["sha256"]
            or detail.get("sizeBytes") != identity["sizeBytes"]
        ):
            raise ArtifactError(
                "validation_failed",
                "Input inspection did not match the admitted immutable snapshot.",
                "Retry with a stable supported input.",
                {"stage": "input_inspection"},
            )
        identities.append(identity)
        details.append(detail)
    return identities, details


def _selected_references(request: Mapping[str, Any]) -> dict[str, list[int]]:
    selected: dict[str, list[int]] = {}
    for request_key, result_key in (("slides", "slides"), ("pages", "pages")):
        values: list[int] = []
        seen: set[int] = set()
        for reference in request.get("inputs", []):
            for raw in reference.get(request_key, []):
                value = int(raw)
                if value not in seen:
                    seen.add(value)
                    values.append(value)
        if values:
            selected[result_key] = values
    return selected


def _project_input_context(
    request: Mapping[str, Any],
    context: WorkerContext,
    result: dict[str, Any],
    identities: list[dict[str, Any]],
    details: list[dict[str, Any]],
    *,
    include_inspection: bool = False,
) -> None:
    """Project admitted input identity, selections, and bounded parser warnings."""

    result["inputs"] = identities
    _record_input_inspection_engines(
        result,
        {str(reference["kind"]) for reference in request.get("inputs", [])},
        context,
    )
    selected = _selected_references(request)
    if selected:
        result["selectedReferences"] = selected
    for detail in details:
        result["warnings"].extend(detail.get("warnings", []))
    if include_inspection:
        result["inspection"] = details


def _xlsx_source(
    request: Mapping[str, Any], context: WorkerContext
) -> tuple[Mapping[str, Any], Path, str, int]:
    matches = [item for item in request.get("inputs", []) if item.get("kind") == "xlsx"]
    if len(matches) != 1:
        raise ArtifactError(
            "protocol_invalid",
            "Exactly one XLSX input is required for this action.",
            "Supply one admitted XLSX input with its SHA-256.",
        )
    reference = matches[0]
    path, digest, size = context.resolve_input(reference)
    return reference, path, digest, size


def _validation_or_error(report: Any) -> None:
    if report.passed:
        return
    failed = next(
        (check for check in report.checks if check["status"] in {"failed", "unavailable"}),
        {"name": "validation", "message": "Workbook validation failed."},
    )
    raise ArtifactError(
        "validation_failed",
        "The workbook did not pass required validation.",
        "Correct the workbook or disable only an optional check before retrying.",
        {"stage": str(failed["name"])[:64]},
    )


def _apply_report(result: dict[str, Any], report: Any) -> None:
    result["validation"] = report.public_dict()
    result["sheets"] = report.sheets
    result["tables"] = report.tables
    result["charts"] = report.charts


def _register_preview(path: Path, context: WorkerContext, *, kind: str = "preview") -> dict[str, Any] | None:
    if context.artifact_registrar is None:
        return None
    artifact = LocalArtifact.from_path(
        path,
        kind=kind,
        media_type="application/pdf",
        limits=context.limits,
    )
    artifact_id = context.register_artifact(path, kind)
    return {
        "artifactId": artifact_id,
        "kind": kind,
        "mediaType": artifact.media_type,
        "sizeBytes": artifact.size_bytes,
        "sha256": artifact.sha256,
        "fileName": path.name,
    }


def _register_local_artifact(artifact: LocalArtifact, context: WorkerContext) -> dict[str, Any]:
    if context.artifact_registrar is None:
        raise ArtifactError(
            "workspace_unauthorized",
            "Preview generation requires an Orca-owned artifact registrar.",
            "Run inspect or render through the integrated Orca artifact registry.",
        )
    artifact_id = context.register_artifact(artifact.path, artifact.kind)
    kind = "contactSheet" if artifact.kind == "contactSheet" else "preview"
    result: dict[str, Any] = {
        "artifactId": artifact_id,
        "kind": kind,
        "mediaType": artifact.media_type,
        "sizeBytes": artifact.size_bytes,
        "sha256": artifact.sha256,
        "fileName": artifact.path.name,
    }
    if artifact.width is not None:
        result["width"] = artifact.width
    if artifact.height is not None:
        result["height"] = artifact.height
    if artifact.index is not None:
        result["index"] = artifact.index
    return result


def _register_committed_preview(
    path: Path,
    context: WorkerContext,
    result: dict[str, Any],
) -> None:
    """Best-effort publication performed only after the XLSX commit succeeds."""

    try:
        preview = _register_preview(path, context)
    except Exception:
        result["warnings"].append(
            {
                "code": "preview_registration_failed",
                "message": "The workbook was committed, but its optional preview could not be registered.",
                "details": {"stage": "artifact_registration"},
            }
        )
        return
    if preview is not None:
        result["previews"].append(preview)


def _mark_retained_artifacts(
    result: dict[str, Any],
    context: WorkerContext,
    *,
    cleanup_required: bool,
) -> None:
    if context._registered_artifacts <= 0:
        return
    result["cleanup"] = {
        "status": "retained",
        "warnings": (
            [
                {
                    "code": "artifact_cleanup_required",
                    "message": "A registered preview may remain and must be expired by the host artifact registry.",
                    "details": {"stage": "artifact_cleanup", "count": context._registered_artifacts},
                }
            ]
            if cleanup_required
            else []
        ),
    }


def _run_create(request: dict[str, Any], context: WorkerContext, result: dict[str, Any]) -> None:
    if request.get("inputs"):
        identities, details = _inspect_inputs(request, context)
        _project_input_context(request, context, result, identities, details)
    if request["validation"].get("renderPreview") and context.artifact_registrar is None:
        raise ArtifactError(
            "workspace_unauthorized",
            "Preview validation requires an Orca-owned artifact registrar.",
            "Run the action through the integrated Orca artifact registry.",
        )
    output = request["output"]
    with context.workspace.output_transaction(
        output["path"],
        overwrite=output["overwrite"],
        expected_sha256=output.get("expectedSha256"),
    ) as transaction:
        context.check_cancelled()
        create_workbook(request["workbookSpec"], transaction.staged_path, image_resolver=context.resolve_image)
        _append_engine(result, _capability_engine(context, "create", "create", "xlsxwriter"))
        context.check_cancelled()
        with tempfile.TemporaryDirectory(prefix="orca-excel-render-") as render_root:
            report = validate_workbook(
                transaction.staged_path,
                request["validation"],
                limits=context.limits,
                render_dir=Path(render_root),
                timeout_seconds=request["timeoutSeconds"],
                workbook_spec=request["workbookSpec"],
                action="create",
            )
            _append_engine(result, _capability_engine(context, "validate", "validate", "openpyxl"))
            _append_engine(result, _engine("defusedxml", "validate"))
            if request["validation"].get("renderPreview"):
                _record_preview_engines(result, {"xlsx"}, context)
            _apply_report(result, report)
            _validation_or_error(report)
            context.check_cancelled()
            receipt = transaction.commit()
            result["output"] = {
                "path": receipt.relative_path,
                "sha256": receipt.sha256,
                "sizeBytes": receipt.size_bytes,
                "replaced": receipt.replaced,
                **({"previousSha256": receipt.previous_sha256} if receipt.previous_sha256 else {}),
            }
            result["committed"] = True
            if report.render_pdf is not None:
                _register_committed_preview(report.render_pdf, context, result)


def _run_modify(request: dict[str, Any], context: WorkerContext, result: dict[str, Any]) -> None:
    source_reference, source_path, digest, size = _xlsx_source(request, context)
    source_origin = context.input_origin(source_reference)
    identities, details = _inspect_inputs(request, context)
    _project_input_context(request, context, result, identities, details)
    if request["validation"].get("renderPreview") and context.artifact_registrar is None:
        raise ArtifactError(
            "workspace_unauthorized",
            "Preview validation requires an Orca-owned artifact registrar.",
            "Run the action through the integrated Orca artifact registry.",
        )
    output = request["output"]
    with context.workspace.output_transaction(
        output["path"],
        overwrite=output["overwrite"],
        expected_sha256=output.get("expectedSha256"),
    ) as transaction:
        try:
            if source_origin.resolve(strict=True) == transaction.destination.resolve(strict=False):
                raise ArtifactError(
                    "output_path_invalid",
                    "The source workbook and output path must be different.",
                    "Choose a distinct output path; the original is preserved until commit.",
                    {"relativePath": transaction.relative_path},
                )
        except OSError:
            raise ArtifactError(
                "output_path_invalid",
                "The source or output path could not be compared safely.",
                "Choose a stable distinct output path and retry.",
            ) from None
        copy_preserving_source(
            source_path,
            transaction.staged_path,
            expected_sha256=source_reference["sha256"],
            limits=context.limits,
        )
        _, before = inspect_ooxml(transaction.staged_path, limits=context.limits)
        result["warnings"].extend(
            preflight_unsupported_features(
                before,
                preservation_policy=request["workbookSpec"]["preservationPolicy"],
            )
        )
        context.check_cancelled()
        modify_workbook(request["workbookSpec"], transaction.staged_path, image_resolver=context.resolve_image)
        _append_engine(result, _capability_engine(context, "modify", "modify", "openpyxl"))
        _, after = inspect_ooxml(transaction.staged_path, limits=context.limits)
        preservation = compare_feature_inventories(
            before,
            after,
            preservation_policy=request["workbookSpec"]["preservationPolicy"],
        )
        result["warnings"].extend(preservation.warnings)
        with tempfile.TemporaryDirectory(prefix="orca-excel-render-") as render_root:
            report = validate_workbook(
                transaction.staged_path,
                request["validation"],
                limits=context.limits,
                render_dir=Path(render_root),
                timeout_seconds=request["timeoutSeconds"],
                workbook_spec=request["workbookSpec"],
                action="modify",
            )
            _append_engine(result, _capability_engine(context, "validate", "validate", "openpyxl"))
            _append_engine(result, _engine("defusedxml", "validate"))
            if request["validation"].get("renderPreview"):
                _record_preview_engines(result, {"xlsx"}, context)
            _apply_report(result, report)
            _validation_or_error(report)
            context.check_cancelled()
            receipt = transaction.commit()
            result["output"] = {
                "path": receipt.relative_path,
                "sha256": receipt.sha256,
                "sizeBytes": receipt.size_bytes,
                "replaced": receipt.replaced,
                **({"previousSha256": receipt.previous_sha256} if receipt.previous_sha256 else {}),
            }
            result["committed"] = True
            if report.render_pdf is not None:
                _register_committed_preview(report.render_pdf, context, result)


def _run_validate(request: dict[str, Any], context: WorkerContext, result: dict[str, Any]) -> None:
    if len(request.get("inputs", [])) != 1 or request["inputs"][0].get("kind") != "xlsx":
        raise ArtifactError(
            "protocol_invalid",
            "Validate requires exactly one XLSX input and no additional inputs.",
            "Submit other artifacts in a separate inspect or render job.",
            {"field": "inputs"},
        )
    source_reference, source_path, digest, size = _xlsx_source(request, context)
    result["inputs"] = [_input_result(source_reference, digest, size)]
    if request["validation"].get("renderPreview") and context.artifact_registrar is None:
        raise ArtifactError(
            "workspace_unauthorized",
            "Preview validation requires an Orca-owned artifact registrar.",
            "Run the action through the integrated Orca artifact registry.",
        )
    with tempfile.TemporaryDirectory(prefix="orca-excel-render-") as render_root:
        report = validate_workbook(
            source_path,
            request["validation"],
            limits=context.limits,
            render_dir=Path(render_root),
            timeout_seconds=request["timeoutSeconds"],
        )
        _append_engine(result, _capability_engine(context, "validate", "validate", "openpyxl"))
        _append_engine(result, _engine("defusedxml", "validate"))
        if request["validation"].get("renderPreview"):
            _record_preview_engines(result, {"xlsx"}, context)
        _apply_report(result, report)
        _validation_or_error(report)
        if report.render_pdf is not None:
            preview = _register_preview(report.render_pdf, context)
            if preview is not None:
                result["previews"].append(preview)


def _run_inspect(request: dict[str, Any], context: WorkerContext, result: dict[str, Any]) -> None:
    identities, details = _inspect_inputs(request, context)
    _project_input_context(request, context, result, identities, details, include_inspection=True)
    xlsx = next((detail for detail in details if detail["kind"] == "xlsx"), None)
    if xlsx:
        result["sheets"] = [
            {"name": name, "status": "validated"}
            for name in xlsx.get("sheets", [])
        ]
    renderable = [
        (reference, context.resolve_input(reference)[0])
        for reference in request["inputs"]
        if reference["kind"] in {"pptx", "pdf", "png", "jpeg"}
    ]
    if renderable:
        if context.artifact_registrar is None:
            raise ArtifactError(
                "workspace_unauthorized",
                "Inspectable presentations, documents, and images require preview artifact registration.",
                "Run inspect through Orca's artifact registry.",
            )
        with tempfile.TemporaryDirectory(prefix="orca-excel-input-preview-") as preview_root:
            for index, (reference, path) in enumerate(renderable):
                selection = reference.get("slides") or reference.get("pages")
                bundle = render_preview(
                    path,
                    reference["kind"],
                    Path(preview_root) / str(index),
                    selection,
                    timeout_seconds=request["timeoutSeconds"],
                    limits=context.limits,
                )
                result["previews"].extend(
                    _register_local_artifact(artifact, context)
                    for artifact in bundle.local_artifacts
                )
                result["warnings"].extend(bundle.warnings)
        _record_preview_engines(
            result,
            {str(reference["kind"]) for reference, _ in renderable},
            context,
        )


def _run_render(request: dict[str, Any], context: WorkerContext, result: dict[str, Any]) -> None:
    if context.artifact_registrar is None:
        raise ArtifactError(
            "workspace_unauthorized",
            "Rendered output requires an Orca-owned artifact registrar.",
            "Run render through the integrated Orca artifact registry.",
        )
    identities: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="orca-excel-render-") as render_root:
        for index, reference in enumerate(request["inputs"]):
            path, digest, size = context.resolve_input(reference)
            identities.append(_input_result(reference, digest, size))
            if reference["kind"] == "xlsx":
                detail = inspect_input(
                    path,
                    "xlsx",
                    expected_sha256=digest,
                    limits=context.limits,
                )
                if (
                    detail.get("kind") != "xlsx"
                    or detail.get("sha256") != digest
                    or detail.get("sizeBytes") != size
                ):
                    raise ArtifactError(
                        "validation_failed",
                        "XLSX render preflight did not match the immutable input snapshot.",
                        "Retry with a stable standard XLSX workbook.",
                        {"stage": "render_preflight"},
                    )
                result["warnings"].extend(detail.get("warnings", []))
                _record_input_inspection_engines(result, {"xlsx"}, context)
                preview_path = render_workbook_pdf(
                    path,
                    Path(render_root) / str(index),
                    timeout_seconds=request["timeoutSeconds"],
                )
                preview = _register_preview(preview_path, context)
                assert preview is not None
                result["previews"].append(preview)
            else:
                selection = reference.get("slides") or reference.get("pages")
                bundle = render_preview(
                    path,
                    reference["kind"],
                    Path(render_root) / str(index),
                    selection,
                    timeout_seconds=request["timeoutSeconds"],
                    limits=context.limits,
                )
                result["previews"].extend(
                    _register_local_artifact(artifact, context)
                    for artifact in bundle.local_artifacts
                )
                result["warnings"].extend(bundle.warnings)
            _record_preview_engines(result, {str(reference["kind"])}, context)
    result["inputs"] = identities
    selected = _selected_references(request)
    if selected:
        result["selectedReferences"] = selected


def run_job(
    payload: str | bytes | Mapping[str, Any],
    context: WorkerContext,
    *,
    job_id: str | None = None,
    raise_errors: bool = False,
) -> dict[str, Any]:
    """Run one validated request and return a schema-valid terminal result."""

    request = parse_job_request(payload)
    started_at = _now()
    resolved_job_id = job_id or f"excel_{uuid.uuid4().hex}"
    result = _base_result(request, resolved_job_id, started_at)
    action = request["action"]
    # A WorkerContext may serve sequential CLI/reference requests. Never carry
    # preview lifecycle evidence from a prior job into an admission failure.
    context._registered_artifacts = 0
    try:
        _enforce_negotiated_capability(request, context)
        with tempfile.TemporaryDirectory(prefix="orca-excel-input-snapshot-") as snapshot_root:
            context._begin_snapshot_run(Path(snapshot_root))
            context._request_inputs = request.get("inputs", [])
            try:
                if action == "create":
                    _run_create(request, context, result)
                elif action == "modify":
                    _run_modify(request, context, result)
                elif action == "validate":
                    _run_validate(request, context, result)
                elif action == "inspect":
                    _run_inspect(request, context, result)
                elif action == "render":
                    _run_render(request, context, result)
                elif action == "cancel":
                    raise ArtifactError(
                        "job_result_unknown",
                        "The synchronous reference worker does not own the requested active job.",
                        "Route cancellation to Orca's process-owning job registry.",
                    )
            finally:
                context._end_snapshot_run()
        _mark_retained_artifacts(result, context, cleanup_required=False)
        result["completedAt"] = _now()
        return validate_result(result)
    except ArtifactError as error:
        if raise_errors:
            raise
        if result.get("committed"):
            result["warnings"].append(
                {
                    "code": "post_commit_issue",
                    "message": "The workbook committed, but a non-commit follow-up step did not complete.",
                    "details": {"stage": "post_commit"},
                }
            )
            _mark_retained_artifacts(result, context, cleanup_required=True)
            result["completedAt"] = _now()
            return validate_result(result)
        result.update(
            {
                "state": "cancelled" if error.code == "cancelled" else "failed",
                "committed": False,
                "error": _sanitize_error(error),
                "completedAt": _now(),
            }
        )
        result.pop("output", None)
        _mark_retained_artifacts(result, context, cleanup_required=True)
        return validate_result(result)
    except Exception:
        if raise_errors:
            raise
        if result.get("committed"):
            result["warnings"].append(
                {
                    "code": "post_commit_issue",
                    "message": "The workbook committed, but a non-commit follow-up step did not complete.",
                    "details": {"stage": "post_commit"},
                }
            )
            _mark_retained_artifacts(result, context, cleanup_required=True)
            result["completedAt"] = _now()
            return validate_result(result)
        code = {
            "create": "generation_failed",
            "modify": "modification_failed",
            "inspect": "conversion_failed",
            "render": "render_failed",
            "validate": "validation_failed",
        }.get(request["action"], "generation_failed")
        error = ArtifactError(
            code,
            "The Excel Artifact worker failed unexpectedly.",
            "Review the sanitized host log and retry with a supported declarative request.",
        )
        result.update(
            {
                "state": "failed",
                "committed": False,
                "error": error.to_dict(),
                "completedAt": _now(),
            }
        )
        result.pop("output", None)
        _mark_retained_artifacts(result, context, cleanup_required=True)
        return validate_result(result)


__all__ = ["WorkerContext", "run_job"]
