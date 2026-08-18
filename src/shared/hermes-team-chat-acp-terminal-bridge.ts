export const HERMES_ACP_LOCAL_TERMINAL_BRIDGE = `
import time

_terminal_records = {}
_terminal_record_limit = 16
_terminal_output_limit = 64 * 1024
_terminal_wait_limit = 120

def _terminal_output(terminal_id):
    response, _ = _client_call(
        lambda conn, session_id: conn.terminal_output(
            session_id=session_id, terminal_id=terminal_id
        ),
        _terminal_ready,
    )
    exit_status = getattr(response, "exit_status", None)
    return {
        "output": getattr(response, "output", "") or "",
        "truncated": bool(getattr(response, "truncated", False)),
        "exit_code": getattr(exit_status, "exit_code", None) if exit_status else None,
        "signal": getattr(exit_status, "signal", None) if exit_status else None,
        "status": "completed" if exit_status else "running",
    }

def _release_terminal(terminal_id):
    _client_call(
        lambda conn, session_id: conn.release_terminal(
            session_id=session_id, terminal_id=terminal_id
        ),
        _terminal_ready,
    )

def _ensure_terminal_record_capacity():
    if len(_terminal_records) < _terminal_record_limit:
        return True
    for terminal_id in list(_terminal_records):
        try:
            result = _terminal_output(terminal_id)
        except Exception:
            _terminal_records.pop(terminal_id, None)
            return True
        if result["status"] != "running":
            try:
                _release_terminal(terminal_id)
            except Exception:
                pass
            _terminal_records.pop(terminal_id, None)
            return True
    return False

def _terminal(arguments):
    command = arguments.get("command")
    if not isinstance(command, str) or not command.strip() or len(command) > 8000:
        return _tool_error("terminal command must be a non-empty string")
    if bool(arguments.get("pty", False)):
        return _tool_error("PTY input is unavailable in SAMWOO local terminal mode")
    background = bool(arguments.get("background", False))
    if background and not _ensure_terminal_record_capacity():
        return _tool_error("local process record capacity is reached")
    raw_timeout = arguments.get("timeout")
    try:
        timeout = _terminal_wait_limit if raw_timeout is None else int(raw_timeout)
    except (TypeError, ValueError):
        return _tool_error("terminal timeout must be an integer")
    timeout = max(1, min(_terminal_wait_limit, timeout))
    route = _active_acp_route.get()
    if route is None:
        return _tool_error("no active ACP prompt route")
    wire_cwd = _workspace_path(arguments.get("workdir") or _virtual_root, route[3])
    response, _ = _client_call(
        lambda conn, session_id: conn.create_terminal(
            command=command.strip(),
            session_id=session_id,
            cwd=wire_cwd,
            output_byte_limit=_terminal_output_limit,
            # The ACP SDK wraps keyword arguments in the wire-level _meta object.
            samwoo={
                "shellText": True,
                "background": background,
                "timeoutSeconds": timeout,
            },
        ),
        _terminal_ready,
        timeout=120,
    )
    terminal_id = getattr(response, "terminal_id", None)
    if not isinstance(terminal_id, str) or not terminal_id:
        return _tool_error("local terminal did not return a terminal id")
    if background:
        _terminal_records[terminal_id] = {
            "command": command.strip(),
            "created_at": time.monotonic(),
        }
        return json.dumps({
            "output": "",
            "exit_code": None,
            "error": None,
            "status": "running",
            "session_id": terminal_id,
        }, ensure_ascii=False)
    try:
        _client_call(
            lambda conn, session_id: conn.wait_for_terminal_exit(
                session_id=session_id, terminal_id=terminal_id
            ),
            _terminal_ready,
            timeout=timeout + 15,
        )
        result = _terminal_output(terminal_id)
        return json.dumps({
            "output": result["output"],
            "exit_code": result["exit_code"],
            "error": None if result["exit_code"] == 0 else (result["signal"] or "command failed"),
            "truncated": result["truncated"],
        }, ensure_ascii=False)
    finally:
        try:
            _release_terminal(terminal_id)
        except Exception:
            pass

def _process_result(terminal_id):
    result = _terminal_output(terminal_id)
    record = _terminal_records.get(terminal_id, {})
    return {
        "session_id": terminal_id,
        "command": record.get("command", ""),
        **result,
    }

def _process_summary(terminal_id):
    result = _process_result(terminal_id)
    result.pop("output", None)
    result.pop("truncated", None)
    return result

def _process_log(arguments, result):
    lines = result["output"].splitlines()
    try:
        limit = max(1, min(1000, int(arguments.get("limit", 200))))
        raw_offset = arguments.get("offset")
        offset = max(0, int(raw_offset)) if raw_offset is not None else max(0, len(lines) - limit)
    except (TypeError, ValueError):
        return _tool_error("process log offset and limit must be integers")
    result["output"] = "\\n".join(lines[offset:offset + limit])
    result["offset"] = offset
    result["total_lines"] = len(lines)
    return json.dumps(result, ensure_ascii=False)

def _process(arguments):
    action = str(arguments.get("action") or "")
    if action == "list":
        processes = []
        for terminal_id in list(_terminal_records):
            try:
                processes.append(_process_summary(terminal_id))
            except Exception:
                _terminal_records.pop(terminal_id, None)
        return json.dumps({"processes": processes}, ensure_ascii=False)
    terminal_id = str(arguments.get("session_id") or "")
    if not terminal_id or terminal_id not in _terminal_records:
        return _tool_error("process session_id is not managed by this local session")
    if action == "poll":
        return json.dumps(_process_result(terminal_id), ensure_ascii=False)
    if action == "log":
        return _process_log(arguments, _process_result(terminal_id))
    if action == "wait":
        try:
            wait_seconds = max(1, min(_terminal_wait_limit, int(arguments.get("timeout", 30))))
        except (TypeError, ValueError):
            return _tool_error("process wait timeout must be an integer")
        deadline = time.monotonic() + wait_seconds
        result = _process_result(terminal_id)
        while result["status"] == "running" and time.monotonic() < deadline:
            time.sleep(min(5.0, max(0.0, deadline - time.monotonic())))
            result = _process_result(terminal_id)
        return json.dumps(result, ensure_ascii=False)
    if action == "kill":
        _client_call(
            lambda conn, session_id: conn.kill_terminal(
                session_id=session_id, terminal_id=terminal_id
            ),
            _terminal_ready,
        )
        result = _process_result(terminal_id)
        try:
            _release_terminal(terminal_id)
        finally:
            _terminal_records.pop(terminal_id, None)
        result["status"] = "killed"
        return json.dumps(result, ensure_ascii=False)
    if action in {"write", "submit", "close"}:
        return _tool_error("process stdin actions are unavailable over ACP terminal")
    return _tool_error("unknown process action")
`.trim()
