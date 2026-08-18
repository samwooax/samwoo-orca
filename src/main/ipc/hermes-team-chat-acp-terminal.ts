import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { stat } from 'node:fs/promises'
import type { Store } from '../persistence'
import { resolveAuthorizedPath } from './filesystem-auth'
import { resolveHermesAcpTerminalDirectory } from './hermes-team-chat-acp-terminal-directory'
import { HermesAcpTerminalOutputBuffer } from './hermes-team-chat-acp-terminal-output'
import {
  parseHermesAcpTerminalCreateRequest,
  requireHermesAcpTerminalId
} from './hermes-team-chat-acp-terminal-request'
import { resolveHermesAcpTerminalInvocation } from './hermes-team-chat-acp-terminal-shell'
import type { AcpJsonRecord } from './hermes-team-chat-acp-values'

const MAX_ACTIVE_TERMINALS = 4
const MAX_TERMINAL_RECORDS = 16
const MAX_BACKGROUND_LIFETIME_MS = 30 * 60 * 1_000

type TerminalExit = { exitCode: number | null; signal: string | null }

type TerminalRecord = {
  id: string
  child: ChildProcessWithoutNullStreams
  generation: number
  background: boolean
  output: HermesAcpTerminalOutputBuffer
  exited: boolean
  exit: TerminalExit
  exitPromise: Promise<TerminalExit>
  resolveExit: (exit: TerminalExit) => void
  timeout: ReturnType<typeof setTimeout>
  termination: Promise<void> | null
  terminationReason: string | null
}

type ApproveTerminalCommand = (command: string, cwd: string) => Promise<boolean>

export class HermesAcpTerminal {
  private readonly records = new Map<string, TerminalRecord>()
  private approvalQueueTail = Promise.resolve()
  private pendingCreates = 0
  private closing = false
  private closePromise: Promise<void> | null = null

  private constructor(
    private readonly projectRoot: string,
    private readonly store: Store,
    private readonly approve: ApproveTerminalCommand
  ) {}

  static async create(args: {
    cwd: string
    store: Store
    approve: ApproveTerminalCommand
  }): Promise<HermesAcpTerminal> {
    const projectRoot = await resolveAuthorizedPath(args.cwd, args.store)
    if (!(await stat(projectRoot)).isDirectory()) {
      throw new Error('selected project root is not a directory')
    }
    return new HermesAcpTerminal(projectRoot, args.store, args.approve)
  }

  isSupportedMethod(method: unknown): method is string {
    return (
      method === 'terminal/create' ||
      method === 'terminal/output' ||
      method === 'terminal/wait_for_exit' ||
      method === 'terminal/kill' ||
      method === 'terminal/release'
    )
  }

  async handle(
    method: string,
    params: AcpJsonRecord,
    generation: number,
    canContinue: () => boolean,
    signal: AbortSignal
  ): Promise<unknown> {
    if (method === 'terminal/create') {
      return this.createTerminal(params, generation, canContinue)
    }
    const record = this.requireRecord(requireHermesAcpTerminalId(params))
    if (method === 'terminal/output') {
      return this.terminalOutput(record)
    }
    if (method === 'terminal/wait_for_exit') {
      return this.waitForExit(record, signal)
    }
    if (method === 'terminal/kill') {
      await this.terminate(record, 'killed')
      return null
    }
    if (method === 'terminal/release') {
      await this.terminate(record, 'released')
      this.records.delete(record.id)
      return null
    }
    throw new Error('ACP terminal method is not supported')
  }

  endGeneration(generation: number): void {
    for (const record of this.records.values()) {
      if (record.generation === generation && !record.background) {
        if (record.exited) {
          this.records.delete(record.id)
        } else {
          void this.terminate(record, 'turn-ended')
        }
      }
    }
  }

