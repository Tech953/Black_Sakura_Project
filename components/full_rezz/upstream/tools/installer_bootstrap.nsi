Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "FULL_REZZ 3.0 Offline Character Studio"
OutFile "FULL_REZZ_3.0_Bootstrap.exe"
InstallDir "$LOCALAPPDATA\Programs\FULL_REZZ"
RequestExecutionLevel user
SetCompressor zlib
CRCCheck off
VIProductVersion "3.0.0.0"
VIAddVersionKey "ProductName" "FULL_REZZ"
VIAddVersionKey "FileVersion" "3.0.0"
VIAddVersionKey "FileDescription" "FULL_REZZ Offline Character Studio"
VIAddVersionKey "LegalCopyright" "See bundled component notices"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
__LANGUAGE_MACROS__
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_OK|MB_ICONSTOP "FULL_REZZ requires 64-bit Windows."
  Abort
 ${EndIf}
 !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd
Section "FULL_REZZ"
 InitPluginsDir
 SetOutPath "$PLUGINSDIR"
 !include "bootstrap_files.nsh"
 DetailPrint "Verifying the complete offline payload..."
 ExecWait '"$PLUGINSDIR\python.exe" "$PLUGINSDIR\install_payload.py" "$EXEPATH" "$INSTDIR"' $0
 ${If} $0 != 0
  MessageBox MB_OK|MB_ICONSTOP "Installation failed. Close FULL_REZZ, check free disk space and retry. Existing workspace data was retained."
  Abort
 ${EndIf}
 SetOutPath "$INSTDIR"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\FULL_REZZ"
 CreateShortcut "$SMPROGRAMS\FULL_REZZ\FULL_REZZ.lnk" "$INSTDIR\FULL_REZZ.exe"
 CreateShortcut "$DESKTOP\FULL_REZZ.lnk" "$INSTDIR\FULL_REZZ.exe"
 WriteRegStr HKCU "Software\VoiceProfileStudio" "InstallerLanguage" "$LANGUAGE"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FULL_REZZ" "DisplayName" "FULL_REZZ 3.0 Offline Character Studio"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FULL_REZZ" "DisplayVersion" "3.0.0"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FULL_REZZ" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
 Delete "$DESKTOP\FULL_REZZ.lnk"
 Delete "$SMPROGRAMS\FULL_REZZ\FULL_REZZ.lnk"
 RMDir "$SMPROGRAMS\FULL_REZZ"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FULL_REZZ"
 !include "uninstall_files.nsh"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
SectionEnd
