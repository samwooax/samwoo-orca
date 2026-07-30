import { describe, expect, it } from 'vitest'
import {
  buildAgentFeatureSkillInstallCommand,
  buildAgentFeatureSkillUpdateCommand,
  COMPUTER_USE_SKILL_UPDATE_COMMAND,
  EPHEMERAL_VMS_SKILL_UPDATE_COMMAND,
  LINEAR_TICKETS_SKILL_UPDATE_COMMAND,
  ORCA_LINEAR_SKILL_UPDATE_COMMAND,
  ORCA_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND,
  ORCA_CLI_SKILL_UPDATE_COMMAND,
  ORCHESTRATION_SKILL_UPDATE_COMMAND
} from './agent-feature-install-commands'

describe('agent feature skill commands', () => {
  it('builds single-skill update commands', () => {
    expect(buildAgentFeatureSkillUpdateCommand('orchestration')).toBe(
      'orca skills install --topics orchestration'
    )
  })

  it('trims and rejects blank update skill names', () => {
    expect(buildAgentFeatureSkillUpdateCommand('  orca-cli  ')).toBe(
      'orca skills install --topics orca-cli'
    )
    expect(() => buildAgentFeatureSkillUpdateCommand('   ')).toThrow('A skill name is required.')
  })

  it('exports single-skill update constants without changing install bundles', () => {
    expect(ORCA_CLI_SKILL_UPDATE_COMMAND).toBe('orca skills install --topics orca-cli')
    expect(COMPUTER_USE_SKILL_UPDATE_COMMAND).toBe('orca skills install --topics computer-use')
    expect(ORCHESTRATION_SKILL_UPDATE_COMMAND).toBe('orca skills install --topics orchestration')
    expect(EPHEMERAL_VMS_SKILL_UPDATE_COMMAND).toBe(
      'orca skills install --topics orca-per-workspace-env'
    )
    expect(ORCA_LINEAR_SKILL_UPDATE_COMMAND).toBe('orca skills install --topics orca-linear')
    expect(LINEAR_TICKETS_SKILL_UPDATE_COMMAND).toBe('orca skills install --topics linear-tickets')
    expect(ORCA_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND).toBe(
      buildAgentFeatureSkillInstallCommand(['orca-cli', 'orchestration'])
    )
  })
})
