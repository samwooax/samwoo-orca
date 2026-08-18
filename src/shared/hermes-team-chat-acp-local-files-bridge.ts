import { HERMES_ACP_REASONING_PATCH } from './hermes-team-chat-acp-reasoning-bridge'
import { HERMES_ACP_LOCAL_TERMINAL_BRIDGE } from './hermes-team-chat-acp-terminal-bridge'

export const HERMES_ACP_LOCAL_FILES_BRIDGE = `
from acp_adapter.entry import main
${HERMES_ACP_REASONING_PATCH}

import asyncio
import json
import os
import posixpath
from contextvars import ContextVar
from hermes_cli import __version__ as _hermes_version
from tools.registry import ToolRegistry

if _hermes_version != "0.20.0":
    raise RuntimeError("SAMWOO ACP local-files bridge requires Hermes 0.20.0")
for _owner, _name in (
    (HermesACPAgent, "initialize"),
    (HermesACPAgent, "prompt"),
    (ToolRegistry, "dispatch"),
):
    if not callable(getattr(_owner, _name, None)):
        raise RuntimeError("SAMWOO ACP local-files bridge hook is unavailable: " + _name)

_active_acp_route = ContextVar("samwoo_active_acp_route", default=None)
_original_initialize = HermesACPAgent.initialize
_original_prompt = HermesACPAgent.prompt
_original_dispatch = ToolRegistry.dispatch
_virtual_root = "/workspace"
_local_tool_names = {
    "execute_code", "patch", "process", "read_file", "search_files", "terminal", "write_file"
}

def _is_ai_center():
    home = os.path.normpath(os.environ.get("HERMES_HOME", ""))
    return os.path.basename(home) == "ai_center"

def _filesystem_ready(agent):
    capabilities = getattr(agent, "_samwoo_client_capabilities", None)
    filesystem = getattr(capabilities, "fs", None)
    return bool(
        filesystem
        and getattr(filesystem, "read_text_file", False)
        and getattr(filesystem, "write_text_file", False)
    )

def _terminal_ready(agent):
    capabilities = getattr(agent, "_samwoo_client_capabilities", None)
    return bool(capabilities and getattr(capabilities, "terminal", False))

def _terminal_route_ready():
    route = _active_acp_route.get()
    return bool(route and _terminal_ready(route[0]))

def _tool_error(message):
    return json.dumps({"error": message}, ensure_ascii=False)

def _workspace_path(value, profile_cwd):
    raw = str(value or ".").replace("\\\\", "/")
    profile_root = str(profile_cwd or "").rstrip("/")
    if raw == profile_root:
        raw = _virtual_root
    elif profile_root and raw.startswith(profile_root + "/"):
        raw = _virtual_root + raw[len(profile_root):]
    elif not raw.startswith("/"):
        raw = posixpath.join(_virtual_root, raw)
    normalized = posixpath.normpath(raw)
    if normalized != _virtual_root and not normalized.startswith(_virtual_root + "/"):
        raise ValueError("path is outside /workspace")
    return normalized

def _client_call(factory, capability_ready, timeout=60):
    route = _active_acp_route.get()
    if route is None:
        raise RuntimeError("no active ACP prompt route")
    agent, loop, session_id, profile_cwd = route
    if not capability_ready(agent) or agent._conn is None:
        raise RuntimeError("ACP local capability handshake failed")
    future = asyncio.run_coroutine_threadsafe(factory(agent._conn, session_id), loop)
    try:
        return future.result(timeout=timeout), profile_cwd
    except BaseException:
        future.cancel()
        raise

def _read_content(path, offset=None, limit=None):
    route = _active_acp_route.get()
    if route is None:
        raise RuntimeError("no active ACP prompt route")
    profile_cwd = route[3]
    wire_path = _workspace_path(path, profile_cwd)
    line = int(offset) if offset is not None else None
    line_limit = int(limit) if limit is not None else None
    response, _ = _client_call(
        lambda conn, session_id: conn.read_text_file(
            path=wire_path, session_id=session_id, line=line, limit=line_limit
        ),
        _filesystem_ready,
    )
    return response.content, wire_path

def _read(path, offset=None, limit=None):
    content, wire_path = _read_content(path, offset, limit)
    return json.dumps({"content": content, "path": wire_path}, ensure_ascii=False)

def _write(path, content):
    if not isinstance(path, str) or not path:
        raise ValueError("path must be a non-empty string")
    if not isinstance(content, str):
        raise ValueError("content must be a string")
    route = _active_acp_route.get()
    if route is None:
        raise RuntimeError("no active ACP prompt route")
    wire_path = _workspace_path(path, route[3])
    _client_call(
        lambda conn, session_id: conn.write_text_file(
            path=wire_path, content=content, session_id=session_id
        ),
        _filesystem_ready,
    )
    return json.dumps({"success": True, "path": wire_path}, ensure_ascii=False)

def _patch(arguments):
    if str(arguments.get("mode") or "replace") != "replace":
        return _tool_error("apply patches are unavailable; use replace mode or read_file then write_file")
    old = arguments.get("old_string")
    new = arguments.get("new_string")
    if not isinstance(old, str) or not isinstance(new, str) or not old:
        return _tool_error("patch replace mode requires non-empty old_string and string new_string")
    content, _ = _read_content(arguments.get("path"))
    count = content.count(old)
    if count == 0:
        return _tool_error("old_string was not found")
    replace_all = bool(arguments.get("replace_all", False))
    if count > 1 and not replace_all:
        return _tool_error("old_string is not unique; add context or set replace_all")
    updated = content.replace(old, new) if replace_all else content.replace(old, new, 1)
    return _write(arguments.get("path"), updated)

${HERMES_ACP_LOCAL_TERMINAL_BRIDGE}

async def _initialize_with_local_files(
    self, protocol_version=None, client_capabilities=None, client_info=None, **kwargs
):
    self._samwoo_client_capabilities = client_capabilities
    return await _original_initialize(
        self,
        protocol_version=protocol_version,
        client_capabilities=client_capabilities,
        client_info=client_info,
        **kwargs,
    )

async def _prompt_with_local_files(self, prompt, session_id, **kwargs):
    state = self.session_manager.get_session(session_id)
    profile_cwd = getattr(state, "cwd", "") if state is not None else ""
    token = _active_acp_route.set((self, asyncio.get_running_loop(), session_id, profile_cwd))
    try:
        return await _original_prompt(self, prompt=prompt, session_id=session_id, **kwargs)
    finally:
        _active_acp_route.reset(token)

def _dispatch_local_files(self, name, args, **kwargs):
    if not _is_ai_center() or name not in _local_tool_names:
        return _original_dispatch(self, name, args, **kwargs)
    if name == "read_file":
        try:
            return _read(args.get("path"), args.get("offset"), args.get("limit"))
        except Exception as error:
            return _tool_error("local read failed: " + str(error))
    if name == "write_file":
        try:
            return _write(args.get("path"), args.get("content"))
        except Exception as error:
            return _tool_error("local write failed: " + str(error))
    if name == "patch":
        try:
            return _patch(args)
        except Exception as error:
            return _tool_error("local patch failed: " + str(error))
    if name == "terminal":
        if not _terminal_route_ready():
            return _tool_error("terminal is disabled in SAMWOO local-files mode")
        try:
            return _terminal(args)
        except Exception as error:
            return _tool_error("local terminal failed: " + str(error))
    if name == "process":
        if not _terminal_route_ready():
            return _tool_error("process is disabled in SAMWOO local-files mode")
        try:
            return _process(args)
        except Exception as error:
            return _tool_error("local process failed: " + str(error))
    return _tool_error(name + " is disabled in SAMWOO local-files mode")

HermesACPAgent.initialize = _initialize_with_local_files
HermesACPAgent.prompt = _prompt_with_local_files
ToolRegistry.dispatch = _dispatch_local_files
main()
`.trim()
