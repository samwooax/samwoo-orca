import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import type { Store } from '../persistence'
import { getHermesTeamChatPage } from './hermes-team-chat-page'
import {
  normalizeTeamChatHistory,
  resolveTeamChatEffort,
  resolveTeamChatModel
} from './hermes-team-chat-models'
import {
  cancelTeamChatMessage,
  closeAllTeamChatConversations,
  closeTeamChatConversation,
  runTeamChatMessage
} from './hermes-team-chat-runner'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type { TeamChatAttachment } from '../../shared/hermes-team-chat-attachments'
import { registerHermesTeamChatAppCleanup } from './hermes-team-chat-app-cleanup'
import { isValidTeamChatSshHost } from './hermes-team-chat-ssh-process'

const NAME_RE = /^[A-Za-z0-9._-]+$/
const MAIL_TOKEN_RE = /^[A-Za-z0-9._-]{1,256}$/
const FIXED_PORT = 47821
const MAX_BODY_BYTES = 768 * 1024
const MAX_ATTACHMENT_CHARS = 96_000

let server: Server | null = null
let port = 0

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

type TeamChatResult = { ok: boolean; reply?: string; error?: string }

function normalizeAttachments(value: unknown): TeamChatAttachment[] {
  if (!Array.isArray(value)) {
    return []
  }
  let remaining = MAX_ATTACHMENT_CHARS
  const result: TeamChatAttachment[] = []
  for (const item of value.slice(0, 5)) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as TeamChatAttachment).name !== 'string'
    ) {
      continue
    }
    const attachment = item as {
      kind?: unknown
      name: string
      content?: unknown
      path?: unknown
    }
    const name = attachment.name.replaceAll(/[\r\n[\]]/g, '').slice(0, 160)
    if (
      attachment.kind === 'image' &&
      typeof attachment.path === 'string' &&
      attachment.path.length <= 1024
    ) {
      result.push({ kind: 'image', name, path: attachment.path })
      continue
    }
    if (
      (attachment.kind !== undefined && attachment.kind !== 'text') ||
      typeof attachment.content !== 'string' ||
      remaining <= 0
    ) {
      continue
    }
    const content = attachment.content.slice(0, remaining)
    remaining -= content.length
    result.push({ kind: 'text', name, content })
  }
  return result
}

