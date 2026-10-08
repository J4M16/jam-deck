param([string]$OutputDirectory = '.cache/island-capture-windows-x64')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'Visual C++ build tools are required.' }
$dev = Join-Path $installation 'Common7/Tools/Launch-VsDevShell.ps1'
& $dev -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
$output = Join-Path $root $OutputDirectory
New-Item -ItemType Directory -Force -Path $output | Out-Null
Push-Location $output
try {
    & cl.exe /nologo /std:c++17 /O2 /MT /EHsc /utf-8 /DWIN32_LEAN_AND_MEAN (Join-Path $root 'native/island-capture/main.cpp') /Fe:island-capture-windows-x64.exe /link windowsapp.lib d3d11.lib windowscodecs.lib ole32.lib oleaut32.lib user32.lib /SUBSYSTEM:CONSOLE
    if ($LASTEXITCODE -ne 0) { throw 'Windows island helper build failed.' }
    Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $output 'island-capture-windows-x64.exe')
} finally { Pop-Location }
