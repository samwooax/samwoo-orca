import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  DEFAULT_HERMES_PROFILE_LIST_COMMAND,
  hermesProfileLabel,
  parseHermesProfileList,
  useStartAgentPickerStore
} from '@/lib/start-agent-picker-store'
import {
  launchStartAgentPickerChoice,
  type StartAgentPickerChoice
} from '@/lib/worktree-activation'

type ProfilesState =
  | { status: 'loading' }
  | { status: 'ready'; profiles: string[] }
  | { status: 'error'; message: string }

/** SAMWOO-ORCA: picker shown when a project is opened with no tabs — choose
 *  Claude (native chat), a Hermes profile, or a plain terminal for the first
 *  tab. Hermes profiles are read live via the configured list command. */
export default function StartAgentPickerDialog(): React.JSX.Element {
  const workspaceKey = useStartAgentPickerStore((state) => state.workspaceKey)
  const close = useStartAgentPickerStore((state) => state.close)
  const cachedProfiles = useStartAgentPickerStore((state) => state.cachedProfiles)
  const setCachedProfiles = useStartAgentPickerStore((state) => state.setCachedProfiles)
  const listCommand = useAppStore(
    (state) => state.settings?.hermesProfileListCommand?.trim() || DEFAULT_HERMES_PROFILE_LIST_COMMAND
  )
  const [profiles, setProfiles] = useState<ProfilesState>({ status: 'loading' })

  useEffect(() => {
    if (workspaceKey === null) {
      return
    }
    let cancelled = false
    // Why: show the last known list instantly (SSH round-trip is ~1-2s) and
    // refresh in the background; the refresh also warms the multiplexed SSH
    // connection the launch command will reuse.
    setProfiles(
      cachedProfiles !== null
        ? { status: 'ready', profiles: cachedProfiles }
        : { status: 'loading' }
    )
    window.api.preflight
      .listHermesProfiles({ command: listCommand })
      .then((result) => {
        if (cancelled) {
          return
        }
        if (!result.ok) {
          if (cachedProfiles === null) {
            setProfiles({ status: 'error', message: result.error ?? 'command failed' })
          }
          return
        }
        const parsed = parseHermesProfileList(result.stdout)
        setCachedProfiles(parsed)
        setProfiles({ status: 'ready', profiles: parsed })
      })
      .catch((error: unknown) => {
        if (!cancelled && cachedProfiles === null) {
          setProfiles({ status: 'error', message: String(error) })
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cachedProfiles is intentionally read once per open
  }, [workspaceKey, listCommand])

  const pick = (choice: StartAgentPickerChoice): void => {
    if (workspaceKey === null) {
      return
    }
    close()
    launchStartAgentPickerChoice(workspaceKey, choice)
  }

  return (
    <Dialog
      open={workspaceKey !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen && workspaceKey !== null) {
          // Why: dismissing still needs a usable surface, so fall back to a plain terminal.
          const key = workspaceKey
          close()
          launchStartAgentPickerChoice(key, { kind: 'terminal' })
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate('auto.components.StartAgentPickerDialog.title', 'Start with which agent?')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.StartAgentPickerDialog.description',
              'Pick the agent for this project’s first tab.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button className="justify-start" onClick={() => pick({ kind: 'claude' })}>
            {translate('auto.components.StartAgentPickerDialog.claude', 'Claude Code (chat)')}
          </Button>
          {profiles.status === 'loading' ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.StartAgentPickerDialog.loading',
                'Loading Hermes profiles…'
              )}
            </p>
          ) : null}
          {profiles.status === 'error' ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.StartAgentPickerDialog.error',
                'Hermes profiles unavailable:'
              )}{' '}
              {profiles.message}
            </p>
          ) : null}
          {profiles.status === 'ready' && profiles.profiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.StartAgentPickerDialog.empty',
                'No Hermes profiles found.'
              )}
            </p>
          ) : null}
          {profiles.status === 'ready'
            ? profiles.profiles.map((profile) => (
                <Button
                  key={profile}
                  variant="secondary"
                  className="justify-start"
                  onClick={() => pick({ kind: 'hermes', profile })}
                >
                  {hermesProfileLabel(profile)}
                </Button>
              ))
            : null}
          <Button variant="outline" className="justify-start" onClick={() => pick({ kind: 'terminal' })}>
            {translate('auto.components.StartAgentPickerDialog.terminal', 'Plain terminal')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
