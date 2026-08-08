"""Profile-scoped in-process events and SSE delivery."""

from __future__ import annotations

import json
import queue
import threading
from typing import Callable

import workspace_sharing

EVENT_PATH = "/events"
SUBSCRIBER_QUEUE_SIZE = 256
HEARTBEAT_SECONDS = 25.0

_registry_lock = threading.Lock()
_subscriptions: dict[str, set["Subscription"]] = {}


class Subscription:
    def __init__(self, profile: str, login: str) -> None:
        self.profile = profile
        self.login = login
        self._queue: queue.Queue[dict] = queue.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
        self._closed = False

    def get(self, timeout: float | None = None) -> dict:
        return self._queue.get(timeout=timeout)

    def get_nowait(self) -> dict:
        return self._queue.get_nowait()

    def close(self) -> None:
        with _registry_lock:
            if self._closed:
                return
            self._closed = True
            subscribers = _subscriptions.get(self.profile)
            if subscribers:
                subscribers.discard(self)
                if not subscribers:
                    _subscriptions.pop(self.profile, None)
            online = _online_logins_locked(self.profile)
        publish(self.profile, {"type": "presence", "online": sorted(online)})

    def __enter__(self) -> "Subscription":
        return self

    def __exit__(self, _type, _value, _traceback) -> None:
        self.close()

    def _offer(self, event: dict) -> None:
        while True:
            try:
                self._queue.put_nowait(event)
                return
            except queue.Full:
                try:
                    self._queue.get_nowait()
                except queue.Empty:
                    continue


def _online_logins_locked(profile: str) -> set[str]:
    return {subscription.login for subscription in _subscriptions.get(profile, set())}


def online_logins(profile: str) -> set[str]:
    with _registry_lock:
        return _online_logins_locked(profile)


def subscribe(profile: str, login: str) -> Subscription:
    subscription = Subscription(profile, login)
    with _registry_lock:
        _subscriptions.setdefault(profile, set()).add(subscription)
        online = _online_logins_locked(profile)
    subscription._offer({"type": "snapshot", "online": sorted(online)})
    publish(profile, {"type": "presence", "online": sorted(online)})
    return subscription


def publish(profile: str, event: dict) -> None:
    with _registry_lock:
        subscribers = tuple(_subscriptions.get(profile, ()))
    for subscription in subscribers:
        subscription._offer(event)


def is_event_stream_path(path: str) -> bool:
    return path.split("?", 1)[0] == EVENT_PATH


def _write_event(handler, event: dict) -> None:
    payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    handler.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
    handler.wfile.flush()


def _send_unauthorized(handler) -> None:
    payload = b'{"ok":false,"error":"invalid or expired session"}'
    handler.send_response(401)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def handle_event_stream(
    handler,
    *,
    heartbeat_seconds: float = HEARTBEAT_SECONDS,
    max_iterations: int | None = None,
    identity: Callable[[str], tuple[str, str]] = workspace_sharing._identity,
) -> None:
    authorization = handler.headers.get("Authorization", "")
    token = authorization[len("Bearer "):].strip() if authorization.startswith("Bearer ") else ""
    try:
        login, profile = identity(token)
    except workspace_sharing.WorkspaceShareError:
        _send_unauthorized(handler)
        return

    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()
    iterations = 0
    with subscribe(profile, login) as subscription:
        try:
            while max_iterations is None or iterations < max_iterations:
                try:
                    identity(token)
                except workspace_sharing.WorkspaceShareError:
                    _write_event(handler, {"type": "expired"})
                    break
                try:
                    event = subscription.get(timeout=heartbeat_seconds)
                    _write_event(handler, event)
                except queue.Empty:
                    handler.wfile.write(b": ping\n\n")
                    handler.wfile.flush()
                iterations += 1
        except (BrokenPipeError, ConnectionError, OSError):
            pass
