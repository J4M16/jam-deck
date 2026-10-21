param([string]$OutputDirectory = '.cache/external-drag-windows-x64')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'Visual C++ build tools are required.' }
& (Join-Path $installation 'Common7/Tools/Launch-VsDevShell.ps1') -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
$output = Join-Path $root $OutputDirectory
New-Item -ItemType Directory -Force -Path $output | Out-Null
$headers = Join-Path $root '.cache/drag-build/node_modules/node-api-headers'
if (!(Test-Path (Join-Path $headers 'include/node_api.h'))) {
    & npm install --prefix (Join-Path $root '.cache/drag-build') --no-save --ignore-scripts node-api-headers@1.9.0
    if ($LASTEXITCODE -ne 0) { throw 'Node-API build headers could not be installed.' }
}
Push-Location $output
try {
    & lib.exe /nologo /machine:x64 "/def:$(Join-Path $headers 'def/node_api.def')" /out:node-api.lib
    if ($LASTEXITCODE -ne 0) { throw 'Node-API import library build failed.' }
    & cl.exe /nologo /std:c++17 /O2 /MT /EHsc /utf-8 /W4 /LD /DNAPI_VERSION=8 /DNODE_GYP_MODULE_NAME=jam_deck_external_drag "/I$(Join-Path $headers 'include')" (Join-Path $root 'native/external-drag/main.cpp') /Fe:external-drag-windows-x64.node /link node-api.lib delayimp.lib /DELAYLOAD:NODE.EXE ole32.lib oleaut32.lib shell32.lib user32.lib uuid.lib
    if ($LASTEXITCODE -ne 0) { throw 'Windows external drag build failed.' }
    & node (Join-Path $root 'tests/external-drag-native-test.js') (Join-Path $output 'external-drag-windows-x64.node')
    if ($LASTEXITCODE -ne 0) { throw 'Windows drag format self-test failed.' }
} finally { Pop-Location }
