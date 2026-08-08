import React, { useMemo, useState } from 'react'
import { Search, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { SamwooProfileMessageChannel } from '../../../../shared/samwoo-profile-messaging'

type Props = {
  channels: SamwooProfileMessageChannel[]
  selectedKey?: string
  onlineLogins?: readonly string[]
  onSelect: (channel: SamwooProfileMessageChannel) => void
}

function channelInitial(channel: SamwooProfileMessageChannel): string {
  return channel.label.trim().slice(0, 1).toLocaleUpperCase() || '#'
}

function formatChannelTime(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return ''
  }
  const date = new Date(timestamp)
  const today = new Date()
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' }).format(date)
}

export default function ProfileMessengerChannelList({
  channels,
  selectedKey,
  onlineLogins,
  onSelect
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const filteredChannels = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) {
      return channels
    }
    return channels.filter((channel) =>
      `${channel.label} ${channel.lastMessageAuthor ?? ''} ${channel.lastMessagePreview ?? ''}`
        .toLocaleLowerCase()
        .includes(needle)
    )
  }, [channels, query])

  return (
    <aside className="flex min-h-0 flex-col border-b border-border bg-muted/20 sm:border-r sm:border-b-0">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">
            {translate('samwoo.profileMessages.title', 'Messages')}
          </h1>
          {onlineLogins ? (
            <span className="text-xs text-status-success">
              {translate('samwoo.profileMessages.onlineCount', 'Online {{count}}', {
                count: onlineLogins.length
              })}
            </span>
          ) : null}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={query}
            placeholder={translate(
              'samwoo.profileMessages.searchPlaceholder',
              'Search conversations'
            )}
            aria-label={translate(
              'samwoo.profileMessages.searchPlaceholder',
              'Search conversations'
            )}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-sleek">
        {filteredChannels.map((channel) => {
          const label =
            channel.kind === 'team'
              ? translate('samwoo.profileMessages.teamChat', 'Team chat')
              : channel.label
          const online = Boolean(onlineLogins?.some((login) => login === channel.lastMessageAuthor))
          return (
            <button
              key={channel.key}
              type="button"
              data-current={channel.key === selectedKey}
              className="mb-1 grid w-full grid-cols-[32px_minmax(0,1fr)_auto] gap-x-2 rounded-md px-2 py-2 text-left hover:bg-accent data-[current=true]:bg-accent"
              onClick={() => onSelect(channel)}
            >
              <span className="relative row-span-2 flex size-8 items-center justify-center rounded-lg bg-muted text-xs font-semibold">
                {channel.kind === 'team' ? <Users className="size-4" /> : channelInitial(channel)}
                {online ? (
                  <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background bg-status-success" />
                ) : null}
              </span>
              <span className="truncate text-sm font-medium">{label}</span>
              <span className="text-[11px] text-muted-foreground">
                {formatChannelTime(channel.lastMessageAt)}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {channel.lastMessagePreview
                  ? `${channel.lastMessageAuthor ?? ''}: ${channel.lastMessagePreview}`
                  : translate('samwoo.profileMessages.empty', 'No messages yet.')}
              </span>
              {channel.unreadCount > 0 ? (
                <Badge className="h-5 min-w-5 px-1.5 text-[10px]">
                  {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
                </Badge>
              ) : null}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
