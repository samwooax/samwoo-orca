import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, join, resolve } from 'node:path'

export const LIBREOFFICE_VERSION = '26.2.5'
export const LIBREOFFICE_MSI_BYTES = 372_948_992
export const LIBREOFFICE_MSI_SHA256 =
  'f15ba07bfcb0186986cf3171063506f5d207c11f8cc051ba0d135209e9e915f9'
export const LIBREOFFICE_MSI_URL =
  'https://download.documentfoundation.org/libreoffice/stable/26.2.5/win/x86_64/LibreOffice_26.2.5_Win_x86-64.msi'
export const LIBREOFFICE_SOURCE_URL =
  'https://download.documentfoundation.org/libreoffice/src/26.2.5/libreoffice-26.2.5.2.tar.xz'
export const LIBREOFFICE_SOURCE_BYTES = 292_259_528
export const LIBREOFFICE_SOURCE_SHA256 =
  '8ec785ee1fd1a1d9b9d8eba1c8ff7556695ca8f02e1f7a26bef8cd540f669fea'
export const LIBREOFFICE_LICENSE_URL = 'https://www.libreoffice.org/about-us/licenses/'
export const LIBREOFFICE_NOTICE_FILE = 'SAMWOO-ORCA-LIBREOFFICE-NOTICE.txt'
export const LIBREOFFICE_REQUIRED_FILES = Object.freeze([
  'program/soffice.exe',
  'program/soffice.bin',
  'program/fundamental.ini',
  'program/mergedlo.dll',
  'program/msvcp140.dll',
  'program/vcruntime140.dll',
  'program/vcruntime140_1.dll',
  'program/types/offapi.rdb',
  'program/services/services.rdb',
  'share/registry/main.xcd',
  'LICENSE.html',
  'license.txt',
  'NOTICE',
  LIBREOFFICE_NOTICE_FILE
])

const repositoryRoot = resolve(import.meta.dirname, '../..')
const cacheRoot = join(repositoryRoot, 'tmp', 'hermes-libreoffice-cache')
const extractionRoot = join(repositoryRoot, 'tmp', 'hermes-libreoffice-extractions')
const downloadAttempts = 3
const downloadTimeoutMs = 10 * 60 * 1000

function fileSha256(path) {
  return new Promise((resolveHash, reject) => {
    const digest = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => digest.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolveHash(digest.digest('hex')))
  })
}

async function fileMatchesPin(path, bytes, sha256) {
  try {
    const metadata = statSync(path)
    return metadata.isFile() && metadata.size === bytes && (await fileSha256(path)) === sha256
  } catch {
    return false
  }
}

