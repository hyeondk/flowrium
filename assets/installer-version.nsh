!macro customHeader
  BrandingText "Flowrium 261117_01"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "261117_01"
!macroend
