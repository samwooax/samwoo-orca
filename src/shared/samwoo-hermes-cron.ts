import type { SamwooSchedule } from './samwoo-schedule'

export type SamwooHermesCronJob = {
  id: string
  name: string
  prompt: string
  scheduleDisplay: string
  enabled: boolean
  state: string
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
}

export type SamwooHermesCronStatus = {
  ok: boolean
  schedulerHealthy: boolean
  heartbeatAt: string | null
  jobs: SamwooHermesCronJob[]
  error?: string
}

export type SamwooHermesCronMutationResult = {
  ok: boolean
  schedulerHealthy: boolean
  heartbeatAt: string | null
  job?: SamwooHermesCronJob
  error?: string
}

export type UpsertSamwooHermesCronArgs = {
  profile: string
  schedule: SamwooSchedule
}

export type SamwooHermesCronAction = 'pause' | 'resume' | 'run' | 'delete'

export type RunSamwooHermesCronActionArgs = {
  profile: string
  jobId: string
  action: SamwooHermesCronAction
}
