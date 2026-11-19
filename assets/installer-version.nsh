!macro customHeader
  BrandingText "Flowrium 261119_08"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "261119_08"
!macroend
