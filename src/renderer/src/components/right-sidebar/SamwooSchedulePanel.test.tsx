// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooScheduleStore } from '@/lib/samwoo-schedule-store'
import SamwooSchedulePanel from './SamwooSchedulePanel'

const { activeWorktree } = vi.hoisted(() => ({
  activeWorktree: {
    id: 'repo::/workspace/project',
    repoId: 'repo',
    path: '/workspace/project',
    displayName: 'Project'
  }
}))

vi.mock('@/store/selectors', () => ({ useActiveWorktree: () => activeWorktree }))
vi.mock('./file-explorer-operation-owner', () => ({
  getFileExplorerOperationOwner: () => ({ kind: 'local' })
}))

function textOf(container: HTMLElement): string {
  return container.textContent ?? ''
}

describe('SamwooSchedulePanel', () => {
  let root: Root
  let container: HTMLDivElement
  let remoteAction: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    useSamwooScheduleStore.setState({ schedules: [], runs: {} })
    useSamwooAuthStore.setState({
      auth: { login: 'member', name: 'Member', role: 'planning', label: 'Planning', token: 'tok' }
    })
    remoteAction = vi.fn(async () => ({ ok: true }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { preflight: { samwooHermesCron: { action: remoteAction } } }
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

  it('states the app-only execution and local result contract', async () => {
    await render()
    expect(textOf(container)).toContain('Runs only while Orca is open')
    expect(textOf(container)).toContain('SAMWOO-예약결과')
    expect(textOf(container)).not.toContain('Hermes cron scheduler')
  })

  it('renders a locally bound schedule without registering server cron', async () => {
    await render()
    expect(textOf(container)).toContain('No schedules yet')

    await act(async () => {
      useSamwooScheduleStore.getState().addSchedule({
        prompt: '아침 메일 요약',
        time: '08:00',
        days: [1, 2, 3, 4, 5],
        frequency: 'daily',
        interval: 1,
        worktreeId: activeWorktree.id,
        worktreePath: activeWorktree.path
      })
      await Promise.resolve()
    })

    expect(textOf(container)).toContain('아침 메일 요약')
    expect(textOf(container)).toContain('08:00')
    expect(remoteAction).not.toHaveBeenCalled()
  })

  it('deletes an old remote job before enabling its local replacement', async () => {
    const created = useSamwooScheduleStore.getState().addSchedule({
      prompt: '주간 리포트',
      time: '17:00',
      days: [5],
      frequency: 'daily',
      interval: 1,
      worktreeId: activeWorktree.id,
      worktreePath: activeWorktree.path
    })
    useSamwooScheduleStore.getState().updateSchedule(created!.id, { remoteJobId: 'job-legacy' })

    await render()
    await vi.waitFor(() => expect(remoteAction).toHaveBeenCalledTimes(1))
    expect(remoteAction).toHaveBeenCalledWith({
      profile: 'planning',
      jobId: 'job-legacy',
      action: 'delete'
    })
    await vi.waitFor(() =>
      expect(useSamwooScheduleStore.getState().schedules[0]?.remoteJobId).toBeNull()
    )
  })
})
