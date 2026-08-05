import { createRequire } from 'node:module'
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
        shortcutName: '${productName}',
        uninstallDisplayName: '${productName}'
      }
    })
  })
})
