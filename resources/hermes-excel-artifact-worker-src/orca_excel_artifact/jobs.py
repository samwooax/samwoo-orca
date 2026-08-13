"""Bounded in-process job lifecycle primitives for the Orca integration layer."""

from __future__ import annotations

import hashlib
import json
import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Callable

from .errors import ArtifactError


class JobState(StrEnum):
    QUEUED = "queued"
    INSPECTING = "inspecting"
    CONVERTING = "converting"
    PLANNING = "planning"
    GENERATING = "generating"
    VALIDATING = "validating"
    RENDERING = "rendering"
    COMMITTING = "committing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATES = {JobState.COMPLETED, JobState.FAILED, JobState.CANCELLED}

_ALLOWED_TRANSITIONS: dict[JobState, frozenset[JobState]] = {
    JobState.QUEUED: frozenset(
        {
            JobState.INSPECTING,
            JobState.GENERATING,
            JobState.VALIDATING,
            JobState.RENDERING,
            JobState.COMPLETED,
            JobState.CANCELLED,
            JobState.FAILED,
        }
    ),
    JobState.INSPECTING: frozenset(
        {JobState.CONVERTING, JobState.PLANNING, JobState.COMPLETED, JobState.CANCELLED, JobState.FAILED}
    ),
    JobState.CONVERTING: frozenset(
        {JobState.PLANNING, JobState.GENERATING, JobState.COMPLETED, JobState.CANCELLED, JobState.FAILED}
    ),
    JobState.PLANNING: frozenset(
        {JobState.GENERATING, JobState.COMPLETED, JobState.CANCELLED, JobState.FAILED}
    ),
    JobState.GENERATING: frozenset(
        {JobState.VALIDATING, JobState.CANCELLED, JobState.FAILED}
    ),
    JobState.VALIDATING: frozenset(
        {JobState.RENDERING, JobState.COMMITTING, JobState.COMPLETED, JobState.CANCELLED, JobState.FAILED}
    ),
    JobState.RENDERING: frozenset(
        {JobState.COMMITTING, JobState.COMPLETED, JobState.CANCELLED, JobState.FAILED}
    ),
    JobState.COMMITTING: frozenset(
        {JobState.COMPLETED, JobState.CANCELLED, JobState.FAILED}
    ),
    JobState.COMPLETED: frozenset(),
    JobState.FAILED: frozenset(),
    JobState.CANCELLED: frozenset(),
}


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def request_fingerprint(request: dict[str, Any]) -> str:
    """Hash a validated request for idempotency conflict detection."""

    canonical = json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(slots=True)
class CancellationToken:
    """Cooperative cancellation token shared with conversion subprocess owners."""

    _event: threading.Event = field(default_factory=threading.Event)

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def check(self) -> None:
        if self.cancelled:
            raise ArtifactError("cancelled", "The artifact job was cancelled.", "Submit a new request to retry.")


@dataclass(slots=True)
class ArtifactJob:
    job_id: str
    operation_id: str
    idempotency_key: str
    idempotency_scope: str
    fingerprint: str
    output_key: str | None
    workspace_key: str | None
    state: JobState = JobState.QUEUED
    started_at: str = field(default_factory=_utc_now)
    finished_at: str | None = None
    token: CancellationToken = field(default_factory=CancellationToken)
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    future: Future[dict[str, Any]] | None = None

    def transition(self, new_state: JobState) -> None:
        if new_state not in _ALLOWED_TRANSITIONS[self.state]:
            raise ArtifactError(
                "job_conflict",
                f"Invalid job transition {self.state.value} -> {new_state.value}.",
                "Inspect the existing job result instead of resubmitting it.",
            )
        self.state = new_state
        if new_state in TERMINAL_STATES:
            self.finished_at = _utc_now()


