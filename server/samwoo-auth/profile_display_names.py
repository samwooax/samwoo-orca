"""Runtime display-name directory scoped by the existing profile role map."""

from __future__ import annotations

import csv
import os
import threading

DISPLAY_NAMES_CSV = "/opt/samwoo-auth/user-display-names.csv"
ROLE_MAP_CSV = "/opt/samwoo-auth/role-map.csv"
_cache_lock = threading.Lock()
_cache_signature: tuple | None = None
_cached_names: dict[str, str] = {}
_cached_profiles: dict[str, tuple[str, str]] = {}


def _path(variable: str, default: str) -> str:
    return os.environ.get(variable, default)


def _signature(path: str) -> tuple[str, int | None, int | None]:
    try:
        stat = os.stat(path)
        return path, stat.st_mtime_ns, stat.st_size
    except OSError:
        return path, None, None


def _clean(value: object, maximum: int = 160) -> str | None:
    result = str(value or "").strip()
    if not result or len(result) > maximum or any(ord(char) < 32 for char in result):
        return None
    return result


def _rows(path: str) -> list[list[str]]:
    try:
        with open(path, newline="", encoding="utf-8-sig") as handle:
            return list(csv.reader(handle))
    except (OSError, UnicodeError, csv.Error):
        return []


def _role_directory(path: str) -> tuple[dict[str, str], dict[str, tuple[str, str]]]:
    names: dict[str, str] = {}
    profiles: dict[str, tuple[str, str]] = {}
    for index, row in enumerate(_rows(path)):
        if len(row) < 3:
            continue
        login, name, profile = (_clean(row[0]), _clean(row[1]), _clean(row[2]))
        if index == 0 and login and login.casefold() == "login":
            continue
        if login and profile:
            key = login.casefold()
            profiles[key] = (login, profile)
            if name:
                names[key] = name
    return names, profiles


def _display_directory(path: str) -> dict[str, str]:
    names: dict[str, str] = {}
    for index, row in enumerate(_rows(path)):
        if len(row) < 2:
            continue
        login, name = _clean(row[0]), _clean(row[1])
        if index == 0 and login and login.casefold() == "login":
            continue
        if login and name:
            names[login.casefold()] = name
    return names


def _directory() -> tuple[dict[str, str], dict[str, tuple[str, str]]]:
    global _cache_signature, _cached_names, _cached_profiles
    display_path = _path("SAMWOO_DISPLAY_NAMES_CSV", DISPLAY_NAMES_CSV)
    role_path = _path("SAMWOO_ROLE_MAP_CSV", ROLE_MAP_CSV)
    signature = (_signature(display_path), _signature(role_path))
    with _cache_lock:
        if signature != _cache_signature:
            role_names, profiles = _role_directory(role_path)
            # Why: deployments may update either CSV first; dedicated names win per login.
            role_names.update(_display_directory(display_path))
            _cached_names = role_names
            _cached_profiles = profiles
            _cache_signature = signature
        return _cached_names, _cached_profiles


def display_name(login: str | None) -> str | None:
    key = _clean(login)
    if not key:
        return None
    names, _ = _directory()
    return names.get(key.casefold())


def profile_members(profile: str) -> list[dict[str, str]]:
    requested = _clean(profile)
    if not requested:
        return []
    names, profiles = _directory()
    members = [
        {"login": login, "name": names.get(key, login)}
        for key, (login, member_profile) in profiles.items()
        if member_profile == requested
    ]
    return sorted(members, key=lambda member: (member["name"].casefold(), member["login"]))


def _reset_cache_for_tests() -> None:
    global _cache_signature, _cached_names, _cached_profiles
    with _cache_lock:
        _cache_signature = None
        _cached_names = {}
        _cached_profiles = {}
