import { useEffect } from 'react'
import { create } from 'zustand'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'

type ConnectionStatus = 'checking' | 'online' | 'offline'

type ConnectionHealthState = {
  status: ConnectionStatus
  latencyMs: number | null
}

const POLL_MS = 30_000
const useConnectionHealth = create<ConnectionHealthState>(() => ({
  status: 'checking',
  latencyMs: null
}))
let consumers = 0
let intervalId: number | null = null
let probeGeneration = 0

async function probe(generation: number): Promise<void> {
  const result = await window.api.preflight.samwooConnectionHealth()
  if (generation !== probeGeneration) {
    return
  }
  useConnectionHealth.setState({
    status: result.ok ? 'online' : 'offline',
    latencyMs: result.ok && typeof result.latencyMs === 'number' ? result.latencyMs : null
  })
}

function retainConnectionProbe(): () => void {
  consumers += 1
  if (consumers === 1) {
    const generation = ++probeGeneration
    useConnectionHealth.setState({ status: 'checking', latencyMs: null })
    void probe(generation)
    intervalId = window.setInterval(() => void probe(generation), POLL_MS)
  }
  return () => {
    consumers = Math.max(0, consumers - 1)
    if (consumers === 0 && intervalId !== null) {
      window.clearInterval(intervalId)
      intervalId = null
      probeGeneration += 1
    }
  }
}

function connectionLabel(status: ConnectionStatus, latencyMs: number | null): string {
  if (status === 'online') {
    return latencyMs === null
      ? translate('samwoo.connection.online', 'Connected to the SAMWOO server.')
      : translate(
          'samwoo.connection.onlineWithLatency',
          'Connected to the SAMWOO server ({{ms}}ms).',
          { ms: latencyMs }
        )
  }
  return status === 'offline'
    ? translate(
        'samwoo.connection.offline',
        'Cannot reach the SAMWOO server. Check that Tailscale is connected, then retry.'
      )
    : translate('samwoo.connection.checking', 'Checking the SAMWOO server connection…')
}

export default function SamwooServerConnectionIndicator(): React.JSX.Element | null {
  const signedIn = useSamwooAuthStore((state) => Boolean(state.auth))
  const { status, latencyMs } = useConnectionHealth()

  useEffect(() => (signedIn ? retainConnectionProbe() : undefined), [signedIn])

  if (!signedIn) {
    return null
  }
  const label = connectionLabel(status, latencyMs)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-status={status}
          className="mr-1 size-2 shrink-0 rounded-full bg-muted-foreground/50 data-[status=offline]:bg-destructive data-[status=online]:bg-status-success"
          aria-label={label}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
