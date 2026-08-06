export type QuitAndInstallFlags = {
  isSilent: boolean
  isForceRunAfter: boolean
}

export function resolveQuitAndInstallFlags(
  platform: NodeJS.Platform,
  supervisorOwnsRelaunch: boolean
): QuitAndInstallFlags {
  return {
    isSilent: supervisorOwnsRelaunch || platform === 'win32',
    isForceRunAfter: !supervisorOwnsRelaunch
  }
}
