!macro customHeader
  !system "echo 'AvoCheck NSIS build ready.'"
!macroend

!macro customInit
  ; Old and new processes termination to prevent locked files during auto-update
  nsExec::Exec 'taskkill /F /IM "RecciTek WCheck.exe" /T'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "AvoCheck.exe" /T'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "TextExpander.exe" /T'
  Pop $0

  ; Enforce clean modern install directory, avoiding nested 'RecciTek WCheck\AvoCheck'
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

  ; Cleanup obsolete legacy RecciTek directory if leftover from uninstaller
  RMDir /r "$LOCALAPPDATA\Programs\RecciTek WCheck"

  ; When auto-updating, launch the new app immediately and quit installer so user never hangs
  ${if} ${isUpdated}
    ExecShell "open" "$INSTDIR\AvoCheck.exe" ""
    Quit
  ${endif}
!macroend
