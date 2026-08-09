import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSamwooAuthStore, type SamwooAuth } from '@/lib/samwoo-auth-store'
import { useSamwooEventStream } from '@/hooks/useSamwooEventStream'
import ProfileMessengerWindow from './ProfileMessengerWindow'

export default function MessengerPopoutRoot({
  initialChannelKey
}: {
  initialChannelKey?: string | null
}): React.JSX.Element {
  useSamwooEventStream(false)
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    const offSession = window.api.messenger.onSession((session) => {
      useSamwooAuthStore.setState({ auth: session as SamwooAuth | null })
      setSessionReady(true)
    })
    void window.api.messenger.requestSession()
    return offSession
  }, [])

  if (!sessionReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  // Why: the popout has a separate React root and cannot inherit App's tooltip context.
  return (
    <TooltipProvider delayDuration={400}>
      <ProfileMessengerWindow initialChannelKey={initialChannelKey} />
    </TooltipProvider>
  )
}
