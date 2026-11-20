!macro customHeader
  BrandingText "Flowrium 261120_05"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "261120_05"
!macroend
