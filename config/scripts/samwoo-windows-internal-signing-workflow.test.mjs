import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = resolve(
  import.meta.dirname,
  '../../.github/workflows/build-samwoo-windows.yml'
)

describe('SAMWOO Windows internal signing workflow', () => {
  it('requires the private signing material only through repository secrets', async () => {
    const workflow = await readFile(workflowPath, 'utf8')
    expect(workflow).toContain('secrets.WIN_CSC_LINK')
    expect(workflow).toContain('secrets.WIN_CSC_KEY_PASSWORD')
    expect(workflow).toContain("SAMWOO_WINDOWS_RELEASE: '1'")
    expect(workflow).not.toContain('SIGNPATH_API_TOKEN')
  })

  it('trusts the pinned public chain and verifies the exact signer', async () => {
    const workflow = await readFile(workflowPath, 'utf8')
    expect(workflow).toContain('deploy/samwoo-internal-root-ca.cer')
    expect(workflow).toContain('deploy/samwoo-internal-code-signing.cer')
    expect(workflow).toContain('81316CB47930717E9EB6949430BD80C2F4E6166D')
    expect(workflow).toContain(
      "if ($signature.Status -notin @('Valid', 'UnknownError', 'NotTrusted'))"
    )
    expect(workflow).not.toContain('Add-CurrentUserCertificate')
  })
})
