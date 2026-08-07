export type QuitAndInstallFlags = {
  isSilent: boolean
  isForceRunAfter: boolean
}

export function resolveQuitAndInstallFlags(
  _platform: NodeJS.Platform,
  supervisorOwnsRelaunch: boolean
): QuitAndInstallFlags {
  return {
    // Why: the Windows NSIS update page is the only UI that survives after Electron exits.
    isSilent: supervisorOwnsRelaunch,
    isForceRunAfter: !supervisorOwnsRelaunch
  }
}
