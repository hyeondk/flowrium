!macro customHeader
  BrandingText "Flowrium 261124_05"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "261124_05"
!macroend
