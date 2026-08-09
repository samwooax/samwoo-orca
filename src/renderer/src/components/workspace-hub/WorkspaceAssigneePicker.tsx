import { Check, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { canonicalSamwooLogin } from '../../../../shared/samwoo-login-identity'
import type { SamwooProfileMember } from '../../../../shared/samwoo-profile-members'

function memberInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?'
}

function AssigneeAvatars({
  selectedLogins
}: {
  selectedLogins: readonly string[]
}): React.JSX.Element {
  if (!selectedLogins.length) {
    return <Plus className="size-3.5" />
  }
  return (
    <span className="flex -space-x-1">
      {selectedLogins.slice(0, 3).map((login) => (
        <span
          key={login}
          className="flex size-5 items-center justify-center rounded-full border border-background bg-muted text-[10px] font-medium text-foreground"
        >
          {memberInitial(login)}
        </span>
      ))}
      {selectedLogins.length > 3 ? (
        <span className="flex size-5 items-center justify-center rounded-full border border-background bg-muted text-[10px] text-muted-foreground">
          +{selectedLogins.length - 3}
        </span>
      ) : null}
    </span>
  )
}

export default function WorkspaceAssigneePicker({
  members,
  selectedLogins,
  ownLogin,
  canEdit,
  updating,
  selectionMode = 'multiple',
  onChange
}: {
  members: readonly SamwooProfileMember[]
  selectedLogins: readonly string[]
  ownLogin: string
  canEdit: boolean
  updating: boolean
  selectionMode?: 'multiple' | 'single'
  onChange: (logins: string[]) => void
}): React.JSX.Element {
  const selected = new Set(selectedLogins.map(canonicalSamwooLogin))
  const selectedLabel = selectedLogins.length
    ? selectionMode === 'single'
      ? selectedLogins[0]
      : translate('samwoo.workspaceHub.assigneeCount', '{{count}} assignees', {
          count: selectedLogins.length
        })
    : translate('samwoo.workspaceHub.unassigned', 'Unassigned')
  const toggle = (login: string): void => {
    const key = canonicalSamwooLogin(login)
    onChange(
      selected.has(key)
        ? selectedLogins.filter((candidate) => canonicalSamwooLogin(candidate) !== key)
        : selectionMode === 'single'
          ? [login]
          : [...selectedLogins, login]
    )
  }

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 max-w-full px-1.5"
      disabled={updating || !canEdit}
      aria-label={selectedLabel}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {updating ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <AssigneeAvatars selectedLogins={selectedLogins} />
      )}
    </Button>
  )

  if (!canEdit) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="top">{selectedLabel}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        align="start"
        onClick={(event) => event.stopPropagation()}
      >
        <Command>
          <CommandInput
            placeholder={translate('samwoo.workspaceHub.searchMembers', 'Search members…')}
          />
          <CommandList>
            <CommandEmpty>
              {translate('samwoo.workspaceHub.noMembers', 'No profile members found.')}
            </CommandEmpty>
            <CommandGroup
              heading={translate('samwoo.workspaceHub.profileMembers', 'Hermes profile members')}
            >
              {members.map((member) => {
                const checked = selected.has(canonicalSamwooLogin(member.login))
                return (
                  <CommandItem
                    key={member.login}
                    value={member.login}
                    onSelect={() => toggle(member.login)}
                  >
                    {selectionMode === 'multiple' ? (
                      <Checkbox
                        checked={checked}
                        tabIndex={-1}
                        aria-hidden
                        className="pointer-events-none"
                      />
                    ) : null}
                    <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {memberInitial(member.login)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{member.login}</span>
                    </span>
                    {canonicalSamwooLogin(member.login) === canonicalSamwooLogin(ownLogin) ? (
                      <span className="text-[11px] text-muted-foreground">
                        {translate('samwoo.workspaceHub.me', 'Me')}
                      </span>
                    ) : null}
                    {checked ? <Check className="text-status-success" /> : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
