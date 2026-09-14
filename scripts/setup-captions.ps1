param([string]$Python = "python", [string]$InstallDir = "", [string]$ModelArchive = "")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Get-CaptionHash([string]$File) {
  $stream = [IO.File]::OpenRead($File)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "") }
  finally { $sha.Dispose(); $stream.Dispose() }
}
$captionRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA "JamDeck/captions" }
$captionCache = [IO.Path]::GetFullPath($InstallDir)
$captionSpec = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "caption-model.json") | ConvertFrom-Json
& $Python -c "import sys,struct; assert sys.version_info[:2] == (3,12) and struct.calcsize('P') == 8, 'Python 3.12 x64 is required'"
if ($LASTEXITCODE -ne 0) { throw "Install Python 3.12 x64 and add it to PATH, or pass -Python <python.exe>." }
$captionEnv = Join-Path $captionCache "caption-runtime"
$captionPython = Join-Path $captionEnv "Scripts/python.exe"
$captionModelName = $captionSpec.name
$captionModel = Join-Path $captionCache $captionModelName
New-Item -ItemType Directory -Force -Path $captionCache | Out-Null
if (-not (Test-Path -LiteralPath $captionPython)) {
  & $Python -m venv $captionEnv
  if ($LASTEXITCODE -ne 0) { throw "Python 3.12 x64 is required." }
}
& $captionPython -m pip install --no-cache-dir -r (Join-Path $PSScriptRoot "caption-requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Caption dependency installation failed." }
$captionMissing = @($captionSpec.files.PSObject.Properties | Where-Object {
  $file = Join-Path $captionModel $_.Name
  -not (Test-Path -LiteralPath $file) -or (Get-CaptionHash $file) -ne $_.Value
})
if ($captionMissing.Count -gt 0) {
  $captionDownload = Join-Path $captionCache "$captionModelName.download"
  try {
    if ($ModelArchive) { $captionArchive = [IO.Path]::GetFullPath($ModelArchive) }
    else {
      $captionArchive = $captionDownload
      & curl.exe -fL --retry 2 --output $captionArchive $captionSpec.url
      if ($LASTEXITCODE -ne 0) { throw "Caption model download failed. Run this installer again to retry." }
    }
    if ((Get-CaptionHash $captionArchive) -ne $captionSpec.sha256) { throw "Caption archive checksum mismatch." }
    & $captionPython (Join-Path $PSScriptRoot "extract-caption-model.py") $captionArchive $captionCache
    if ($LASTEXITCODE -ne 0) { throw "Caption model extraction failed." }
  } finally {
    # Delete only this installer's exact temporary download, never a supplied archive.
    if (Test-Path -LiteralPath $captionDownload) { Remove-Item -LiteralPath $captionDownload -Force }
  }
}
foreach ($captionFile in $captionSpec.files.PSObject.Properties) {
  $file = Join-Path $captionModel $captionFile.Name
  if (-not (Test-Path -LiteralPath $file) -or (Get-CaptionHash $file) -ne $captionFile.Value) { throw "Invalid model file: $($captionFile.Name)" }
}
& $captionPython -c "import sherpa_onnx, pyaudiowpatch, numpy"
if ($LASTEXITCODE -ne 0) { throw "Caption runtime validation failed." }
$captionConfigDirectory = Join-Path $captionRoot ".cache"
New-Item -ItemType Directory -Force -Path $captionConfigDirectory | Out-Null
@{python=$captionPython; model=$captionModel} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $captionConfigDirectory "caption-runtime-win32.json")
Write-Host "Caption runtime ready: $captionCache. Reload Jam Deck. Source developers: deploy to your plugin directory first."
