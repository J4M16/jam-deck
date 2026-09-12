param([string]$Python = "python")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$captionRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$captionCache = Join-Path $captionRoot ".cache"
$captionEnv = Join-Path $captionCache "caption-runtime"
$captionPython = Join-Path $captionEnv "Scripts/python.exe"
$captionModelName = "sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16"
$captionModel = Join-Path $captionCache $captionModelName
New-Item -ItemType Directory -Force -Path $captionCache | Out-Null
if (-not (Test-Path -LiteralPath $captionPython)) {
  & $Python -m venv $captionEnv
  if ($LASTEXITCODE -ne 0) { throw "Python 3.12 x64 is required." }
}
& $captionPython -m pip install -r (Join-Path $PSScriptRoot "caption-requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Caption dependency installation failed." }
if (-not (Test-Path -LiteralPath (Join-Path $captionModel "tokens.txt"))) {
  $captionArchive = Join-Path $captionCache "$captionModelName.tar.bz2"
  $captionUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$captionModelName.tar.bz2"
  & curl.exe -fL --retry 2 --output $captionArchive $captionUrl
  if ($LASTEXITCODE -ne 0) { throw "Caption model download failed." }
  & $captionPython (Join-Path $PSScriptRoot "extract-caption-model.py") $captionArchive $captionCache
  if ($LASTEXITCODE -ne 0) { throw "Caption model extraction failed." }
}
foreach ($captionFile in @("tokens.txt", "encoder-epoch-99-avg-1.int8.onnx", "decoder-epoch-99-avg-1.onnx", "joiner-epoch-99-avg-1.int8.onnx")) {
  if (-not (Test-Path -LiteralPath (Join-Path $captionModel $captionFile))) { throw "Missing caption model file: $captionFile" }
}
@{python=$captionPython; model=$captionModel} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $captionCache "caption-runtime.json")
Write-Host "Caption runtime ready. Run npm run deploy with your target directory."
