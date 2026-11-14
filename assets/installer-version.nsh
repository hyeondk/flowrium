!macro customHeader
  BrandingText "Flowrium 261114_02"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "261114_02"
!macroend
