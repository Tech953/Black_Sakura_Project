#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wchar.h>
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE previous,LPWSTR args,int show){
 wchar_t base[32768],python[32768],command[32768];
 DWORD len=GetModuleFileNameW(NULL,base,32768);if(!len||len>=32768)return 1;
 wchar_t *last=wcsrchr(base,L'\\');if(!last)return 1;*last=0;
 if(swprintf(python,32768,L"%ls\\runtime\\pythonw.exe",base)<0)return 1;
 if(GetFileAttributesW(python)==INVALID_FILE_ATTRIBUTES){MessageBoxW(NULL,L"The bundled runtime is missing. Reinstall FULL_REZZ.",L"FULL_REZZ",MB_ICONERROR);return 1;}
 SetEnvironmentVariableW(L"VOICE_STUDIO_OFFLINE",L"1");
 swprintf(command,32768,L"\"%ls\" -m voice_studio.desktop",python);
 STARTUPINFOW info={0};info.cb=sizeof(info);PROCESS_INFORMATION process={0};
 if(!CreateProcessW(python,command,NULL,NULL,FALSE,0,NULL,base,&info,&process)){MessageBoxW(NULL,L"FULL_REZZ could not start its bundled runtime.",L"FULL_REZZ",MB_ICONERROR);return 1;}
 CloseHandle(process.hThread);WaitForSingleObject(process.hProcess,INFINITE);DWORD result;GetExitCodeProcess(process.hProcess,&result);CloseHandle(process.hProcess);return result;
}
