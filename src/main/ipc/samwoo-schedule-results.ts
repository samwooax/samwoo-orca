import { ipcMain } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Store } from '../persistence'
import type {
  WriteSamwooScheduleResultArgs,
  WriteSamwooScheduleResultResult
} from '../../shared/samwoo-schedule'
import { resolveAuthorizedPath } from './filesystem-auth'

const SCHEDULE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const MAX_RESULT_CHARS = 2_000_000

function resultFilename(occurrenceAt: number): string {
  const stamp = new Date(occurrenceAt).toISOString().replace(/[:.]/g, '-').replace('T', '_')
  return `${stamp}.md`
}

function resultMarkdown(args: WriteSamwooScheduleResultArgs): string {
  return [
    '# 예약 실행 결과',
    '',
    `- 실행 시각: ${new Date(args.occurrenceAt).toLocaleString('ko-KR')}`,
    `- Hermes 프로필: ${args.profile}`,
    `- 예약 ID: ${args.scheduleId}`,
    '',
    '## 지시',
    '',
    args.prompt.trim(),
    '',
    '## 결과',
    '',
    args.reply.trim(),
    ''
  ].join('\n')
}

export async function writeSamwooScheduleResult(
  store: Store,
  args: WriteSamwooScheduleResultArgs
): Promise<WriteSamwooScheduleResultResult> {
  try {
    if (
      !SCHEDULE_ID_RE.test(args.scheduleId) ||
      !args.worktreePath.trim() ||
      !args.profile.trim() ||
      !args.prompt.trim() ||
      !args.reply.trim() ||
      args.reply.length > MAX_RESULT_CHARS ||
      !Number.isFinite(args.occurrenceAt)
    ) {
      return { ok: false, error: 'invalid schedule result' }
    }
    const requestedPath = join(
      args.worktreePath,
      'SAMWOO-예약결과',
      args.scheduleId,
      resultFilename(args.occurrenceAt)
    )
    const outputPath = await resolveAuthorizedPath(requestedPath, store)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, resultMarkdown(args), { encoding: 'utf8', flag: 'wx' })
    return { ok: true, outputPath }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function registerSamwooScheduleResultHandlers(store: Store): void {
  ipcMain.handle('samwooScheduleResults:write', (_event, args: WriteSamwooScheduleResultArgs) =>
    writeSamwooScheduleResult(store, args)
  )
}
