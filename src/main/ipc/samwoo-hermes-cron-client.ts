import { spawn } from 'node:child_process'
import type {
  RunSamwooHermesCronActionArgs,
  SamwooHermesCronJob,
  SamwooHermesCronMutationResult,
  SamwooHermesCronStatus,
  UpsertSamwooHermesCronArgs
} from '../../shared/samwoo-hermes-cron'
import {
  buildHermesCronSchedule,
  SAMWOO_SCHEDULE_PROMPT_MAX_CHARS
} from '../../shared/samwoo-schedule'
import { SAMWOO_HERMES_SSH_HOST } from '../../shared/samwoo-service-endpoints'
import { teamChatSshArgs } from './hermes-team-chat-ssh-process'

const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024
const COMMAND_TIMEOUT_MS = 30_000
const HEARTBEAT_MAX_AGE_MS = 3 * 60_000
const HEARTBEAT_FILE = '/opt/data/cron/samwoo-profile-ticker-heartbeat'

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function profileHome(profile: string): string {
  if (!PROFILE_RE.test(profile)) {
    throw new Error('Invalid Hermes profile.')
  }
  return `/opt/data/profiles/${profile}`
}

function runRemote(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('ssh', teamChatSshArgs(SAMWOO_HERMES_SSH_HOST, command), {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
      } else {
        resolve(stdout)
      }
    }
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString()
      if (Buffer.byteLength(next) > OUTPUT_LIMIT_BYTES) {
        process.kill()
        finish(new Error('Hermes cron response is too large.'))
      }
      return next
    }
    process.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    process.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    process.on('error', (error) => finish(error))
    process.on('close', (code) => {
      finish(code === 0 ? undefined : new Error(stderr.trim() || `Hermes cron exited ${code}`))
    })
    const timer = setTimeout(() => {
      process.kill()
      finish(new Error('Hermes cron command timed out.'))
    }, COMMAND_TIMEOUT_MS)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeJob(value: unknown): SamwooHermesCronJob | null {
  if (!isRecord(value) || !text(value.id)) {
    return null
  }
  const repeatError = isRecord(value.repeat) ? text(value.repeat.error) : null
  return {
    id: text(value.id)!,
    name: text(value.name) ?? text(value.prompt) ?? 'Hermes cron',
    prompt: text(value.prompt) ?? '',
    scheduleDisplay: text(value.schedule_display) ?? '',
    enabled: value.enabled !== false,
    state: text(value.state) ?? 'unknown',
    nextRunAt: text(value.next_run_at),
    lastRunAt: text(value.last_run_at),
    lastStatus: text(value.last_status),
    lastError: text(value.last_error) ?? text(value.last_delivery_error) ?? repeatError
  }
}

async function readJobs(profile: string): Promise<SamwooHermesCronJob[]> {
  const home = profileHome(profile)
  const jobsFile = `${home}/cron/jobs.json`
  const output = await runRemote(
    `sh -lc ${shellQuote(`if [ -f ${shellQuote(jobsFile)} ]; then cat -- ${shellQuote(jobsFile)}; else printf '{"jobs":[]}'; fi`)}`
  )
  const parsed = JSON.parse(output) as unknown
  const values = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.jobs)
      ? parsed.jobs
      : []
  return values.map(normalizeJob).filter((job): job is SamwooHermesCronJob => job !== null)
}

async function readHeartbeat(): Promise<{ healthy: boolean; at: string | null }> {
  const output = (
    await runRemote(
      `sh -lc ${shellQuote(`if [ -f ${shellQuote(HEARTBEAT_FILE)} ]; then cat -- ${shellQuote(HEARTBEAT_FILE)}; fi`)}`
    )
  ).trim()
  const timestamp = Number(output)
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { healthy: false, at: null }
  }
  return {
    healthy: Date.now() - timestamp * 1000 <= HEARTBEAT_MAX_AGE_MS,
    at: new Date(timestamp * 1000).toISOString()
  }
}

