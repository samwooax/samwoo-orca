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
        oneClick: true,
        perMachine: true,
        runAfterFinish: true,
        shortcutName: '${productName}',
        uninstallDisplayName: '${productName}'
      }
    })
    expect(electronBuilderConfig.nsis).not.toHaveProperty('allowToChangeInstallationDirectory')
  })

  it('keeps update cleanup guarded while the one-click installer owns relaunch', async () => {
    const include = await readFile(
      resolve(import.meta.dirname, '../nsis/daemon-host-uninstall.nsh'),
      'utf8'
    )

    expect(include).toContain('!ifndef ONE_CLICK')
    const assistedOnly = include.slice(
      include.indexOf('!ifndef ONE_CLICK'),
      include.indexOf('!endif\n!endif', include.indexOf('!ifndef ONE_CLICK'))
    )
    expect(assistedOnly).toContain('!define MUI_PAGE_CUSTOMFUNCTION_SHOW SamwooInstallModePageShow')
    expect(assistedOnly).toContain('!macro customHeader')
    expect(assistedOnly).toContain('$MultiUser.InstallModePage.CurrentUser')
    expect(include).toContain('!macro customFinishPage')
    expect(include).toContain('!macro customInstall')
    expect(include).toMatch(/!ifndef ONE_CLICK[\s\S]*!macro customInstall[\s\S]*!endif/)
    expect(include).toContain('${ifNot} ${isUpdated}')
    expect(include).toContain('RMDir /r "$LOCALAPPDATA\\SAMWOO-ORCA\\daemon-host"')
  })
})
