"""Strict parser and JSON Schema boundary for Excel Artifact protocol v1.

The model-facing wire form is exactly one tagged JSON object::

    <orca_excel_artifact>{"version":1,...}</orca_excel_artifact>

This module intentionally does not resolve paths, artifact handles, workspaces, or
execution hosts.  Those are capabilities supplied and revalidated by Orca main.
"""

from __future__ import annotations

import copy
import json
import math
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Final, Mapping

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError, ValidationError
from referencing import Registry, Resource

from .errors import ArtifactError


PROTOCOL_VERSION: Final[int] = 1
ENVELOPE_TAG: Final[str] = "orca_excel_artifact"
OPEN_TAG: Final[str] = f"<{ENVELOPE_TAG}>"
CLOSE_TAG: Final[str] = f"</{ENVELOPE_TAG}>"
MAX_ENVELOPE_BYTES: Final[int] = 1_048_576

_SCHEMA_DIR = Path(__file__).resolve().parents[1] / "schemas"
_SCHEMA_FILES: Final[dict[str, str]] = {
    "definitions": "definitions.schema.json",
    "job": "job.schema.json",
    "job-request": "job.schema.json",
    "request": "job.schema.json",
    "artifact": "artifact.schema.json",
    "artifact-metadata": "artifact.schema.json",
    "capability": "capability.schema.json",
    "result": "result.schema.json",
}
_RFC3339_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$"
)
_FORMAT_CHECKER = FormatChecker()


@_FORMAT_CHECKER.checks("date-time")
def _is_strict_rfc3339(value: object) -> bool:
    if not isinstance(value, str) or _RFC3339_PATTERN.fullmatch(value) is None:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


class _DuplicateKey(ValueError):
    pass


def _protocol_error(message: str, *, recovery: str, details: Mapping[str, Any] | None = None) -> ArtifactError:
    """Construct a sanitized protocol error without echoing untrusted content."""

    return ArtifactError(
        code="protocol_invalid",
        message=message,
        recovery=recovery,
        details=dict(details or {}),
    )


def _unsupported_version(version: int) -> ArtifactError:
    return ArtifactError(
        code="protocol_version_unsupported",
        message="The Excel Artifact protocol version is not supported.",
        recovery=f"Send an exact {OPEN_TAG} envelope with integer version {PROTOCOL_VERSION}.",
        details={"stage": "version"},
    )


def _schema_file(schema_name: str) -> Path:
    if not isinstance(schema_name, str):
        raise TypeError("schema_name must be a string")
    normalized = schema_name.removesuffix(".schema.json")
    file_name = _SCHEMA_FILES.get(normalized)
    if file_name is None:
        raise ValueError(f"unknown protocol schema: {schema_name}")
    path = _SCHEMA_DIR / file_name
    if not path.is_file():
        raise RuntimeError(f"protocol schema is missing: {file_name}")
    return path


@lru_cache(maxsize=16)
def _load_schema_cached(schema_name: str) -> dict[str, Any]:
    path = _schema_file(schema_name)
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:  # pragma: no cover - installation failure
        raise RuntimeError(f"cannot load protocol schema: {path.name}") from exc
    try:
        Draft202012Validator.check_schema(document)
    except SchemaError as exc:  # pragma: no cover - caught by schema integrity test
        raise RuntimeError(f"invalid bundled protocol schema: {path.name}") from exc
    return document


def load_schema(schema_name: str) -> dict[str, Any]:
    """Return a defensive copy of a bundled v1 schema.

    Accepted names are ``job``/``job-request``, ``artifact``/
    ``artifact-metadata``, ``capability``, ``result``, and ``definitions``.
    """

    return copy.deepcopy(_load_schema_cached(schema_name))


