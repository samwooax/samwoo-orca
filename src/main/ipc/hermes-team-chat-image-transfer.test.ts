import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  realpath: vi.fn(),
  spawn: vi.fn(),
  stat: vi.fn()
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  realpath: mocks.realpath,
  stat: mocks.stat
}))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

import {
  appendRemoteImageInstructions,
  uploadTeamChatClipboardImages
} from './hermes-team-chat-image-transfer'

type FakeProcess = EventEmitter & {
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function fakeProcess(): FakeProcess {
  const process = new EventEmitter() as FakeProcess
  process.stdout = new EventEmitter()
  process.stderr = new EventEmitter()
  process.kill = vi.fn()
  process.stdin = new EventEmitter() as FakeProcess['stdin']
  process.stdin.end = vi.fn(() => queueMicrotask(() => process.emit('close', 0)))
  return process
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.realpath.mockImplementation(async (value: string) => value)
  mocks.stat.mockResolvedValue({ isFile: () => true, size: 3 })
  mocks.readFile.mockResolvedValue(Buffer.from('png'))
  mocks.spawn.mockImplementation(() => fakeProcess())
})

describe('Hermes team chat image transfer', () => {
  it('uploads only an authorized clipboard temp image to a request-scoped remote path', async () => {
    const commands: string[] = []
    const onProcess = vi.fn()
    const result = await uploadTeamChatClipboardImages({
      requestId: 'request-1',
      attachments: [{ kind: 'image', name: 'pasted-image.png', path: '/tmp/orca-paste-1-id.png' }],
      sshArgs: (command) => {
        commands.push(command)
        return ['hermes@example', command]
      },
      onProcess
    })

    expect(result).toEqual([
      {
        name: 'pasted-image.png',
        path: '/tmp/samwoo-orca-chat-request-1/image-1.png'
      }
    ])
    expect(commands).toEqual([
      "umask 077; mkdir -p '/tmp/samwoo-orca-chat-request-1'; cat > '/tmp/samwoo-orca-chat-request-1/image-1.png'"
    ])
    expect(mocks.readFile).toHaveBeenCalledWith('/tmp/orca-paste-1-id.png')
    const process = mocks.spawn.mock.results[0]?.value as FakeProcess
    expect(process.stdin.end).toHaveBeenCalledWith(Buffer.from('png'))
    expect(onProcess).toHaveBeenNthCalledWith(1, process)
    expect(onProcess).toHaveBeenLastCalledWith(null)
  })

  it('rejects a renderer-supplied path outside the clipboard temp directory', async () => {
    await expect(
      uploadTeamChatClipboardImages({
        requestId: 'request-2',
        attachments: [
          { kind: 'image', name: 'secret.png', path: '/Users/alice/orca-paste-secret.png' }
        ],
        sshArgs: (command) => ['hermes@example', command],
        onProcess: () => {}
      })
    ).rejects.toThrow('허용되지 않은 이미지 첨부 경로')

    expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it('adds remote image paths without exposing the laptop temp path', () => {
    const result = appendRemoteImageInstructions('이 화면을 확인해줘', [
      { name: 'pasted-image.png', path: '/tmp/samwoo-orca-chat-request-1/image-1.png' }
    ])

    expect(result).toContain('이 화면을 확인해줘')
    expect(result).toContain('/tmp/samwoo-orca-chat-request-1/image-1.png')
    expect(result).toContain('이미지 읽기 도구로 직접 열어')
    expect(result).not.toContain('C:\\Users')
  })
})