  cancelGeneration(generation: number): void {
    for (const record of this.records.values()) {
      if (record.generation === generation && !record.exited) {
        void this.terminate(record, 'cancelled')
      }
    }
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closing = true
      this.closePromise = Promise.all(
        [...this.records.values()].map((record) => this.terminate(record, 'closed'))
      ).then(() => {
        this.records.clear()
      })
    }
    return this.closePromise
  }

  private async createTerminal(
    params: AcpJsonRecord,
    generation: number,
    canContinue: () => boolean
  ): Promise<{ terminalId: string }> {
    this.pruneFinishedRecords()
    if (this.closing || this.liveTerminalCount() + this.pendingCreates >= MAX_ACTIVE_TERMINALS) {
      throw new Error('ACP terminal capacity is reached')
    }
    if (this.records.size + this.pendingCreates >= MAX_TERMINAL_RECORDS) {
      throw new Error('ACP terminal record capacity is reached')
    }
    this.pendingCreates += 1
    try {
      return await this.createReservedTerminal(params, generation, canContinue)
    } finally {
      this.pendingCreates -= 1
    }
  }

  private async createReservedTerminal(
    params: AcpJsonRecord,
    generation: number,
    canContinue: () => boolean
  ): Promise<{ terminalId: string }> {
    const request = parseHermesAcpTerminalCreateRequest(params)
    const root = await resolveHermesAcpTerminalDirectory({
      projectRoot: this.projectRoot,
      virtualCwd: request.virtualCwd,
      store: this.store
    })
    if (
      !(await this.approveSerially(request.command, root, canContinue)) ||
      !canContinue() ||
      this.closing
    ) {
      throw new Error('local terminal command was denied or cancelled')
    }
    const invocation = resolveHermesAcpTerminalInvocation({
      commandText: request.command,
      root,
      store: this.store
    })
    if (!canContinue()) {
      throw new Error('local terminal command was denied or cancelled')
    }
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      detached: process.platform !== 'win32',
      shell: false,
      windowsHide: true,
      ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {})
    })
    const record = this.trackTerminal(child, generation, request)
    child.stdin.on('error', () => {})
    child.stdin.end()
    return { terminalId: record.id }
  }

  private trackTerminal(
    child: ChildProcessWithoutNullStreams,
    generation: number,
    request: { background: boolean; outputByteLimit: unknown; timeoutSeconds: number }
  ): TerminalRecord {
    let resolveExit = (_exit: TerminalExit): void => {}
    const exitPromise = new Promise<TerminalExit>((resolve) => {
      resolveExit = resolve
    })
    const record = {
      id: randomUUID(),
      child,
      generation,
      background: request.background,
      output: new HermesAcpTerminalOutputBuffer(request.outputByteLimit),
      exited: false,
      exit: { exitCode: null, signal: null },
      exitPromise,
      resolveExit,
      timeout: setTimeout(() => {}, 0),
      termination: null,
      terminationReason: null
    } satisfies TerminalRecord
    clearTimeout(record.timeout)
    const lifetimeMs = request.background
      ? MAX_BACKGROUND_LIFETIME_MS
      : request.timeoutSeconds * 1_000
    record.timeout = setTimeout(() => void this.terminate(record, 'timeout'), lifetimeMs)
    record.timeout.unref?.()
    this.records.set(record.id, record)
    child.stdout.on('data', (chunk: Buffer) => record.output.append(chunk))
    child.stderr.on('data', (chunk: Buffer) => record.output.append(chunk))
    child.on('error', () => this.finish(record, null, 'spawn-error'))
    child.on('close', (exitCode, signal) => this.finish(record, exitCode, signal))
    return record
  }

  private finish(record: TerminalRecord, exitCode: number | null, signal: string | null): void {
    if (record.exited) {
      return
    }
    record.exited = true
    clearTimeout(record.timeout)
    record.exit = {
      exitCode,
      signal: record.terminationReason ?? signal
    }
    record.resolveExit(record.exit)
  }

  private terminalOutput(record: TerminalRecord): AcpJsonRecord {
    return {
      ...record.output.snapshot(),
      exitStatus: record.exited ? record.exit : null
    }
  }

  private waitForExit(record: TerminalRecord, signal: AbortSignal): Promise<TerminalExit> {
    if (record.exited) {
      return Promise.resolve(record.exit)
    }
    return new Promise((resolve, reject) => {
      const cancel = () => reject(new Error('ACP terminal request was cancelled'))
      signal.addEventListener('abort', cancel, { once: true })
      void record.exitPromise.then((exit) => {
        signal.removeEventListener('abort', cancel)
        resolve(exit)
      })
    })
  }

  private terminate(record: TerminalRecord, reason: string): Promise<void> {
    if (record.exited || record.termination) {
      return record.termination ?? Promise.resolve()
    }
    record.terminationReason = reason
    const pid = record.child.pid
    const termination = pid
      ? import('../pty-descendant-termination').then(({ killWithDescendantSweep }) =>
          killWithDescendantSweep(pid, () => void record.child.kill('SIGKILL'), {
            ownsRoot: () => this.records.get(record.id) === record && !record.exited
          })
        )
      : Promise.resolve().then(() => void record.child.kill('SIGKILL'))
    record.termination = termination
    return termination
  }

  private async approveSerially(
    command: string,
    root: string,
    canContinue: () => boolean
  ): Promise<boolean> {
    const previous = this.approvalQueueTail
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    this.approvalQueueTail = previous.catch(() => {}).then(() => gate)
    await previous.catch(() => {})
    try {
      return !this.closing && canContinue() && (await this.approve(command, root))
    } finally {
      release()
    }
  }

  private requireRecord(id: string): TerminalRecord {
    const record = this.records.get(id)
    if (!record) {
      throw new Error('ACP terminal does not exist')
    }
    return record
  }

  private liveTerminalCount(): number {
    return [...this.records.values()].filter((record) => !record.exited).length
  }

  private pruneFinishedRecords(): void {
    for (const [id, record] of this.records) {
      if (this.records.size < MAX_TERMINAL_RECORDS) {
        return
      }
      if (record.exited) {
        this.records.delete(id)
      }
    }
  }
}
