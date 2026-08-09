import { useEffect } from 'react'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { startSamwooScheduleRunner } from '@/lib/samwoo-schedule-runner'

/** SAMWOO-ORCA: drive scheduled team-bot prompts for as long as the app runs
 *  with a signed-in session. Signing out stops the timer, so a schedule never
 *  fires with a stale token. */
export function useSamwooScheduleRunner(): void {
  const signedIn = useSamwooAuthStore((state) => Boolean(state.auth))
  useEffect(() => (signedIn ? startSamwooScheduleRunner() : undefined), [signedIn])
}
