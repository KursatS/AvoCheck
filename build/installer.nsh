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
!macroend