@lru_cache(maxsize=16)
def _validator(schema_name: str) -> Draft202012Validator:
    root = _load_schema_cached(schema_name)
    resources: list[tuple[str, Resource[Any]]] = []
    for file_name in sorted(set(_SCHEMA_FILES.values())):
        schema = _load_schema_cached(file_name.removesuffix(".schema.json"))
        resource = Resource.from_contents(schema)
        resources.append((schema["$id"], resource))
        resources.append(((_SCHEMA_DIR / file_name).resolve().as_uri(), resource))
    registry = Registry().with_resources(resources)
    return Draft202012Validator(root, registry=registry, format_checker=_FORMAT_CHECKER)


def _json_path(error: ValidationError) -> str:
    path = "$"
    for segment in error.absolute_path:
        if isinstance(segment, int):
            path += f"[{segment}]"
        elif re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", str(segment)):
            path += f".{segment}"
        else:
            path += "[?]"
    return path


def _validation_sort_key(error: ValidationError) -> tuple[str, str, str]:
    return (_json_path(error), str(error.validator), error.message)


def _schema_hint(schema: object) -> str:
    """Render the expected shape of the failing node from our own trusted schema."""

    if not isinstance(schema, Mapping):
        return ""
    parts: list[str] = []
    kind = schema.get("type")
    if isinstance(kind, str):
        parts.append(f"type {kind}")
    elif isinstance(kind, list):
        parts.append("type " + "/".join(str(item) for item in kind[:4]))
    enum = schema.get("enum")
    if isinstance(enum, list) and enum:
        parts.append("one of " + "|".join(str(item) for item in enum[:10]))
    properties = schema.get("properties")
    if isinstance(properties, Mapping) and properties:
        required = schema.get("required")
        required_keys = frozenset(required) if isinstance(required, list) else frozenset()
        parts.append(
            "keys "
            + ", ".join(
                f"{key}*" if key in required_keys else str(key)
                for key in list(properties)[:14]
            )
        )
    return "; ".join(parts)[:240]


def _check_exact_version(document: Mapping[str, Any]) -> None:
    if "version" not in document:
        return
    value = document["version"]
    if type(value) is not int:  # bool and 1.0 must not pass as integer v1
        raise _protocol_error(
            "The protocol version must be the integer 1.",
            recovery=f"Set version to integer {PROTOCOL_VERSION}; do not quote it.",
            details={"stage": "version"},
        )
    if value != PROTOCOL_VERSION:
        raise _unsupported_version(value)


def validate_document(document: Any, schema_name: str) -> dict[str, Any]:
    """Validate a protocol document and return it unchanged.

    Validation is fail-closed.  Only JSON objects are accepted, the protocol
    version must be the exact integer ``1``, and every protocol object rejects
    unknown fields through its schema.
    """

    if type(document) is not dict:
        raise _protocol_error(
            "The protocol document must be one JSON object.",
            recovery="Send one object with only fields defined by the v1 schema.",
            details={"stage": "schema"},
        )

    normalized = schema_name.removesuffix(".schema.json") if isinstance(schema_name, str) else schema_name
    canonical = {
        "job-request": "job",
        "request": "job",
        "artifact-metadata": "artifact",
    }.get(normalized, normalized)
    _schema_file(canonical)
    _check_exact_version(document)

    errors = sorted(_validator(canonical).iter_errors(document), key=_validation_sort_key)
    if errors:
        error = errors[0]
        hint = _schema_hint(error.schema)
        raise _protocol_error(
            f"The protocol document does not match the {canonical} v1 schema at {_json_path(error)}."
            + (f" Expected here: {hint}." if hint else ""),
            recovery="Correct the reported field to the expected shape and remove unknown fields.",
            details={"stage": "schema"},
        )
    return document


def validate_job(document: Any) -> dict[str, Any]:
    return validate_document(document, "job")


def validate_artifact(document: Any) -> dict[str, Any]:
    return validate_document(document, "artifact")


def validate_capability(document: Any) -> dict[str, Any]:
    return validate_document(document, "capability")


