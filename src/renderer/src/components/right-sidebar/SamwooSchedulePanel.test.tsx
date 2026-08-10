// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooScheduleStore } from '@/lib/samwoo-schedule-store'
import SamwooSchedulePanel from './SamwooSchedulePanel'

function textOf(container: HTMLElement): string {
  return container.textContent ?? ''
}

describe('SamwooSchedulePanel', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    localStorage.clear()
    useSamwooScheduleStore.setState({ schedules: [], runs: {} })
    useSamwooAuthStore.setState({
      auth: { login: 'member', name: 'Member', role: 'planning', label: 'Planning', token: 'tok' }
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        preflight: {
          samwooHermesCron: {
            list: vi.fn(async () => ({
              ok: true,
              schedulerHealthy: true,
              heartbeatAt: new Date().toISOString(),
              jobs: []
            })),
            upsert: vi.fn(async ({ schedule }) => ({
              ok: true,
              schedulerHealthy: true,
              heartbeatAt: new Date().toISOString(),
              job: {
                id: 'job-1',
                name: `SAMWOO-ORCA:${schedule.id}`,
                prompt: schedule.prompt,
                scheduleDisplay: 'daily',
                enabled: true,
                state: 'scheduled',
                nextRunAt: new Date(Date.now() + 60_000).toISOString(),
                lastRunAt: null,
                lastStatus: null,
                lastError: null
              }
            })),
            action: vi.fn()
          }
        }
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    useSamwooAuthStore.setState({ auth: null })
    useSamwooScheduleStore.setState({ schedules: [], runs: {} })
  })

  async function render(): Promise<void> {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <SamwooSchedulePanel />
        </TooltipProvider>
      )
      await Promise.resolve()
    })
  }

  it('asks the user to sign in instead of exposing the form', async () => {
    useSamwooAuthStore.setState({ auth: null })
    await render()
    expect(textOf(container)).toContain('Sign in to SAMWOO')
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('states the server execution contract and verified scheduler state', async () => {
    await render()
    expect(textOf(container)).toContain('runs even when this app is closed')
    expect(textOf(container)).toContain('Hermes cron scheduler is running')
  })

  it('shows the empty state until a schedule exists, then renders the row', async () => {
    await render()
    expect(textOf(container)).toContain('No schedules yet')

    await act(async () => {
      useSamwooScheduleStore.getState().addSchedule({
        prompt: '아침 메일 요약',
        time: '08:00',
        days: [1, 2, 3, 4, 5],
        frequency: 'daily',
        interval: 1
      })
      await Promise.resolve()
    })

    expect(textOf(container)).toContain('아침 메일 요약')
    expect(textOf(container)).toContain('08:00')
    expect(textOf(container)).not.toContain('No schedules yet')
  })

  it('renders a locally paused legacy schedule as unregistered until migration confirms it', async () => {
    await act(async () => {
      const created = useSamwooScheduleStore.getState().addSchedule({
        prompt: '주간 리포트',
        time: '17:00',
        days: [5],
        frequency: 'daily',
        interval: 1
      })
      useSamwooScheduleStore.getState().updateSchedule(created!.id, { enabled: false })
      await Promise.resolve()
    })
    await render()
    expect(textOf(container)).toContain('Hermes cron')
  })
})
