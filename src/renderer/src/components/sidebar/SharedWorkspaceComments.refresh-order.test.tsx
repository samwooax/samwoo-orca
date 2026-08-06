// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SharedWorkspaceComments from './SharedWorkspaceComments'
import type { SamwooWorkspaceShareResult } from '../../../../shared/samwoo-workspace-sharing'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string): string => fallback
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => children,
  TooltipContent: ({ children }: React.PropsWithChildren) => children,
  TooltipTrigger: ({ children }: React.PropsWithChildren) => children
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SharedWorkspaceComments refresh ordering', () => {
  it('does not let an older poll response remove a newly created comment', async () => {
    let resolvePoll: (result: SamwooWorkspaceShareResult) => void = () => undefined
    const listComments = vi.fn(
      () =>
        new Promise<SamwooWorkspaceShareResult>((resolve) => {
          resolvePoll = resolve
        })
    )
    const createComment = vi.fn(async () => ({
      ok: true,
      comment: comment('new-comment', '새 작업')
    }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        preflight: {
          samwooWorkspaceShares: {
            listComments,
            createComment,
            setCommentCompleted: vi.fn()
          }
        }
      }
    })

    render(<SharedWorkspaceComments shareId="share-1" token="token-123" initialCount={0} />)
    fireEvent.click(screen.getByRole('button', { name: /Comments/ }))
    await waitFor(() => expect(listComments).toHaveBeenCalledOnce())

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '새 작업' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }))
    await screen.findByText('새 작업')

    await act(async () => {
      resolvePoll({
        ok: true,
        comments: [comment('old-comment', '기존 작업')],
        commentCount: 1,
        completedCommentCount: 0,
        hasMoreComments: false
      })
    })

    expect(screen.getByText('새 작업')).toBeInTheDocument()
    expect(screen.queryByText('기존 작업')).not.toBeInTheDocument()
  })
})

function comment(id: string, body: string) {
  return {
    id,
    shareId: 'share-1',
    authorLogin: 'peer',
    body,
    completed: false,
    completedBy: null,
    completedAt: null,
    createdAt: 1,
    updatedAt: 1,
    isAuthor: true
  }
}
