Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "FULL_REZZ 2.0 Offline Studio"
OutFile "FULL_REZZ_2.0_Offline_Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\FULL_REZZ"
RequestExecutionLevel user
SetCompressor zlib
SetDatablockOptimize on
VIProductVersion "2.0.0.0"
VIAddVersionKey "ProductName" "FULL_REZZ"
VIAddVersionKey "FileDescription" "FULL_REZZ offline installer"
VIAddVersionKey "FileVersion" "2.0.0"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "windows_bundle/app/THIRD_PARTY_NOTICES.md"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_OK|MB_ICONSTOP "FULL_REZZ requires 64-bit Windows."
  Abort
 ${EndIf}
FunctionEnd
Section "FULL_REZZ"
 SetOutPath "$INSTDIR"
 !include "payload_files.nsh"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\FULL_REZZ"
 CreateShortcut "$SMPROGRAMS\FULL_REZZ\FULL_REZZ.lnk" "$INSTDIR\FULL_REZZ.exe"
 CreateShortcut "$SMPROGRAMS\FULL_REZZ\User guide.lnk" "$INSTDIR\app\docs\User_Guide.pdf"
 CreateShortcut "$DESKTOP\FULL_REZZ.lnk" "$INSTDIR\FULL_REZZ.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FULL_REZZ" "DisplayName" "FULL_REZZ 2.0 Offline Studio"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FULL_REZZ" "UninstallString" '"$INSTDIR\Uninstall.exe"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FULL_REZZ" "DisplayVersion" "2.0.0"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FULL_REZZ" "InstallLocation" "$INSTDIR"
SectionEnd
Section "Uninstall"
 Delete "$DESKTOP\FULL_REZZ.lnk"
 RMDir /r "$SMPROGRAMS\FULL_REZZ"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FULL_REZZ"
 !include "uninstall_files.nsh"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
SectionEnd
