import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { assertClipboardImageByteLengthWithinLimit } from '../../shared/clipboard-image'
import type { TeamChatImageAttachment } from '../../shared/hermes-team-chat-attachments'

const TRANSFER_TIMEOUT_MS = 60_000
const CLEANUP_TIMEOUT_MS = 15_000
const REQUEST_ID_RE = /^[A-Za-z0-9._-]+$/
const CLIPBOARD_IMAGE_RE = /^orca-paste-[A-Za-z0-9._-]+\.png$/i

export type RemoteTeamChatImage = {
  name: string
  path: string
}

type ImageTransferArgs = {
  requestId: string
  attachments: TeamChatImageAttachment[]
  sshArgs: (remoteCommand: string) => string[]
  onProcess: (process: ChildProcessWithoutNullStreams | null) => void
}

function runSshTransfer(args: {
  sshArgs: string[]
  input?: Buffer
  timeoutMs: number
  onProcess?: (process: ChildProcessWithoutNullStreams | null) => void
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn('ssh', args.sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
    args.onProcess?.(process)
    let stderr = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      args.onProcess?.(null)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const timer = setTimeout(() => {
      process.kill()
      finish(new Error('이미지 전송 시간이 초과됐습니다.'))
    }, args.timeoutMs)
    process.stderr.on('data', (data: Buffer) => {
      stderr = `${stderr}${data.toString()}`.slice(-2000)
    })
    process.stdin.on('error', () => {})
    process.on('error', (error) => finish(error))
    process.on('close', (code) =>
      finish(code === 0 ? undefined : new Error(stderr.trim() || `이미지 전송 실패: ${code}`))
    )
    process.stdin.end(args.input)
  })
}

async function readAuthorizedClipboardImage(filePath: string): Promise<Buffer> {
  const tempRoot = await realpath(app.getPath('temp'))
  const resolved = await realpath(filePath)
  const relative = path.relative(tempRoot, resolved)
  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    relative.includes(path.sep) ||
    !CLIPBOARD_IMAGE_RE.test(path.basename(resolved))
  ) {
    throw new Error('허용되지 않은 이미지 첨부 경로입니다.')
  }
  const fileStat = await stat(resolved)
  if (!fileStat.isFile()) {
    throw new Error('이미지 첨부파일을 찾을 수 없습니다.')
  }
  assertClipboardImageByteLengthWithinLimit(fileStat.size)
  return readFile(resolved)
}

export async function uploadTeamChatClipboardImages({
  requestId,
  attachments,
  sshArgs,
  onProcess
}: ImageTransferArgs): Promise<RemoteTeamChatImage[]> {
  if (attachments.length === 0) {
    return []
  }
  if (!REQUEST_ID_RE.test(requestId)) {
    throw new Error('잘못된 이미지 요청 ID입니다.')
  }
  const remoteDir = `/tmp/samwoo-orca-chat-${requestId}`
  const uploaded: RemoteTeamChatImage[] = []
  let totalBytes = 0
  try {
    for (const [index, attachment] of attachments.slice(0, 5).entries()) {
      const buffer = await readAuthorizedClipboardImage(attachment.path)
      totalBytes += buffer.byteLength
      assertClipboardImageByteLengthWithinLimit(totalBytes)
      const remotePath = `${remoteDir}/image-${index + 1}.png`
      const remoteCommand = `umask 077; mkdir -p '${remoteDir}'; cat > '${remotePath}'`
      await runSshTransfer({
        sshArgs: sshArgs(remoteCommand),
        input: buffer,
        timeoutMs: TRANSFER_TIMEOUT_MS,
        onProcess
      })
      uploaded.push({ name: attachment.name, path: remotePath })
    }
    return uploaded
  } catch (error) {
    await cleanupTeamChatClipboardImages(requestId, sshArgs).catch(() => {})
    throw error
  }
}

export async function cleanupTeamChatClipboardImages(
  requestId: string,
  sshArgs: (remoteCommand: string) => string[]
): Promise<void> {
  if (!REQUEST_ID_RE.test(requestId)) {
    return
  }
  const remoteDir = `/tmp/samwoo-orca-chat-${requestId}`
  await runSshTransfer({
    sshArgs: sshArgs(`rm -rf -- '${remoteDir}'`),
    timeoutMs: CLEANUP_TIMEOUT_MS
  })
}

export function appendRemoteImageInstructions(
  message: string,
  images: RemoteTeamChatImage[]
): string {
  if (images.length === 0) {
    return message
  }
  const imageList = images.map((image) => `- ${image.name}: ${image.path}`).join('\n')
  const instruction =
    `[첨부 이미지]\n${imageList}\n` +
    '위 이미지 파일을 이미지 읽기 도구로 직접 열어 확인한 뒤 답변하세요.\n[첨부 이미지 끝]'
  return `${message}${message ? '\n\n' : ''}${instruction}`
}
