@echo off
setlocal
cd /d "%~dp0.."
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "JD_VS=%%i"
if not defined JD_VS exit /b 1
call "%JD_VS%\VC\Auxiliary\Build\vcvars64.bat" >nul
if not exist .cache mkdir .cache
cl /nologo /std:c++17 /EHsc /O2 /MT /DUNICODE /D_UNICODE native\island-glass\windows.cpp /Fe:.cache\island-glass.exe /Fo:.cache\island-glass.obj /link /Brepro windowsapp.lib user32.lib dwmapi.lib CoreMessaging.lib
if errorlevel 1 exit /b 1
node scripts\embed-island-glass.js
