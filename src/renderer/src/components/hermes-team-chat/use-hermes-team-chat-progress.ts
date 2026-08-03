import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { TeamChatProgressEvent } from '../../../../shared/hermes-team-chat-progress'

const MAX_PROGRESS_EVENTS = 40

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
  resetProgress: () => void
  finishProgress: (status: 'completed' | 'failed') => void
} {
  const [progressEvents, setProgressEvents] = useState<TeamChatProgressEvent[]>([])

  useEffect(
    () =>
      window.api.preflight.onHermesTeamChatProgress((event) => {
        if (event.requestId === requestIdRef.current) {
          setProgressEvents((current) => upsertTeamChatProgress(current, event))
        }
      }),
    [requestIdRef]
  )

  const resetProgress = useCallback(() => setProgressEvents([]), [])
  const finishProgress = useCallback((status: 'completed' | 'failed') => {
    setProgressEvents((current) => finishTeamChatProgress(current, status))
  }, [])

  return { progressEvents, resetProgress, finishProgress }
}
