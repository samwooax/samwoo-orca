import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'
import {
  DEFAULT_HERMES_LAUNCH_COMMAND,
  DEFAULT_HERMES_PROFILE_LIST_COMMAND
} from '@/lib/start-agent-picker-store'

type StartAgentPickerSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

/** SAMWOO-ORCA: settings for the project-open agent picker (Claude / Hermes
 *  profiles / plain terminal) and the Hermes commands it relies on. */
export function StartAgentPickerSetting({
  settings,
  updateSettings
}: StartAgentPickerSettingProps): React.JSX.Element {
  const enabled = settings.startAgentPicker === true

  return (
    <SearchableSetting
      title={translate(
        'auto.components.settings.ExperimentalPane.startAgentPicker.title',
        'Start agent picker'
      )}
      description={translate(
        'auto.components.settings.ExperimentalPane.startAgentPicker.description',
        'Choose Claude, a Hermes profile, or a plain terminal whenever a project opens with no tabs.'
      )}
      keywords={['agent', 'picker', 'hermes', 'profile', 'start']}
      className="space-y-3 py-2"
      id="experimental-start-agent-picker"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.ExperimentalPane.startAgentPicker.title',
              'Start agent picker'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.ExperimentalPane.startAgentPicker.copy',
              'Ask which agent to start (Claude, a Hermes profile, or a plain terminal) when opening a project that has no tabs. Overrides the automatic Claude chat launch.'
            )}
          </p>
        </div>
        <SettingsSwitch
          checked={enabled}
          ariaLabel={translate(
            'auto.components.settings.ExperimentalPane.startAgentPicker.toggleLabel',
            'Toggle start agent picker'
          )}
          onChange={() => updateSettings({ startAgentPicker: !enabled })}
        />
      </div>
      {enabled ? (
        <div className="ml-4 space-y-3 border-l border-border pl-4">
          <div className="space-y-1">
            <Label>
              {translate(
                'auto.components.settings.ExperimentalPane.startAgentPicker.listCommandTitle',
                'Hermes profile list command'
              )}
            </Label>
            <Input
              value={settings.hermesProfileListCommand ?? ''}
              placeholder={DEFAULT_HERMES_PROFILE_LIST_COMMAND}
              onChange={(event) =>
                updateSettings({ hermesProfileListCommand: event.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>
              {translate(
                'auto.components.settings.ExperimentalPane.startAgentPicker.launchCommandTitle',
                'Hermes launch command ({profile} is replaced)'
              )}
            </Label>
            <Input
              value={settings.hermesLaunchCommand ?? ''}
              placeholder={DEFAULT_HERMES_LAUNCH_COMMAND}
              onChange={(event) => updateSettings({ hermesLaunchCommand: event.target.value })}
            />
          </div>
        </div>
      ) : null}
    </SearchableSetting>
  )
}