def validate_result(document: Any) -> dict[str, Any]:
    validated = validate_document(document, "result")
    validation = validated.get("validation")
    if validation is not None:
        checks = validation["checks"]
        has_failed_check = any(
            check["status"] in {"failed", "unavailable"}
            for check in checks
        )
        if validation["passed"] and has_failed_check:
            raise _protocol_error(
                "Passed validation cannot contain a failed or unavailable check.",
                recovery="Set validation.passed to false or correct the inconsistent check evidence.",
                details={"stage": "result"},
            )
        if not validation["passed"] and not has_failed_check:
            raise _protocol_error(
                "Failed validation must identify at least one failed or unavailable check.",
                recovery="Include the check that prevented validation from passing.",
                details={"stage": "result"},
            )
    if validated["state"] == "completed" and validated["action"] == "validate":
        if validation is None or not validation["passed"] or not validation["checks"]:
            raise _protocol_error(
                "A completed validate result requires passed, non-empty validation evidence.",
                recovery="Return at least one passed validation check, or mark the job failed.",
                details={"stage": "result"},
            )
    if (
        validated["state"] == "completed"
        and validated["action"] == "render"
        and not validated["previews"]
    ):
        raise _protocol_error(
            "A completed render result requires at least one preview artifact.",
            recovery="Return the registered preview artifact, or mark rendering failed.",
            details={"stage": "result"},
        )
    inspections = validated.get("inspection")
    if inspections is not None:
        inputs = validated.get("inputs", [])
        if len(inspections) != len(inputs):
            raise _protocol_error(
                "Inspection evidence must correspond one-for-one with result inputs.",
                recovery="Return one ordered inspection item for every result input.",
                details={"stage": "result"},
            )
        for result_input, inspection in zip(inputs, inspections, strict=True):
            if any(
                result_input[field] != inspection[field]
                for field in ("kind", "sha256", "sizeBytes")
            ):
                raise _protocol_error(
                    "Inspection evidence does not match the admitted result input identity.",
                    recovery="Assemble inspection from the same immutable admitted input snapshot.",
                    details={"stage": "result"},
                )
    return validated


def _object_without_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateKey("duplicate JSON object key")
        result[key] = value
    return result


def _reject_non_finite_constant(_value: str) -> None:
    raise ValueError("non-finite JSON number")


def _assert_safe_json_tree(value: Any, *, depth: int = 0) -> None:
    if depth > 128:
        raise ValueError("JSON nesting limit exceeded")
    if isinstance(value, str):
        value.encode("utf-8", errors="strict")
        return
    if value is None or type(value) in {bool, int}:
        return
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError("non-finite JSON number")
        return
    if type(value) is list:
        for item in value:
            _assert_safe_json_tree(item, depth=depth + 1)
        return
    if type(value) is dict:
        for key, item in value.items():
            key.encode("utf-8", errors="strict")
            _assert_safe_json_tree(item, depth=depth + 1)
        return
    raise ValueError("unsupported JSON value")


