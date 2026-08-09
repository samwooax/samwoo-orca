// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import WorkspaceAssigneePicker from './WorkspaceAssigneePicker'

const members = [
  { login: 'kim', name: '김동훈' },
  { login: 'peer', name: '동료' }
]

afterEach(cleanup)

describe('WorkspaceAssigneePicker', () => {
  it('selects multiple Hermes profile members from the shared popover', async () => {
    const onChange = vi.fn()
    render(
      <TooltipProvider>
        <WorkspaceAssigneePicker
          members={members}
          selectedLogins={['kim']}
          ownLogin="kim"
          canEdit
          updating={false}
          onChange={onChange}
        />
      </TooltipProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '1 assignees' }))
    expect(await screen.findByText('Hermes profile members')).toBeTruthy()
    fireEvent.click(screen.getByText('peer'))
    expect(onChange).toHaveBeenCalledWith(['kim', 'peer'])
  })

  it('keeps read-only assignment display non-editable', () => {
    render(
      <TooltipProvider>
        <WorkspaceAssigneePicker
          members={members}
          selectedLogins={['peer']}
          ownLogin="kim"
          canEdit={false}
          updating={false}
          onChange={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(screen.getByRole('button', { name: '1 assignees' }).hasAttribute('disabled')).toBe(true)
  })

  it('replaces the selected login in single-assignee mode', async () => {
    const onChange = vi.fn()
    render(
      <TooltipProvider>
        <WorkspaceAssigneePicker
          members={members}
          selectedLogins={['kim']}
          ownLogin="kim"
          canEdit
          updating={false}
          selectionMode="single"
          onChange={onChange}
        />
      </TooltipProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'kim' }))
    fireEvent.click(await screen.findByText('peer'))
    expect(onChange).toHaveBeenCalledWith(['peer'])
  })

  it('marks the current assignee using canonical login matching', async () => {
    render(
      <TooltipProvider>
        <WorkspaceAssigneePicker
          members={members}
          selectedLogins={[]}
          ownLogin="KIM@Company.Test"
          canEdit
          updating={false}
          onChange={vi.fn()}
        />
      </TooltipProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }))
    expect(await screen.findByText('Me')).toBeTruthy()
  })
})
