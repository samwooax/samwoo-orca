import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('./filesystem-auth', () => ({
  resolveAuthorizedPath: vi.fn(async (path: string) => path)
}))

import { writeSamwooScheduleResult } from './samwoo-schedule-results'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('SAMWOO local schedule result writer', () => {
  it('creates a Markdown result beneath the connected project', async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), 'samwoo-schedule-result-'))
    temporaryRoots.push(worktreePath)
    const result = await writeSamwooScheduleResult({} as never, {
      worktreePath,
      scheduleId: 'sch_test',
      occurrenceAt: Date.UTC(2026, 7, 11, 1, 2, 3, 4),
      profile: 'ai_center',
      prompt: '오늘 상태를 한 줄로 알려줘',
      reply: '예약 실행이 정상 완료되었습니다.'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.outputPath).toContain(join('SAMWOO-예약결과', 'sch_test'))
    await expect(readFile(result.outputPath, 'utf8')).resolves.toContain(
      '예약 실행이 정상 완료되었습니다.'
    )
  })

  it('rejects unsafe schedule ids and empty replies', async () => {
    await expect(
      writeSamwooScheduleResult({} as never, {
        worktreePath: '/workspace/project',
        scheduleId: '../escape',
        occurrenceAt: Date.now(),
        profile: 'ai_center',
        prompt: 'prompt',
        reply: ''
      })
    ).resolves.toEqual({ ok: false, error: 'invalid schedule result' })
  })
})
