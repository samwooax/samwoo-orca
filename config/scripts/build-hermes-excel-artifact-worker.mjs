import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import manifestWriter from './hermes-excel-artifact-worker-manifest.cjs'
import {
  LIBREOFFICE_REQUIRED_FILES,
  prepareBundledLibreOffice
} from './prepare-hermes-libreoffice.mjs'

const root = resolve(import.meta.dirname, '../..')
const source = join(root, 'resources', 'hermes-excel-artifact-worker-src')
const platformKey = `${process.platform}-${process.arch}`
const destination = join(root, 'resources', 'hermes-excel-artifact-worker', platformKey)
const work = join(root, 'tmp', 'hermes-excel-artifact-worker', platformKey)

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log(
    `[hermes-excel-artifact-worker] unsupported build host ${platformKey}; capability disabled`
  )
  process.exit(0)
}

rmSync(destination, { recursive: true, force: true })
rmSync(work, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
mkdirSync(work, { recursive: true })

execFileSync('uv', ['sync', '--frozen', '--group', 'build', '--python', '3.13', '--no-progress'], {
  cwd: source,
  stdio: 'inherit'
})
execFileSync(
  'uv',
  [
    'run',
    '--frozen',
    '--group',
    'build',
    'python',
    '-B',
    '-m',
    'unittest',
    'discover',
    '-s',
    'tests',
    '-p',
    'test_*.py'
  ],
  { cwd: source, stdio: 'inherit' }
)
execFileSync(
  'uv',
  [
    'run',
    '--frozen',
    '--group',
    'build',
    'pyinstaller',
    '--noconfirm',
    '--clean',
    '--onedir',
    '--name',
    'orca-excel-artifact-worker',
    '--distpath',
    destination,
    '--workpath',
    join(work, 'build'),
    '--specpath',
    join(work, 'spec'),
    '--paths',
    source,
    '--add-data',
    `${join(source, 'schemas')}${delimiter}schemas`,
    '--copy-metadata',
    'openpyxl',
    '--copy-metadata',
    'xlsxwriter',
    '--copy-metadata',
    'defusedxml',
    join(source, 'orca_excel_artifact_host.py')
  ],
  { cwd: source, stdio: 'inherit' }
)

const executable = join(destination, 'orca-excel-artifact-worker', 'orca-excel-artifact-worker.exe')
if (!existsSync(executable)) {
  throw new Error(`Excel Artifact worker build did not produce ${executable}`)
}
const bundleRoot = join(destination, 'orca-excel-artifact-worker')
const libreOfficePrepared = await prepareBundledLibreOffice(join(bundleRoot, 'libreoffice'))
if (!libreOfficePrepared) {
  throw new Error('Excel Artifact worker build requires the bundled win32-x64 LibreOffice runtime')
}
const manifest = manifestWriter.writeExcelArtifactWorkerManifest(bundleRoot)
const unverifiedLibreOfficeFiles = LIBREOFFICE_REQUIRED_FILES.filter(
  (path) => !manifest[`libreoffice/${path}`]
)
if (unverifiedLibreOfficeFiles.length > 0) {
  throw new Error(
    `Excel Artifact manifest omitted LibreOffice files: ${unverifiedLibreOfficeFiles.join(', ')}`
  )
}
console.log(`[hermes-excel-artifact-worker] built ${executable}`)
