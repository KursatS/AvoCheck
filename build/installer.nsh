!macro customHeader
  !system "echo 'AvoCheck NSIS build ready.'"
!macroend

!macro customInit
  ; Old and new processes termination to prevent locked files during auto-update
  nsExec::Exec 'taskkill /F /IM "RecciTek WCheck.exe" /T'
  nsExec::Exec 'taskkill /F /IM "AvoCheck.exe" /T'
  nsExec::Exec 'taskkill /F /IM "TextExpander.exe" /T'
!macroend

!macro customInstall
  ; Cleanup legacy desktop & start menu shortcuts from old RecciTek installations
  Delete "$DESKTOP\RecciTek WCheck.lnk"
  Delete "$SMPROGRAMS\RecciTek WCheck.lnk"
  Delete "$SMPROGRAMS\RecciTek WCheck\RecciTek WCheck.lnk"
!macroend
