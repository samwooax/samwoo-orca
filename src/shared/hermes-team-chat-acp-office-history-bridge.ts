export const HERMES_ACP_OFFICE_HISTORY_BRIDGE = `
_office_history_marker = "[Orca Office Preview] "

def _office_preview_message_summary(message):
    if not isinstance(message, dict) or message.get("role") != "tool":
        return None
    if (message.get("tool_name") or message.get("name")) != "read_file":
        return None
    content = message.get("content")
    if not isinstance(content, list):
        return None
    text_parts = []
    has_image = False
    for part in content:
        if not isinstance(part, dict):
            continue
        part_type = part.get("type")
        if part_type == "text" and isinstance(part.get("text"), str):
            text_parts.append(part["text"])
        elif part_type in ("image", "image_url", "input_image"):
            has_image = True
    summary = "\\n".join(text_parts)
    if not has_image or not summary.startswith(_office_history_marker):
        return None
    return summary

def _prune_office_preview_history(state):
    history = getattr(state, "history", None)
    if not isinstance(history, list):
        return False
    previews = []
    for message in history:
        summary = _office_preview_message_summary(message)
        if summary is not None:
            previews.append((message, summary))
    for message, summary in previews[:-1]:
        message["content"] = summary
    return len(previews) > 1

def _prune_persisted_office_preview_history(state):
    agent = getattr(state, "agent", None)
    database = getattr(agent, "_session_db", None)
    session_id = getattr(agent, "session_id", None)
    execute_write = getattr(database, "_execute_write", None)
    decode_content = getattr(database, "_decode_content", None)
    encode_content = getattr(database, "_encode_content", None)
    if not session_id or not all(callable(value) for value in (
        execute_write, decode_content, encode_content
    )):
        return False

    def _rewrite(connection):
        rows = connection.execute(
            "SELECT id, content FROM messages "
            "WHERE session_id = ? AND role = 'tool' "
            "AND tool_name = 'read_file' ORDER BY timestamp, id",
            (session_id,),
        ).fetchall()
        previews = []
        for row in rows:
            content = decode_content(row["content"])
            summary = _office_preview_message_summary({
                "role": "tool", "tool_name": "read_file", "content": content
            })
            if summary is not None:
                previews.append((row["id"], summary))
        for row_id, summary in previews[:-1]:
            connection.execute(
                "UPDATE messages SET content = ? WHERE id = ? AND session_id = ?",
                (encode_content(summary), row_id, session_id),
            )

    try:
        execute_write(_rewrite)
        return True
    except Exception:
        _bridge_logger.warning("Could not prune persisted Office previews", exc_info=True)
        return False
`.trim()
