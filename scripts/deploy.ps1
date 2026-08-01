param(
  [string]$TargetPluginDir = "D:\jam16\Jamnote\.obsidian\plugins\jam-deck"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$requiredFiles = @("main.js", "styles.css", "manifest.json")
$files = @($requiredFiles)
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..")).TrimEnd([IO.Path]::DirectorySeparatorChar)
$target = [IO.Path]::GetFullPath($TargetPluginDir).TrimEnd([IO.Path]::DirectorySeparatorChar)
$separator = [IO.Path]::DirectorySeparatorChar

if ($repoRoot -eq $target) { throw "Deploy target cannot equal the project source." }
if ($target.StartsWith($repoRoot + $separator, [StringComparison]::OrdinalIgnoreCase)) { throw "Deploy target cannot be inside the project source." }
if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw "Deploy target does not exist: $target" }

$targetManifestPath = Join-Path $target "manifest.json"
if (-not (Test-Path -LiteralPath $targetManifestPath -PathType Leaf)) { throw "Target is not a Jam Deck plugin directory: missing manifest.json" }
$targetManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $targetManifestPath | ConvertFrom-Json
if ($targetManifest.id -ne "jam-deck") { throw "Target manifest id is not jam-deck." }

function Get-DataState([string]$PluginDir) {
  $dataPath = Join-Path $PluginDir "data.json"
  if (-not (Test-Path -LiteralPath $dataPath -PathType Leaf)) {
    return [PSCustomObject]@{ Exists = $false; Length = 0L; Hash = "ABSENT" }
  }
  $item = Get-Item -LiteralPath $dataPath
  return [PSCustomObject]@{
    Exists = $true
    Length = [long]$item.Length
    Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $dataPath).Hash
  }
}

$dataBefore = Get-DataState $target

foreach ($name in $files) {
  $sourcePath = Join-Path $repoRoot $name
  $targetPath = Join-Path $target $name
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Missing source file: $sourcePath" }
  if ($requiredFiles -contains $name -and -not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
    throw "Missing target file: $targetPath"
  }
}

& node --check (Join-Path $repoRoot "main.js")
if ($LASTEXITCODE -ne 0) { throw "Source main.js syntax check failed." }
$sourceManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot "manifest.json") | ConvertFrom-Json
if ($sourceManifest.id -ne "jam-deck") { throw "Source manifest id is not jam-deck." }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$nonce = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$targetParent = Split-Path -Parent $target
$staging = Join-Path $targetParent ".jam-deck-staging-$stamp-$nonce"
$backup = Join-Path $targetParent ".jam-deck-backup-$stamp-$nonce"
New-Item -ItemType Directory -Path $staging | Out-Null
New-Item -ItemType Directory -Path $backup | Out-Null

$replaced = [Collections.Generic.List[string]]::new()
$success = $false
try {
  foreach ($name in $files) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $name) -Destination (Join-Path $staging $name)
  }
  & node --check (Join-Path $staging "main.js")
  if ($LASTEXITCODE -ne 0) { throw "Staged main.js syntax check failed." }
  $stagedManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $staging "manifest.json") | ConvertFrom-Json
  if ($stagedManifest.id -ne "jam-deck") { throw "Staged manifest id is not jam-deck." }

  foreach ($name in $files) {
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repoRoot $name)).Hash
    $stageHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $staging $name)).Hash
    if ($sourceHash -ne $stageHash) { throw "Staging hash mismatch: $name" }
    $targetPath = Join-Path $target $name
    if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
      Copy-Item -LiteralPath $targetPath -Destination (Join-Path $backup $name)
    }
  }

  foreach ($name in $files) {
    Copy-Item -LiteralPath (Join-Path $staging $name) -Destination (Join-Path $target $name) -Force
    $replaced.Add($name)
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repoRoot $name)).Hash
    $targetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $target $name)).Hash
    if ($sourceHash -ne $targetHash) { throw "Deployed hash mismatch: $name" }
  }
  $dataAfter = Get-DataState $target
  if ($dataBefore.Exists -ne $dataAfter.Exists -or $dataBefore.Length -ne $dataAfter.Length -or $dataBefore.Hash -ne $dataAfter.Hash) {
    throw "Protected data.json changed during deployment. Program files will be restored; data.json will not be modified."
  }
  $success = $true
  Write-Host "Jam Deck deployed successfully."
  Write-Host "Protected data.json state: $($dataAfter.Hash) ($($dataAfter.Length) bytes)"
  Write-Host "Backup retained at: $backup"
} catch {
  foreach ($name in $replaced) {
    $backupPath = Join-Path $backup $name
    if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
      Copy-Item -LiteralPath $backupPath -Destination (Join-Path $target $name) -Force
    }
  }
  Write-Error "Deploy failed and replaced files were restored. Backup: $backup. $($_.Exception.Message)"
  exit 1
} finally {
  foreach ($name in $files) {
    $stagedPath = Join-Path $staging $name
    if (Test-Path -LiteralPath $stagedPath -PathType Leaf) { Remove-Item -LiteralPath $stagedPath -Force }
  }
  if (Test-Path -LiteralPath $staging -PathType Container) { Remove-Item -LiteralPath $staging -Force }
}

if (-not $success) { exit 1 }
