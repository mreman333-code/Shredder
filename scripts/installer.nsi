; Shredder installer. Built by scripts/make-installer.mjs with:
;   /DVERSION /DSOURCE /DOUTFILE /DAPPICON /DPUBLISHER
; Installs to a fixed path so the documented MCP configuration works unchanged.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef SOURCE
  !error "SOURCE must point at the packaged Shredder folder"
!endif
!ifndef OUTFILE
  !define OUTFILE "Shredder-Setup.exe"
!endif
!ifndef APPICON
  !define APPICON "build\icon.ico"
!endif
!ifndef PUBLISHER
  !define PUBLISHER "Shredder"
!endif

!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Shredder"
!define APP_KEY "Software\Shredder"

Name "Shredder"
Caption "Shredder ${VERSION} Setup"
OutFile "${OUTFILE}"
; Fixed install path: docs/ai/mcp.example.json points here, so do not move it.
InstallDir "C:\Shredder"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "Shredder — desktop character modeler"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Shredder"
VIAddVersionKey "FileDescription" "Shredder installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "LegalCopyright" "© Shredder"

!define MUI_ICON "${APPICON}"
!define MUI_UNICON "${APPICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install Shredder ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Shredder installs to C:\Shredder so the AI/MCP configuration always finds it.$\r$\n$\r$\nYour projects live in Documents\Shredder and are not touched by installing or uninstalling."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Shredder.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Shredder"
!insertmacro MUI_PAGE_FINISH

!define MUI_UNCONFIRMPAGE_TEXT_TOP "Shredder will be removed. Projects in Documents\Shredder are kept."
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetRegView 64

  ; Overwriting a running exe fails; MCP servers also run as Shredder.exe.
  nsExec::ExecToStack 'cmd /C tasklist /FI "IMAGENAME eq Shredder.exe" /NH | findstr /I "Shredder.exe"'
  Pop $0
  Pop $1
  ${If} $1 != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "Shredder is running. Close the app (and any MCP client using it), then run the installer again."
    Abort
  ${EndIf}
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Section "Shredder (required)" SEC_MAIN
  SectionIn RO
  SetShellVarContext all
  SetOutPath "$INSTDIR"
  File /r "${SOURCE}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Shredder"
  CreateShortcut "$SMPROGRAMS\Shredder\Shredder.lnk" "$INSTDIR\Shredder.exe" "" "$INSTDIR\Shredder.exe" 0
  CreateShortcut "$SMPROGRAMS\Shredder\Uninstall Shredder.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKLM "${APP_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${APP_KEY}" "Version" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\Shredder.exe" "" "$INSTDIR\Shredder.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\Shredder.exe" "Path" "$INSTDIR"

  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "Shredder"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\Shredder.exe,0"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section /o "Desktop shortcut" SEC_DESKTOP
  SetShellVarContext all
  CreateShortcut "$DESKTOP\Shredder.lnk" "$INSTDIR\Shredder.exe" "" "$INSTDIR\Shredder.exe" 0
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MAIN} "Shredder ${VERSION}, the local AI bridge and connector files."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} "Add a Shredder shortcut on the desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  SetShellVarContext all

  Delete "$SMPROGRAMS\Shredder\Shredder.lnk"
  Delete "$SMPROGRAMS\Shredder\Uninstall Shredder.lnk"
  RMDir "$SMPROGRAMS\Shredder"
  Delete "$DESKTOP\Shredder.lnk"

  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "${APP_KEY}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\Shredder.exe"

  ; Remove the program files only. Projects live in Documents\Shredder.
  RMDir /r "$INSTDIR"
SectionEnd