class JobRegistry:
    """Memory-bounded reference registry; Orca must persist receipts durably."""

    def __init__(self, *, max_workers: int = 2, max_jobs: int = 256) -> None:
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="excel-artifact")
        self._max_jobs = max_jobs
        self._jobs: dict[str, ArtifactJob] = {}
        self._idempotency: dict[tuple[str, str], str] = {}
        self._operations: dict[tuple[str, str], str] = {}
        self._output_locks: dict[str, str] = {}
        self._workspace_locks: dict[str, str] = {}
        self._lock = threading.RLock()

    def submit(
        self,
        request: dict[str, Any],
        runner: Callable[[ArtifactJob, dict[str, Any]], dict[str, Any]],
        *,
        output_key: str | None = None,
        idempotency_scope: str = "default",
        workspace_key: str | None = None,
    ) -> ArtifactJob:
        idem = str(request["idempotencyKey"])
        operation_id = str(request["operationId"])
        fingerprint = request_fingerprint(request)
        scoped_idempotency = (idempotency_scope, idem)
        scoped_operation = (idempotency_scope, operation_id)
        with self._lock:
            existing_id = self._idempotency.get(scoped_idempotency)
            if existing_id:
                existing = self._jobs[existing_id]
                if existing.fingerprint != fingerprint:
                    raise ArtifactError(
                        "job_conflict",
                        "The idempotency key was already used with a different request.",
                        "Reuse the original request or choose a new key for a genuinely new operation.",
                    )
                return existing
            if scoped_operation in self._operations:
                raise ArtifactError(
                    "job_conflict",
                    "The operation ID already belongs to another artifact request.",
                    "Inspect the existing job or submit a genuinely new operation ID.",
                )
            if output_key and output_key in self._output_locks:
                raise ArtifactError(
                    "job_conflict",
                    "Another artifact job owns the requested output path.",
                    "Wait for the existing job and inspect its result.",
                )
            if workspace_key and workspace_key in self._workspace_locks:
                raise ArtifactError(
                    "job_conflict",
                    "The selected workspace already has an active artifact job.",
                    "Wait for the existing workspace job to finish and retry.",
                )
            if len(self._jobs) >= self._max_jobs:
                self._evict_oldest_terminal()
            if len(self._jobs) >= self._max_jobs:
                raise ArtifactError(
                    "job_conflict",
                    "The artifact job registry is full.",
                    "Wait for active jobs to complete and retry.",
                )
            job = ArtifactJob(
                job_id=f"excel_{uuid.uuid4().hex}",
                operation_id=operation_id,
                idempotency_key=idem,
                idempotency_scope=idempotency_scope,
                fingerprint=fingerprint,
                output_key=output_key,
                workspace_key=workspace_key,
            )
            self._jobs[job.job_id] = job
            self._idempotency[scoped_idempotency] = job.job_id
            self._operations[scoped_operation] = job.job_id
            if output_key:
                self._output_locks[output_key] = job.job_id
            if workspace_key:
                self._workspace_locks[workspace_key] = job.job_id
            job.future = self._executor.submit(self._run, job, request, runner)
            return job

    def _run(
        self,
        job: ArtifactJob,
        request: dict[str, Any],
        runner: Callable[[ArtifactJob, dict[str, Any]], dict[str, Any]],
    ) -> dict[str, Any]:
        try:
            job.token.check()
            result = runner(job, request)
            if job.state not in TERMINAL_STATES:
                job.transition(JobState.COMPLETED)
            job.result = result
            return result
        except ArtifactError as exc:
            with self._lock:
                if job.state not in TERMINAL_STATES:
                    job.transition(JobState.CANCELLED if exc.code == "cancelled" else JobState.FAILED)
                job.error = exc.to_dict()
            raise
        except Exception:
            sanitized = ArtifactError(
                "generation_failed",
                "The artifact worker failed.",
                "Review the sanitized Orca job log and retry after correcting the workbook specification.",
            )
            with self._lock:
                if job.state not in TERMINAL_STATES:
                    job.transition(JobState.FAILED)
                job.error = sanitized.to_dict()
            raise sanitized from None
        finally:
            with self._lock:
                if job.output_key and self._output_locks.get(job.output_key) == job.job_id:
                    self._output_locks.pop(job.output_key, None)
                if job.workspace_key and self._workspace_locks.get(job.workspace_key) == job.job_id:
                    self._workspace_locks.pop(job.workspace_key, None)

    def cancel(self, job_id: str) -> ArtifactJob:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise ArtifactError("input_not_found", "The artifact job was not found.", "Refresh job status.")
            if job.state in TERMINAL_STATES:
                return job
            job.token.cancel()
            if job.future and job.future.cancel():
                job.transition(JobState.CANCELLED)
            return job

    def get(self, job_id: str) -> ArtifactJob:
        with self._lock:
            try:
                return self._jobs[job_id]
            except KeyError:
                raise ArtifactError("input_not_found", "The artifact job was not found.", "Refresh job status.") from None

    def _evict_oldest_terminal(self) -> None:
        terminal = next((job for job in self._jobs.values() if job.state in TERMINAL_STATES), None)
        if not terminal:
            return
        self._jobs.pop(terminal.job_id, None)
        scoped_idempotency = (terminal.idempotency_scope, terminal.idempotency_key)
        scoped_operation = (terminal.idempotency_scope, terminal.operation_id)
        if self._idempotency.get(scoped_idempotency) == terminal.job_id:
            self._idempotency.pop(scoped_idempotency, None)
        if self._operations.get(scoped_operation) == terminal.job_id:
            self._operations.pop(scoped_operation, None)

    def shutdown(self, *, cancel: bool = True) -> None:
        if cancel:
            with self._lock:
                for job in self._jobs.values():
                    if job.state not in TERMINAL_STATES:
                        job.token.cancel()
        self._executor.shutdown(wait=True, cancel_futures=cancel)
