!macro customHeader
  BrandingText "Flowrium 261123_03"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "261123_03"
!macroend
