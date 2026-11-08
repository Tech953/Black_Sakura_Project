#include <windows.h>
#include <wchar.h>
int WINAPI wWinMain(HINSTANCE h,HINSTANCE old,LPWSTR args,int show){
 wchar_t root[32768],exe[32768],cmd[32768];GetModuleFileNameW(NULL,root,32768);wchar_t *p=wcsrchr(root,L'\\');if(!p)return 1;*p=0;
 _snwprintf(exe,32768,L"%ls\\python\\pythonw.exe",root);_snwprintf(cmd,32768,L"\"%ls\" \"%ls\\app\\launch.py\"",exe,root);
 STARTUPINFOW si={0};si.cb=sizeof(si);PROCESS_INFORMATION pi={0};
 if(!CreateProcessW(exe,cmd,NULL,NULL,FALSE,0,NULL,root,&si,&pi)){MessageBoxW(NULL,L"The bundled application could not start. Reinstall the complete offline package.",L"Voice Profile Studio",MB_OK|MB_ICONERROR);return 1;}CloseHandle(pi.hThread);CloseHandle(pi.hProcess);return 0;
}
