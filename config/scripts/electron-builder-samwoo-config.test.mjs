import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')

describe('SAMWOO electron-builder identity', () => {
  it('aligns the packaged app identity with local-build validation', () => {
    expect(electronBuilderConfig.appId).toBe(
      require('../../src/shared/local-build-compatibility-contract.json').appId
    )
  })

  it('keeps the Windows install separate from upstream Orca', () => {
    expect(electronBuilderConfig).toMatchObject({
      appId: 'com.samwooax.samwoo-orca',
      productName: 'SAMWOO-ORCA',
      win: {
        executableName: 'SAMWOO-ORCA',
        signtoolOptions: { publisherName: 'SAMWOO ELECO Internal Code Signing' }
      },
      nsis: {
        artifactName: 'samwoo-orca-windows-setup.${ext}',
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        runAfterFinish: false,
        shortcutName: '${productName}',
        uninstallDisplayName: '${productName}'
      }
    })
  })

  it('shows update progress while preserving automatic relaunch', async () => {
    const include = await readFile(
      resolve(import.meta.dirname, '../nsis/daemon-host-uninstall.nsh'),
      'utf8'
    )

    expect(include).toContain('!macro customFinishPage')
    expect(include).toContain('!define MUI_PAGE_CUSTOMFUNCTION_PRE SamwooFinishPagePre')
    expect(include).toMatch(
      /!macro customFinishPage[\s\S]*Function SamwooFinishPagePre[\s\S]*!macroend/
    )
    expect(include).toContain('${if} ${isUpdated}')
    expect(include).toContain('${andIfNot} ${Silent}')
    expect(include).toContain('!insertmacro StartApp')
  })
})
