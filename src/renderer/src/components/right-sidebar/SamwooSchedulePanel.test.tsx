// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

  it('states the app-only limitation up front', async () => {
    await render()
    // Why assert this: it is the one behaviour a scheduling UI is expected to
    // have and this one deliberately does not — it must never be discovered by
    // a missed run.
    expect(textOf(container)).toContain('only while this app is open')
  })

  it('shows the empty state until a schedule exists, then renders the row', async () => {
    await render()
    expect(textOf(container)).toContain('No schedules yet')

    await act(async () => {
      useSamwooScheduleStore
        .getState()
        .addSchedule({ prompt: '아침 메일 요약', time: '08:00', days: [1, 2, 3, 4, 5] })
      await Promise.resolve()
    })

    expect(textOf(container)).toContain('아침 메일 요약')
    expect(textOf(container)).toContain('08:00')
    expect(textOf(container)).not.toContain('No schedules yet')
  })

  it('renders a paused schedule without claiming a next run time', async () => {
    await act(async () => {
      const created = useSamwooScheduleStore
        .getState()
        .addSchedule({ prompt: '주간 리포트', time: '17:00', days: [5] })
      useSamwooScheduleStore.getState().updateSchedule(created!.id, { enabled: false })
      await Promise.resolve()
    })
    await render()
    expect(textOf(container)).toContain('Paused')
  })
})
