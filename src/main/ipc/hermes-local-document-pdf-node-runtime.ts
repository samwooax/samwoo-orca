import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

type PdfCanvasRuntime = {
  DOMMatrix?: unknown
  ImageData?: unknown
  Path2D?: unknown
}

function loadCanvasRuntime(): PdfCanvasRuntime {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [...(resourcesPath ? [join(resourcesPath, 'package.json')] : []), __filename]
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      return createRequire(candidate)('@napi-rs/canvas') as PdfCanvasRuntime
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(`PDF canvas runtime is unavailable: ${errors.at(-1) ?? 'module not found'}`)
}

export function installPdfNodeGlobals(): void {
  const globals = globalThis as Record<string, unknown>
  if (globals.DOMMatrix && globals.ImageData && globals.Path2D) {
    return
  }
  const canvas = loadCanvasRuntime()
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D'] as const) {
    if (!globals[name] && canvas[name]) {
      globals[name] = canvas[name]
    }
  }
  if (!globals.DOMMatrix) {
    throw new Error('PDF canvas runtime did not provide DOMMatrix')
  }
}

export function resolvePdfWorkerSource(): string {
  const bundledWorker = join(__dirname, '..', 'pdf.worker.mjs')
  const workerPath = existsSync(bundledWorker)
    ? bundledWorker
    : createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  return pathToFileURL(workerPath).href
}