export async function ensurePinnedDownload({
  destination,
  url,
  bytes,
  sha256,
  fetchImpl = fetch,
  timeoutMs = downloadTimeoutMs
}) {
  if (await fileMatchesPin(destination, bytes, sha256)) {
    return 'cache'
  }
  mkdirSync(dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${randomUUID()}.partial`
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok || !response.body) {
      throw new Error(`download failed with HTTP ${response.status}`)
    }
    const declaredBytes = response.headers.get('content-length')
    if (declaredBytes !== null && Number(declaredBytes) !== bytes) {
      throw new Error(`download declared ${declaredBytes} bytes; expected ${bytes}`)
    }
    await pipeline(response.body, createWriteStream(temporary, { flags: 'wx' }))
    if (!(await fileMatchesPin(temporary, bytes, sha256))) {
      throw new Error('download failed its pinned size or SHA-256 check')
    }
    if (await fileMatchesPin(destination, bytes, sha256)) {
      return 'cache'
    }
    rmSync(destination, { force: true })
    renameSync(temporary, destination)
    return 'download'
  } finally {
    rmSync(temporary, { force: true })
  }
}

async function downloadMsi(path) {
  for (let attempt = 1; attempt <= downloadAttempts; attempt += 1) {
    try {
      const result = await ensurePinnedDownload({
        destination: path,
        url: LIBREOFFICE_MSI_URL,
        bytes: LIBREOFFICE_MSI_BYTES,
        sha256: LIBREOFFICE_MSI_SHA256
      })
      console.log(
        result === 'cache'
          ? `[hermes-libreoffice] using verified cache ${path}`
          : '[hermes-libreoffice] download hash verified'
      )
      return
    } catch (error) {
      if (attempt === downloadAttempts) {
        throw error
      }
      console.warn(`[hermes-libreoffice] download attempt ${attempt} failed: ${error.message}`)
    }
  }
}

function findSoffice(root) {
  const matches = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase() === 'soffice.exe' &&
        basename(dirname(path)).toLowerCase() === 'program'
      ) {
        matches.push(path)
      }
    }
  }
  visit(root)
  if (matches.length !== 1) {
    throw new Error(`LibreOffice administrative image has ${matches.length} soffice executables`)
  }
  return matches[0]
}

function extractMsi(msi, destination) {
  console.log('[hermes-libreoffice] extracting administrative image')
  const result = spawnSync(
    'msiexec.exe',
    ['/a', resolve(msi), '/qn', `TARGETDIR=${resolve(destination)}`],
    { stdio: 'inherit', windowsHide: true }
  )
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0 && result.status !== 3010) {
    throw new Error(`LibreOffice administrative extraction failed with ${result.status}`)
  }
  console.log('[hermes-libreoffice] administrative image extracted')
}

function colocateRuntimeDependencies(destination) {
  const system64 = join(destination, 'System64')
  if (!existsSync(system64)) {
    throw new Error('LibreOffice administrative image is missing System64 runtime files')
  }
  const runtimeFiles = readdirSync(system64, { withFileTypes: true })
  if (runtimeFiles.length === 0 || runtimeFiles.some((entry) => !entry.isFile())) {
    throw new Error('LibreOffice System64 runtime layout is unsupported')
  }
  for (const entry of runtimeFiles) {
    cpSync(join(system64, entry.name), join(destination, 'program', entry.name), {
      preserveTimestamps: true
    })
  }
  rmSync(join(destination, 'System'), { recursive: true, force: true })
  rmSync(system64, { recursive: true, force: true })
}

export function writeLibreOfficeNotice(destination) {
  writeFileSync(
    join(destination, LIBREOFFICE_NOTICE_FILE),
    [
      `LibreOffice ${LIBREOFFICE_VERSION}`,
      '',
      'Copyright The Document Foundation and LibreOffice contributors.',
      'LibreOffice is distributed under MPL 2.0 and includes third-party components.',
      'Upstream LICENSE, NOTICE, readme, and component notices are retained in this bundle.',
      '',
      `Binary: ${LIBREOFFICE_MSI_URL}`,
      `Binary size: ${LIBREOFFICE_MSI_BYTES} bytes`,
      `Binary SHA-256: ${LIBREOFFICE_MSI_SHA256}`,
      `Corresponding source: ${LIBREOFFICE_SOURCE_URL}`,
      `Source size: ${LIBREOFFICE_SOURCE_BYTES} bytes`,
      `Source SHA-256: ${LIBREOFFICE_SOURCE_SHA256}`,
      `License information: ${LIBREOFFICE_LICENSE_URL}`,
      ''
    ].join('\n'),
    'utf8'
  )
}

export function verifyBundledLibreOffice(destination) {
  const missing = LIBREOFFICE_REQUIRED_FILES.filter((path) => {
    try {
      return !statSync(join(destination, path)).isFile()
    } catch {
      return true
    }
  })
  if (missing.length > 0) {
    throw new Error(`LibreOffice bundle is missing required files: ${missing.join(', ')}`)
  }
  const administrativeMsi = readdirSync(destination, { withFileTypes: true }).find(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.msi')
  )
  if (administrativeMsi) {
    throw new Error(`LibreOffice bundle retained administrative MSI ${administrativeMsi.name}`)
  }
  if (existsSync(join(destination, 'System')) || existsSync(join(destination, 'System64'))) {
    throw new Error('LibreOffice bundle retained non-portable system runtime directories')
  }
  return true
}

function replaceBundle(staged, destination) {
  const resolvedDestination = resolve(destination)
  const parent = dirname(resolvedDestination)
  const previous = join(parent, `.${basename(resolvedDestination)}.${randomUUID()}.previous`)
  let hasPrevious = false
  if (existsSync(resolvedDestination)) {
    renameSync(resolvedDestination, previous)
    hasPrevious = true
  }
  try {
    renameSync(staged, resolvedDestination)
  } catch (error) {
    if (hasPrevious && !existsSync(resolvedDestination)) {
      renameSync(previous, resolvedDestination)
    }
    throw error
  }
  if (hasPrevious) {
    rmSync(previous, { recursive: true, force: true })
  }
}

export async function prepareBundledLibreOffice(destination) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return false
  }
  const msi = join(cacheRoot, `LibreOffice_${LIBREOFFICE_VERSION}_Win_x86-64.msi`)
  const destinationParent = dirname(resolve(destination))
  mkdirSync(cacheRoot, { recursive: true })
  mkdirSync(extractionRoot, { recursive: true })
  mkdirSync(destinationParent, { recursive: true })
  await downloadMsi(msi)
  const extracted = mkdtempSync(join(extractionRoot, 'image-'))
  const stagingRoot = mkdtempSync(join(destinationParent, '.hermes-libreoffice-'))
  const staged = join(stagingRoot, 'bundle')
  try {
    extractMsi(msi, extracted)
    const installationRoot = dirname(dirname(findSoffice(extracted)))
    cpSync(installationRoot, staged, { recursive: true, preserveTimestamps: true })
    colocateRuntimeDependencies(staged)
    rmSync(join(staged, basename(msi)), { force: true })
    writeLibreOfficeNotice(staged)
    verifyBundledLibreOffice(staged)
    replaceBundle(staged, destination)
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
    rmSync(extracted, { recursive: true, force: true })
  }
  console.log(`[hermes-libreoffice] bundled ${destination}`)
  return true
}
