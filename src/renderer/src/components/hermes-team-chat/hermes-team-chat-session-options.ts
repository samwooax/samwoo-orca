import { translate } from '@/i18n/i18n'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import {
  TEAM_CHAT_MODELS,
  resolveTeamChatModel,
  type TeamChatEffort,
  type TeamChatModelId
} from '../../../../shared/hermes-team-chat-models'

const EFFORT_CHOICES = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export function createTeamChatOptionSnapshot(
  modelId: TeamChatModelId,
  effort: TeamChatEffort
): SessionOptionDescriptor[] {
  const model = resolveTeamChatModel(modelId)
  const descriptors: SessionOptionDescriptor[] = [
    {
      id: 'model',
      label: translate('auto.components.HermesTeamChatView.model', 'Model'),
      category: 'model',
      kind: {
        type: 'select',
        currentValue: modelId,
        choices: TEAM_CHAT_MODELS.map((choice) => ({
          value: choice.id,
          label: choice.label
        }))
      },
      valueSource: 'applied',
      settable: true
    }
  ]
  if (model.efforts.length) {
    descriptors.unshift({
      id: 'effort',
      label: translate('auto.components.HermesTeamChatView.effort', 'Effort'),
      category: 'thought_level',
      kind: {
        type: 'select',
        currentValue: effort,
        choices: EFFORT_CHOICES.map((value) => ({ value, label: value }))
      },
      valueSource: 'applied',
      settable: true
    })
  }
  return descriptors
}