function jobName(scheduleId: string): string {
  if (!/^sch_[A-Za-z0-9-]+$/.test(scheduleId)) {
    throw new Error('Invalid schedule id.')
  }
  return `SAMWOO-ORCA:${scheduleId}`
}

function hermesCommand(profile: string, args: string[]): string {
  const home = profileHome(profile)
  const command = ['hermes', 'cron', ...args].map(shellQuote).join(' ')
  return `sh -lc ${shellQuote(`cd ${shellQuote(home)} && HERMES_HOME=${shellQuote(home)} ${command}`)}`
}

export async function listSamwooHermesCron(profile: string): Promise<SamwooHermesCronStatus> {
  try {
    profileHome(profile)
    const [jobs, heartbeat] = await Promise.all([readJobs(profile), readHeartbeat()])
    return {
      ok: true,
      schedulerHealthy: heartbeat.healthy,
      heartbeatAt: heartbeat.at,
      jobs: jobs.filter((job) => job.name.startsWith('SAMWOO-ORCA:'))
    }
  } catch (error) {
    return {
      ok: false,
      schedulerHealthy: false,
      heartbeatAt: null,
      jobs: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function upsertSamwooHermesCron(
  args: UpsertSamwooHermesCronArgs
): Promise<SamwooHermesCronMutationResult> {
  try {
    const prompt = args.schedule.prompt.trim()
    // Why: Hermes evaluates five-field cron in UTC; preserve the time selected on this PC.
    const cronSchedule = buildHermesCronSchedule(args.schedule, new Date().getTimezoneOffset())
    if (!prompt || prompt.length > SAMWOO_SCHEDULE_PROMPT_MAX_CHARS || !cronSchedule) {
      throw new Error('Invalid schedule.')
    }
    const name = jobName(args.schedule.id)
    const jobs = await readJobs(args.profile)
    const existing = jobs.find((job) => job.id === args.schedule.remoteJobId || job.name === name)
    const commandArgs = existing
      ? [
          'edit',
          existing.id,
          '--schedule',
          cronSchedule,
          '--prompt',
          prompt,
          '--name',
          name,
          '--deliver',
          'local'
        ]
      : ['create', cronSchedule, prompt, '--name', name, '--deliver', 'local']
    await runRemote(hermesCommand(args.profile, commandArgs))
    const [confirmedJobs, heartbeat] = await Promise.all([readJobs(args.profile), readHeartbeat()])
    const job = confirmedJobs.find((candidate) => candidate.name === name)
    if (!job) {
      throw new Error('Hermes cron registration could not be verified.')
    }
    return {
      ok: true,
      schedulerHealthy: heartbeat.healthy,
      heartbeatAt: heartbeat.at,
      job
    }
  } catch (error) {
    return {
      ok: false,
      schedulerHealthy: false,
      heartbeatAt: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function runSamwooHermesCronAction(
  args: RunSamwooHermesCronActionArgs
): Promise<SamwooHermesCronMutationResult> {
  try {
    if (!JOB_ID_RE.test(args.jobId)) {
      throw new Error('Invalid Hermes cron job id.')
    }
    const command = args.action === 'delete' ? 'remove' : args.action
    await runRemote(hermesCommand(args.profile, [command, args.jobId]))
    const [jobs, heartbeat] = await Promise.all([readJobs(args.profile), readHeartbeat()])
    const job = jobs.find((candidate) => candidate.id === args.jobId)
    if (args.action !== 'delete' && !job) {
      throw new Error('Hermes cron action could not be verified.')
    }
    return {
      ok: true,
      schedulerHealthy: heartbeat.healthy,
      heartbeatAt: heartbeat.at,
      ...(job ? { job } : {})
    }
  } catch (error) {
    return {
      ok: false,
      schedulerHealthy: false,
      heartbeatAt: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
