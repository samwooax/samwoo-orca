import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { HERMES_ACP_LOCAL_FILES_BRIDGE } from './hermes-team-chat-acp-local-files-bridge'
import { HERMES_ACP_OFFICE_HISTORY_BRIDGE } from './hermes-team-chat-acp-office-history-bridge'

function availablePython(): string | null {
  for (const command of ['python', 'python3']) {
    if (spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0) {
      return command
    }
  }
  return null
}

describe('Hermes ACP local files bridge', () => {
  it('returns authenticated Office previews as native multimodal tool results', () => {
    expect(HERMES_ACP_LOCAL_FILES_BRIDGE).toContain('officePreview')
    expect(HERMES_ACP_LOCAL_FILES_BRIDGE).toContain('field_meta')
    expect(HERMES_ACP_LOCAL_FILES_BRIDGE).toContain('"_multimodal": True')
    expect(HERMES_ACP_LOCAL_FILES_BRIDGE).toContain('"type": "image_url"')
    expect(HERMES_ACP_LOCAL_FILES_BRIDGE).toContain('data:" + media_type + ";base64,')
  })

  it('gives cold Office rendering enough time to finish end to end', () => {
    expect(HERMES_ACP_LOCAL_FILES_BRIDGE).toContain('_office_client_timeout = 270')
    expect(HERMES_ACP_LOCAL_FILES_BRIDGE).toContain(
      'timeout=_office_client_timeout if preview_meta else 60'
    )
  })

  it('rewrites older Office image rows after each dirty prompt', () => {
    expect(HERMES_ACP_LOCAL_FILES_BRIDGE).toContain(
      'UPDATE messages SET content = ? WHERE id = ? AND session_id = ?'
    )
    expect(HERMES_ACP_LOCAL_FILES_BRIDGE).toContain(
      '_prune_persisted_office_preview_history(state)'
    )
  })
})

const python = availablePython()

describe.skipIf(python === null)('Hermes ACP Office history bridge', () => {
  it('produces valid Python after composing all bridge fragments', () => {
    const result = spawnSync(
      python!,
      ['-c', 'import sys; compile(sys.stdin.read(), "<samwoo-acp-bridge>", "exec")'],
      { input: HERMES_ACP_LOCAL_FILES_BRIDGE, encoding: 'utf8' }
    )

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('keeps only the newest marked Office image and leaves other images alone', () => {
    const script = `${HERMES_ACP_OFFICE_HISTORY_BRIDGE}
import json

def preview(label):
    return {
        "role": "tool",
        "tool_name": "read_file",
        "content": [
            {"type": "text", "text": _office_history_marker + label},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}},
        ],
    }

other_image = {
    "role": "tool",
    "tool_name": "computer_use",
    "content": [{"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}}],
}
state = type("State", (), {})()
state.history = [preview("old"), other_image, preview("latest")]
changed = _prune_office_preview_history(state)
changed_again = _prune_office_preview_history(state)
print(json.dumps({
    "changed": changed,
    "changedAgain": changed_again,
    "contentTypes": [type(message["content"]).__name__ for message in state.history],
    "oldSummary": state.history[0]["content"],
}))
`
    const result = spawnSync(python!, ['-'], { input: script, encoding: 'utf8' })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      changed: true,
      changedAgain: false,
      contentTypes: ['str', 'list', 'list'],
      oldSummary: '[Orca Office Preview] old'
    })
  })

  it('prunes archived and active rows in only the current persisted session', () => {
    const script = `${HERMES_ACP_OFFICE_HISTORY_BRIDGE}
import json

def preview(label):
    return [
        {"type": "text", "text": _office_history_marker + label},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}},
    ]

class Result:
    def __init__(self, rows):
        self.rows = rows
    def fetchall(self):
        return self.rows

class Connection:
    def __init__(self):
        self.select_sql = ""
        self.select_params = None
        self.updates = []
    def execute(self, sql, params):
        if sql.startswith("SELECT"):
            self.select_sql = sql
            self.select_params = params
            return Result([
                {"id": 1, "content": preview("archived")},
                {"id": 2, "content": preview("active-old")},
                {"id": 3, "content": [{"type": "text", "text": "ordinary read"}]},
                {"id": 4, "content": preview("latest")},
            ])
        self.updates.append(params)
        return Result([])

class Database:
    def __init__(self):
        self.connection = Connection()
    def _execute_write(self, callback):
        callback(self.connection)
    def _decode_content(self, content):
        return content
    def _encode_content(self, content):
        return content

database = Database()
agent = type("Agent", (), {"_session_db": database, "session_id": "current"})()
state = type("State", (), {"agent": agent})()
changed = _prune_persisted_office_preview_history(state)
print(json.dumps({
    "changed": changed,
    "hasActiveFilter": "active = 1" in database.connection.select_sql,
    "selectParams": database.connection.select_params,
    "updates": database.connection.updates,
}))
`
    const result = spawnSync(python!, ['-'], { input: script, encoding: 'utf8' })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      changed: true,
      hasActiveFilter: false,
      selectParams: ['current'],
      updates: [
        ['[Orca Office Preview] archived', 1, 'current'],
        ['[Orca Office Preview] active-old', 2, 'current']
      ]
    })
  })
})
