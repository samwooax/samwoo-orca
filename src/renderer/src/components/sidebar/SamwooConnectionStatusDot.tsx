import React, { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'

type ConnectionStatus = 'checking' | 'online' | 'offline'

const POLL_MS = 30_000

export default function SamwooConnectionStatusDot(): React.JSX.Element | null {
  const auth = useSamwooAuthStore((state) => state.auth)
  const signedIn = Boolean(auth)
  const [status, setStatus] = useState<ConnectionStatus>('checking')
  const [latencyMs, setLatencyMs] = useState<number | null>(null)

  useEffect(() => {
    if (!signedIn) {
      return
    }
    let disposed = false
    const probe = async (): Promise<void> => {
      const result = await window.api.preflight.samwooConnectionHealth()
      if (disposed) {
        return
      }
      setStatus(result.ok ? 'online' : 'offline')
      setLatencyMs(result.ok && typeof result.latencyMs === 'number' ? result.latencyMs : null)
    }
    void probe()
    const interval = window.setInterval(() => void probe(), POLL_MS)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [signedIn])

  if (!signedIn) {
    return null
  }

  const label =
    status === 'online'
      ? latencyMs === null
        ? translate('samwoo.connection.online', 'Connected to the SAMWOO server.')
        : translate(
            'samwoo.connection.onlineWithLatency',
            'Connected to the SAMWOO server ({{ms}}ms).',
            { ms: latencyMs }
          )
      : status === 'offline'
        ? translate(
            'samwoo.connection.offline',
            'Cannot reach the SAMWOO server. Check that Tailscale is connected, then retry.'
          )
        : translate('samwoo.connection.checking', 'Checking the SAMWOO server connection…')
  const shortLabel =
    status === 'online'
      ? translate('samwoo.connection.onlineShort', 'SAMWOO server connected')
      : status === 'offline'
        ? translate('samwoo.connection.offlineShort', 'SAMWOO server offline')
        : translate('samwoo.connection.checkingShort', 'Checking SAMWOO server')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex min-w-0 items-center gap-2 border-t border-worktree-sidebar-border px-3 py-2 text-xs text-worktree-sidebar-foreground/60"
          role="status"
          aria-live="polite"
          aria-label={label}
        >
          <span
            data-status={status}
            className="size-2 rounded-full bg-muted-foreground/50 data-[status=offline]:bg-destructive data-[status=online]:bg-status-success"
          />
          <span className="min-w-0 truncate">
            {shortLabel}
            {auth?.login ? ` · ${auth.login}` : ''}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
