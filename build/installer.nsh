!macro customUnInit
  ; Check all-users context (C:\ProgramData)
  SetShellVarContext all
  IfFileExists "$APPDATA\Focus\uninstall-allowed.flag" UninstAllowed 0
  IfFileExists "$APPDATA\focus-desktop\uninstall-allowed.flag" UninstAllowed 0

  ; Check current-user context (AppData\Roaming)
  SetShellVarContext current
  IfFileExists "$APPDATA\Focus\uninstall-allowed.flag" UninstAllowed 0
  IfFileExists "$APPDATA\focus-desktop\uninstall-allowed.flag" UninstAllowed UninstBlocked

  UninstBlocked:
    Exec '"$INSTDIR\Focus.exe" --uninstall-challenge'
    Abort

  UninstAllowed:
    SetShellVarContext all
    Delete "$APPDATA\Focus\uninstall-allowed.flag"
    Delete "$APPDATA\focus-desktop\uninstall-allowed.flag"
    SetShellVarContext current
    Delete "$APPDATA\Focus\uninstall-allowed.flag"
    Delete "$APPDATA\focus-desktop\uninstall-allowed.flag"
    ; Continue uninstallation normally
!macroend
