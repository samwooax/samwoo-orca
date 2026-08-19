import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const digest = createHash('sha256')
    const input = createReadStream(path)
    input.on('data', (chunk) => digest.update(chunk))
    input.once('error', reject)
    input.once('end', () => resolveHash(digest.digest('hex')))
  })
}

export async function assertWorkerManifest(root, stage) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Office worker manifest is invalid ${stage}`)
  }
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files = new Map(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name)
        return [relative(root, path).replaceAll('\\', '/'), path]
      })
      .filter(([path]) => path !== 'manifest.json')
  )
  const expected = Object.keys(manifest).sort()
  if (expected.length !== files.size || expected.some((path) => !files.has(path))) {
    throw new Error(`Office worker manifest file set changed ${stage}`)
  }
  for (const path of expected) {
    const digest = manifest[path]
    if (
      typeof digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(digest) ||
      (await sha256File(files.get(path))) !== digest
    ) {
      throw new Error(`Office worker manifest integrity failed ${stage}: ${path}`)
    }
  }
}

async function assertVisibleContent(image, value, label) {
  const decoded = await loadImage(image)
  if (decoded.width !== value.width || decoded.height !== value.height) {
    throw new Error(`${label} preview dimensions do not match the decoded image`)
  }
  const canvas = createCanvas(decoded.width, decoded.height)
  const context = canvas.getContext('2d')
  context.drawImage(decoded, 0, 0)
  const pixels = context.getImageData(0, 0, decoded.width, decoded.height).data
  let visiblePixels = 0
  for (let index = 0; index < pixels.length; index += 4) {
    const distanceFromWhite =
      255 - pixels[index] + 255 - pixels[index + 1] + 255 - pixels[index + 2]
    if (pixels[index + 3] >= 128 && distanceFromWhite >= 48 && ++visiblePixels >= 64) {
      return
    }
  }
  throw new Error(`${label} preview contains no visible non-white content`)
}

export async function assertOfficePreview(value, label) {
  if (
    value.ok !== true ||
    !['image/png', 'image/jpeg'].includes(value.mediaType) ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 1 ||
    value.height < 1
  ) {
    throw new Error(`${label} preview metadata failed: ${JSON.stringify(value)}`)
  }
  const image = Buffer.from(value.imageBase64 ?? '', 'base64')
  const isPng = image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  const isJpeg = image.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
  if (!image.length || (!isPng && !isJpeg)) {
    throw new Error(`${label} preview image failed: ${JSON.stringify(value)}`)
  }
  await assertVisibleContent(image, value, label)
}
