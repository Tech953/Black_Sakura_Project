Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
Name "Voice Profile Studio 3.0 Offline"
OutFile "Voice_Profile_Studio_3.0.0_Offline_Windows_x64_Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\VoiceProfileStudio"
RequestExecutionLevel user
SetCompressor zlib
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "Software\VoiceProfileStudio"
!define MUI_LANGDLL_REGISTRY_VALUENAME "InstallerLanguage"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "../THIRD_PARTY_NOTICES.md"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\VoiceProfileStudio.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Spanish"
!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_LANGUAGE "German"
!insertmacro MUI_LANGUAGE "Portuguese"
!insertmacro MUI_LANGUAGE "Italian"
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "Japanese"
!insertmacro MUI_LANGUAGE "Korean"
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "Arabic"
!insertmacro MUI_LANGUAGE "Hindi"
!insertmacro MUI_RESERVEFILE_LANGDLL
Function .onInit
 SetRegView 64
 !insertmacro MUI_LANGDLL_DISPLAY
 ${IfNot} ${RunningX64}
  MessageBox MB_OK|MB_ICONSTOP "Windows x64 is required."
  Abort
 ${EndIf}
 ${IfNot} ${AtLeastWin10}
  MessageBox MB_OK|MB_ICONSTOP "Windows 10 or later is required."
  Abort
 ${EndIf}
 SetShellVarContext current
FunctionEnd
Section "Application"
 SetShellVarContext current
 !include "installer_files.nsh"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\Voice Profile Studio"
 CreateShortcut "$SMPROGRAMS\Voice Profile Studio\Voice Profile Studio.lnk" "$INSTDIR\VoiceProfileStudio.exe"
 CreateShortcut "$SMPROGRAMS\Voice Profile Studio\User Guide.lnk" "$INSTDIR\app\docs\User_Guide.pdf"
 CreateShortcut "$DESKTOP\Voice Profile Studio.lnk" "$INSTDIR\VoiceProfileStudio.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceProfileStudio" "DisplayName" "Voice Profile Studio 3.0 Offline"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceProfileStudio" "DisplayVersion" "3.0.0"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceProfileStudio" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceProfileStudio" "UninstallString" '"$INSTDIR\Uninstall.exe"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceProfileStudio" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceProfileStudio" "NoRepair" 1
SectionEnd
Function un.onInit
 SetRegView 64
 !insertmacro MUI_UNGETLANGUAGE
FunctionEnd
Section "Uninstall"
 SetShellVarContext current
 !include "uninstall_files.nsh"
 Delete "$SMPROGRAMS\Voice Profile Studio\Voice Profile Studio.lnk"
 Delete "$SMPROGRAMS\Voice Profile Studio\User Guide.lnk"
 RMDir "$SMPROGRAMS\Voice Profile Studio"
 Delete "$DESKTOP\Voice Profile Studio.lnk"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceProfileStudio"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
SectionEnd
