"""Profile-scoped Nextcloud WebDAV storage for shared workspaces."""

from __future__ import annotations

import base64
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

NEXTCLOUD_URL = os.environ.get("SAMWOO_NEXTCLOUD_URL", "").rstrip("/")
NEXTCLOUD_USERNAME = os.environ.get("SAMWOO_NEXTCLOUD_USERNAME", "")
NEXTCLOUD_APP_PASSWORD = os.environ.get("SAMWOO_NEXTCLOUD_APP_PASSWORD", "")
WORKSPACE_ROOT = os.environ.get("SAMWOO_NEXTCLOUD_WORKSPACE_ROOT", "SAMWOO-Workspaces")
MAX_FILE_BYTES = int(os.environ.get("SAMWOO_NEXTCLOUD_MAX_FILE_BYTES", str(16 * 1024 * 1024)))
REQUEST_TIMEOUT = int(os.environ.get("SAMWOO_NEXTCLOUD_TIMEOUT", "30"))

_PROFILE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_SHARE_ID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)
_DAV = "{DAV:}"
MAX_PATH_SEGMENTS = 64


class NextcloudStorageError(Exception):
    pass


class NextcloudStorageConflictError(NextcloudStorageError):
    pass


def _configured() -> bool:
    return bool(NEXTCLOUD_URL and NEXTCLOUD_USERNAME and NEXTCLOUD_APP_PASSWORD)


def _workspace_segments(profile: str, share_id: str) -> list[str]:
    if not _PROFILE.fullmatch(profile) or not _SHARE_ID.fullmatch(share_id):
        raise NextcloudStorageError("invalid workspace storage identity")
    root = [segment for segment in WORKSPACE_ROOT.strip("/").split("/") if segment]
    if not root or any(segment in {".", ".."} for segment in root):
        raise NextcloudStorageError("invalid workspace storage root")
    return [*root, profile, share_id]


def normalize_relative_path(value: object, allow_empty: bool = True) -> str:
    raw = str(value or "")
    if re.match(r"^[A-Za-z]:[\\/]", raw) or raw.startswith(("/", "\\")):
        raise NextcloudStorageError("invalid file path")
    text = raw.replace("\\", "/").strip("/")
    if not text:
        if allow_empty:
            return ""
        raise NextcloudStorageError("file path required")
    segments = text.split("/")
    if any(
        not segment
        or segment in {".", ".."}
        or len(segment) > 255
        or any(ord(char) < 32 for char in segment)
        for segment in segments
    ) or len(segments) > MAX_PATH_SEGMENTS:
        raise NextcloudStorageError("invalid file path")
    return "/".join(segments)


def _dav_root() -> str:
    if not _configured():
        raise NextcloudStorageError("Nextcloud workspace storage is not configured")
    username = urllib.parse.quote(NEXTCLOUD_USERNAME, safe="")
    return f"{NEXTCLOUD_URL}/remote.php/dav/files/{username}"


def _url(segments: list[str], trailing_slash: bool = False) -> str:
    path = "/".join(urllib.parse.quote(segment, safe="") for segment in segments)
    suffix = "/" if trailing_slash else ""
    return f"{_dav_root()}/{path}{suffix}"


