; Clean up the relocated terminal daemon on a REAL uninstall.
;
; Why: the daemon host is deliberately copied to a distinct image name
; (samwoo-orca-terminal-daemon.exe) under %LOCALAPPDATA%\SAMWOO-ORCA\daemon-host so that app
; UPDATES cannot kill it — that relocation is what keeps terminals alive across
; updates. The same design means a normal uninstall's process sweep and file
; removal both miss it, leaving an orphaned daemon plus its runtime copy behind.
;
; The ${isUpdated} guard is essential: electron-builder runs this uninstaller as
; part of uninstallOldVersion on EVERY update, and killing the daemon there would
; defeat the whole feature. Only clean up on a genuine uninstall.
;
; The image name and the LOCALAPPDATA folder name must stay in sync with
; DAEMON_HOST_EXE_NAME and LOCAL_HOST_ROOT_NAME in
; src/main/daemon/daemon-host-relocation.ts.

; Why: exposing the Windows account name in the install-mode choice is unnecessary and confusing.
!ifndef BUILD_UNINSTALLER
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SamwooInstallModePageShow

  !macro customHeader
    Function SamwooInstallModePageShow
      SendMessage $MultiUser.InstallModePage.CurrentUser ${WM_SETTEXT} 0 "STR:현재 사용자"
    FunctionEnd
  !macroend

  ; Updates use the native progress page, then close and relaunch without requiring a Finish click.
  !macro customFinishPage
    ; Why: LogicLib is available only when electron-builder expands this page macro.
    Function SamwooFinishPagePre
      ${if} ${isUpdated}
        Abort
      ${endIf}
    FunctionEnd

    !define MUI_PAGE_CUSTOMFUNCTION_PRE SamwooFinishPagePre
    !insertmacro MUI_PAGE_FINISH
  !macroend

  !macro customInstall
    ${if} ${isUpdated}
    ${andIfNot} ${Silent}
      HideWindow
      !insertmacro StartApp
    ${endIf}
  !macroend
!endif

!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec 'taskkill /F /IM samwoo-orca-terminal-daemon.exe'
    ; Give the OS a moment to release the image lock before removing the tree.
    Sleep 500
    RMDir /r "$LOCALAPPDATA\SAMWOO-ORCA\daemon-host"
  ${endIf}
!macroend
