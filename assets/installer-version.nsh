!macro customHeader
  BrandingText "Flowrium 261115_01"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "261115_01"
!macroend
