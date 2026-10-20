param([string]$OutputDirectory = '.cache/external-drag-windows-x64')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'Visual C++ build tools are required.' }
& (Join-Path $installation 'Common7/Tools/Launch-VsDevShell.ps1') -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
$output = Join-Path $root $OutputDirectory
New-Item -ItemType Directory -Force -Path $output | Out-Null
Push-Location $output
try {
    & cl.exe /nologo /std:c++17 /O2 /MT /EHsc /utf-8 /W4 (Join-Path $root 'native/external-drag/main.cpp') /Fe:external-drag-windows-x64.exe /link ole32.lib oleaut32.lib shell32.lib user32.lib uuid.lib /SUBSYSTEM:CONSOLE
    if ($LASTEXITCODE -ne 0) { throw 'Windows external drag build failed.' }
    & (Join-Path $output 'external-drag-windows-x64.exe') --self-test
    if ($LASTEXITCODE -ne 0) { throw 'Windows drag format self-test failed.' }
} finally { Pop-Location }
