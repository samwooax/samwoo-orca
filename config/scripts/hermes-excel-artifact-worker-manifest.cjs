const { createHash } = require('node:crypto')
const { readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { join, relative } = require('node:path')

function workerFiles(root, directory = root) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...workerFiles(root, path))
    } else if (entry.isFile() && entry.name !== 'manifest.json') {
      files.push(path)
    }
  }
  return files
}

function writeExcelArtifactWorkerManifest(root) {
  const manifest = Object.fromEntries(
    workerFiles(root)
      .sort()
      .map((file) => [
        relative(root, file).replaceAll('\\', '/'),
        createHash('sha256').update(readFileSync(file)).digest('hex')
      ])
  )
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`)
  return manifest
}

module.exports = { writeExcelArtifactWorkerManifest }
