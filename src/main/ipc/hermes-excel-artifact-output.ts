import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

export function isInsideExcelWorkspace(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

export async function createPrivateExcelWorkspace(): Promise<string> {
  const base = join(app.getPath('userData'), 'hermes-excel-artifact-jobs', 'workspaces')
  await mkdir(base, { recursive: true, mode: 0o700 })
  return mkdtemp(join(base, 'job-'))
}

export async function savePrivateExcelOutput(
  source: string,
  suggestedPath: string
): Promise<string> {
  const window = BrowserWindow.getFocusedWindow()
  const options = {
    title: 'Save Excel workbook',
    defaultPath: basename(suggestedPath),
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
  }
  const selected = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (selected.canceled || !selected.filePath) {
    throw new Error('Excel file save was cancelled')
  }
  if (extname(selected.filePath).toLowerCase() !== '.xlsx') {
    throw new Error('Excel output must use the .xlsx extension')
  }
  const content = await readFile(source)
  if (content.byteLength < 1 || content.byteLength > MAX_OUTPUT_BYTES) {
    throw new Error('Excel output exceeds the 64 MiB limit')
  }
  await mkdir(dirname(selected.filePath), { recursive: true })
  const temporary = `${selected.filePath}.orca-${randomUUID()}.tmp`
  try {
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600
    )
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await link(temporary, selected.filePath)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
  return basename(selected.filePath)
}
