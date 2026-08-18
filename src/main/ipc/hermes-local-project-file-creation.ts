import { open, rm } from 'node:fs/promises'

export async function createLocalProjectFile(
  path: string,
  content: Buffer,
  beforeCommit?: () => void
): Promise<void> {
  beforeCommit?.()
  const handle = await open(path, 'wx')
  let complete = false
  try {
    beforeCommit?.()
    await handle.writeFile(content)
    await handle.sync()
    complete = true
  } finally {
    await handle.close().catch(() => {})
    if (!complete) {
      await rm(path, { force: true }).catch(() => {})
    }
  }
}