def parse_envelope(text: str | bytes) -> dict[str, Any]:
    """Parse and validate one exact model-facing Excel Artifact envelope.

    No surrounding prose, Markdown fences, second envelope, alternate tag,
    comments, duplicate JSON keys, non-standard numeric constants, or trailing
    JSON is accepted.  ASCII whitespace may surround the single envelope and
    may appear inside it as ordinary JSON whitespace.
    """

    if isinstance(text, bytes):
        if len(text) > MAX_ENVELOPE_BYTES:
            raise _protocol_error(
                "The Excel Artifact envelope exceeds the protocol size limit.",
                recovery="Reduce the declarative request; pass binary inputs as artifact handles.",
                details={"stage": "envelope", "limit": MAX_ENVELOPE_BYTES, "observed": len(text)},
            )
        try:
            text = text.decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise _protocol_error(
                "The Excel Artifact envelope is not valid UTF-8.",
                recovery="Encode the single tagged JSON request as UTF-8.",
                details={"stage": "envelope"},
            ) from exc
    elif not isinstance(text, str):
        raise TypeError("envelope must be str or bytes")

    try:
        encoded_size = len(text.encode("utf-8", errors="strict"))
    except UnicodeEncodeError as exc:
        raise _protocol_error(
            "The Excel Artifact envelope contains invalid Unicode.",
            recovery="Send a valid UTF-8 JSON request.",
            details={"stage": "envelope"},
        ) from exc
    if encoded_size > MAX_ENVELOPE_BYTES:
        raise _protocol_error(
            "The Excel Artifact envelope exceeds the protocol size limit.",
            recovery="Reduce the declarative request; pass binary inputs as artifact handles.",
            details={"stage": "envelope", "limit": MAX_ENVELOPE_BYTES, "observed": encoded_size},
        )

    stripped = text.strip(" \t\r\n")
    if not (stripped.startswith(OPEN_TAG) and stripped.endswith(CLOSE_TAG)):
        raise _protocol_error(
            "Expected exactly one Excel Artifact envelope with no surrounding prose.",
            recovery=f"Send only {OPEN_TAG} followed by one JSON object and {CLOSE_TAG}.",
            details={"stage": "envelope"},
        )

    body = stripped[len(OPEN_TAG) : -len(CLOSE_TAG)]
    # A reserved/tag-like Orca tool marker in the body indicates a mixed,
    # nested, or multiple envelope. Ordinary comparison characters in formulas
    # remain valid JSON content.
    if re.search(r"</?orca_[A-Za-z0-9_-]*", body, flags=re.IGNORECASE):
        raise _protocol_error(
            "Nested, mixed, or multiple tool envelopes are not allowed.",
            recovery=f"Send exactly one {OPEN_TAG} JSON envelope.",
            details={"stage": "envelope"},
        )

    try:
        document = json.loads(
            body,
            object_pairs_hook=_object_without_duplicate_keys,
            parse_constant=_reject_non_finite_constant,
        )
        _assert_safe_json_tree(document)
    except (json.JSONDecodeError, _DuplicateKey, ValueError, UnicodeError, RecursionError) as exc:
        raise _protocol_error(
            "The Excel Artifact envelope does not contain one strict JSON object.",
            recovery="Use valid JSON without duplicate keys, comments, non-finite numbers, or trailing content.",
            details={"stage": "json"},
        ) from exc

    return validate_job(document)


def parse_job_request(payload: str | bytes | Mapping[str, Any]) -> dict[str, Any]:
    """Parse a model envelope, or validate an already decoded trusted payload."""

    if isinstance(payload, (str, bytes)):
        return parse_envelope(payload)
    if isinstance(payload, Mapping):
        # Copy the mapping into plain JSON-shaped containers so exotic mapping
        # subclasses cannot execute behavior after the validation boundary.  The
        # trusted decoded path retains the same byte budget as the wire parser;
        # otherwise JSONL/IPC callers could bypass the envelope limit.
        try:
            document = copy.deepcopy(dict(payload))
            _assert_safe_json_tree(document)
            canonical = json.dumps(
                document,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8", errors="strict")
        except (TypeError, ValueError, UnicodeError, RecursionError) as exc:
            raise _protocol_error(
                "The job payload is not a supported JSON object.",
                recovery="Pass an ordinary JSON object matching the job v1 schema.",
                details={"stage": "json"},
            ) from exc
        if len(canonical) > MAX_ENVELOPE_BYTES:
            raise _protocol_error(
                "The decoded Excel Artifact request exceeds the protocol size limit.",
                recovery="Reduce the declarative request; pass binary inputs as artifact handles.",
                details={
                    "stage": "json",
                    "limit": MAX_ENVELOPE_BYTES,
                    "observed": len(canonical),
                },
            )
        return validate_job(document)
    raise TypeError("job request must be an envelope or mapping")


__all__ = [
    "CLOSE_TAG",
    "ENVELOPE_TAG",
    "MAX_ENVELOPE_BYTES",
    "OPEN_TAG",
    "PROTOCOL_VERSION",
    "load_schema",
    "parse_envelope",
    "parse_job_request",
    "validate_artifact",
    "validate_capability",
    "validate_document",
    "validate_job",
    "validate_result",
]
