import { useEffect, useState } from 'react'

const WIDE_LAYOUT_QUERY = '(min-width: 1024px)'

export function useWorkspaceHubWideLayout(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE_LAYOUT_QUERY).matches ?? true)

  useEffect(() => {
    const media = window.matchMedia?.(WIDE_LAYOUT_QUERY)
    if (!media) {
      return
    }
    const update = (): void => setWide(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return wide
}
