!macro customHeader
  BrandingText "Flowrium 261127_04"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "261127_04"
!macroend
