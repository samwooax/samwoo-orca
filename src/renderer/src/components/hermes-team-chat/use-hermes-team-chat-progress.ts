import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { TeamChatProgressEvent } from '../../../../shared/hermes-team-chat-progress'

const MAX_PROGRESS_EVENTS = 40
export type HermesTeamChatProgressOutcome = 'completed' | 'failed' | 'cancelled' | null

export function upsertTeamChatProgress(
  current: TeamChatProgressEvent[],
  event: TeamChatProgressEvent
): TeamChatProgressEvent[] {
  const index = current.findIndex((item) => item.id === event.id)
  if (index < 0) {
    return [...current, event].slice(-MAX_PROGRESS_EVENTS)
  }
  const next = current.slice()
  next[index] = { ...current[index], ...event }
  return next
}

export function preserveFailedTeamChatProgress(
  current: boolean,
  event: TeamChatProgressEvent
): boolean {
  return current || event.status === 'failed'
}

export function finishTeamChatProgress(
  current: TeamChatProgressEvent[],
  status: 'completed' | 'failed'
): TeamChatProgressEvent[] {
  return current.map((event) =>
    event.status === 'pending' || event.status === 'in_progress' ? { ...event, status } : event
  )
}

export function useHermesTeamChatProgress(requestIdRef: RefObject<string | null>): {
  progressEvents: TeamChatProgressEvent[]
  progressOutcome: HermesTeamChatProgressOutcome
  hadFailedProgress: boolean
  resetProgress: () => void
  finishProgress: (outcome: Exclude<HermesTeamChatProgressOutcome, null>) => void
} {
  const [progressEvents, setProgressEvents] = useState<TeamChatProgressEvent[]>([])
  const [progressOutcome, setProgressOutcome] = useState<HermesTeamChatProgressOutcome>(null)
  const [hadFailedProgress, setHadFailedProgress] = useState(false)

  useEffect(
    () =>
      window.api.preflight.onHermesTeamChatProgress((event) => {
        if (event.requestId === requestIdRef.current) {
          setProgressEvents((current) => upsertTeamChatProgress(current, event))
          setHadFailedProgress((current) => preserveFailedTeamChatProgress(current, event))
        }
      }),
    [requestIdRef]
  )

  const resetProgress = useCallback(() => {
    setProgressEvents([])
    setProgressOutcome(null)
    setHadFailedProgress(false)
  }, [])
  const finishProgress = useCallback((outcome: Exclude<HermesTeamChatProgressOutcome, null>) => {
    setProgressEvents((current) =>
      finishTeamChatProgress(current, outcome === 'completed' ? 'completed' : 'failed')
    )
    setProgressOutcome(outcome)
  }, [])

  return { progressEvents, progressOutcome, hadFailedProgress, resetProgress, finishProgress }
}
