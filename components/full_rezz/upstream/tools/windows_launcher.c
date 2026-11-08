#ifndef UNICODE
#define UNICODE
#endif
#define _UNICODE
#include <windows.h>
#include <wchar.h>
int WINAPI wWinMain(HINSTANCE h,HINSTANCE prev,LPWSTR args,int show) {
    wchar_t root[32768],python[32768],app[32768],command[65536];
    if (!GetModuleFileNameW(NULL,root,32768)) return 1;
    wchar_t *end=wcsrchr(root,L'\\'); if(!end) return 1; *end=0;
    swprintf(python,32768,L"%ls\\python\\pythonw.exe",root);
    swprintf(app,32768,L"%ls\\app",root);
    swprintf(command,65536,L"\"%ls\" -X utf8 \"%ls\\launch.py\"",python,app);
    STARTUPINFOW startup={sizeof(startup)}; PROCESS_INFORMATION process={0};
    if(!CreateProcessW(python,command,NULL,NULL,FALSE,0,NULL,app,&startup,&process)) {
        MessageBoxW(NULL,L"FULL_REZZ could not start its bundled runtime. Repair with the complete installer.",L"FULL_REZZ",MB_OK|MB_ICONERROR);return 1;
    }
    CloseHandle(process.hThread);CloseHandle(process.hProcess);return 0;
}
