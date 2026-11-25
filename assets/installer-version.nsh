!macro customHeader
  BrandingText "Flowrium 261126_01"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "261126_01"
!macroend
