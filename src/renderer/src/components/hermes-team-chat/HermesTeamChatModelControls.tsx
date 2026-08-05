import { translate } from '@/i18n/i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  TEAM_CHAT_MODELS,
  resolveTeamChatModel,
  type TeamChatEffort,
  type TeamChatModelId
} from '../../../../shared/hermes-team-chat-models'
import { teamChatEffortLabel } from './hermes-team-chat-session-options'

const AUTOMATIC_EFFORT_VALUE = 'automatic'

export function HermesTeamChatModelControls(props: {
  model: TeamChatModelId
  effort: TeamChatEffort
  disabled: boolean
  onModelChange: (model: TeamChatModelId) => void
  onEffortChange: (effort: TeamChatEffort) => void
}): React.JSX.Element {
  const selectedModel = resolveTeamChatModel(props.model)
  const supportsEffort = selectedModel.efforts.length > 0

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-2 pb-2">
      <label className="flex items-center gap-2 text-xs font-medium text-foreground">
        <span>{translate('auto.components.HermesTeamChatView.model', 'Model')}</span>
        <Select
          value={props.model}
          disabled={props.disabled}
          onValueChange={(value) => props.onModelChange(value as TeamChatModelId)}
        >
          <SelectTrigger
            size="sm"
            className="min-w-40"
            aria-label={translate('auto.components.HermesTeamChatView.model', 'Model')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEAM_CHAT_MODELS.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-2 text-xs font-medium text-foreground">
        <span>{translate('auto.components.HermesTeamChatView.effort', 'Effort')}</span>
        <Select
          value={supportsEffort ? props.effort : AUTOMATIC_EFFORT_VALUE}
          disabled={props.disabled || !supportsEffort}
          onValueChange={(value) => props.onEffortChange(value as TeamChatEffort)}
        >
          <SelectTrigger
            size="sm"
            className="min-w-32"
            aria-label={translate('auto.components.HermesTeamChatView.effort', 'Effort')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {supportsEffort ? (
              selectedModel.efforts.map((effort) => (
                <SelectItem key={effort} value={effort}>
                  {teamChatEffortLabel(effort)}
                </SelectItem>
              ))
            ) : (
              <SelectItem value={AUTOMATIC_EFFORT_VALUE}>
                {translate('auto.components.HermesTeamChatView.automaticEffort', 'Automatic')}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </label>
    </div>
  )
}