function appendAttachments(message: string, attachments: TeamChatAttachment[]): string {
  if (!attachments.length) {
    return message
  }
  const blocks = attachments
    .filter((attachment) => attachment.kind === 'text')
    .map((attachment) => `[첨부파일: ${attachment.name}]\n${attachment.content}\n[첨부파일 끝]`)
  return `${message}${message ? '\n\n' : ''}${blocks.join('\n\n')}`
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
      if (body.length > MAX_BODY_BYTES) {
        rejectBody(new Error('request too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolveBody(body))
    req.on('error', rejectBody)
  })
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res
    .writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    .end(JSON.stringify(value))
}

async function handleSend(req: IncomingMessage, res: ServerResponse, store: Store): Promise<void> {
  try {
    const parsed = JSON.parse(await readRequestBody(req)) as Record<string, unknown>
    const result = await handleTeamChatRequest(parsed, store)
    writeJson(res, result.ok || result.error !== 'invalid request' ? 200 : 400, result)
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function handleTeamChatRequest(
  parsed: Record<string, unknown>,
  store: Store,
  onProgress?: (event: TeamChatProgressEvent) => void
): Promise<TeamChatResult> {
  const profile = typeof parsed.profile === 'string' ? parsed.profile : ''
  const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : ''
  const conversationId =
    typeof parsed.conversationId === 'string' ? parsed.conversationId : requestId
  const host =
    typeof parsed.host === 'string' && parsed.host.trim()
      ? parsed.host.trim()
      : 'hermes@100.68.242.83'
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd.slice(0, 512) : ''
  const message = typeof parsed.message === 'string' ? parsed.message.slice(0, 96_000) : ''
  const attachments = normalizeAttachments(parsed.attachments)
  if (
    !NAME_RE.test(profile) ||
    !NAME_RE.test(requestId) ||
    !NAME_RE.test(conversationId) ||
    !isValidTeamChatSshHost(host) ||
    (!message.trim() && !attachments.length)
  ) {
    return { ok: false, error: 'invalid request' }
  }
  const model = resolveTeamChatModel(parsed.model)
  const effort = resolveTeamChatEffort(model.id, parsed.effort)
  const mailToken =
    typeof parsed.mailtoken === 'string' && MAIL_TOKEN_RE.test(parsed.mailtoken)
      ? parsed.mailtoken
      : undefined
  return runTeamChatMessage({
    requestId,
    conversationId,
    host,
    profile,
    modelId: model.id,
    effort,
    message: appendAttachments(message, attachments),
    imageAttachments: attachments.filter((attachment) => attachment.kind === 'image'),
    history: normalizeTeamChatHistory(parsed.history),
    cwd,
    store,
    mailToken,
    onProgress
  })
}

async function handleCancel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const parsed = JSON.parse(await readRequestBody(req)) as { requestId?: unknown }
    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : ''
    const cancelled = NAME_RE.test(requestId) && (await cancelTeamChatMessage(requestId))
    writeJson(res, 200, { ok: true, cancelled })
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function handleCloseConversation(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const parsed = JSON.parse(await readRequestBody(req)) as { conversationId?: unknown }
    const conversationId = typeof parsed.conversationId === 'string' ? parsed.conversationId : ''
    const closed = NAME_RE.test(conversationId)
      ? await closeTeamChatConversation(conversationId)
      : false
    writeJson(res, 200, { ok: true, closed })
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

function ensureServer(
  store: Store
): Promise<{ ok: boolean; port?: number; token?: string; error?: string }> {
  if (server && port) {
    return Promise.resolve({ ok: true, port, token })
  }
  return new Promise((resolvePromise) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/chat') {
        res
          .writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy':
              "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'"
          })
          .end(getHermesTeamChatPage(token))
        return
      }
      if (
        req.method === 'POST' &&
        ['/api/send', '/api/cancel', '/api/close'].includes(url.pathname)
      ) {
        if (req.headers['x-orca-token'] !== token) {
          res.writeHead(403).end()
          return
        }
        void (url.pathname === '/api/send'
          ? handleSend(req, res, store)
          : url.pathname === '/api/cancel'
            ? handleCancel(req, res)
            : handleCloseConversation(req, res))
        return
      }
      res.writeHead(404).end()
    })
    let triedFixed = false
    srv.on('error', () => {
      // Why: a restored chat still needs a live server when another launch holds the fixed port.
      if (!triedFixed) {
        triedFixed = true
        srv.listen(0, '127.0.0.1')
      } else {
        resolvePromise({ ok: false, error: 'could not bind chat server' })
      }
    })
    srv.on('listening', () => {
      const address = srv.address()
      if (address && typeof address === 'object') {
        server = srv
        port = address.port
        resolvePromise({ ok: true, port, token })
      } else {
        resolvePromise({ ok: false, error: 'could not bind chat server' })
      }
    })
    srv.listen(FIXED_PORT, '127.0.0.1')
  })
}

export function registerHermesChatServerHandlers(store: Store): void {
  ipcMain.handle('hermes:ensureChatServer', async () => ensureServer(store))
  ipcMain.handle('hermes:sendTeamChat', async (event, input: unknown) =>
    input && typeof input === 'object'
      ? handleTeamChatRequest(input as Record<string, unknown>, store, (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('hermes:teamChatProgress', progress)
          }
        })
      : { ok: false, error: 'invalid request' }
  )
  ipcMain.handle('hermes:cancelTeamChat', async (_event, requestId: unknown) => {
    const cancelled =
      typeof requestId === 'string' && NAME_RE.test(requestId)
        ? await cancelTeamChatMessage(requestId)
        : false
    return { ok: true, cancelled }
  })
  ipcMain.handle('hermes:closeTeamChatConversation', async (_event, conversationId: unknown) => {
    const closed =
      typeof conversationId === 'string' && NAME_RE.test(conversationId)
        ? await closeTeamChatConversation(conversationId)
        : false
    return { ok: true, closed }
  })
  registerHermesTeamChatAppCleanup(app, closeAllTeamChatConversations)
  // Why: restored chat tabs load before profile launch can start the server lazily.
  void ensureServer(store)
}
