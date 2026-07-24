import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'

// Why: the bot SSHes back into this laptop as this OS user (the built-in
// "administrator" account is usually disabled on Windows). The user is a local
// admin, so the machine-wide administrators_authorized_keys still authorizes it.
const LAPTOP_USER = (() => {
  try {
    return userInfo().username
  } catch {
    return ''
  }
})()

/** SAMWOO-ORCA: loopback HTTP server that serves a native-looking chat page
 *  (bubbles + composer, zero terminal chrome) and relays each message to the
 *  remote Hermes profile over SSH:
 *    stdin(message) → ssh <host> hermes --profile X -z "$(cat)" --cli --continue <session>
 *  The page lives at /chat so BrowserPane's toolbar-hiding rule applies. */

const NAME_RE = /^[A-Za-z0-9._-]+$/
const MESSAGE_TIMEOUT_MS = 180_000

// Why: a FIXED port + STABLE token so a chat tab restored from a previous
// session still resolves after a restart. An ephemeral port/token made every
// restored tab point at a dead port ("can't reach 127.0.0.1:<old>").
const FIXED_PORT = 47821

let server: Server | null = null
let port = 0

// Persist the token across launches so restored /chat URLs keep validating.
function loadOrCreateToken(): string {
  try {
    const dir = join(app.getPath('userData'), 'samwoo')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'chat-token')
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8').trim()
      if (existing) {
        return existing
      }
    }
    const fresh = randomBytes(16).toString('hex')
    writeFileSync(file, fresh, { mode: 0o600 })
    return fresh
  } catch {
    return randomBytes(16).toString('hex')
  }
}

const token = loadOrCreateToken()

// Why: the team-bot runs on the server and reaches this laptop's files over SSH.
// Resolve this laptop's Tailscale hostname once and cache it, so every message
// can tell the bot which machine to SSH into — no "what's your laptop name?".
let cachedLaptopName: string | null = null
function getLaptopName(): Promise<string> {
  if (cachedLaptopName !== null) {
    return Promise.resolve(cachedLaptopName)
  }
  return new Promise((resolveName) => {
    const ts =
      process.platform === 'win32'
        ? 'C:\\Program Files\\Tailscale\\tailscale.exe'
        : 'tailscale'
    const proc = spawn(ts, ['status', '--self', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => {
      out += d.toString()
    })
    const done = (name: string): void => {
      cachedLaptopName = name
      resolveName(name)
    }
    proc.on('error', () => done(''))
    proc.on('close', () => {
      try {
        done(String(JSON.parse(out)?.Self?.HostName ?? ''))
      } catch {
        done('')
      }
    })
  })
}

const SSH_MUX_ARGS =
  process.platform === 'win32'
    ? []
    : [
        '-o',
        'ControlMaster=auto',
        '-o',
        'ControlPath=/tmp/.samwoo-orca-ssh-%r@%h-%p',
        '-o',
        'ControlPersist=10m'
      ]

function runHermesMessage(args: {
  host: string
  profile: string
  session: string
  message: string
  cwd?: string
  laptopName?: string
}): Promise<{ ok: boolean; reply?: string; error?: string }> {
  return new Promise((resolvePromise) => {
    // Why: prepend a machine-readable context header so the bot works on the
    // opened project folder of this exact laptop without asking. SOUL.md tells
    // it how to read this block.
    const ctxParts: string[] = []
    if (args.laptopName) ctxParts.push(`노트북=${args.laptopName}`)
    if (LAPTOP_USER) ctxParts.push(`계정=${LAPTOP_USER}`)
    if (args.cwd) ctxParts.push(`현재폴더=${args.cwd}`)
    const contextLine = ctxParts.length ? `[작업컨텍스트 ${ctxParts.join(' ')}]\n` : ''
    const fullMessage = contextLine + args.message
    const remote = `sh -lc 'hermes --profile ${args.profile} -z "$(cat)" --cli --continue ${args.session} 2>/dev/null'`
    const proc = spawn(
      'ssh',
      ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', ...SSH_MUX_ARGS, args.host, remote],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        proc.kill()
        resolvePromise({ ok: false, error: 'timeout waiting for Hermes reply' })
      }
    }, MESSAGE_TIMEOUT_MS)
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('error', (error) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolvePromise({ ok: false, error: error.message })
      }
    })
    proc.on('close', (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      const reply = stdout.trim()
      if (code === 0 && reply) {
        resolvePromise({ ok: true, reply })
      } else {
        resolvePromise({ ok: false, error: stderr.trim() || `hermes exited with code ${code}` })
      }
    })
    proc.stdin.write(fullMessage)
    proc.stdin.end()
  })
}

