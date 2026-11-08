!macro customHeader
  !system "echo 'AvoCheck NSIS build ready.'"
!macroend

!macro customInit
  ; Terminate all running processes so files are unlocked
  nsExec::Exec 'taskkill /F /IM "RecciTek WCheck.exe" /T'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "AvoCheck.exe" /T'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "TextExpander.exe" /T'
  Pop $0
  Sleep 1000

  ; Purge legacy RecciTek directory immediately so old exe cannot survive
  Delete "$LOCALAPPDATA\Programs\RecciTek WCheck\RecciTek WCheck.exe"
  Delete "$LOCALAPPDATA\Programs\RecciTek WCheck\Uninstall RecciTek WCheck.exe"
  RMDir /r "$LOCALAPPDATA\Programs\RecciTek WCheck"

  ; Update registry keys to point to clean AvoCheck path
  WriteRegStr HKCU "Software\${APP_GUID}" InstallLocation "$LOCALAPPDATA\Programs\AvoCheck"
  WriteRegStr HKCU "Software\${APP_GUID}" ShortcutName "AvoCheck"
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\AvoCheck"
!macroend

!macro customInstallMode
  ; When auto-updating, silently bypass the install mode page and stay in current user mode
  ${if} ${isUpdated}
    StrCpy $isForceCurrentInstall "1"
  ${endif}
!macroend

!macro customInstall
  ; Cleanup legacy desktop & start menu shortcuts from old RecciTek installations
  Delete "$DESKTOP\RecciTek WCheck.lnk"
  Delete "$SMPROGRAMS\RecciTek WCheck.lnk"
  Delete "$SMPROGRAMS\RecciTek WCheck\RecciTek WCheck.lnk"
  RMDir /r "$SMPROGRAMS\RecciTek WCheck"

  ; Explicitly create modern Desktop & Start Menu shortcuts for AvoCheck
  CreateShortCut "$DESKTOP\AvoCheck.lnk" "$INSTDIR\AvoCheck.exe" "" "$INSTDIR\AvoCheck.exe" 0 "" "" "AvoCheck"
  CreateShortCut "$SMPROGRAMS\AvoCheck.lnk" "$INSTDIR\AvoCheck.exe" "" "$INSTDIR\AvoCheck.exe" 0 "" "" "AvoCheck"

  ; When auto-updating, launch the new app immediately and quit installer so user never hangs
  ${if} ${isUpdated}
    ExecShell "open" "$INSTDIR\AvoCheck.exe" ""
    Quit
  ${endif}
!macroend
