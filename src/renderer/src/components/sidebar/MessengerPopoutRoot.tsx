import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useSamwooAuthStore, type SamwooAuth } from '@/lib/samwoo-auth-store'
import ProfileMessengerWindow from './ProfileMessengerWindow'

export default function MessengerPopoutRoot({
  initialChannelKey
}: {
  initialChannelKey?: string | null
}): React.JSX.Element {
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
  return <ProfileMessengerWindow initialChannelKey={initialChannelKey} />
}
