!macro customHeader
  BrandingText "Flowrium 261118_07"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "261118_07"
!macroend
