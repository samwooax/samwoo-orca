import { promises as fs } from 'node:fs'
import path from 'node:path'

const MAX_FILES = 5_000
const EXCLUDED_DIRECTORIES = new Set([
  '.aws',
  '.git',
  '.gnupg',
  '.next',
  '.ssh',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'venv'
])
const EXCLUDED_SECRET_FILES = new Set([
  '.netrc',
  '.npmrc',
  '.pypirc',
  'credentials',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa'
])

export function safeSamwooWorkspaceFolderName(value: string): string {
  const printable = [...value]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
  const sanitized = printable
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
  return sanitized.slice(0, 120) || 'Shared workspace'
}

function isExcludedSecretFile(name: string): boolean {
  const lowerName = name.toLowerCase()
  const isEnvironmentSecret =
    (lowerName === '.env' || lowerName.startsWith('.env.')) &&
    !['.env.example', '.env.sample', '.env.template'].includes(lowerName)
  return (
    isEnvironmentSecret ||
    EXCLUDED_SECRET_FILES.has(lowerName) ||
    ['.key', '.p12', '.pem', '.pfx'].some((extension) => lowerName.endsWith(extension))
  )
}

export function isSamwooWorkspacePathSupported(
  relativePath: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (platform !== 'win32') {
    return true
  }
  return relativePath.split('/').every((segment) => {
    const stem = segment.split('.')[0]?.toUpperCase() ?? ''
    return (
      Boolean(segment) &&
      !/[<>:"\\|?*]/.test(segment) &&
      !/[. ]$/.test(segment) &&
      !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)
    )
  })
}

export async function listSamwooWorkspaceUploadFiles(
  rootPath: string,
  relativePath = '',
  files: string[] = []
): Promise<string[]> {
  const directoryPath = relativePath ? path.join(rootPath, relativePath) : rootPath
  for (const entry of await fs.readdir(directoryPath, { withFileTypes: true })) {
    if (entry.name === '.git') {
      continue
    }
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) {
      continue
    }
    const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name
    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isFile() && isExcludedSecretFile(entry.name)) {
      continue
    }
    if (entry.isDirectory()) {
      await listSamwooWorkspaceUploadFiles(rootPath, childRelative, files)
    } else if (entry.isFile()) {
      files.push(childRelative)
    }
    if (files.length > MAX_FILES) {
      throw new Error('Workspace contains too many files')
    }
  }
  return files
}