def _request(
    method: str,
    segments: list[str],
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    expected: tuple[int, ...] = (200, 201, 204, 207),
) -> tuple[int, bytes, dict[str, str]]:
    token = base64.b64encode(
        f"{NEXTCLOUD_USERNAME}:{NEXTCLOUD_APP_PASSWORD}".encode("utf-8")
    ).decode("ascii")
    request_headers = {"Authorization": f"Basic {token}", "User-Agent": "SAMWOO-ORCA"}
    request_headers.update(headers or {})
    request = urllib.request.Request(
        _url(segments, trailing_slash=method in {"MKCOL", "PROPFIND"}),
        data=body,
        method=method,
        headers=request_headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            payload = response.read(MAX_FILE_BYTES + 1)
            if len(payload) > MAX_FILE_BYTES:
                raise NextcloudStorageError("Nextcloud file exceeds the configured size limit")
            status = response.status
            response_headers = {key.lower(): value for key, value in response.headers.items()}
    except urllib.error.HTTPError as error:
        if error.code in expected:
            return error.code, b"", {}
        if error.code == 404:
            raise NextcloudStorageError("Nextcloud workspace file not found") from error
        if error.code in {409, 412}:
            raise NextcloudStorageConflictError(
                "Nextcloud workspace file changed; refresh and retry"
            ) from error
        if error.code == 423:
            raise NextcloudStorageError("Nextcloud workspace file is locked; retry later") from error
        raise NextcloudStorageError(f"Nextcloud request failed ({error.code})") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise NextcloudStorageError("Nextcloud workspace storage is unavailable") from error
    if status not in expected:
        raise NextcloudStorageError(f"Nextcloud request failed ({status})")
    return status, payload, response_headers


def ensure_workspace(profile: str, share_id: str) -> str:
    segments: list[str] = []
    for segment in _workspace_segments(profile, share_id):
        segments.append(segment)
        try:
            _request("MKCOL", segments, expected=(201, 405))
        except NextcloudStorageError as error:
            if "(405)" not in str(error):
                raise
    return "/".join(segments)


def list_directory(profile: str, share_id: str, relative_path: object = "") -> list[dict]:
    relative = normalize_relative_path(relative_path)
    base_segments = _workspace_segments(profile, share_id)
    target_segments = [*base_segments, *relative.split("/")] if relative else base_segments
    _, payload, _ = _request(
        "PROPFIND",
        target_segments,
        body=b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/><d:getlastmodified/></d:prop></d:propfind>',
        headers={"Depth": "1", "Content-Type": "application/xml"},
        expected=(207,),
    )
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise NextcloudStorageError("invalid Nextcloud directory response") from error
    entries: list[dict] = []
    target_path = "/".join(target_segments)
    for response in root.findall(f"{_DAV}response"):
        href = response.findtext(f"{_DAV}href") or ""
        decoded_path = urllib.parse.unquote(urllib.parse.urlparse(href).path).rstrip("/")
        marker = f"/{target_path}"
        marker_index = decoded_path.find(marker)
        if marker_index < 0:
            continue
        child = decoded_path[marker_index + len(marker) :].strip("/")
        if not child or "/" in child:
            continue
        prop = None
        for propstat in response.findall(f"{_DAV}propstat"):
            if (propstat.findtext(f"{_DAV}status") or "").strip().endswith(" 200 OK"):
                prop = propstat.find(f"{_DAV}prop")
                break
        if prop is None:
            continue
        is_directory = prop.find(f"{_DAV}resourcetype/{_DAV}collection") is not None
        size_text = prop.findtext(f"{_DAV}getcontentlength") or "0"
        entries.append(
            {
                "name": child,
                "kind": "directory" if is_directory else "file",
                "size": int(size_text) if size_text.isdigit() else 0,
                "etag": (prop.findtext(f"{_DAV}getetag") or "").strip('"'),
                "modifiedAt": prop.findtext(f"{_DAV}getlastmodified") or None,
            }
        )
    return sorted(entries, key=lambda entry: (entry["kind"] != "directory", entry["name"].lower()))


def read_file(profile: str, share_id: str, relative_path: object) -> dict:
    relative = normalize_relative_path(relative_path, allow_empty=False)
    segments = [*_workspace_segments(profile, share_id), *relative.split("/")]
    _, payload, headers = _request("GET", segments, expected=(200,))
    return {
        "path": relative,
        "contentBase64": base64.b64encode(payload).decode("ascii"),
        "etag": headers.get("etag", "").strip('"'),
        "size": len(payload),
    }


def write_file(
    profile: str,
    share_id: str,
    relative_path: object,
    content_base64: object,
    expected_etag: object = None,
    create_only: object = False,
) -> dict:
    relative = normalize_relative_path(relative_path, allow_empty=False)
    try:
        payload = base64.b64decode(str(content_base64 or ""), validate=True)
    except (ValueError, TypeError) as error:
        raise NextcloudStorageError("invalid file content") from error
    if len(payload) > MAX_FILE_BYTES:
        raise NextcloudStorageError("Nextcloud file exceeds the configured size limit")
    segments = _workspace_segments(profile, share_id)
    parent_segments = relative.split("/")[:-1]
    for segment in parent_segments:
        segments.append(segment)
        try:
            _request("MKCOL", segments, expected=(201, 405))
        except NextcloudStorageError as error:
            if "(405)" not in str(error):
                raise
    file_segments = [*segments, relative.split("/")[-1]]
    headers = {"Content-Type": "application/octet-stream"}
    if expected_etag:
        headers["If-Match"] = f'"{str(expected_etag).strip(chr(34))}"'
    elif create_only is True:
        headers["If-None-Match"] = "*"
    _, _, response_headers = _request("PUT", file_segments, body=payload, headers=headers)
    return {
        "path": relative,
        "etag": response_headers.get("etag", "").strip('"'),
        "size": len(payload),
    }


def delete_file(
    profile: str,
    share_id: str,
    relative_path: object,
    expected_etag: object,
) -> dict:
    relative = normalize_relative_path(relative_path, allow_empty=False)
    headers = {}
    if expected_etag:
        headers["If-Match"] = f'"{str(expected_etag).strip(chr(34))}"'
    segments = [*_workspace_segments(profile, share_id), *relative.split("/")]
    _request("DELETE", segments, headers=headers, expected=(204, 404))
    return {"path": relative}
