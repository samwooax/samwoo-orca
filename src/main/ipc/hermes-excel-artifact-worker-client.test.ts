import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: false },
  spawn: vi.fn(),
  killWithDescendantSweep: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('electron', () => ({ app: mocks.app }))
vi.mock('../pty-descendant-termination', () => ({
  killWithDescendantSweep: mocks.killWithDescendantSweep
}))

import {
  cancelExcelArtifactWorker,
  HERMES_OFFICE_PREVIEW_WORKER_TIMEOUT_MS,
  runHermesOfficePreviewWorker,
  runOfficeDocumentWorker,
  verifyExcelArtifactWorkerBundle
} from './hermes-excel-artifact-worker-client'

type FakeWorker = EventEmitter & {
  pid: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { end: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

function fakeWorker(pid: number): FakeWorker {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { end: vi.fn() },
    kill: vi.fn(() => true)
  })
}

function closeWorker(worker: FakeWorker, code = 1): void {
  worker.exitCode = code
  worker.emit('close', code)
}

beforeEach(() => {
  mocks.app.isPackaged = false
  mocks.spawn.mockReset()
  mocks.killWithDescendantSweep.mockReset().mockImplementation(async (_pid, killRoot) => {
    killRoot()
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Hermes Excel Artifact worker termination', () => {
  it('cancels through the descendant sweep before killing the worker root', async () => {
    const worker = fakeWorker(4_242)
    mocks.spawn.mockReturnValue(worker)
    const pending = runOfficeDocumentWorker('cancel-tree', {})

    expect(cancelExcelArtifactWorker('cancel-tree')).toBe(true)
    expect(mocks.killWithDescendantSweep).toHaveBeenCalledOnce()
    const [pid, killRoot, options] = mocks.killWithDescendantSweep.mock.calls[0] as [
      number,
      () => void,
      { ownsRoot: () => boolean }
    ]
    expect(pid).toBe(4_242)
    expect(options.ownsRoot()).toBe(true)
    expect(worker.kill).toHaveBeenCalledWith('SIGKILL')

    closeWorker(worker)
    await expect(pending).rejects.toThrow('Excel Artifact worker was cancelled')
    expect(options.ownsRoot()).toBe(false)
    killRoot()
    expect(worker.kill).toHaveBeenCalledOnce()
  })

  it('uses the descendant sweep when the worker times out', async () => {
    vi.useFakeTimers()
    const worker = fakeWorker(8_484)
    mocks.spawn.mockReturnValue(worker)
    const pending = runOfficeDocumentWorker('timeout-tree', {}, 25)
    const rejection = expect(pending).rejects.toThrow('Excel Artifact worker timed out')

    await vi.advanceTimersByTimeAsync(25)

    expect(mocks.killWithDescendantSweep).toHaveBeenCalledWith(
      8_484,
      expect.any(Function),
      expect.objectContaining({ ownsRoot: expect.any(Function) })
    )
    expect(worker.kill).toHaveBeenCalledWith('SIGKILL')
    closeWorker(worker)
    await rejection
  })

  it('settles cancellation only after root close and the descendant sweep', async () => {
    let finishSweep = (): void => {}
    mocks.killWithDescendantSweep.mockImplementation(
      (_pid: number, killRoot: () => void) =>
        new Promise<void>((resolve) => {
          finishSweep = () => {
            killRoot()
            resolve()
          }
        })
    )
    const worker = fakeWorker(12_726)
    mocks.spawn.mockReturnValue(worker)
    const pending = runOfficeDocumentWorker('ordered-cancel', {})
    let settled = false
    void pending.catch(() => {
      settled = true
    })

    expect(cancelExcelArtifactWorker('ordered-cancel')).toBe(true)
    closeWorker(worker)
    expect(cancelExcelArtifactWorker('ordered-cancel')).toBe(false)
    await Promise.resolve()
    expect(settled).toBe(false)

    finishSweep()
    await expect(pending).rejects.toThrow('Excel Artifact worker was cancelled')
    expect(settled).toBe(true)
  })
})

describe('Hermes Office preview worker lifecycle', () => {
  it('keeps cleanup headroom inside the 270 second bridge deadline', () => {
    expect(HERMES_OFFICE_PREVIEW_WORKER_TIMEOUT_MS).toBe(160_000)
    expect(HERMES_OFFICE_PREVIEW_WORKER_TIMEOUT_MS).toBeLessThan(270_000)
  })

  it('does not spawn when its request signal was already cancelled', async () => {
    const abort = new AbortController()
    abort.abort()

    await expect(
      runHermesOfficePreviewWorker({
        requestId: 'pre-cancelled-preview',
        sourcePath: 'report.xlsx',
        kind: 'xlsx',
        startIndex: 1,
        count: 4,
        signal: abort.signal
      })
    ).rejects.toThrow('cancelled')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('cancels a cold capability worker without spawning the preview worker', async () => {
    const resourcesRoot = await mkdtemp(join(tmpdir(), 'orca-worker-client-resources-'))
    const previousResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    const root = join(resourcesRoot, 'hermes-excel-artifact-worker')
    const executableName =
      process.platform === 'win32' ? 'orca-excel-artifact-worker.exe' : 'orca-excel-artifact-worker'
    const executable = join(root, executableName)
    const payload = 'capability worker'
    try {
      await mkdir(root)
      await writeFile(executable, payload)
      await writeFile(
        join(root, 'manifest.json'),
        JSON.stringify({
          [executableName]: createHash('sha256').update(payload).digest('hex')
        })
      )
      Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: resourcesRoot
      })
      mocks.app.isPackaged = true
      const worker = fakeWorker(16_968)
      mocks.spawn.mockReturnValue(worker)
      const abort = new AbortController()
      const pending = runHermesOfficePreviewWorker({
        requestId: 'cold-capability-cancel',
        sourcePath: 'report.xlsx',
        kind: 'xlsx',
        startIndex: 1,
        count: 4,
        signal: abort.signal
      })
      const rejection = expect(pending).rejects.toThrow('cancelled')
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())

      abort.abort()
      await vi.waitFor(() => expect(mocks.killWithDescendantSweep).toHaveBeenCalledOnce())
      closeWorker(worker)
      await rejection
      expect(mocks.spawn).toHaveBeenCalledOnce()
    } finally {
      mocks.app.isPackaged = false
      if (previousResourcesPath) {
        Object.defineProperty(process, 'resourcesPath', previousResourcesPath)
      } else {
        Reflect.deleteProperty(process, 'resourcesPath')
      }
      await rm(resourcesRoot, { recursive: true, force: true })
    }
  })
})

describe('Hermes Excel Artifact worker manifest', () => {
  it('verifies nested manifest files like every other bundle file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-worker-client-manifest-'))
    const nested = join(root, 'nested')
    const payload = 'nested manifest'
    try {
      await mkdir(nested)
      await writeFile(join(nested, 'manifest.json'), payload)
      await writeFile(
        join(root, 'manifest.json'),
        JSON.stringify({
          'nested/manifest.json': createHash('sha256').update(payload).digest('hex')
        })
      )
      await expect(verifyExcelArtifactWorkerBundle(root)).resolves.toBeUndefined()
      const abort = new AbortController()
      abort.abort()
      await expect(verifyExcelArtifactWorkerBundle(root, abort.signal)).rejects.toMatchObject({
        name: 'AbortError'
      })
      await writeFile(join(nested, 'manifest.json'), 'mutated')
      await expect(verifyExcelArtifactWorkerBundle(root)).rejects.toThrow('integrity check failed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
