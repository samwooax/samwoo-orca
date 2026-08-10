import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()
const processResults: { stdout: string; stderr: string; code: number }[] = []

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('./hermes-team-chat-ssh-process', () => ({
  teamChatSshArgs: (host: string, remote: string) => [host, remote]
}))

function enqueueProcess(stdout: string, stderr = '', code = 0): void {
  processResults.push({ stdout, stderr, code })
}

function createProcess() {
  const result = processResults.shift()
  if (!result) {
    throw new Error('Missing mocked SSH result.')
  }
  const process = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  process.stdout = new EventEmitter()
  process.stderr = new EventEmitter()
  process.kill = vi.fn()
  queueMicrotask(() => {
    if (result.stdout) {
      process.stdout.emit('data', Buffer.from(result.stdout))
    }
    if (result.stderr) {
      process.stderr.emit('data', Buffer.from(result.stderr))
    }
    process.emit('close', result.code)
  })
  return process
}

const schedule = {
  id: 'sch_123e4567-e89b-12d3-a456-426614174000',
  prompt: "check today's mail",
  time: '08:00',
  days: [],
  frequency: 'minutes' as const,
  interval: 5,
  remoteJobId: null,
  enabled: true,
  createdAt: 1
}

describe('SAMWOO Hermes cron client', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    processResults.length = 0
    spawnMock.mockImplementation(createProcess)
  })

  it('creates and then verifies a profile-scoped five-minute Hermes cron job', async () => {
    enqueueProcess('{"jobs":[]}')
    enqueueProcess('Created job: abc123\n')
    enqueueProcess(
      JSON.stringify({
        jobs: [
          {
            id: 'abc123',
            name: `SAMWOO-ORCA:${schedule.id}`,
            prompt: schedule.prompt,
            schedule_display: 'Every 5 minutes',
            enabled: true,
            state: 'scheduled',
            next_run_at: '2026-08-10T06:00:00+00:00'
          }
        ]
      })
    )
    enqueueProcess(String(Math.floor(Date.now() / 1000)))

    const { upsertSamwooHermesCron } = await import('./samwoo-hermes-cron-client')
    const result = await upsertSamwooHermesCron({ profile: 'ai_center', schedule })

    expect(result).toMatchObject({
      ok: true,
      schedulerHealthy: true,
      job: { id: 'abc123', scheduleDisplay: 'Every 5 minutes' }
    })
    const mutationCommand = spawnMock.mock.calls[1][1].at(-1) as string
    expect(mutationCommand).toContain('HERMES_HOME=')
    expect(mutationCommand).toContain('ai_center')
    expect(mutationCommand).toContain('cron')
    expect(mutationCommand).toContain('create')
    expect(mutationCommand).toContain('every 5m')
  })

  it('fails closed for an invalid renderer-authored profile', async () => {
    const { listSamwooHermesCron } = await import('./samwoo-hermes-cron-client')
    await expect(listSamwooHermesCron('../other')).resolves.toMatchObject({ ok: false })
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