const CHAT_HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SAMWOO-ORCA Chat</title>
<style>
  :root {
    --bg: #101012; --panel: #18181c; --border: #2a2a30;
    --me: #2563eb; --me-text: #ffffff;
    --bot: #202027; --bot-text: #ececf1;
    --muted: #8b8b96; --accent: #8fc1ff;
  }
  /* Light palette: follows the OS/app scheme unless ?theme= forces one. */
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --bg: #f4f4f6; --panel: #ffffff; --border: #d9d9e0;
      --me: #2563eb; --me-text: #ffffff;
      --bot: #ffffff; --bot-text: #1c1c22;
      --muted: #6c6c78; --accent: #1a4fa0;
    }
  }
  :root[data-theme="light"] {
    --bg: #f4f4f6; --panel: #ffffff; --border: #d9d9e0;
    --me: #2563eb; --me-text: #ffffff;
    --bot: #ffffff; --bot-text: #1c1c22;
    --muted: #6c6c78; --accent: #1a4fa0;
  }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    background: var(--bg); color: var(--bot-text);
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif;
    display: flex; flex-direction: column;
  }
  header {
    flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
    padding: 12px 18px; border-bottom: 1px solid var(--border); background: var(--panel);
  }
  .avatar {
    width: 30px; height: 30px; border-radius: 8px; background: linear-gradient(180deg,#2b2b2b,#050505);
    color: var(--accent); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px;
  }
  .title { font-weight: 600; font-size: 14px; }
  .subtitle { color: var(--muted); font-size: 11.5px; }
  #log { flex: 1 1 auto; overflow-y: auto; padding: 20px 18px 8px; display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; }
  .row.me { justify-content: flex-end; }
  .bubble {
    max-width: 76%; padding: 9px 13px; border-radius: 14px; white-space: pre-wrap; word-break: break-word;
  }
  .me .bubble { background: var(--me); color: var(--me-text); border-bottom-right-radius: 4px; }
  .bot .bubble { background: var(--bot); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
  .bot.error .bubble { border-color: #7f1d1d; color: #fca5a5; }
  .typing { color: var(--muted); font-size: 12.5px; padding: 2px 4px; }
  .typing .dot { animation: blink 1.2s infinite; }
  .typing .dot:nth-child(2) { animation-delay: .2s; }
  .typing .dot:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%, 60%, 100% { opacity: .25 } 30% { opacity: 1 } }
  footer { flex: 0 0 auto; padding: 12px 18px 16px; background: var(--bg); }
  .composer {
    display: flex; gap: 8px; align-items: flex-end;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 8px 10px;
  }
  textarea {
    flex: 1; resize: none; border: 0; outline: 0; background: transparent; color: var(--bot-text);
    font: inherit; max-height: 140px; padding: 4px 6px;
  }
  button {
    border: 0; border-radius: 10px; background: var(--me); color: #fff; font-weight: 600;
    padding: 8px 14px; cursor: pointer; font-size: 13px;
  }
  button:disabled { opacity: .45; cursor: default; }
</style>
</head>
<body>
  <header>
    <div class="avatar">SW</div>
    <div>
      <div class="title" id="botName">Hermes</div>
      <div class="subtitle" id="botSub">SAMWOO 팀 에이전트</div>
    </div>
  </header>
  <div id="log"></div>
  <footer>
    <div class="composer">
      <textarea id="input" rows="1" placeholder="메시지를 입력하세요…"></textarea>
      <button id="send">보내기</button>
    </div>
  </footer>
<script>
  const params = new URLSearchParams(location.search)
  const profile = params.get('profile') || 'default'
  const label = params.get('label') || profile
  const host = params.get('host') || ''
  const cwd = params.get('cwd') || ''
  // Injected by the server on every /chat render so a restored tab with a
  // stale URL token still authenticates its /api/send calls.
  const t = '__ORCA_CHAT_TOKEN__'
  const theme = params.get('theme')
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme
  }
  document.getElementById('botName').textContent = label
  document.getElementById('botSub').textContent = 'SAMWOO 팀 에이전트 · ' + profile
  document.title = label + ' - SAMWOO-ORCA'

  const log = document.getElementById('log')
  const input = document.getElementById('input')
  const sendBtn = document.getElementById('send')

  function addBubble(kind, text) {
    const row = document.createElement('div')
    row.className = 'row ' + kind
    const b = document.createElement('div')
    b.className = 'bubble'
    b.textContent = text
    row.appendChild(b)
    log.appendChild(row)
    log.scrollTop = log.scrollHeight
    return row
  }
  function addTyping() {
    const el = document.createElement('div')
    el.className = 'typing'
    el.innerHTML = label + ' 응답 작성 중 <span class="dot">●</span><span class="dot">●</span><span class="dot">●</span>'
    log.appendChild(el)
    log.scrollTop = log.scrollHeight
    return el
  }

  let busy = false
  async function send() {
    const message = input.value.trim()
    if (!message || busy) return
    busy = true
    sendBtn.disabled = true
    input.value = ''
    input.style.height = 'auto'
    addBubble('me', message)
    const typing = addTyping()
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Orca-Token': t },
        body: JSON.stringify({ profile, host, message, cwd })
      })
      const data = await res.json()
      typing.remove()
      if (data.ok) {
        addBubble('bot', data.reply)
      } else {
        addBubble('bot error', '오류: ' + (data.error || '응답을 받지 못했습니다'))
      }
    } catch (e) {
      typing.remove()
      addBubble('bot error', '연결 오류: ' + e)
    }
    busy = false
    sendBtn.disabled = false
    input.focus()
  }
  sendBtn.addEventListener('click', send)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      send()
    }
  })
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 140) + 'px'
  })
  addBubble('bot', '안녕하세요! ' + label + ' 에이전트입니다. 무엇을 도와드릴까요?')
  input.focus()
</script>
</body>
</html>`

function ensureServer(): Promise<{ ok: boolean; port?: number; token?: string; error?: string }> {
  if (server && port) {
    return Promise.resolve({ ok: true, port, token })
  }
  return new Promise((resolvePromise) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/chat') {
        // Why: serve to any loopback GET and inject the CURRENT token into the
        // page, instead of gating on a token in the URL. A chat tab restored
        // from a previous session carries a stale token in its URL; requiring
        // it would 403. The server binds 127.0.0.1 only, and /api/send still
        // requires the current token, so injection keeps the send path guarded.
        const html = CHAT_HTML.replace('__ORCA_CHAT_TOKEN__', token)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/send') {
        if (req.headers['x-orca-token'] !== token) {
          res.writeHead(403).end()
          return
        }
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
          if (body.length > 256 * 1024) {
            req.destroy()
          }
        })
        req.on('end', () => {
          void (async () => {
            try {
              const parsed = JSON.parse(body) as {
                profile?: string
                host?: string
                message?: string
                cwd?: string
              }
              const profile = parsed.profile ?? ''
              const message = parsed.message ?? ''
              const host = parsed.host?.trim() || 'hermes@100.68.242.83'
              const cwd = typeof parsed.cwd === 'string' ? parsed.cwd.slice(0, 512) : ''
              if (!NAME_RE.test(profile) || !message.trim() || !/^[A-Za-z0-9@.:_-]+$/.test(host)) {
                res
                  .writeHead(400, { 'Content-Type': 'application/json' })
                  .end(JSON.stringify({ ok: false, error: 'invalid request' }))
                return
              }
              const laptopName = await getLaptopName()
              const result = await runHermesMessage({
                host,
                profile,
                session: `orca-${profile}`,
                message,
                cwd,
                laptopName
              })
              res
                .writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
                .end(JSON.stringify(result))
            } catch (error) {
              res
                .writeHead(500, { 'Content-Type': 'application/json' })
                .end(
                  JSON.stringify({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error)
                  })
                )
            }
          })()
        })
        return
      }
      res.writeHead(404).end()
    })
    let triedFixed = false
    srv.on('error', () => {
      // Why: if the fixed port is taken (another launch, or a leftover), fall
      // back to an ephemeral port once so the chat still opens this session.
      if (!triedFixed) {
        triedFixed = true
        srv.listen(0, '127.0.0.1')
      } else {
        resolvePromise({ ok: false, error: 'could not bind chat server' })
      }
    })
    const onListening = (): void => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        server = srv
        port = addr.port
        resolvePromise({ ok: true, port, token })
      } else {
        resolvePromise({ ok: false, error: 'could not bind chat server' })
      }
    }
    srv.on('listening', onListening)
    srv.listen(FIXED_PORT, '127.0.0.1')
  })
}

export function registerHermesChatServerHandlers(): void {
  ipcMain.handle('hermes:ensureChatServer', async () => ensureServer())
  // Why: start the loopback chat server eagerly at app startup so port 47821 is
  // already listening when a chat tab is restored from a previous session.
  // Without this, a restored chat tab loads before any profile launch triggers
  // the lazy start and fails with "can't reach 127.0.0.1:47821".
  void ensureServer()
}
