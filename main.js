"use strict";

const { ItemView, Modal, Notice, Plugin, WorkspaceLeaf, normalizePath, setIcon } = require("obsidian");
const { spawn } = require("child_process");
const crypto = require("crypto");
const readline = require("readline");
const zlib = require("zlib");

const VIEW_TYPE = "jam-deck-view";
// 40x36 keeps each cell near-square on a 1920x1080 deck (~37x23px).
const GRID_COLS = 40;
const GRID_ROWS = 36;
const JAM_DECK_LEGACY_GRID_COLS = 12;
const CLIPBOARD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLIPBOARD_DIR = "attachments/jam-deck-clipboard";
const CANVAS_ASSET_DIR = "attachments/jam-deck-canvas-assets";
const ICON_DIR = "attachments/jam-deck-icons";
const TASK_ASSET_DIR = "attachments/jam-deck-task-assets";
const WORK_JOURNAL_DIR = "Work/工作日记";
const LIFE_DAILY_PATH = "Life/Daily.md";
const JOURNAL_SECTIONS = ["工作内容", "效果图 / 视频", "链接", "备注"];
const JOURNAL_SECTION_KEYS = { "工作内容": "work", "效果图 / 视频": "media", "链接": "links", "备注": "notes" };
const CLIPBOARD_DRAG_MIME = "application/x-jam-deck-clipboard+json";
const SHORTCUT_DRAG_MIME = "application/x-jam-deck-shortcut+json";
const SHORTCUT_URL_LIMIT = 4096;
const SHORTCUT_URI_LIST_LIMIT = 20;
const CANVAS_INK_SUFFIX = ".canvas.jam-deck.json";
const CANVAS_INK_COLORS = ["#20252B", "#5E83B9", "#D87868", "#6DAB93"];
const CANVAS_INK_WIDTHS = [2, 5, 9];
const CANVAS_INK_SOFT_POINTS = 150000;
const CANVAS_INK_HARD_POINTS = 300000;
const COUNTDOWN_DEFAULT_SECONDS = 25 * 60;
const COUNTDOWN_MAX_SECONDS = 99 * 60 * 60 + 59 * 60 + 59;
const COUNTDOWN_WINDOWS_APP_ID = "md.obsidian";
const MEDIA_PROTOCOL_VERSION = 1;
const MEDIA_REQUEST_MAX_BYTES = 32 * 1024;
const MEDIA_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const MEDIA_ARTWORK_MAX_BYTES = 768 * 1024;
const MEDIA_REQUEST_TIMEOUT_MS = 5000;
const MEDIA_READY_TIMEOUT_MS = 6000;
const MEDIA_LAUNCH_POLL_MS = 500;
const MEDIA_LAUNCH_TIMEOUT_MS = 12000;

function jamDeckMediaProvider(sourceAppId) {
  const source = String(sourceAppId || "").trim().toLocaleLowerCase("en-US");
  if (source === "qqmusic.exe" || source.endsWith(".qqmusic.exe") || source.includes("qqmusic")) {
    return { id: "qqmusic", label: "QQ音乐" };
  }
  if (source === "cloudmusic.exe" || source.endsWith(".cloudmusic.exe") || source.includes("cloudmusic")) {
    return { id: "netease", label: "网易云音乐" };
  }
  if (
    source === "com.soda.music" ||
    source.startsWith("com.soda.music_") ||
    source === "sodamusic.exe" ||
    source.includes("qishui") ||
    source.includes("汽水")
  ) {
    return { id: "qishui", label: "汽水音乐" };
  }
  return { id: "other", label: "其他播放器" };
}

function jamDeckFormatMediaTime(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "--:--";
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function jamDeckProjectedMediaPosition(snapshot, now = Date.now()) {
  const media = snapshot && snapshot.selected;
  const timeline = media && media.timeline;
  if (!timeline) return 0;
  const duration = Math.max(0, Number(timeline.durationMs) || 0);
  let position = Math.max(0, Number(timeline.positionMs) || 0);
  if (media.playbackStatus === "playing") {
    position += Math.max(0, Number(now) - (Number(snapshot.receivedAt) || Number(now)));
  }
  return duration > 0 ? Math.min(position, duration) : position;
}

function jamDeckMediaFavoriteId(media) {
  if (!media) return null;
  const timeline = media.timeline || {};
  const identity = [
    media.sourceAppId || "",
    media.title || "",
    media.artist || "",
    media.album || "",
    Math.round(Number(timeline.durationMs) || 0),
  ].join("\n");
  if (!identity.replace(/\n/g, "")) return null;
  return crypto.createHash("sha256").update(identity, "utf8").digest("hex");
}

function jamDeckMediaBridgePowerShellScript() {
  return String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$ProtocolVersion = 1
$MaxRequestChars = 32768
$MaxArtworkBytes = 786432

function Write-Protocol([object]$Value) {
  $line = $Value | ConvertTo-Json -Compress -Depth 8
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}

function Await-Result($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

function Limit-Text([object]$Value, [int]$Limit = 512) {
  $text = [string]$Value
  if ($text.Length -gt $Limit) { return $text.Substring(0, $Limit) }
  return $text
}

function Get-Hash([string]$Value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-Artwork($Thumbnail, [string]$ArtworkKey, [string]$KnownArtworkKey) {
  if ($null -eq $Thumbnail -or $ArtworkKey -eq $KnownArtworkKey) { return $null }
  $stream = $null
  $reader = $null
  try {
    $stream = Await-Result ($Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $size = [uint64]$stream.Size
    if ($size -eq 0 -or $size -gt $MaxArtworkBytes) { return $null }
    $mime = [string]$stream.ContentType
    if ($mime -notmatch '^image/(jpeg|png|webp|gif)$') { return $null }
    $reader = [Windows.Storage.Streams.DataReader]::new($stream.GetInputStreamAt(0))
    $loaded = Await-Result ($reader.LoadAsync([uint32]$size)) ([uint32])
    if ($loaded -eq 0 -or $loaded -gt $MaxArtworkBytes) { return $null }
    $bytes = [byte[]]::new([int]$loaded)
    $reader.ReadBytes($bytes)
    return [ordered]@{
      artworkKey = $ArtworkKey
      mime = $mime
      byteLength = [int]$loaded
      base64 = [Convert]::ToBase64String($bytes)
    }
  } catch {
    return $null
  } finally {
    if ($null -ne $reader) {
      try { $reader.Dispose() } catch {}
    }
    if ($null -ne $stream) {
      try { $stream.Dispose() } catch {}
    }
  }
}

function Get-UniqueSession($Manager, [string]$Source) {
  $matches = @($Manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -eq $Source })
  if ($matches.Count -eq 0) { throw 'SESSION_NOT_FOUND' }
  if ($matches.Count -gt 1) { throw 'AMBIGUOUS_SESSION' }
  return $matches[0]
}

function Find-Session($Manager, [string]$PreferredSource) {
  $sessions = @($Manager.GetSessions())
  if ($sessions.Count -eq 0) { return $null }
  if ($PreferredSource) {
    $matches = @($sessions | Where-Object { $_.SourceAppUserModelId -eq $PreferredSource })
    if ($matches.Count -eq 1) { return $matches[0] }
  }
  $current = $Manager.GetCurrentSession()
  if ($null -ne $current) {
    $matches = @($sessions | Where-Object { $_.SourceAppUserModelId -eq $current.SourceAppUserModelId })
    if ($matches.Count -eq 1) { return $matches[0] }
  }
  foreach ($source in @($sessions | ForEach-Object { $_.SourceAppUserModelId } | Sort-Object -Unique)) {
    $matches = @($sessions | Where-Object { $_.SourceAppUserModelId -eq $source })
    if ($matches.Count -eq 1) { return $matches[0] }
  }
  return $null
}

function Start-KnownProvider([string]$Provider) {
  $apps = @(Get-StartApps)
  if ($Provider -eq 'qqmusic') {
    $matches = @($apps | Where-Object { ([string]$_.AppID) -match '^\{[0-9A-Fa-f-]{36}\}\\Tencent\\QQMusic\\QQMusic\.exe$' })
  } elseif ($Provider -eq 'netease') {
    $matches = @($apps | Where-Object { ([string]$_.AppID) -match '^\{[0-9A-Fa-f-]{36}\}\\NetEase\\CloudMusic\\cloudmusic\.exe$' })
  } elseif ($Provider -eq 'qishui') {
    $matches = @($apps | Where-Object { ([string]$_.AppID) -eq 'com.soda.music' })
  } else {
    throw 'UNKNOWN_PROVIDER'
  }
  if ($matches.Count -ne 1) { throw 'APP_NOT_FOUND' }
  $appId = [string]$matches[0].AppID
  $shell = New-Object -ComObject Shell.Application
  $folder = $shell.Namespace('shell:AppsFolder')
  $item = if ($null -ne $folder) { $folder.ParseName($appId) } else { $null }
  if ($null -eq $item -or ([string]$item.Path) -ne $appId) { throw 'APP_NOT_FOUND' }
  $target = 'shell:AppsFolder\' + $appId
  $shell.ShellExecute($target, '', '', 'open', 1)
  return $true
}

function Get-Snapshot($Manager, [string]$PreferredSource, [string]$KnownArtworkKey) {
  $sessions = @($Manager.GetSessions())
  $summaries = @()
  foreach ($group in @($sessions | Group-Object SourceAppUserModelId)) {
    $states = @($group.Group | ForEach-Object { ([string]$_.GetPlaybackInfo().PlaybackStatus).ToLowerInvariant() })
    $summaries += [ordered]@{
      sourceAppId = Limit-Text $group.Name 256
      playbackStatus = if ($states -contains 'playing') { 'playing' } elseif ($states -contains 'paused') { 'paused' } else { $states | Select-Object -First 1 }
      sessionCount = [int]$group.Count
      ambiguous = [bool]($group.Count -ne 1)
    }
  }

  $selectedSession = Find-Session $Manager $PreferredSource
  if ($null -eq $selectedSession) {
    $script:SnapshotSeq++
    return [ordered]@{ bridgeGeneration = $BridgeGeneration; snapshotSeq = $script:SnapshotSeq; sessions = @($summaries); selected = $null }
  }

  $properties = Await-Result ($selectedSession.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $playback = $selectedSession.GetPlaybackInfo()
  $controls = $playback.Controls
  $timeline = $selectedSession.GetTimelineProperties()
  $source = Limit-Text $selectedSession.SourceAppUserModelId 256
  $title = Limit-Text $properties.Title
  $artist = Limit-Text $properties.Artist
  $album = Limit-Text $properties.AlbumTitle
  $durationMs = [math]::Max(0, [math]::Round($timeline.EndTime.TotalMilliseconds - $timeline.StartTime.TotalMilliseconds))
  $positionMs = [math]::Max(0, [math]::Round($timeline.Position.TotalMilliseconds - $timeline.StartTime.TotalMilliseconds))
  $separator = [Environment]::NewLine
  $trackKey = Get-Hash ($source + $separator + $title + $separator + $artist + $separator + $album + $separator + $durationMs)
  $artworkKey = Get-Hash ($trackKey + $separator + 'artwork')
  $artwork = Get-Artwork $properties.Thumbnail $artworkKey $KnownArtworkKey
  $sessionToken = Get-Hash ($BridgeGeneration + $separator + $source)
  $script:SnapshotSeq++

  return [ordered]@{
    bridgeGeneration = $BridgeGeneration
    snapshotSeq = $script:SnapshotSeq
    sessions = @($summaries)
    selected = [ordered]@{
      sourceAppId = $source
      sessionToken = $sessionToken
      title = $title
      artist = $artist
      album = $album
      trackKey = $trackKey
      artworkKey = $artworkKey
      artwork = $artwork
      playbackStatus = ([string]$playback.PlaybackStatus).ToLowerInvariant()
      timeline = [ordered]@{
        positionMs = $positionMs
        durationMs = $durationMs
      }
      capabilities = [ordered]@{
        canPlay = [bool]$controls.IsPlayEnabled
        canPause = [bool]$controls.IsPauseEnabled
        canToggle = [bool]$controls.IsPlayPauseToggleEnabled
        canPrevious = [bool]$controls.IsPreviousEnabled
        canNext = [bool]$controls.IsNextEnabled
        canSeek = [bool]$controls.IsPlaybackPositionEnabled
      }
    }
  }
}

try {
  $BridgeGeneration = [Guid]::NewGuid().ToString('N')
  $script:SnapshotSeq = 0
  $LaunchResponses = @{}
  $manager = Await-Result ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  Write-Protocol ([ordered]@{
    protocolVersion = $ProtocolVersion
    type = 'ready'
    ok = $true
    payload = [ordered]@{ bridgeVersion = '2'; bridgeGeneration = $BridgeGeneration; mode = 'polling'; gsmtcAvailable = $true }
  })
} catch {
  Write-Protocol ([ordered]@{
    protocolVersion = $ProtocolVersion
    type = 'ready'
    ok = $false
    errorCode = 'GSMTC_UNAVAILABLE'
    payload = @{}
  })
  exit 2
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Length -eq 0) { continue }
  if ($line.Length -gt $MaxRequestChars) {
    Write-Protocol ([ordered]@{ protocolVersion = $ProtocolVersion; requestId = ''; type = 'response'; ok = $false; errorCode = 'REQUEST_TOO_LARGE'; payload = @{} })
    continue
  }
  $requestId = ''
  try {
    $request = $line | ConvertFrom-Json
    $requestId = Limit-Text $request.requestId 80
    if ([int]$request.protocolVersion -ne $ProtocolVersion -or -not $requestId) { throw 'PROTOCOL_MISMATCH' }
    $type = [string]$request.type
    if ($type -eq 'snapshot') {
      $preferred = Limit-Text $request.payload.preferredSource 256
      $knownArtworkKey = Limit-Text $request.payload.knownArtworkKey 128
      $payload = Get-Snapshot $manager $preferred $knownArtworkKey
      Write-Protocol ([ordered]@{ protocolVersion = $ProtocolVersion; requestId = $requestId; type = 'response'; ok = $true; errorCode = $null; payload = $payload })
      continue
    }
    if ($type -eq 'control') {
      $action = [string]$request.payload.action
      if ($action -notin @('toggle', 'previous', 'next', 'seek', 'launch_provider')) { throw 'UNKNOWN_ACTION' }
      if ($action -eq 'launch_provider') {
        if ($LaunchResponses.ContainsKey($requestId)) {
          Write-Protocol ([ordered]@{ protocolVersion = $ProtocolVersion; requestId = $requestId; type = 'response'; ok = $true; errorCode = $null; payload = $LaunchResponses[$requestId] })
          continue
        }
        $provider = [string]$request.payload.provider
        $accepted = [bool](Start-KnownProvider $provider)
        $result = [ordered]@{ accepted = $accepted }
        if ($LaunchResponses.Count -ge 64) { $LaunchResponses.Clear() }
        $LaunchResponses[$requestId] = $result
        Write-Protocol ([ordered]@{ protocolVersion = $ProtocolVersion; requestId = $requestId; type = 'response'; ok = $true; errorCode = $null; payload = $result })
        continue
      }
      if ([string]$request.payload.bridgeGeneration -ne $BridgeGeneration) { throw 'STALE_GENERATION' }
      $source = Limit-Text $request.payload.sourceAppId 256
      $session = Get-UniqueSession $manager $source
      $info = $session.GetPlaybackInfo()
      $controls = $info.Controls
      $operation = $null
      if ($action -eq 'toggle') {
        if ($controls.IsPlayPauseToggleEnabled) { $operation = $session.TryTogglePlayPauseAsync() }
        elseif (([string]$info.PlaybackStatus) -eq 'Playing' -and $controls.IsPauseEnabled) { $operation = $session.TryPauseAsync() }
        elseif ($controls.IsPlayEnabled) { $operation = $session.TryPlayAsync() }
        else { throw 'CAPABILITY_UNAVAILABLE' }
      } elseif ($action -eq 'previous') {
        if (-not $controls.IsPreviousEnabled) { throw 'CAPABILITY_UNAVAILABLE' }
        $operation = $session.TrySkipPreviousAsync()
      } elseif ($action -eq 'next') {
        if (-not $controls.IsNextEnabled) { throw 'CAPABILITY_UNAVAILABLE' }
        $operation = $session.TrySkipNextAsync()
      } elseif ($action -eq 'seek') {
        if (-not $controls.IsPlaybackPositionEnabled) { throw 'CAPABILITY_UNAVAILABLE' }
        $properties = Await-Result ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $timeline = $session.GetTimelineProperties()
        $durationMs = [math]::Max(0, [math]::Round($timeline.EndTime.TotalMilliseconds - $timeline.StartTime.TotalMilliseconds))
        if ($durationMs -le 0) { throw 'INVALID_POSITION' }
        $separator = [Environment]::NewLine
        $trackKey = Get-Hash ($source + $separator + (Limit-Text $properties.Title) + $separator + (Limit-Text $properties.Artist) + $separator + (Limit-Text $properties.AlbumTitle) + $separator + $durationMs)
        if ([string]$request.payload.trackKey -ne $trackKey) { throw 'STALE_TRACK' }
        $positionMs = $request.payload.positionMs
        if ($null -eq $positionMs -or $positionMs -isnot [int] -and $positionMs -isnot [long]) { throw 'INVALID_POSITION' }
        $positionMs = [math]::Max(0, [math]::Min([int64]$durationMs, [int64]$positionMs))
        $operation = $session.TryChangePlaybackPositionAsync([int64]($positionMs * 10000))
      }
      $accepted = [bool](Await-Result $operation ([bool]))
      Write-Protocol ([ordered]@{ protocolVersion = $ProtocolVersion; requestId = $requestId; type = 'response'; ok = $true; errorCode = $null; payload = [ordered]@{ accepted = $accepted } })
      continue
    }
    if ($type -eq 'shutdown') {
      Write-Protocol ([ordered]@{ protocolVersion = $ProtocolVersion; requestId = $requestId; type = 'response'; ok = $true; errorCode = $null; payload = @{} })
      break
    }
    throw 'UNKNOWN_TYPE'
  } catch {
    $code = [string]$_.Exception.Message
    if ($code -notin @('PROTOCOL_MISMATCH','UNKNOWN_ACTION','UNKNOWN_PROVIDER','APP_NOT_FOUND','SESSION_NOT_FOUND','AMBIGUOUS_SESSION','STALE_GENERATION','STALE_TRACK','INVALID_POSITION','CAPABILITY_UNAVAILABLE','UNKNOWN_TYPE')) { $code = 'BRIDGE_ERROR' }
    Write-Protocol ([ordered]@{ protocolVersion = $ProtocolVersion; requestId = $requestId; type = 'response'; ok = $false; errorCode = $code; payload = @{} })
  }
}
`; 
}

function jamDeckEncodedMediaBridgeCommand() {
  const compressed = zlib.gzipSync(Buffer.from(jamDeckMediaBridgePowerShellScript(), "utf8"), { level: 9 }).toString("base64");
  const bootstrap = [
    `$b=[Convert]::FromBase64String('${compressed}')`,
    "$m=[IO.MemoryStream]::new([byte[]]$b)",
    "$g=[IO.Compression.GzipStream]::new($m,[IO.Compression.CompressionMode]::Decompress)",
    "$r=[IO.StreamReader]::new($g,[Text.Encoding]::UTF8)",
    "& ([ScriptBlock]::Create($r.ReadToEnd()))",
  ].join(";");
  return Buffer.from(bootstrap, "utf16le").toString("base64");
}

class WindowsMediaBridge {
  constructor(plugin) {
    this.plugin = plugin;
    this.child = null;
    this.reader = null;
    this.pending = new Map();
    this.sequence = 0;
    this.generation = 0;
    this.ready = false;
    this.startPromise = null;
    this.stopping = false;
  }

  async start() {
    if (process.platform !== "win32") throw Object.assign(new Error("unsupported platform"), { code: "UNSUPPORTED_PLATFORM" });
    if (this.ready && this.child) return true;
    if (this.startPromise) return this.startPromise;
    this.stopping = false;
    const generation = ++this.generation;
    this.startPromise = new Promise((resolve, reject) => {
      const encoded = jamDeckEncodedMediaBridgeCommand();
      const child = spawn("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        encoded,
      ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      this.child = child;
      child.stdin.setDefaultEncoding("utf8");
      const reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      this.reader = reader;
      const readyTimer = setTimeout(() => {
        if (generation !== this.generation || this.ready) return;
        const error = Object.assign(new Error("media bridge ready timeout"), { code: "READY_TIMEOUT" });
        this.failGeneration(generation, error);
        reject(error);
      }, MEDIA_READY_TIMEOUT_MS);
      const finishReady = (error) => {
        clearTimeout(readyTimer);
        if (error) reject(error);
        else resolve(true);
      };
      reader.on("line", (line) => {
        if (generation !== this.generation) return;
        if (Buffer.byteLength(line, "utf8") > MEDIA_RESPONSE_MAX_BYTES) {
          const error = Object.assign(new Error("media bridge response too large"), { code: "RESPONSE_TOO_LARGE" });
          this.failGeneration(generation, error);
          finishReady(error);
          return;
        }
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          const protocolError = Object.assign(new Error("media bridge stdout protocol pollution"), { code: "INVALID_JSON" });
          this.failGeneration(generation, protocolError);
          finishReady(protocolError);
          return;
        }
        if (!message || message.protocolVersion !== MEDIA_PROTOCOL_VERSION) return;
        if (message.type === "ready") {
          if (message.ok !== true || !message.payload || message.payload.gsmtcAvailable !== true) {
            const error = Object.assign(new Error("GSMTC unavailable"), { code: message.errorCode || "GSMTC_UNAVAILABLE" });
            this.failGeneration(generation, error);
            finishReady(error);
            return;
          }
          this.bridgeGeneration = String(message.payload.bridgeGeneration || "");
          this.ready = true;
          finishReady();
          return;
        }
        if (message.type !== "response" || typeof message.requestId !== "string") return;
        const entry = this.pending.get(message.requestId);
        if (!entry || entry.generation !== generation) return;
        this.pending.delete(message.requestId);
        clearTimeout(entry.timer);
        if (message.ok === true) entry.resolve(message.payload || {});
        else entry.reject(Object.assign(new Error(message.errorCode || "media bridge request failed"), { code: message.errorCode || "BRIDGE_ERROR" }));
      });
      child.stderr.on("data", () => {
        // stderr is intentionally not forwarded: it can contain media-provider text.
      });
      child.once("error", (error) => {
        if (generation !== this.generation) return;
        this.failGeneration(generation, Object.assign(error, { code: error.code || "SPAWN_FAILED" }));
        finishReady(error);
      });
      child.once("exit", (code) => {
        if (generation !== this.generation) return;
        const error = Object.assign(new Error(`media bridge exited (${Number(code) || 0})`), { code: this.stopping ? "STOPPED" : "BRIDGE_EXITED" });
        this.failGeneration(generation, error);
        if (!this.stopping) finishReady(error);
      });
    }).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  failGeneration(generation, error) {
    if (generation !== this.generation) return;
    this.ready = false;
    if (this.reader) {
      this.reader.close();
      this.reader = null;
    }
    const child = this.child;
    this.child = null;
    for (const [id, entry] of this.pending) {
      if (entry.generation !== generation) continue;
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(error);
    }
    if (child && !child.killed) {
      try { child.kill(); } catch (killError) {}
    }
  }

  async request(type, payload, timeoutMs = MEDIA_REQUEST_TIMEOUT_MS) {
    await this.start();
    if (!this.child || !this.ready || this.stopping && type !== "shutdown") throw Object.assign(new Error("media bridge unavailable"), { code: "BRIDGE_UNAVAILABLE" });
    if (!["snapshot", "control", "shutdown"].includes(type)) throw Object.assign(new Error("unsupported media bridge request"), { code: "UNKNOWN_TYPE" });
    const requestId = `${this.generation}-${++this.sequence}`;
    const message = { protocolVersion: MEDIA_PROTOCOL_VERSION, requestId, type, payload: payload || {} };
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line, "utf8") > MEDIA_REQUEST_MAX_BYTES) throw Object.assign(new Error("media bridge request too large"), { code: "REQUEST_TOO_LARGE" });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Object.assign(new Error("media bridge request timeout"), { code: "REQUEST_TIMEOUT" }));
      }, timeoutMs);
      this.pending.set(requestId, { generation: this.generation, timer, resolve, reject });
      this.child.stdin.write(line, "utf8", (error) => {
        if (!error) return;
        const entry = this.pending.get(requestId);
        if (!entry) return;
        this.pending.delete(requestId);
        clearTimeout(entry.timer);
        reject(Object.assign(error, { code: error.code || "PIPE_WRITE_FAILED" }));
      });
    });
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    try {
      if (this.ready) await this.request("shutdown", {}, 800);
    } catch (error) {}
    try { child.stdin.end(); } catch (error) {}
    await new Promise((resolve) => {
      if (child.exitCode != null || child.killed) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        try { child.kill(); } catch (error) {}
        resolve();
      }, 900);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (this.child === child) this.child = null;
    this.ready = false;
  }
}

function jamDeckWindowsToastPowerShellScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$xml.LoadXml('<toast><visual><binding template=\"ToastGeneric\"><text>Jam Deck · 倒计时结束</text><text>设定时间已到。</text></binding></visual><audio src=\"ms-winsoundevent:Notification.Default\"/></toast>')",
    "$toast = New-Object Windows.UI.Notifications.ToastNotification $xml",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${COUNTDOWN_WINDOWS_APP_ID}').Show($toast)`,
  ].join("; ");
}

function jamDeckParseCountdownDuration(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  let seconds;
  if (numbers.length === 1) seconds = numbers[0] * 60;
  else if (numbers.length === 2) {
    if (numbers[1] > 59) return null;
    seconds = numbers[0] * 60 + numbers[1];
  } else {
    if (numbers[1] > 59 || numbers[2] > 59) return null;
    seconds = numbers[0] * 60 * 60 + numbers[1] * 60 + numbers[2];
  }
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= COUNTDOWN_MAX_SECONDS ? seconds : null;
}

function jamDeckFormatCountdownDuration(value) {
  const total = Math.max(0, Math.min(COUNTDOWN_MAX_SECONDS, Math.floor(Number(value) || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function jamDeckCountdownDurationParts(value) {
  const total = Math.max(0, Math.min(COUNTDOWN_MAX_SECONDS, Math.floor(Number(value) || 0)));
  return {
    hours: String(Math.floor(total / 3600)).padStart(2, "0"),
    minutes: String(Math.floor((total % 3600) / 60)).padStart(2, "0"),
    seconds: String(total % 60).padStart(2, "0"),
  };
}

function jamDeckFormatCountdownClock(value) {
  const parts = jamDeckCountdownDurationParts(value);
  return `${parts.hours}:${parts.minutes}:${parts.seconds}`;
}

function jamDeckRenderCountdownFlip(container, formattedValue) {
  if (!container) return;
  const value = String(formattedValue || "00:00");
  const signature = Array.from(value, (character) => (character === ":" ? ":" : "#")).join("");
  if (container.dataset.signature !== signature) {
    container.replaceChildren();
    Array.from(value).forEach((character, index) => {
      const slot = container.ownerDocument.createElement("span");
      slot.dataset.slot = String(index);
      if (character === ":") {
        slot.className = "jam-deck-countdown-flip-separator";
        slot.textContent = ":";
      } else {
        slot.className = "jam-deck-countdown-flip-digit";
        slot.textContent = character;
        slot.dataset.value = character;
      }
      container.appendChild(slot);
    });
    container.dataset.signature = signature;
  } else {
    Array.from(value).forEach((character, index) => {
      if (character === ":") return;
      const slot = container.querySelector(`[data-slot="${index}"]`);
      if (!slot || slot.dataset.value === character) return;
      slot.dataset.value = character;
      slot.textContent = character;
      slot.classList.remove("is-flipping");
      void slot.offsetWidth;
      slot.classList.add("is-flipping");
    });
  }
  container.setAttribute("aria-label", `剩余时间 ${value}`);
}

function jamDeckCountdownState(widget, now = Date.now()) {
  const config = widget && widget.config && typeof widget.config === "object" ? widget.config : {};
  const durationSeconds = Number.isInteger(Number(config.countdownDurationSec))
    && Number(config.countdownDurationSec) >= 1
    && Number(config.countdownDurationSec) <= COUNTDOWN_MAX_SECONDS
    ? Number(config.countdownDurationSec)
    : COUNTDOWN_DEFAULT_SECONDS;
  const endsAt = Number(config.countdownEndsAt);
  const enabled = config.countdownEnabled === true && Number.isFinite(endsAt) && endsAt > 0;
  const remainingSeconds = enabled
    ? Math.max(0, Math.ceil((endsAt - Number(now)) / 1000))
    : durationSeconds;
  return { durationSeconds, endsAt: enabled ? endsAt : null, enabled, remainingSeconds };
}

const WIDGET_DEFS = {
  clock: { label: "时钟", icon: "◷", w: 13, h: 8, minDisplayW: 4, minDisplayH: 4 },
  clipboard: { label: "剪贴板", icon: "▣", w: 13, h: 18, minDisplayW: 4, minDisplayH: 5 },
  tasks: { label: "最近待办", icon: "✓", w: 13, h: 14, minDisplayW: 4, minDisplayH: 4 },
  calendar: { label: "日历", icon: "□", w: 13, h: 16, minDisplayW: 4, minDisplayH: 4 },
  canvas: { label: "Canvas 文件", icon: "◇", w: 13, h: 10, minDisplayW: 3, minDisplayH: 4 },
  "canvas-embed": { label: "原生 Canvas", icon: "◎", w: 26, h: 16, minDisplayW: 5, minDisplayH: 5 },
  browser: { label: "浏览器", icon: "↗", w: 13, h: 14, minDisplayW: 3, minDisplayH: 3 },
  launcher: { label: "快捷方式", icon: "⊞", w: 13, h: 10, minDisplayW: 3, minDisplayH: 4 },
  music: { label: "音乐播放器", icon: "♫", w: 13, h: 14, minDisplayW: 2, minDisplayH: 4 },
};

const DEFAULT_SETTINGS = {
  dataVersion: 4,
  editMode: false,
  clipboardPollMs: 700,
  clipboardMaxItems: 60,
  widgets: [
    { id: "clock-1", type: "clock", x: 1, y: 1, w: 13, h: 8, config: {} },
    { id: "clipboard-1", type: "clipboard", x: 14, y: 1, w: 13, h: 18, config: {} },
    { id: "tasks-1", type: "tasks", x: 27, y: 1, w: 14, h: 14, config: {} },
    { id: "calendar-1", type: "calendar", x: 1, y: 9, w: 13, h: 16, config: {} },
    { id: "canvas-1", type: "canvas", x: 27, y: 15, w: 14, h: 10, config: {} },
    { id: "browser-1", type: "browser", x: 14, y: 19, w: 13, h: 14, config: { url: "" } },
    { id: "launcher-1", type: "launcher", x: 27, y: 25, w: 14, h: 10, config: { shortcuts: [] } },
  ],
  clipboardItems: [],
  deckTasks: [],
  musicLikes: [],
  musicLauncher: { schemaVersion: 1, lastConnectedProvider: null },
};

class WidgetPickerModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jam-deck-picker");
    contentEl.createEl("h2", { text: "添加组件" });
    contentEl.createEl("p", { text: "新组件会自动放进第一个空网格位。" });

    const list = contentEl.createDiv({ cls: "jam-deck-picker-grid" });
    for (const [type, def] of Object.entries(WIDGET_DEFS)) {
      const button = list.createEl("button", { cls: "jam-deck-picker-item" });
      button.createSpan({ text: def.icon, cls: "jam-deck-picker-icon" });
      button.createSpan({ text: def.label, cls: "jam-deck-picker-label" });
      button.addEventListener("click", async () => {
        if (type === "canvas-embed") {
          this.close();
          new CanvasFilePickerModal(this.app, this.plugin).open();
          return;
        }
        await this.plugin.addWidget(type);
        this.close();
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class CanvasFilePickerModal extends Modal {
  constructor(app, plugin, widgetId) {
    super(app);
    this.plugin = plugin;
    this.widgetId = widgetId || null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jam-deck-canvas-picker");
    contentEl.createEl("h2", { text: this.widgetId ? "更换原生 Canvas" : "插入原生 Canvas" });
    contentEl.createEl("p", { text: "选择知识库中的 Canvas 文件；画布仍由 Obsidian 原生功能渲染和保存。" });
    const search = contentEl.createEl("input", { type: "search", attr: { placeholder: "搜索 Canvas 名称或路径…" } });
    const list = contentEl.createDiv({ cls: "jam-deck-canvas-picker-list" });
    const files = this.app.vault.getFiles()
      .filter((file) => file.extension === "canvas")
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    const renderList = () => {
      list.empty();
      const query = search.value.trim().toLowerCase();
      const visible = files.filter((file) => !query || file.path.toLowerCase().includes(query));
      if (!visible.length) {
        list.createDiv({ cls: "jam-deck-empty", text: query ? "没有匹配的 Canvas" : "知识库中还没有 Canvas 文件" });
        return;
      }
      for (const file of visible) {
        const button = list.createEl("button", { cls: "jam-deck-canvas-picker-item" });
        button.createSpan({ cls: "jam-deck-canvas-picker-name", text: file.basename });
        button.createSpan({ cls: "jam-deck-canvas-picker-path", text: file.path });
        button.addEventListener("click", async () => {
          if (this.widgetId) await this.plugin.setCanvasEmbedFile(this.widgetId, file.path);
          else await this.plugin.addCanvasEmbedWidget(file.path);
          this.close();
        });
      }
    };
    search.addEventListener("input", renderList);
    renderList();
    search.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class BrowserConfigModal extends Modal {
  constructor(app, plugin, widgetId) {
    super(app);
    this.plugin = plugin;
    this.widgetId = widgetId;
  }

  onOpen() {
    const { contentEl } = this;
    const widget = this.plugin.settings.widgets.find((item) => item.id === this.widgetId);
    if (!widget) {
      this.close();
      return;
    }

    contentEl.empty();
    contentEl.addClass("jam-deck-browser-modal");
    contentEl.createEl("h2", { text: "设置浏览器网址" });
    contentEl.createEl("p", { text: "请输入完整 HTTPS 地址。部分网站会阻止内嵌显示。" });
    const input = contentEl.createEl("input", {
      type: "url",
      value: (widget.config && widget.config.url) || "",
      attr: { placeholder: "https://example.com" },
    });
    input.focus();
    input.select();

    const actions = contentEl.createDiv({ cls: "jam-deck-modal-actions" });
    const clear = actions.createEl("button", { text: "清空" });
    const save = primary.createEl("button", { text: "保存", cls: "mod-cta" });
    clear.addEventListener("click", async () => {
      await this.plugin.setBrowserUrl(this.widgetId, "");
      this.close();
    });
    const submit = async () => {
      const url = input.value.trim();
      if (url && !/^https:\/\//i.test(url)) {
        new Notice("Jam Deck：仅允许 https:// 地址");
        return;
      }
      await this.plugin.setBrowserUrl(this.widgetId, url);
      this.close();
    };
    save.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class TaskDetailModal extends Modal {
  constructor(app, plugin, taskId, onSaved, draft) {
    super(app);
    this.plugin = plugin;
    this.taskId = taskId;
    this.onSaved = onSaved || null;
    this.pendingFiles = [];
    this.draft = draft || null;
    this.previewUrls = new Map();
    this.didSave = false;
  }

  onOpen() {
    const task = this.taskId ? this.plugin.getDeckTask(this.taskId) : {
      text: "",
      description: "",
      links: [],
      images: [],
      category: null,
      dueDate: this.draft && this.draft.dueDate || null,
      status: "active",
    };
    if (!task) {
      this.close();
      return;
    }

    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("jam-deck-task-modal-shell");
    contentEl.addClass("jam-deck-task-modal");
    contentEl.createEl("h2", { text: this.taskId ? "待办详情" : "新建待办" });
    contentEl.createEl("p", { text: "整理分类、截止日期、说明、链接和图片；图片栏支持直接粘贴。", cls: "jam-deck-task-modal-subtitle" });

    const form = contentEl.createDiv({ cls: "jam-deck-task-form" });
    const titleField = form.createDiv({ cls: "jam-deck-task-field" });
    titleField.createEl("label", { text: "标题" });
    const titleInput = titleField.createEl("input", { type: "text" });
    titleInput.value = task.text;

    const metaFields = form.createDiv({ cls: "jam-deck-task-meta-fields" });
    const categoryField = metaFields.createDiv({ cls: "jam-deck-task-field" });
    categoryField.createEl("label", { text: "分类" });
    const categoryInput = categoryField.createEl("select");
    for (const option of [
      { value: "", label: "自动判断" },
      { value: "work", label: "工作" },
      { value: "life", label: "生活" },
    ]) categoryInput.createEl("option", { text: option.label, attr: { value: option.value } });
    categoryInput.value = task.category || "";
    categoryField.createDiv({ text: "自动：标题含【】归工作，否则归生活。", cls: "jam-deck-task-hint" });

    const dueField = metaFields.createDiv({ cls: "jam-deck-task-field" });
    dueField.createEl("label", { text: "截止日期" });
    const dueRow = dueField.createDiv({ cls: "jam-deck-task-due-row" });
    const dueInput = dueRow.createEl("input", { type: "date" });
    dueInput.value = task.dueDate || "";
    const clearDue = dueRow.createEl("button", { text: "清除", attr: { type: "button" } });
    clearDue.addEventListener("click", () => { dueInput.value = ""; });

    const descriptionField = form.createDiv({ cls: "jam-deck-task-field" });
    descriptionField.createEl("label", { text: "说明" });
    const descriptionInput = descriptionField.createEl("textarea", { attr: { rows: "4", placeholder: "补充背景、交付说明或备注…" } });
    descriptionInput.value = task.description || "";

    const linksField = form.createDiv({ cls: "jam-deck-task-field" });
    linksField.createEl("label", { text: "链接" });
    const linksInput = linksField.createEl("textarea", { attr: { rows: "3", placeholder: "每行一个：名称 | https://…\n也可以只写 https://…" } });
    linksInput.value = this.plugin.getSafeTaskLinks(task)
      .map((link) => link.label ? `${link.label} | ${link.url}` : link.url)
      .join("\n");
    linksField.createDiv({ text: "仅支持 http / https；归档时会写入当天日记的“链接”。", cls: "jam-deck-task-hint" });

    const imageField = form.createDiv({ cls: "jam-deck-task-field" });
    imageField.createEl("label", { text: "图片 · 可直接 Ctrl+V 粘贴" });
    imageField.tabIndex = 0;
    const imageList = imageField.createDiv({ cls: "jam-deck-task-images" });
    let retainedImages = this.plugin.getSafeTaskImages(task).map((image) => ({ ...image }));
    const renderImages = () => {
      imageList.empty();
      if (!retainedImages.length && !this.pendingFiles.length) {
        imageList.createDiv({ text: "暂无图片", cls: "jam-deck-task-image-empty" });
      }
      for (const image of retainedImages) {
        const row = imageList.createDiv({ cls: "jam-deck-task-image-row" });
        const src = this.app.vault.adapter.getResourcePath(image.path);
        row.createEl("img", { attr: { src, loading: "lazy" } });
        row.createSpan({ text: image.caption || image.path, cls: "jam-deck-task-image-name" });
        const remove = row.createEl("button", { text: "移除", attr: { type: "button" } });
        remove.addEventListener("click", () => {
          retainedImages = retainedImages.filter((item) => item.id !== image.id);
          renderImages();
        });
      }
      this.pendingFiles.forEach((file, index) => {
        const row = imageList.createDiv({ cls: "jam-deck-task-image-row is-pending" });
        let preview = this.previewUrls.get(file);
        if (!preview && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
          preview = URL.createObjectURL(file);
          this.previewUrls.set(file, preview);
        }
        if (preview) row.createEl("img", { attr: { src: preview, alt: file.name || "待添加图片" } });
        row.createSpan({ text: `待添加：${file.name}`, cls: "jam-deck-task-image-name" });
        const remove = row.createEl("button", { text: "移除", attr: { type: "button" } });
        remove.addEventListener("click", () => {
          this.pendingFiles.splice(index, 1);
          renderImages();
        });
      });
    };
    renderImages();

    const filePicker = imageField.createDiv({ cls: "jam-deck-task-file-picker" });
    const fileInput = filePicker.createEl("input", { type: "file", cls: "jam-deck-task-file-input", attr: { accept: "image/*" } });
    fileInput.multiple = true;
    const chooseFiles = filePicker.createEl("button", { text: "＋ 添加图片", cls: "jam-deck-task-file-button", attr: { type: "button" } });
    filePicker.createSpan({ text: "支持 PNG、JPG、WebP，可多选", cls: "jam-deck-task-file-hint" });
    chooseFiles.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const files = Array.from(fileInput.files || []).filter((file) => file.type && file.type.startsWith("image/"));
      this.pendingFiles.push(...files);
      fileInput.value = "";
      renderImages();
    });

    imageField.addEventListener("paste", (event) => {
      const files = Array.from((event.clipboardData && event.clipboardData.items) || [])
        .filter((item) => item.kind === "file" && item.type && item.type.startsWith("image/"))
        .map((item) => item.getAsFile && item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      this.pendingFiles.push(...files);
      renderImages();
      new Notice(`Jam Deck：已粘贴 ${files.length} 张图片，保存后写入待办`);
    });

    const actions = form.createDiv({ cls: "jam-deck-modal-actions" });
    const destructive = actions.createDiv({ cls: "jam-deck-modal-actions-left" });
    const primary = actions.createDiv({ cls: "jam-deck-modal-actions-right" });
    const removeTask = destructive.createEl("button", { text: "删除", cls: "is-danger" });
    const cancel = primary.createEl("button", { text: "取消" });
    const save = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    cancel.addEventListener("click", () => this.close());
    const collectDraft = () => {
      const text = titleInput.value.trim();
      if (!text) {
        throw new Error("标题不能为空");
      }
      return {
        text,
        description: descriptionInput.value.trim(),
        links: this.plugin.parseTaskLinks(linksInput.value),
        images: retainedImages,
        pendingFiles: this.pendingFiles,
        category: categoryInput.value || null,
        dueDate: dueInput.value || null,
      };
    };
    const setBusy = (busy) => actions.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
    const persistForm = async () => {
      const payload = collectDraft();
      if (this.taskId) await this.plugin.saveTaskDetails(this.taskId, payload);
      else this.taskId = await this.plugin.createDeckTaskFromDraft(payload);
      this.didSave = true;
      this.pendingFiles = [];
      const savedTask = this.plugin.getDeckTask(this.taskId);
      if (savedTask) retainedImages = this.plugin.getSafeTaskImages(savedTask).map((image) => ({ ...image }));
      renderImages();
      if (this.onSaved) this.onSaved();
      return this.taskId;
    };
    save.addEventListener("click", async () => {
      setBusy(true);
      try {
        await persistForm();
        this.close();
      } catch (error) {
        console.error("jam-deck task detail save failed", error);
        new Notice(`Jam Deck：详情保存失败 — ${error.message || "未知错误"}`);
        setBusy(false);
      }
    });
    removeTask.addEventListener("click", async () => {
      if (!this.taskId) { this.close(); return; }
      if (!window.confirm(`删除待办“${titleInput.value.trim() || task.text}”？\n\n已归档内容会同步从对应日记移除，附件文件保留。`)) return;
      setBusy(true);
      if (await this.plugin.deleteDeckTask(this.taskId)) this.close();
      else setBusy(false);
    });
    if (task.status !== "archived") {
      const archive = primary.createEl("button", { text: task.status === "completed" ? "归档" : "完成并归档", cls: "jam-deck-task-modal-archive" });
      archive.addEventListener("click", async () => {
        setBusy(true);
        try {
          const id = await persistForm();
          if (await this.plugin.completeAndArchiveDeckTask(id)) this.close();
          else setBusy(false);
        } catch (error) {
          console.error("jam-deck detail archive failed", error);
          new Notice(`Jam Deck：归档失败 — ${error.message || "未知错误"}`);
          setBusy(false);
        }
      });
    } else {
      const restore = primary.createEl("button", { text: "恢复待办" });
      restore.addEventListener("click", async () => {
        setBusy(true);
        if (await this.plugin.restoreArchivedTask(this.taskId)) this.close();
        else setBusy(false);
      });
    }
    titleInput.focus();
  }

  onClose() {
    this.pendingFiles = [];
    for (const url of this.previewUrls.values()) {
      try { URL.revokeObjectURL(url); } catch (error) {}
    }
    this.previewUrls.clear();
    this.contentEl.empty();
  }
}

class ArchiveViewerModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jam-deck-archive-modal");
    contentEl.createEl("h2", { text: "归档待办" });

    const archived = this.plugin.settings.deckTasks.filter((task) => task.status === "archived");
    if (!archived.length) {
      contentEl.createEl("p", { text: "暂无归档项。", cls: "jam-deck-archive-empty" });
      return;
    }

    const list = contentEl.createDiv({ cls: "jam-deck-archive-list" });
    for (const task of [...archived].reverse()) {
      const row = list.createDiv({ cls: "jam-deck-archive-row" });
      const taskText = row.createEl("button", { text: task.text, cls: "jam-deck-archive-text", attr: { type: "button", title: "打开并编辑归档待办" } });
      taskText.addEventListener("click", () => {
        this.plugin.openTaskDetail(task.id, () => this.onOpen());
      });
      const meta = row.createSpan({ text: this.plugin.formatTime(task.archivedAt || task.createdAt), cls: "jam-deck-archive-meta" });
      const restore = row.createEl("button", { text: "恢复", cls: "jam-deck-archive-action" });
      restore.addEventListener("click", async () => {
        if (await this.plugin.restoreArchivedTask(task.id)) this.onOpen();
      });
      const purge = row.createEl("button", { text: "彻底删除", cls: "jam-deck-archive-action is-danger" });
      purge.addEventListener("click", async () => {
        if (await this.plugin.deleteArchivedTask(task.id)) this.onOpen();
      });
    }

    const footer = contentEl.createDiv({ cls: "jam-deck-archive-footer" });
    const purgeAll = footer.createEl("button", { text: "清空全部归档", cls: "jam-deck-archive-action is-danger" });
    purgeAll.addEventListener("click", async () => {
      await this.plugin.deleteAllArchivedTasks();
      this.onOpen();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ShortcutEditorModal extends Modal {
  constructor(app, plugin, widgetId, existing) {
    super(app);
    this.plugin = plugin;
    this.widgetId = widgetId;
    this.existing = existing || null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jam-deck-shortcut-modal");
    contentEl.createEl("h2", { text: this.existing ? "编辑快捷方式" : "添加快捷方式" });

    const form = contentEl.createDiv({ cls: "jam-deck-shortcut-form" });
    const nameInput = form.createEl("input", { type: "text", attr: { placeholder: "显示名称" } });
    nameInput.value = (this.existing && this.existing.name) || "";

    const pathInput = form.createEl("input", { type: "text", attr: { placeholder: "完整路径，或 https:// 网页链接" } });
    pathInput.value = (this.existing && (this.existing.url || this.existing.path)) || "";

    const hint = form.createDiv({ text: "支持应用、文件夹和 http / https 网页链接", cls: "jam-deck-shortcut-hint" });

    const actions = form.createDiv({ cls: "jam-deck-modal-actions" });
    const save = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    save.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const path = pathInput.value.trim();
      if (!name || !path) {
        new Notice("Jam Deck：名称和路径不能为空");
        return;
      }
      await this.plugin.saveShortcut(this.widgetId, this.existing && this.existing.id, name, path);
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

function jamDeckInkId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function jamDeckInkNormalizePath(path) {
  const value = String(path || "").replace(/\\/g, "/");
  return typeof normalizePath === "function" ? normalizePath(value) : value.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

function jamDeckInkSidecarPath(canvasPath, suffix = "") {
  const normalized = jamDeckInkNormalizePath(canvasPath);
  if (!normalized.toLowerCase().endsWith(".canvas")) throw new Error("绘图数据只能绑定 Canvas 文件");
  const path = jamDeckInkNormalizePath(`${normalized}.jam-deck.json${suffix}`);
  const lower = path.toLowerCase();
  if (lower.endsWith("/data.json") || lower === "data.json" || (!lower.endsWith(CANVAS_INK_SUFFIX) && !/\.canvas\.jam-deck\.json\.(tmp|bak)$/.test(lower) && !/\.canvas\.jam-deck\.(conflict|corrupt)-\d+\.json$/.test(lower))) {
    throw new Error("拒绝写入非 Jam Deck Canvas 绘图文件");
  }
  return path;
}

function jamDeckInkClamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function jamDeckInkPoint(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const x = Number(raw[0]);
  const y = Number(raw[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function jamDeckInkBBox(points, width) {
  if (!points.length) return [0, 0, 0, 0];
  const radius = Math.max(1, Number(width) || 1) / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0] - radius);
    minY = Math.min(minY, point[1] - radius);
    maxX = Math.max(maxX, point[0] + radius);
    maxY = Math.max(maxY, point[1] + radius);
  }
  return [minX, minY, maxX, maxY];
}

function jamDeckInkLinePath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]} l 0.01 0`;
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let index = 1; index < points.length; index++) path += ` L ${points[index][0]} ${points[index][1]}`;
  return path;
}

function jamDeckInkDistanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function jamDeckInkStrokeHit(stroke, eraserPoints, radius) {
  const points = stroke.points || [];
  if (!points.length || !eraserPoints.length) return false;
  const bbox = Array.isArray(stroke.bbox) ? stroke.bbox : jamDeckInkBBox(points, stroke.style && stroke.style.baseWidth);
  const eraserBox = jamDeckInkBBox(eraserPoints, radius * 2);
  if (bbox[2] < eraserBox[0] || bbox[0] > eraserBox[2] || bbox[3] < eraserBox[1] || bbox[1] > eraserBox[3]) return false;
  const threshold = radius + Math.max(1, Number(stroke.style && stroke.style.baseWidth) || 2) / 2;
  for (const eraser of eraserPoints) {
    if (points.length === 1 && Math.hypot(eraser[0] - points[0][0], eraser[1] - points[0][1]) <= threshold) return true;
    for (let index = 1; index < points.length; index++) {
      if (jamDeckInkDistanceToSegment(eraser, points[index - 1], points[index]) <= threshold) return true;
    }
  }
  return false;
}

function jamDeckInkSanitizeStroke(raw) {
  if (!raw || !["pen", "highlighter"].includes(raw.tool) || !Array.isArray(raw.points)) return null;
  const points = raw.points.map(jamDeckInkPoint).filter(Boolean).slice(0, 2048);
  if (!points.length) return null;
  const style = raw.style || {};
  const stroke = {
    id: String(raw.id || jamDeckInkId("stroke")),
    tool: raw.tool,
    anchor: { type: "canvas" },
    style: {
      color: /^#[0-9a-f]{6}$/i.test(style.color || "") ? style.color : CANVAS_INK_COLORS[0],
      baseWidth: jamDeckInkClamp(style.baseWidth, 0.5, 48, 2),
      opacity: jamDeckInkClamp(style.opacity, 0.05, 1, raw.tool === "highlighter" ? 0.4 : 1),
      blendMode: style.blendMode === "multiply" ? "multiply" : "normal",
    },
    points,
    bbox: jamDeckInkBBox(points, (Number(style.baseWidth) || 2) * (raw.tool === "highlighter" ? 3 : 1)),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
  };
  return stroke;
}

class CanvasInkOwner {
  constructor(plugin, canvasPath) {
    this.plugin = plugin;
    this.canvasPath = jamDeckInkNormalizePath(canvasPath);
    this.sidecarPath = jamDeckInkSidecarPath(this.canvasPath);
    this.document = null;
    this.revision = 0;
    this.dirty = false;
    this.readonly = false;
    this.refCount = 0;
    this.writer = null;
    this.subscribers = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.saveTimer = null;
    this.saveQueue = Promise.resolve();
    this.changeVersion = 0;
    this.loading = this.load();
  }

  makeEmptyDocument() {
    const now = new Date().toISOString();
    return { schemaVersion: 1, documentId: jamDeckInkId("ink"), canvas: { path: this.canvasPath }, revision: 0, createdAt: now, updatedAt: now, strokes: [] };
  }

  parseDocument(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (error) { return null; }
    if (!raw || Number(raw.schemaVersion) !== 1 || !Array.isArray(raw.strokes)) return null;
    const strokes = raw.strokes.map(jamDeckInkSanitizeStroke).filter(Boolean);
    return {
      schemaVersion: 1,
      documentId: String(raw.documentId || jamDeckInkId("ink")),
      canvas: { path: this.canvasPath },
      revision: Math.max(0, Number(raw.revision) || 0),
      previousRevision: Math.max(0, Number(raw.previousRevision) || 0),
      saveId: typeof raw.saveId === "string" ? raw.saveId : "",
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
      strokes,
    };
  }

  async readCandidate(path) {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!file) return { path, file: null, text: null, document: null };
    try {
      const text = await this.plugin.app.vault.read(file);
      return { path, file, text, document: this.parseDocument(text) };
    } catch (error) {
      return { path, file, text: null, document: null };
    }
  }

  async load() {
    const formal = await this.readCandidate(this.sidecarPath);
    const temporary = await this.readCandidate(jamDeckInkSidecarPath(this.canvasPath, ".tmp"));
    const backup = await this.readCandidate(jamDeckInkSidecarPath(this.canvasPath, ".bak"));
    let selected = formal.document;
    if (formal.document && temporary.document && temporary.document.revision === formal.document.revision + 1 && temporary.document.previousRevision === formal.document.revision) selected = temporary.document;
    if (!selected && temporary.document) selected = temporary.document;
    if (!selected && backup.document) selected = backup.document;
    if (!selected) {
      const hasInvalid = Boolean((formal.file && !formal.document) || (temporary.file && !temporary.document) || (backup.file && !backup.document));
      this.document = this.makeEmptyDocument();
      this.readonly = hasInvalid;
      if (hasInvalid) new Notice("Jam Deck：Canvas 绘图数据损坏，已只读打开并保留原文件");
      return this;
    }
    this.document = selected;
    this.revision = selected.revision;
    if (formal.file && !formal.document) {
      this.readonly = true;
      new Notice("Jam Deck：正式 Canvas 绘图文件损坏，已从恢复副本只读显示");
    } else if (selected !== formal.document) {
      this.dirty = true;
      this.scheduleSave(50);
    }
    return this;
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  notify() {
    for (const listener of this.subscribers) {
      try { listener(this.document); } catch (error) {}
    }
  }

  acquireWriter(owner) {
    if (this.readonly || (this.writer && this.writer !== owner)) return false;
    this.writer = owner;
    return true;
  }

  releaseWriter(owner) {
    if (this.writer === owner) this.writer = null;
  }

  totalPoints() {
    return (this.document && this.document.strokes || []).reduce((sum, stroke) => sum + stroke.points.length, 0);
  }

  markChanged() {
    this.dirty = true;
    this.changeVersion++;
    this.document.updatedAt = new Date().toISOString();
    this.notify();
    this.scheduleSave();
  }

  addStroke(stroke, record = true) {
    if (this.readonly || this.totalPoints() >= CANVAS_INK_HARD_POINTS) return false;
    this.document.strokes.push(stroke);
    if (record) {
      this.undoStack.push({ type: "add", strokes: [stroke] });
      this.redoStack = [];
      if (this.undoStack.length > 100) this.undoStack.shift();
    }
    this.markChanged();
    if (this.totalPoints() >= CANVAS_INK_SOFT_POINTS) new Notice("Jam Deck：当前白板笔迹较多，已加强采样简化");
    return true;
  }

  removeStrokes(ids, record = true) {
    const wanted = new Set(ids);
    const removed = this.document.strokes.filter((stroke) => wanted.has(stroke.id));
    if (!removed.length) return false;
    this.document.strokes = this.document.strokes.filter((stroke) => !wanted.has(stroke.id));
    if (record) {
      this.undoStack.push({ type: "remove", strokes: removed });
      this.redoStack = [];
      if (this.undoStack.length > 100) this.undoStack.shift();
    }
    this.markChanged();
    return true;
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return false;
    if (command.type === "add") this.document.strokes = this.document.strokes.filter((stroke) => !command.strokes.some((item) => item.id === stroke.id));
    else this.document.strokes.push(...command.strokes);
    this.redoStack.push(command);
    this.markChanged();
    return true;
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return false;
    if (command.type === "add") this.document.strokes.push(...command.strokes);
    else this.document.strokes = this.document.strokes.filter((stroke) => !command.strokes.some((item) => item.id === stroke.id));
    this.undoStack.push(command);
    this.markChanged();
    return true;
  }

  scheduleSave(delay = 600) {
    if (this.readonly) return;
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, delay);
  }

  async writeText(path, text) {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (file) await this.plugin.app.vault.modify(file, text);
    else await this.plugin.app.vault.create(path, text);
    const written = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!written) throw new Error(`无法创建 ${path}`);
    const verify = await this.plugin.app.vault.read(written);
    if (verify !== text) throw new Error(`写入校验失败 ${path}`);
    return written;
  }

  flush() {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveQueue = this.saveQueue.then(async () => {
      if (!this.dirty || this.readonly || !this.document) return;
      const snapshotVersion = this.changeVersion;
      const nextRevision = this.revision + 1;
      const payloadObject = { ...this.document, canvas: { path: this.canvasPath }, revision: nextRevision, previousRevision: this.revision, saveId: jamDeckInkId("save"), updatedAt: new Date().toISOString() };
      const payload = JSON.stringify(payloadObject, null, 2);
      if (Buffer.byteLength(payload, "utf8") > 16 * 1024 * 1024) throw new Error("Canvas 绘图数据超过 16MB，已停止新增保存");
      const tmpPath = jamDeckInkSidecarPath(this.canvasPath, ".tmp");
      const bakPath = jamDeckInkSidecarPath(this.canvasPath, ".bak");
      await this.writeText(tmpPath, payload);
      const formalFile = this.plugin.app.vault.getAbstractFileByPath(this.sidecarPath);
      if (formalFile) {
        const previous = await this.plugin.app.vault.read(formalFile);
        if (this.parseDocument(previous)) await this.writeText(bakPath, previous);
      }
      await this.writeText(this.sidecarPath, payload);
      const verifyFile = this.plugin.app.vault.getAbstractFileByPath(this.sidecarPath);
      const verified = verifyFile && this.parseDocument(await this.plugin.app.vault.read(verifyFile));
      if (!verified || verified.revision !== nextRevision) throw new Error("Canvas 绘图正式文件校验失败");
      const tmpFile = this.plugin.app.vault.getAbstractFileByPath(tmpPath);
      if (tmpFile) {
        try { await this.plugin.app.vault.delete(tmpFile); } catch (error) {}
      }
      this.document = payloadObject;
      this.revision = nextRevision;
      if (snapshotVersion === this.changeVersion) this.dirty = false;
    }).catch((error) => {
      console.error("jam-deck canvas ink save failed", error);
      new Notice(`Jam Deck：Canvas 笔迹保存失败 · ${error.message || "未知错误"}`);
    });
    return this.saveQueue;
  }
}

class CanvasInkOverlay {
  constructor(runtime, entry, owner) {
    this.runtime = runtime;
    this.entry = entry;
    this.owner = owner;
    this.canvas = entry.leaf && entry.leaf.view && entry.leaf.view.canvas;
    this.wrapper = this.canvas && this.canvas.wrapperEl;
    this.ownerWindow = entry.ownerDocument && entry.ownerDocument.defaultView;
    this.active = false;
    this.spaceNavigating = false;
    this.tool = "pen";
    this.color = CANVAS_INK_COLORS[0];
    this.baseWidth = CANVAS_INK_WIDTHS[1];
    this.pointerId = null;
    this.gesture = null;
    this.frame = 0;
    this.disposers = [];
    this.strokeElements = new Map();
  }

  static async create(runtime, entry) {
    const canvas = entry.leaf && entry.leaf.view && entry.leaf.view.canvas;
    if (!canvas || !canvas.wrapperEl || !canvas.canvasEl || typeof canvas.posFromEvt !== "function" || !Number.isFinite(Number(canvas.scale))) return null;
    const owner = await runtime.deckView.plugin.acquireCanvasInkOwner(entry.filePath);
    const overlay = new CanvasInkOverlay(runtime, entry, owner);
    try {
      overlay.mount();
      return overlay;
    } catch (error) {
      console.error("jam-deck canvas ink enhancement disabled", error);
      await runtime.deckView.plugin.releaseCanvasInkOwner(owner);
      new Notice("Jam Deck：当前 Obsidian 版本暂不能启用 Canvas 画笔");
      return null;
    }
  }

  mount() {
    const document = this.entry.ownerDocument;
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.classList.add("jam-deck-drawing-overlay");
    this.svg.setAttribute("aria-hidden", "true");
    this.world = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.world.classList.add("jam-deck-drawing-world");
    this.svg.appendChild(this.world);
    this.wrapper.appendChild(this.svg);
    this.installToolbar();
    this.installPalette();
    this.installEvents();
    this.unsubscribeOwner = this.owner.subscribe(() => {
      this.renderAll();
      this.updatePalette();
    });
    this.updateViewport();
    this.renderAll();
    if (typeof this.ownerWindow.ResizeObserver === "function") {
      this.resizeObserver = new this.ownerWindow.ResizeObserver(() => this.scheduleViewport());
      this.resizeObserver.observe(this.wrapper);
    }
    if (typeof this.ownerWindow.MutationObserver === "function") {
      this.viewportObserver = new this.ownerWindow.MutationObserver(() => this.scheduleViewport());
      this.viewportObserver.observe(this.canvas.canvasEl, { attributes: true, attributeFilter: ["style", "class"] });
      this.toolbarObserver = new this.ownerWindow.MutationObserver(() => this.installToolbar());
      this.toolbarObserver.observe(this.wrapper, { childList: true, subtree: true });
    }
  }

  installToolbar() {
    const nativeMenu = this.canvas.cardMenuEl;
    const menu = nativeMenu && nativeMenu.isConnected ? nativeMenu : this.wrapper.querySelector(".canvas-card-menu");
    if (!menu || !this.entry.leaf.containerEl.contains(menu)) return;
    menu.addClass("jam-deck-node-toolbar--spatial");
    this.toolbarMenu = menu;
    if (this.toggleButton && this.toggleButton.isConnected && this.toggleButton.parentElement === menu) return;
    const existing = menu.querySelector(".jam-deck-draw-toggle");
    if (existing) existing.remove();
    const button = this.entry.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "canvas-card-menu-button jam-deck-draw-toggle";
    button.setAttribute("aria-label", "画笔模式");
    button.setAttribute("title", "画笔模式");
    button.setAttribute("aria-pressed", String(this.active));
    setIcon(button, "pen-tool");
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
    });
    menu.appendChild(button);
    this.toggleButton = button;
  }

  makePaletteButton(parent, icon, label, handler, cls = "") {
    const button = parent.createEl("button", { cls, attr: { type: "button", title: label, "aria-label": label } });
    if (icon) setIcon(button, icon);
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handler();
    });
    return button;
  }

  installPalette() {
    const palette = this.wrapper.createDiv({ cls: "jam-deck-drawing-palette", attr: { role: "toolbar", "aria-label": "绘制工具" } });
    palette.hidden = true;
    const tools = palette.createDiv({ cls: "jam-deck-ink-group", attr: { "data-group": "tool" } });
    this.toolButtons = {
      pen: this.makePaletteButton(tools, "pen-tool", "画笔", () => this.setTool("pen"), "jam-deck-ink-tool"),
      highlighter: this.makePaletteButton(tools, "highlighter", "荧光笔", () => this.setTool("highlighter"), "jam-deck-ink-tool"),
      eraser: this.makePaletteButton(tools, "eraser", "整笔橡皮擦", () => this.setTool("eraser"), "jam-deck-ink-tool is-eraser"),
    };
    const colors = palette.createDiv({ cls: "jam-deck-ink-group", attr: { "data-group": "color", "aria-label": "颜色" } });
    this.colorButtons = CANVAS_INK_COLORS.map((color, index) => {
      const button = this.makePaletteButton(colors, "", `颜色 ${index + 1}`, () => this.setColor(color), "jam-deck-ink-color");
      button.style.setProperty("--jam-deck-ink-color", color);
      return button;
    });
    const widths = palette.createDiv({ cls: "jam-deck-ink-group", attr: { "data-group": "width", "aria-label": "粗细" } });
    this.widthButtons = CANVAS_INK_WIDTHS.map((width) => {
      const button = this.makePaletteButton(widths, "", `${width === 2 ? "细" : width === 5 ? "中" : "粗"}笔画`, () => this.setWidth(width), "jam-deck-ink-width");
      button.style.setProperty("--jam-deck-ink-width", `${width}px`);
      button.createSpan();
      return button;
    });
    palette.createDiv({ cls: "jam-deck-ink-divider" });
    const history = palette.createDiv({ cls: "jam-deck-ink-group", attr: { "data-group": "history" } });
    this.undoButton = this.makePaletteButton(history, "undo-2", "撤销笔迹", () => this.owner.undo());
    this.redoButton = this.makePaletteButton(history, "redo-2", "重做笔迹", () => this.owner.redo());
    this.doneButton = this.makePaletteButton(palette, "", "完成绘制", () => this.exit(), "jam-deck-ink-done");
    this.doneButton.setText("完成");
    this.palette = palette;
    this.updatePalette();
  }

  installEvents() {
    const down = (event) => this.onPointerDown(event);
    const move = (event) => this.onPointerMove(event);
    const up = (event) => this.onPointerUp(event, false);
    const cancel = (event) => this.onPointerUp(event, true);
    const lost = (event) => this.onPointerUp(event, true);
    const keydown = (event) => this.onKeyDown(event);
    const keyup = (event) => this.onKeyUp(event);
    const wheel = () => this.scheduleViewport();
    const blur = () => this.cancelGesture();
    this.wrapper.addEventListener("pointerdown", down, true);
    this.wrapper.addEventListener("pointermove", move, true);
    this.wrapper.addEventListener("pointerup", up, true);
    this.wrapper.addEventListener("pointercancel", cancel, true);
    this.wrapper.addEventListener("lostpointercapture", lost, true);
    this.wrapper.addEventListener("keydown", keydown, true);
    this.wrapper.addEventListener("wheel", wheel, { capture: true, passive: true });
    this.ownerWindow.addEventListener("keyup", keyup, true);
    this.ownerWindow.addEventListener("blur", blur);
    this.disposers.push(
      () => this.wrapper.removeEventListener("pointerdown", down, true),
      () => this.wrapper.removeEventListener("pointermove", move, true),
      () => this.wrapper.removeEventListener("pointerup", up, true),
      () => this.wrapper.removeEventListener("pointercancel", cancel, true),
      () => this.wrapper.removeEventListener("lostpointercapture", lost, true),
      () => this.wrapper.removeEventListener("keydown", keydown, true),
      () => this.wrapper.removeEventListener("wheel", wheel, true),
      () => this.ownerWindow.removeEventListener("keyup", keyup, true),
      () => this.ownerWindow.removeEventListener("blur", blur)
    );
  }

  editableTarget(event) {
    return event.target && event.target.closest && event.target.closest("input, textarea, [contenteditable='true'], .canvas-card-menu, .jam-deck-drawing-palette");
  }

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  enter() {
    if (this.owner.readonly) {
      new Notice("Jam Deck：当前 Canvas 笔迹为只读状态");
      return false;
    }
    if (!this.owner.acquireWriter(this)) {
      new Notice("Jam Deck：这个 Canvas 已在另一个工作区中绘制");
      return false;
    }
    this.active = true;
    this.spaceNavigating = false;
    this.entry.leaf.containerEl.addClass("is-jam-deck-drawing");
    this.palette.hidden = false;
    if (this.toggleButton) this.toggleButton.setAttribute("aria-pressed", "true");
    this.updatePalette();
    this.wrapper.focus();
    new Notice("Jam Deck：画笔模式已开启 · 按住空格可导航");
    return true;
  }

  exit() {
    this.cancelGesture();
    this.active = false;
    this.spaceNavigating = false;
    this.owner.releaseWriter(this);
    this.entry.leaf.containerEl.removeClass("is-jam-deck-drawing");
    if (this.palette) this.palette.hidden = true;
    if (this.toggleButton) {
      this.toggleButton.setAttribute("aria-pressed", "false");
      try { this.toggleButton.focus(); } catch (error) {}
    }
    void this.owner.flush();
  }

  setTool(tool) {
    this.tool = tool;
    this.updatePalette();
  }

  setColor(color) {
    this.color = color;
    this.updatePalette();
  }

  setWidth(width) {
    this.baseWidth = width;
    this.updatePalette();
  }

  updatePalette() {
    if (!this.palette) return;
    for (const [tool, button] of Object.entries(this.toolButtons || {})) button.setAttribute("aria-pressed", String(tool === this.tool));
    for (let index = 0; index < (this.colorButtons || []).length; index++) this.colorButtons[index].setAttribute("aria-pressed", String(CANVAS_INK_COLORS[index] === this.color));
    for (let index = 0; index < (this.widthButtons || []).length; index++) this.widthButtons[index].setAttribute("aria-pressed", String(CANVAS_INK_WIDTHS[index] === this.baseWidth));
    if (this.undoButton) this.undoButton.disabled = !this.owner.undoStack.length;
    if (this.redoButton) this.redoButton.disabled = !this.owner.redoStack.length;
    this.palette.toggleClass("is-eraser", this.tool === "eraser");
  }

  onKeyDown(event) {
    if (!this.active || this.editableTarget(event)) return;
    const key = String(event.key || "").toLowerCase();
    if (key === "escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.exit();
      return;
    }
    if (key === " ") {
      if (this.gesture) this.cancelGesture();
      this.spaceNavigating = true;
      this.entry.leaf.containerEl.addClass("is-jam-deck-navigating");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey) this.owner.redo(); else this.owner.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === "y") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.owner.redo();
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && ["p", "h", "e"].includes(key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setTool(key === "p" ? "pen" : key === "h" ? "highlighter" : "eraser");
    }
  }

  onKeyUp(event) {
    if (String(event.key || "") !== " ") return;
    this.spaceNavigating = false;
    this.entry.leaf.containerEl.removeClass("is-jam-deck-navigating");
  }

  canDrawEvent(event) {
    if (!this.active || this.spaceNavigating || this.owner.readonly || this.editableTarget(event) || !event.isPrimary || event.button !== 0) return false;
    return event.pointerType === "pen" || event.pointerType === "mouse";
  }

  eventPoint(event) {
    let pos;
    try { pos = this.canvas.posFromEvt(event); } catch (error) { return null; }
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
    return [pos.x, pos.y];
  }

  appendPoint(points, point) {
    if (!point) return;
    const threshold = Math.max(0.08, 0.45 / Math.max(0.1, Number(this.canvas.scale) || 1));
    const previous = points[points.length - 1];
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= threshold) points.push(point);
    if (points.length > 8192) points.splice(1, 1);
  }

  onPointerDown(event) {
    if (!this.canDrawEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.runtime.activate(this.entry);
    this.pointerId = event.pointerId;
    try { this.wrapper.setPointerCapture(event.pointerId); } catch (error) {}
    const points = [];
    this.appendPoint(points, this.eventPoint(event));
    this.gesture = { tool: this.tool, points };
    this.previewPath = this.createStrokeElement({ tool: this.tool === "eraser" ? "highlighter" : this.tool, style: { color: this.tool === "eraser" ? "#ff6b6b" : this.color, baseWidth: this.tool === "eraser" ? this.baseWidth * 2 : this.baseWidth, opacity: this.tool === "eraser" ? 0.2 : this.tool === "highlighter" ? 0.4 : 1 }, points });
    this.previewPath.classList.add("is-preview");
    this.world.appendChild(this.previewPath);
    this.schedulePreview();
  }

  onPointerMove(event) {
    if (this.pointerId !== event.pointerId || !this.gesture) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.appendPoint(this.gesture.points, this.eventPoint(event));
    this.schedulePreview();
  }

  onPointerUp(event, cancelled) {
    if (this.pointerId !== event.pointerId || !this.gesture) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!cancelled) this.appendPoint(this.gesture.points, this.eventPoint(event));
    const gesture = this.gesture;
    this.pointerId = null;
    this.gesture = null;
    try { if (this.wrapper.hasPointerCapture(event.pointerId)) this.wrapper.releasePointerCapture(event.pointerId); } catch (error) {}
    if (this.previewPath) this.previewPath.remove();
    this.previewPath = null;
    if (cancelled || !gesture.points.length) return;
    if (gesture.tool === "eraser") {
      const ids = this.owner.document.strokes.filter((stroke) => jamDeckInkStrokeHit(stroke, gesture.points, this.baseWidth * 1.8)).map((stroke) => stroke.id);
      this.owner.removeStrokes(ids);
      return;
    }
    let points = gesture.points;
    if (points.length > 2048) {
      const step = Math.ceil(points.length / 2048);
      points = points.filter((point, index) => index === 0 || index === gesture.points.length - 1 || index % step === 0);
    }
    const stroke = jamDeckInkSanitizeStroke({
      id: jamDeckInkId("stroke"),
      tool: gesture.tool,
      anchor: { type: "canvas" },
      style: { color: this.color, baseWidth: this.baseWidth, opacity: gesture.tool === "highlighter" ? 0.4 : 1, blendMode: gesture.tool === "highlighter" ? "multiply" : "normal" },
      points,
      createdAt: new Date().toISOString(),
    });
    if (stroke) this.owner.addStroke(stroke);
  }

  cancelGesture() {
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.gesture = null;
    if (pointerId != null) {
      try { if (this.wrapper.hasPointerCapture(pointerId)) this.wrapper.releasePointerCapture(pointerId); } catch (error) {}
    }
    if (this.previewPath) this.previewPath.remove();
    this.previewPath = null;
  }

  createStrokeElement(stroke) {
    const element = this.entry.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
    element.classList.add("jam-deck-ink-stroke");
    const style = stroke.style || {};
    element.setAttribute("d", jamDeckInkLinePath(stroke.points || []));
    element.setAttribute("fill", "none");
    element.setAttribute("stroke", style.color || CANVAS_INK_COLORS[0]);
    element.setAttribute("stroke-width", String((Number(style.baseWidth) || 2) * (stroke.tool === "highlighter" ? 3 : 1)));
    element.setAttribute("stroke-linecap", "round");
    element.setAttribute("stroke-linejoin", "round");
    element.setAttribute("opacity", String(style.opacity == null ? 1 : style.opacity));
    element.style.mixBlendMode = style.blendMode || "normal";
    return element;
  }

  renderAll() {
    if (!this.world || !this.owner.document) return;
    const preview = this.previewPath;
    while (this.world.firstChild) this.world.removeChild(this.world.firstChild);
    this.strokeElements.clear();
    for (const stroke of this.owner.document.strokes) {
      const element = this.createStrokeElement(stroke);
      element.dataset.strokeId = stroke.id;
      this.world.appendChild(element);
      this.strokeElements.set(stroke.id, element);
    }
    if (preview) this.world.appendChild(preview);
  }

  schedulePreview() {
    if (this.frame) return;
    this.frame = this.ownerWindow.requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.previewPath || !this.gesture) return;
      const stroke = { tool: this.gesture.tool === "eraser" ? "highlighter" : this.gesture.tool, points: this.gesture.points };
      this.previewPath.setAttribute("d", jamDeckInkLinePath(stroke.points));
    });
  }

  scheduleViewport() {
    if (this.viewportFrame) return;
    this.viewportFrame = this.ownerWindow.requestAnimationFrame(() => {
      this.viewportFrame = 0;
      this.updateViewport();
    });
  }

  updateViewport() {
    if (!this.world || !this.wrapper) return;
    const rect = this.wrapper.getBoundingClientRect();
    const scale = Number(this.canvas.scale);
    const x = Number(this.canvas.x);
    const y = Number(this.canvas.y);
    if (![rect.width, rect.height, scale, x, y].every(Number.isFinite) || scale <= 0) {
      this.exit();
      if (this.toggleButton) this.toggleButton.disabled = true;
      return;
    }
    const tx = rect.width / 2 - x * scale;
    const ty = rect.height / 2 - y * scale;
    this.world.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
  }

  async destroy() {
    this.exit();
    if (this.unsubscribeOwner) this.unsubscribeOwner();
    for (const dispose of this.disposers) {
      try { dispose(); } catch (error) {}
    }
    this.disposers = [];
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.viewportObserver) this.viewportObserver.disconnect();
    if (this.toolbarObserver) this.toolbarObserver.disconnect();
    if (this.frame) this.ownerWindow.cancelAnimationFrame(this.frame);
    if (this.viewportFrame) this.ownerWindow.cancelAnimationFrame(this.viewportFrame);
    if (this.toggleButton) this.toggleButton.remove();
    if (this.toolbarMenu) this.toolbarMenu.removeClass("jam-deck-node-toolbar--spatial");
    if (this.palette) this.palette.remove();
    if (this.svg) this.svg.remove();
    await this.runtime.deckView.plugin.releaseCanvasInkOwner(this.owner);
  }
}

const JAM_DECK_CANVAS_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"]);
const JAM_DECK_STACK_OVERLAP_THRESHOLD = 0.5;
const JAM_DECK_STACK_DETACH_THRESHOLD = 0.4;
const JAM_DECK_STACK_SHRINK_DEAD_BAND = 0.95;
const JAM_DECK_STACK_AMBIGUITY_MARGIN = 0.05;
const JAM_DECK_STACK_NORMALIZATION_VERSION = 1;
const JAM_DECK_STACK_TEXT_PREVIEW_FONT_PX = 16;
const JAM_DECK_STACK_TEXT_PREVIEW_PADDING_PX = 16;

function jamDeckCanvasStackRect(value) {
  const source = value && value.rect ? value.rect : value;
  if (!source) return null;
  const rect = {
    x: Number(source.x),
    y: Number(source.y),
    width: Number(source.width),
    height: Number(source.height),
  };
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 1 || rect.height < 1) return null;
  return rect;
}

function jamDeckCanvasStackKind(data) {
  if (!data || typeof data !== "object") return null;
  if (data.type === "text") return "text";
  if (data.type !== "file" || typeof data.file !== "string" || !data.file.trim()) return null;
  const extension = data.file.toLowerCase().split(/[?#]/)[0].split(".").pop();
  if (extension === "md") return "markdown-note";
  return JAM_DECK_CANVAS_IMAGE_EXTENSIONS.has(extension) ? "image" : null;
}

function jamDeckCanvasStackNormalizationKey(kind) {
  return kind === "text" ? "stackTextNormalization" : kind === "image" ? "stackImageNormalization" : null;
}

function jamDeckCanvasStackNormalization(data, kind = "image") {
  const key = jamDeckCanvasStackNormalizationKey(kind);
  const value = key && data && data.jamdeck && data.jamdeck[key];
  if (!value || value.version !== JAM_DECK_STACK_NORMALIZATION_VERSION) return null;
  const original = value.originalCanvasSize;
  const normalized = value.normalizedCanvasSize;
  if (
    !original || !normalized
    || ![original.width, original.height, normalized.width, normalized.height].every((number) => Number.isFinite(Number(number)) && Number(number) >= 1)
  ) return null;
  return value;
}

function jamDeckRoundCanvasStackValue(value) {
  return Math.round(Number(value) * 100) / 100;
}

function jamDeckCanvasStackIntersectionArea(left, right) {
  const a = jamDeckCanvasStackRect(left);
  const b = jamDeckCanvasStackRect(right);
  if (!a || !b) return 0;
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function jamDeckCanvasStackOverlapRatio(left, right) {
  const a = jamDeckCanvasStackRect(left);
  const b = jamDeckCanvasStackRect(right);
  if (!a || !b) return 0;
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > 0 ? jamDeckCanvasStackIntersectionArea(a, b) / smallerArea : 0;
}

function jamDeckCanvasStackAnchor(members) {
  if (!Array.isArray(members) || !members.length) return null;
  const center = members.reduce((result, member) => {
    const rect = jamDeckCanvasStackRect(member);
    result.x += rect.x + rect.width / 2;
    result.y += rect.y + rect.height / 2;
    return result;
  }, { x: 0, y: 0 });
  center.x /= members.length;
  center.y /= members.length;
  return members.slice().sort((left, right) => {
    const a = jamDeckCanvasStackRect(left);
    const b = jamDeckCanvasStackRect(right);
    const ad = Math.hypot(a.x + a.width / 2 - center.x, a.y + a.height / 2 - center.y);
    const bd = Math.hypot(b.x + b.width / 2 - center.x, b.y + b.height / 2 - center.y);
    return ad - bd || a.y - b.y || a.x - b.x || String(left.id).localeCompare(String(right.id));
  })[0];
}

function jamDeckBuildCanvasStackClusters(items, includeSingles = false) {
  const valid = (Array.isArray(items) ? items : []).filter((item) => item && item.id && jamDeckCanvasStackRect(item));
  const graph = new Map(valid.map((item) => [String(item.id), new Set()]));
  for (let left = 0; left < valid.length; left++) {
    for (let right = left + 1; right < valid.length; right++) {
      if (jamDeckCanvasStackOverlapRatio(valid[left], valid[right]) > JAM_DECK_STACK_OVERLAP_THRESHOLD) {
        graph.get(String(valid[left].id)).add(String(valid[right].id));
        graph.get(String(valid[right].id)).add(String(valid[left].id));
      }
    }
  }
  const byId = new Map(valid.map((item) => [String(item.id), item]));
  const visited = new Set();
  const clusters = [];
  for (const item of valid) {
    const id = String(item.id);
    if (visited.has(id)) continue;
    const pending = [id];
    const members = [];
    visited.add(id);
    while (pending.length) {
      const current = pending.pop();
      members.push(byId.get(current));
      for (const neighbor of graph.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }
    if (includeSingles || members.length > 1) {
      const anchor = jamDeckCanvasStackAnchor(members);
      clusters.push({
        id: members.map((member) => String(member.id)).sort().join(":"),
        members,
        anchor,
      });
    }
  }
  return clusters.sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function jamDeckChooseCanvasStackTarget(dragged, candidates) {
  if (!jamDeckCanvasStackRect(dragged)) return null;
  const groups = jamDeckBuildCanvasStackClusters(candidates, true);
  const scored = [];
  const draggedRect = jamDeckCanvasStackRect(dragged);
  for (const cluster of groups) {
    let ratio = 0;
    for (const member of cluster.members) {
      const nextRatio = jamDeckCanvasStackOverlapRatio(dragged, member);
      ratio = Math.max(ratio, nextRatio);
    }
    if (ratio <= JAM_DECK_STACK_OVERLAP_THRESHOLD) continue;
    const clipped = cluster.members.map((member) => {
      const rect = jamDeckCanvasStackRect(member);
      const left = Math.max(draggedRect.x, rect.x);
      const top = Math.max(draggedRect.y, rect.y);
      const right = Math.min(draggedRect.x + draggedRect.width, rect.x + rect.width);
      const bottom = Math.min(draggedRect.y + draggedRect.height, rect.y + rect.height);
      return right > left && bottom > top ? { left, top, right, bottom } : null;
    }).filter(Boolean);
    const edges = [...new Set(clipped.flatMap((rect) => [rect.left, rect.right]))].sort((a, b) => a - b);
    let coveredArea = 0;
    for (let index = 0; index < edges.length - 1; index++) {
      const left = edges[index];
      const right = edges[index + 1];
      if (right <= left) continue;
      const intervals = clipped.filter((rect) => rect.left < right && rect.right > left)
        .map((rect) => [rect.top, rect.bottom]).sort((a, b) => a[0] - b[0]);
      let coveredHeight = 0;
      let start = null;
      let end = null;
      for (const interval of intervals) {
        if (start === null) {
          [start, end] = interval;
        } else if (interval[0] <= end) {
          end = Math.max(end, interval[1]);
        } else {
          coveredHeight += end - start;
          [start, end] = interval;
        }
      }
      if (start !== null) coveredHeight += end - start;
      coveredArea += (right - left) * coveredHeight;
    }
    const coverage = coveredArea / (draggedRect.width * draggedRect.height);
    const score = 0.7 * ratio + 0.3 * coverage;
    scored.push({ cluster, ratio, coverage, score });
  }
  scored.sort((left, right) => right.score - left.score || right.ratio - left.ratio || right.coverage - left.coverage);
  if (scored.length > 1 && scored[0].score - scored[1].score < JAM_DECK_STACK_AMBIGUITY_MARGIN) return null;
  return scored[0] || null;
}

function jamDeckNormalizeCanvasStackImage(candidate, members) {
  const current = jamDeckCanvasStackRect(candidate);
  const targets = (Array.isArray(members) ? members : []).map(jamDeckCanvasStackRect).filter(Boolean);
  if (!current || !targets.length) return null;
  const targetWidth = targets.reduce((sum, rect) => sum + rect.width, 0) / targets.length;
  const targetHeight = targets.reduce((sum, rect) => sum + rect.height, 0) / targets.length;
  const rawScale = Math.min(targetWidth / current.width, targetHeight / current.height);
  const scale = Math.min(1, rawScale);
  if (!Number.isFinite(scale) || scale >= JAM_DECK_STACK_SHRINK_DEAD_BAND) return { ...current, scale: 1, changed: false };
  const width = current.width * scale;
  const height = current.height * scale;
  if (width < 1 || height < 1) return null;
  const centerX = current.x + current.width / 2;
  const centerY = current.y + current.height / 2;
  return {
    x: jamDeckRoundCanvasStackValue(centerX - width / 2),
    y: jamDeckRoundCanvasStackValue(centerY - height / 2),
    width: jamDeckRoundCanvasStackValue(width),
    height: jamDeckRoundCanvasStackValue(height),
    scale,
    changed: true,
  };
}

function jamDeckRestoreCanvasStackImage(candidate, originalSize, others) {
  const current = jamDeckCanvasStackRect(candidate);
  if (!current || !originalSize) return null;
  const width = Number(originalSize.width);
  const height = Number(originalSize.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const centerX = current.x + current.width / 2;
  const centerY = current.y + current.height / 2;
  const restored = {
    x: jamDeckRoundCanvasStackValue(centerX - width / 2),
    y: jamDeckRoundCanvasStackValue(centerY - height / 2),
    width: jamDeckRoundCanvasStackValue(width),
    height: jamDeckRoundCanvasStackValue(height),
  };
  const safe = (Array.isArray(others) ? others : []).every((item) => (
    jamDeckCanvasStackOverlapRatio(restored, item) < JAM_DECK_STACK_DETACH_THRESHOLD
  ));
  return safe ? restored : null;
}

function jamDeckCanvasStackSlotOffsets(count = 24, screenStep = 7, zoom = 1) {
  const total = Math.max(1, Math.floor(Number(count) || 1));
  const step = Math.min(9, Math.max(5, Number(screenStep) || 7)) / Math.max(0.01, Number(zoom) || 1);
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
    [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
  ];
  const slots = [{ x: 0, y: 0, screenX: 0, screenY: 0 }];
  for (let index = 0; slots.length < total; index++) {
    const ring = Math.floor(index / directions.length) + 1;
    const direction = directions[index % directions.length];
    const radius = step * ring;
    slots.push({
      x: direction[0] * radius,
      y: direction[1] * radius,
      screenX: direction[0] * radius * Math.max(0.01, Number(zoom) || 1),
      screenY: direction[1] * radius * Math.max(0.01, Number(zoom) || 1),
    });
  }
  return slots;
}

function jamDeckCanvasStackScreenScale(item) {
  const rect = item && jamDeckCanvasStackRect(item);
  const nodeEl = item && item.node && item.node.nodeEl;
  if (!rect || !nodeEl || typeof nodeEl.getBoundingClientRect !== "function") return 1;
  const screen = nodeEl.getBoundingClientRect();
  const scales = [
    rect.width > 0 ? screen.width / rect.width : 0,
    rect.height > 0 ? screen.height / rect.height : 0,
  ].filter((value) => Number.isFinite(value) && value > 0.01);
  if (!scales.length) return 1;
  return Math.min(16, Math.max(0.04, scales.reduce((sum, value) => sum + value, 0) / scales.length));
}

function jamDeckComputeCanvasStackSnap(dragged, cluster, options = {}) {
  const source = jamDeckCanvasStackRect(dragged);
  const anchor = cluster && jamDeckCanvasStackRect(cluster.anchor);
  if (!source || !anchor) return null;
  const zoom = Math.max(0.04, Number(options.zoom) || 1);
  const desiredScreenStep = Math.min(9, Math.max(5, Number(options.screenStep) || 7));
  const anchorCenter = { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
  const occupied = (cluster.members || []).map((member) => {
    const rect = jamDeckCanvasStackRect(member);
    return rect ? {
      x: (rect.x + rect.width / 2 - anchorCenter.x) * zoom,
      y: (rect.y + rect.height / 2 - anchorCenter.y) * zoom,
    } : null;
  }).filter(Boolean);
  const slots = jamDeckCanvasStackSlotOffsets(Math.max(24, occupied.length + 12), desiredScreenStep, zoom).slice(1);
  for (const slot of slots) {
    const distinct = occupied.every((point) => Math.hypot(slot.screenX - point.x, slot.screenY - point.y) >= 4.5);
    if (!distinct) continue;
    const result = {
      x: Math.round(anchorCenter.x - source.width / 2 + slot.x),
      y: Math.round(anchorCenter.y - source.height / 2 + slot.y),
      width: source.width,
      height: source.height,
    };
    if (jamDeckCanvasStackOverlapRatio(result, anchor) > 0.55) {
      return { ...result, screenOffset: { x: slot.screenX, y: slot.screenY }, zoom };
    }
  }
  return null;
}

function jamDeckLayoutCanvasStackPreview(sizes, anchorRect, viewport) {
  if (!Array.isArray(sizes) || !sizes.length || !anchorRect || !viewport) return null;
  const count = sizes.length;
  const viewportWidth = Math.max(1, Number(viewport.width) || 1);
  const viewportHeight = Math.max(1, Number(viewport.height) || 1);
  const margin = Math.min(64, Math.max(16, Math.min(viewportWidth, viewportHeight) * 0.035));
  const gap = viewportWidth < 640 ? 10 : 12;
  const safe = {
    left: margin,
    top: margin + 12,
    right: Math.max(margin + 1, viewportWidth - margin - 48),
    bottom: Math.max(margin + 1, viewportHeight - margin - 56),
  };
  const availableWidth = Math.max(1, safe.right - safe.left);
  const availableHeight = Math.max(1, safe.bottom - safe.top);
  const normalized = sizes.map((size) => ({
    width: Math.max(1, Number(size.width) || 1),
    height: Math.max(1, Number(size.height) || 1),
  }));
  const partitions = [];
  if (count <= 10) {
    const limit = 1 << Math.max(0, count - 1);
    for (let mask = 0; mask < limit; mask++) {
      const rows = [[]];
      for (let index = 0; index < count; index++) {
        rows[rows.length - 1].push(index);
        if (index < count - 1 && (mask & (1 << index))) rows.push([]);
      }
      partitions.push(rows);
    }
  } else {
    const columns = Math.max(2, Math.ceil(Math.sqrt(count)));
    const rows = [];
    for (let index = 0; index < count; index += columns) {
      rows.push(Array.from({ length: Math.min(columns, count - index) }, (_, offset) => index + offset));
    }
    partitions.push(rows);
  }
  let best = null;
  for (const rows of partitions) {
    const rowContentWidths = rows.map((row) => row.reduce((sum, index) => sum + normalized[index].width, 0));
    const rowHeights = rows.map((row) => Math.max(...row.map((index) => normalized[index].height)));
    const widthScale = Math.min(...rows.map((row, index) => (
      (availableWidth - gap * Math.max(0, row.length - 1)) / rowContentWidths[index]
    )));
    const heightScale = (availableHeight - gap * Math.max(0, rows.length - 1))
      / rowHeights.reduce((sum, height) => sum + height, 0);
    const scale = Math.min(1.55, widthScale, heightScale);
    if (!Number.isFinite(scale) || scale <= 0) continue;
    const scaledGap = gap;
    const width = Math.max(...rows.map((row) => row.reduce((sum, index) => sum + normalized[index].width * scale, 0) + scaledGap * Math.max(0, row.length - 1)));
    const rowScaledHeights = rows.map((row) => Math.max(...row.map((index) => normalized[index].height * scale)));
    const height = rowScaledHeights.reduce((sum, value) => sum + value, 0) + scaledGap * Math.max(0, rows.length - 1);
    const shortEdges = normalized.map((size) => Math.min(size.width, size.height) * scale);
    const minShort = Math.min(...shortEdges);
    const area = normalized.reduce((sum, size) => sum + size.width * size.height * scale * scale, 0);
    const rowBalance = Math.max(...rowContentWidths) - Math.min(...rowContentWidths);
    const score = minShort * 1000 + area * 0.002 - rowBalance * scale * 3 - rows.length * 18;
    if (!best || score > best.score) best = { rows, scale, width, height, rowScaledHeights, score };
  }
  if (!best) return null;
  const anchorCenterX = ((Number(anchorRect.left) || 0) + (Number(anchorRect.right) || 0)) / 2;
  const anchorCenterY = ((Number(anchorRect.top) || 0) + (Number(anchorRect.bottom) || 0)) / 2;
  const x = Math.max(safe.left, Math.min(anchorCenterX - best.width / 2, safe.right - best.width));
  const y = Math.max(safe.top, Math.min(anchorCenterY - best.height / 2, safe.bottom - best.height));
  const positions = new Array(count);
  let cursorY = y;
  best.rows.forEach((row, rowIndex) => {
    const rowWidth = row.reduce((sum, index) => sum + normalized[index].width * best.scale, 0) + gap * Math.max(0, row.length - 1);
    let cursorX = x + (best.width - rowWidth) / 2;
    const rowHeight = best.rowScaledHeights[rowIndex];
    row.forEach((index) => {
      const width = normalized[index].width * best.scale;
      const height = normalized[index].height * best.scale;
      positions[index] = {
        x: cursorX,
        y: cursorY + (rowHeight - height) / 2,
        width,
        height,
      };
      cursorX += width + gap;
    });
    cursorY += rowHeight + gap;
  });
  return { x, y, width: best.width, height: best.height, positions, safe, scale: best.scale };
}

function jamDeckCanvasStackBystanderShift(rect, focus, viewport, gap = 20, influence = 64) {
  if (!rect || !focus || !viewport) return { x: 0, y: 0 };
  const values = [rect.left, rect.top, rect.right, rect.bottom, focus.left, focus.top, focus.right, focus.bottom, viewport.width, viewport.height];
  if (values.some((value) => !Number.isFinite(Number(value)))) return { x: 0, y: 0 };
  const influenced = !(
    rect.right <= focus.left - influence
    || rect.left >= focus.right + influence
    || rect.bottom <= focus.top - influence
    || rect.top >= focus.bottom + influence
  );
  if (!influenced) return { x: 0, y: 0 };
  const overlapsFocus = !(
    rect.right <= focus.left - gap
    || rect.left >= focus.right + gap
    || rect.bottom <= focus.top - gap
    || rect.top >= focus.bottom + gap
  );
  const rectCenterX = (rect.left + rect.right) / 2;
  const rectCenterY = (rect.top + rect.bottom) / 2;
  const focusCenterX = (focus.left + focus.right) / 2;
  const focusCenterY = (focus.top + focus.bottom) / 2;
  const dx = rectCenterX - focusCenterX;
  const dy = rectCenterY - focusCenterY;
  const horizontal = Math.abs(dx) / Math.max(1, focus.right - focus.left) >= Math.abs(dy) / Math.max(1, focus.bottom - focus.top);
  let x = 0;
  let y = 0;
  if (overlapsFocus) {
    if (horizontal) x = dx < 0 ? focus.left - gap - rect.right : focus.right + gap - rect.left;
    else y = dy < 0 ? focus.top - gap - rect.bottom : focus.bottom + gap - rect.top;
  } else if (horizontal) {
    x = dx < 0 ? -24 : 24;
  } else {
    y = dy < 0 ? -24 : 24;
  }
  const minVisible = 24;
  x = Math.max(minVisible - rect.right, Math.min(viewport.width - minVisible - rect.left, x));
  y = Math.max(minVisible - rect.bottom, Math.min(viewport.height - minVisible - rect.top, y));
  return { x, y };
}

class CanvasImageStackController {
  constructor(runtime, entry) {
    this.runtime = runtime;
    this.entry = entry;
    this.canvas = entry.leaf && entry.leaf.view && entry.leaf.view.canvas;
    this.root = entry.leaf && entry.leaf.containerEl;
    this.ownerWindow = entry.ownerDocument && entry.ownerDocument.defaultView;
    this.disposers = [];
    this.drag = null;
    this.clusters = [];
    this.clusterByNodeId = new Map();
    this.markedNodes = new Set();
    this.previewClusterId = null;
    this.previewWrapper = null;
    this.previewCards = [];
    this.previewCluster = null;
    this.previewBystanders = [];
    this.previewRemovalTimer = 0;
    this.previewPress = null;
    this.dragPortal = null;
    this.imageFocus = null;
    this.snapGeneration = 0;
    this.snapValidationFrame = 0;
    this.reconcileFrame = 0;
    this.destroyed = false;
    this.canAutoSnap = !!(
      this.canvas
      && typeof this.canvas.requestSave === "function"
      && typeof this.canvas.markMoved === "function"
      && typeof this.canvas.requestPushHistory === "function"
      && typeof this.canvas.requestPushHistory.run === "function"
      && typeof this.canvas.requestPushHistory.cancel === "function"
    );
  }

  install() {
    if (!this.canvas || !this.root || !this.ownerWindow || this.destroyed) return false;
    this.root.addClass("has-jam-deck-image-stacks");
    this.root.addClass("has-jam-deck-mixed-stacks");
    this.overlay = this.entry.ownerDocument.createElement("div");
    this.overlay.className = "jam-deck-canvas-stack-overlay";
    this.overlay.setAttribute("aria-hidden", "true");
    this.root.appendChild(this.overlay);
    const pointerdown = (event) => this.onPointerDown(event);
    const collapse = (event) => {
      if (!this.previewWrapper) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.collapsePreview();
    };
    const keydown = (event) => {
      if (this.imageFocus) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") this.closeImageFocus();
        return;
      }
      if (!this.previewWrapper) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") this.collapsePreview();
    };
    this.root.addEventListener("pointerdown", pointerdown, true);
    this.root.addEventListener("wheel", collapse, true);
    this.root.addEventListener("contextmenu", collapse, true);
    this.root.addEventListener("keydown", keydown, true);
    this.disposers.push(() => this.root.removeEventListener("pointerdown", pointerdown, true));
    this.disposers.push(() => this.root.removeEventListener("wheel", collapse, true));
    this.disposers.push(() => this.root.removeEventListener("contextmenu", collapse, true));
    this.disposers.push(() => this.root.removeEventListener("keydown", keydown, true));
    const MutationObserverCtor = this.ownerWindow.MutationObserver;
    if (typeof MutationObserverCtor === "function") {
      this.observer = new MutationObserverCtor(() => {
        if (!this.drag) this.scheduleReconcile();
      });
      this.observer.observe(this.root, { subtree: true, childList: true });
    }
    const ResizeObserverCtor = this.ownerWindow.ResizeObserver;
    if (typeof ResizeObserverCtor === "function") {
      this.resizeObserver = new ResizeObserverCtor(() => {
        if (this.previewClusterId) this.collapsePreview();
      });
      this.resizeObserver.observe(this.root);
    }
    this.scheduleReconcile();
    return true;
  }

  nodeItem(node) {
    if (!node || typeof node.getData !== "function") return null;
    let data;
    try { data = node.getData(); } catch (error) { return null; }
    const kind = jamDeckCanvasStackKind(data);
    if (!kind) return null;
    if (data.type === "file") {
      const app = this.runtime && this.runtime.deckView && this.runtime.deckView.app;
      const file = app && app.vault && typeof app.vault.getAbstractFileByPath === "function"
        ? app.vault.getAbstractFileByPath(data.file)
        : null;
      if (!file) return null;
    }
    const rect = jamDeckCanvasStackRect(data);
    return rect ? { id: String(data.id || node.id), node, data, rect, kind } : null;
  }

  getStackItems() {
    if (!this.canvas || !this.canvas.nodes || typeof this.canvas.nodes.values !== "function") return [];
    const items = [];
    for (const node of this.canvas.nodes.values()) {
      const item = this.nodeItem(node);
      if (item) items.push(item);
    }
    return items;
  }

  getImageItems() {
    return this.getStackItems().filter((item) => item.kind === "image");
  }

  getCanvasItems() {
    if (!this.canvas || !this.canvas.nodes || typeof this.canvas.nodes.values !== "function") return [];
    const items = [];
    for (const node of this.canvas.nodes.values()) {
      if (!node || !node.nodeEl || typeof node.getData !== "function") continue;
      let data;
      try { data = node.getData(); } catch (error) { continue; }
      const rect = jamDeckCanvasStackRect(data);
      if (!rect) continue;
      items.push({ id: String(data.id || node.id), node, data, rect });
    }
    return items;
  }

  findNodeFromElement(element) {
    if (!element || !element.closest) return null;
    const nodeEl = element.closest(".canvas-node");
    if (!nodeEl || !this.root.contains(nodeEl)) return null;
    for (const node of this.canvas.nodes.values()) {
      if (node.nodeEl === nodeEl) return node;
    }
    return null;
  }

  isBlockedPointerTarget(target) {
    return !!(target && target.closest && target.closest(
      "button, input, textarea, [contenteditable='true'], .canvas-node-resizer, .canvas-control-point, .canvas-card-menu, .canvas-menu, .jam-deck-drawing-palette, .jam-deck-canvas-ink-layer"
    ));
  }

  onPointerDown(event) {
    if (this.imageFocus && this.imageFocus.wrapper && this.imageFocus.wrapper.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.target.closest(".jam-deck-canvas-stack-image-focus-media")) this.closeImageFocus();
      return;
    }
    if (this.previewWrapper && this.previewWrapper.contains(event.target)) {
      const card = event.target.closest(".jam-deck-canvas-stack-preview-card");
      if (card) {
        this.startPreviewPress(event, card);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.collapsePreview();
      return;
    }
    if (this.destroyed || !event.isPrimary || event.button !== 0 || this.isBlockedPointerTarget(event.target)) return;
    if (this.root.hasClass("is-jam-deck-drawing") || this.canvas.readonly || this.canvas.isHoldingSpace) {
      this.collapsePreview();
      return;
    }
    const node = this.findNodeFromElement(event.target);
    const item = this.nodeItem(node);
    if (!item) {
      this.collapsePreview();
      return;
    }
    if (this.canvas.selection && this.canvas.selection.size > 1 && this.canvas.selection.has(node)) return;
    this.snapGeneration += 1;
    if (this.snapValidationFrame) {
      this.ownerWindow.cancelAnimationFrame(this.snapValidationFrame);
      this.snapValidationFrame = 0;
    }
    const drag = {
      pointerId: event.pointerId,
      node,
      nodeId: item.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      preRect: item.rect,
      moved: false,
      cancelled: false,
      releaseTime: 0,
      dispose: null,
    };
    this.drag = drag;
    const move = (next) => {
      if (this.drag !== drag || next.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(next.clientX - drag.startClientX, next.clientY - drag.startClientY) >= 5) {
        drag.moved = true;
        this.collapsePreview(true);
        if (node.nodeEl) node.nodeEl.addClass("is-jam-deck-stack-dragging");
      }
    };
    const finish = (next, cancelled) => {
      if (this.drag !== drag || next.pointerId !== drag.pointerId) return;
      drag.cancelled = cancelled;
      drag.releaseTime = Date.now();
      drag.dispose();
      if (!drag.moved && !cancelled) {
        const cluster = this.clusterByNodeId.get(drag.nodeId);
        this.finishDrag(drag);
        this.togglePreview(cluster);
        return;
      }
      if (cancelled) {
        this.finishDrag(drag);
        return;
      }
      this.ownerWindow.setTimeout(() => this.awaitStableDragRect(drag), 0);
    };
    const up = (next) => finish(next, false);
    const cancel = (next) => finish(next, true);
    drag.dispose = () => {
      this.ownerWindow.removeEventListener("pointermove", move, true);
      this.ownerWindow.removeEventListener("pointerup", up, false);
      this.ownerWindow.removeEventListener("pointercancel", cancel, true);
    };
    this.ownerWindow.addEventListener("pointermove", move, true);
    this.ownerWindow.addEventListener("pointerup", up, false);
    this.ownerWindow.addEventListener("pointercancel", cancel, true);
  }

  canvasWorldPoint(event) {
    if (!this.canvas || typeof this.canvas.posFromEvt !== "function") return null;
    try {
      const point = this.canvas.posFromEvt(event);
      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
      return { x: Number(point.x), y: Number(point.y) };
    } catch (error) {
      return null;
    }
  }

  viewportSignature() {
    if (!this.canvas || !this.canvas.canvasEl || !this.root) return "";
    const rect = this.root.getBoundingClientRect();
    return JSON.stringify([
      Number(this.canvas.scale) || 0,
      this.canvas.canvasEl.getAttribute("style") || "",
      Math.round(rect.left * 100) / 100,
      Math.round(rect.top * 100) / 100,
      Math.round(rect.width * 100) / 100,
      Math.round(rect.height * 100) / 100,
    ]);
  }

  previewVisualForCard(card) {
    return this.previewCards.find((visual) => visual.card === card) || null;
  }

  startPreviewPress(event, card) {
    if (
      this.destroyed || this.previewPress || !event.isPrimary || event.button !== 0
      || !this.previewWrapper || !this.previewWrapper.contains(card)
    ) return;
    const visual = this.previewVisualForCard(card);
    const member = visual && visual.member;
    const live = member && this.nodeItem(member.node);
    const startWorld = this.canvasWorldPoint(event);
    if (!visual || !live || !startWorld) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const normalization = live.kind === "image" || live.kind === "text"
      ? jamDeckCanvasStackNormalization(live.data, live.kind)
      : null;
    const press = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      card,
      visual,
      member,
      nodeId: live.id,
      kind: live.kind,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorld,
      baseRect: { ...live.rect },
      baseIdentity: {
        type: live.data.type,
        file: live.data.file || null,
        subpath: live.data.subpath || null,
        normalization: normalization ? JSON.stringify(normalization) : null,
      },
      viewport: this.viewportSignature(),
      dragging: false,
      disposed: false,
      move: null,
      up: null,
      cancel: null,
    };
    this.previewPress = press;
    try { card.setPointerCapture(event.pointerId); } catch (error) {}
    press.move = (next) => {
      if (this.previewPress !== press || next.pointerId !== press.pointerId) return;
      const threshold = press.pointerType === "touch" ? 10 : 6;
      const dx = next.clientX - press.startClientX;
      const dy = next.clientY - press.startClientY;
      if (!press.dragging && Math.hypot(dx, dy) >= threshold) this.beginPreviewDrag(press);
      if (press.dragging) {
        if (this.viewportSignature() !== press.viewport) return this.cancelPreviewPress(press, true);
        press.card.style.setProperty("--jd-stack-drag-x", `${dx}px`);
        press.card.style.setProperty("--jd-stack-drag-y", `${dy}px`);
      }
    };
    press.up = (next) => {
      if (this.previewPress !== press || next.pointerId !== press.pointerId) return;
      if (press.dragging) this.commitPreviewDrag(press, next);
      else {
        this.disposePreviewPress(press);
        this.handlePreviewCardClick(press);
      }
    };
    press.cancel = (next) => {
      if (this.previewPress !== press || next.pointerId !== press.pointerId) return;
      this.cancelPreviewPress(press, press.dragging);
    };
    this.ownerWindow.addEventListener("pointermove", press.move, true);
    this.ownerWindow.addEventListener("pointerup", press.up, true);
    this.ownerWindow.addEventListener("pointercancel", press.cancel, true);
  }

  disposePreviewPress(press) {
    if (!press || press.disposed) return;
    press.disposed = true;
    try { press.card.releasePointerCapture(press.pointerId); } catch (error) {}
    this.ownerWindow.removeEventListener("pointermove", press.move, true);
    this.ownerWindow.removeEventListener("pointerup", press.up, true);
    this.ownerWindow.removeEventListener("pointercancel", press.cancel, true);
    if (this.previewPress === press) this.previewPress = null;
  }

  beginPreviewDrag(press) {
    if (!press || press.dragging || !this.previewWrapper) return;
    press.dragging = true;
    const rootRect = this.root.getBoundingClientRect();
    const cardRect = press.card.getBoundingClientRect();
    const wrapper = this.previewWrapper;
    const cards = this.previewCards.slice();
    const bystanders = this.previewBystanders.slice();
    const portal = this.entry.ownerDocument.createElement("div");
    portal.className = "jam-deck-canvas-stack-drag-portal";
    press.card.style.left = `${cardRect.left - rootRect.left}px`;
    press.card.style.top = `${cardRect.top - rootRect.top}px`;
    press.card.style.width = `${cardRect.width}px`;
    press.card.style.height = `${cardRect.height}px`;
    press.card.style.transform = "none";
    press.card.classList.add("is-dragging-out");
    portal.appendChild(press.card);
    this.overlay.appendChild(portal);
    this.dragPortal = portal;
    for (const visual of cards) {
      if (visual !== press.visual && visual.member && visual.member.node && visual.member.node.nodeEl) {
        visual.member.node.nodeEl.removeClass("is-jam-deck-stack-source-ghost");
      }
    }
    for (const nodeEl of bystanders) {
      nodeEl.removeClass("is-jam-deck-stack-displaced");
      nodeEl.removeClass("is-jam-deck-stack-bystander");
      nodeEl.style.removeProperty("--jd-stack-bystander-x");
      nodeEl.style.removeProperty("--jd-stack-bystander-y");
    }
    if (wrapper.isConnected) wrapper.remove();
    this.previewWrapper = null;
    this.previewCards = [];
    this.previewCluster = null;
    this.previewClusterId = null;
    this.previewBystanders = [];
  }

  cancelPreviewPress(press, rebuild = false) {
    this.disposePreviewPress(press);
    if (press && press.card) {
      press.card.classList.remove("is-dragging-out");
      press.card.style.removeProperty("--jd-stack-drag-x");
      press.card.style.removeProperty("--jd-stack-drag-y");
    }
    if (this.dragPortal) this.dragPortal.remove();
    this.dragPortal = null;
    const nodeEl = press && press.member && press.member.node && press.member.node.nodeEl;
    if (nodeEl) nodeEl.removeClass("is-jam-deck-stack-source-ghost");
    this.scheduleReconcile();
    if (rebuild) {
      this.ownerWindow.requestAnimationFrame(() => {
        const cluster = this.clusterByNodeId.get(press.nodeId);
        if (cluster) this.showPreview(cluster);
      });
    }
  }

  previewDragGuard(press, live) {
    if (!press || !live || live.id !== press.nodeId || live.kind !== press.kind) return false;
    const currentNormalization = live.kind === "image" || live.kind === "text"
      ? jamDeckCanvasStackNormalization(live.data, live.kind)
      : null;
    return this.rectsEqual(live.rect, press.baseRect)
      && (live.data.type || null) === press.baseIdentity.type
      && (live.data.file || null) === press.baseIdentity.file
      && (live.data.subpath || null) === press.baseIdentity.subpath
      && (currentNormalization ? JSON.stringify(currentNormalization) : null) === press.baseIdentity.normalization;
  }

  commitPreviewDrag(press, event) {
    this.disposePreviewPress(press);
    const endWorld = this.canvasWorldPoint(event);
    const live = press && press.member && this.nodeItem(press.member.node);
    if (!endWorld || this.viewportSignature() !== press.viewport || !this.previewDragGuard(press, live)) {
      this.cancelPreviewPress(press, true);
      return false;
    }
    const translated = {
      x: jamDeckRoundCanvasStackValue(press.baseRect.x + endWorld.x - press.startWorld.x),
      y: jamDeckRoundCanvasStackValue(press.baseRect.y + endWorld.y - press.startWorld.y),
      width: press.baseRect.width,
      height: press.baseRect.height,
    };
    const others = this.getStackItems().filter((item) => item.id !== press.nodeId);
    const normalization = press.kind === "image" || press.kind === "text"
      ? jamDeckCanvasStackNormalization(live.data, press.kind)
      : null;
    const restored = normalization
      ? jamDeckRestoreCanvasStackImage(translated, normalization.originalCanvasSize, others)
      : null;
    const finalRect = restored || translated;
    try {
      this.commitGestureNodePatch(press.member.node, finalRect, {
        removeNormalization: !!restored,
        normalizationKind: press.kind,
        flushHistory: true,
      });
      this.cancelPreviewPress(press, false);
      return true;
    } catch (error) {
      console.error("jam-deck expanded stack drag failed", error);
      this.cancelPreviewPress(press, true);
      return false;
    }
  }

  handlePreviewCardClick(press) {
    if (!press || !press.member) return;
    if (press.kind === "image") {
      this.openImageFocus(press.visual);
      return;
    }
    const member = press.member;
    this.collapsePreview(true);
    if (press.kind === "text") {
      this.ownerWindow.requestAnimationFrame(() => this.activateCanvasTextNode(member.node));
      return;
    }
    if (press.kind === "markdown-note") {
      const app = this.runtime && this.runtime.deckView && this.runtime.deckView.app;
      const file = app && app.vault && app.vault.getAbstractFileByPath(member.data.file);
      if (file && app.workspace && typeof app.workspace.getLeaf === "function") {
        const leaf = app.workspace.getLeaf("tab");
        if (leaf && typeof leaf.openFile === "function") leaf.openFile(file, { active: true });
      }
    }
  }

  activateCanvasTextNode(node) {
    if (!node || !node.nodeEl) return false;
    try {
      if (this.canvas.selection && typeof this.canvas.deselectAll === "function") this.canvas.deselectAll();
      if (typeof this.canvas.selectOnly === "function") this.canvas.selectOnly(node);
      else if (typeof this.canvas.select === "function") this.canvas.select(node);
      if (typeof node.startEditing !== "function") {
        new Notice("当前 Obsidian 版本无法自动进入文本编辑，请双击节点编辑");
        return false;
      }
      node.startEditing();
      const editable = node.nodeEl.querySelector("[contenteditable='true'], textarea");
      if (editable && typeof editable.focus === "function") editable.focus();
      return !!editable || node.nodeEl.matches(".is-editing") || node.nodeEl.hasClass("is-editing");
    } catch (error) {
      console.error("jam-deck Canvas text edit failed", error);
      return false;
    }
  }

  openImageFocus(visual) {
    if (!visual || this.imageFocus) return;
    const nodeEl = visual.member && visual.member.node && visual.member.node.nodeEl;
    const image = nodeEl && nodeEl.querySelector(".canvas-node-content.media-embed > img");
    if (!image) return;
    const wrapper = this.entry.ownerDocument.createElement("div");
    wrapper.className = "jam-deck-canvas-stack-image-focus";
    wrapper.setAttribute("role", "dialog");
    wrapper.setAttribute("aria-modal", "true");
    wrapper.setAttribute("aria-label", "图片预览");
    const media = this.entry.ownerDocument.createElement("div");
    media.className = "jam-deck-canvas-stack-image-focus-media";
    const focusedImage = image.cloneNode(true);
    focusedImage.removeAttribute("id");
    focusedImage.setAttribute("draggable", "false");
    media.appendChild(focusedImage);
    const close = this.entry.ownerDocument.createElement("button");
    close.className = "jam-deck-canvas-stack-image-focus-close";
    close.type = "button";
    close.setAttribute("aria-label", "关闭图片预览");
    setIcon(close, "x");
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeImageFocus();
    });
    wrapper.appendChild(media);
    wrapper.appendChild(close);
    this.overlay.appendChild(wrapper);
    this.imageFocus = { wrapper, origin: visual.card };
    this.ownerWindow.requestAnimationFrame(() => {
      wrapper.addClass("is-visible");
      close.focus();
    });
  }

  closeImageFocus() {
    const focus = this.imageFocus;
    if (!focus) return;
    this.imageFocus = null;
    if (focus.wrapper) focus.wrapper.remove();
    if (focus.origin && focus.origin.isConnected) focus.origin.focus();
  }

  rectsEqual(left, right) {
    if (!left || !right) return false;
    return ["x", "y", "width", "height"].every((key) => Math.abs(left[key] - right[key]) <= 0.0001);
  }

  awaitStableDragRect(drag) {
    if (this.destroyed || this.drag !== drag || drag.cancelled) return this.finishDrag(drag);
    let frames = 0;
    let stableFrames = 0;
    let previous = null;
    const sample = () => {
      if (this.destroyed || this.drag !== drag || drag.cancelled) return this.finishDrag(drag);
      frames += 1;
      const currentItem = this.nodeItem(drag.node);
      const current = currentItem && currentItem.rect;
      if (!current) return this.finishDrag(drag);
      if (this.rectsEqual(current, previous)) stableFrames += 1;
      else stableFrames = 1;
      previous = current;
      if (stableFrames >= 3) {
        if (!this.rectsEqual(current, drag.preRect)) this.attemptAutoSnap(drag, currentItem);
        this.finishDrag(drag);
        return;
      }
      if (frames >= 12 || Date.now() - drag.releaseTime >= 500) {
        this.finishDrag(drag);
        return;
      }
      this.ownerWindow.requestAnimationFrame(sample);
    };
    this.ownerWindow.requestAnimationFrame(sample);
  }

  attemptAutoSnap(drag, currentItem) {
    if (!this.canAutoSnap || Date.now() - drag.releaseTime >= 210 || this.canvas.isDragging) return false;
    const candidates = this.getStackItems().filter((item) => item.id !== currentItem.id);
    const target = jamDeckChooseCanvasStackTarget(currentItem, candidates);
    if (!target) return this.attemptSafeImageRestore(drag, currentItem, candidates);
    let stackCandidate = currentItem;
    let normalized = null;
    const canNormalize = currentItem.kind === "image" || currentItem.kind === "text";
    const existingNormalization = canNormalize ? jamDeckCanvasStackNormalization(currentItem.data, currentItem.kind) : null;
    if (canNormalize) {
      normalized = jamDeckNormalizeCanvasStackImage(currentItem, target.cluster.members);
      if (!normalized) return false;
      if (normalized.changed) stackCandidate = { ...currentItem, rect: normalized };
    }
    const zoom = jamDeckCanvasStackScreenScale(target.cluster.anchor || currentItem);
    const snap = jamDeckComputeCanvasStackSnap(stackCandidate, target.cluster, { zoom, screenStep: 7 });
    if (!snap) return false;
    const geometryChanged = !this.rectsEqual(snap, currentItem.rect);
    const shouldUpdateNormalization = canNormalize && (normalized.changed || existingNormalization);
    if (!geometryChanged && !shouldUpdateNormalization) return false;
    const latest = this.nodeItem(drag.node);
    if (!latest || !this.rectsEqual(latest.rect, currentItem.rect)) return false;
    try {
      let nextNormalization;
      if (shouldUpdateNormalization) {
        nextNormalization = {
          version: JAM_DECK_STACK_NORMALIZATION_VERSION,
          originalCanvasSize: existingNormalization
            ? { ...existingNormalization.originalCanvasSize }
            : { width: currentItem.rect.width, height: currentItem.rect.height },
          normalizedCanvasSize: { width: snap.width, height: snap.height },
          anchorNodeIds: [...new Set(target.cluster.members.map((member) => String(member.id)))].sort(),
        };
      }
      this.commitGestureNodePatch(drag.node, snap, { normalization: nextNormalization, normalizationKind: currentItem.kind });
      this.verifyRenderedSnap(++this.snapGeneration, drag, target.cluster, snap);
      if (drag.node.nodeEl) {
        drag.node.nodeEl.addClass("is-jam-deck-stack-snapped");
        this.ownerWindow.setTimeout(() => {
          if (drag.node && drag.node.nodeEl) drag.node.nodeEl.removeClass("is-jam-deck-stack-snapped");
        }, 260);
      }
      return true;
    } catch (error) {
      this.canAutoSnap = false;
      console.error("jam-deck canvas stack auto-snap disabled", error);
      return false;
    }
  }

  attemptSafeImageRestore(drag, currentItem, candidates) {
    if (!currentItem || (currentItem.kind !== "image" && currentItem.kind !== "text")) return false;
    const normalization = jamDeckCanvasStackNormalization(currentItem.data, currentItem.kind);
    if (!normalization) return false;
    const restored = jamDeckRestoreCanvasStackImage(currentItem, normalization.originalCanvasSize, candidates);
    if (!restored || this.rectsEqual(restored, currentItem.rect)) return false;
    const latest = this.nodeItem(drag.node);
    if (!latest || !this.rectsEqual(latest.rect, currentItem.rect)) return false;
    try {
      this.commitGestureNodePatch(drag.node, restored, { removeNormalization: true, normalizationKind: currentItem.kind });
      return true;
    } catch (error) {
      this.canAutoSnap = false;
      console.error("jam-deck canvas stack restore disabled", error);
      return false;
    }
  }

  commitGestureNodePatch(node, geometry, metadata = {}) {
    if (!node || typeof node.getData !== "function" || typeof node.setData !== "function") throw new Error("Canvas node mutation API unavailable");
    const fresh = node.getData();
    const rect = jamDeckCanvasStackRect(geometry);
    if (!fresh || !rect || String(fresh.id || node.id) !== String(node.id || fresh.id)) throw new Error("Canvas node changed during stack gesture");
    const next = {
      ...fresh,
      x: jamDeckRoundCanvasStackValue(rect.x),
      y: jamDeckRoundCanvasStackValue(rect.y),
      width: jamDeckRoundCanvasStackValue(rect.width),
      height: jamDeckRoundCanvasStackValue(rect.height),
    };
    const normalizationKey = jamDeckCanvasStackNormalizationKey(metadata.normalizationKind);
    if (metadata.normalization && normalizationKey) {
      next.jamdeck = { ...(fresh.jamdeck || {}), [normalizationKey]: metadata.normalization };
    } else if (metadata.removeNormalization && normalizationKey && fresh.jamdeck && Object.prototype.hasOwnProperty.call(fresh.jamdeck, normalizationKey)) {
      next.jamdeck = { ...fresh.jamdeck };
      delete next.jamdeck[normalizationKey];
      if (!Object.keys(next.jamdeck).length) delete next.jamdeck;
    }
    node.setData(next);
    if (typeof this.canvas.markMoved === "function") this.canvas.markMoved(node);
    if (
      metadata.flushHistory
      && this.canvas.requestPushHistory
      && typeof this.canvas.requestPushHistory.run === "function"
    ) {
      this.canvas.requestPushHistory.run();
    }
    if (typeof node.render === "function") node.render();
    this.canvas.requestSave();
    return next;
  }

  verifyRenderedSnap(generation, drag, cluster, snap) {
    let frames = 0;
    const validate = () => {
      this.snapValidationFrame = 0;
      if (this.destroyed || generation !== this.snapGeneration || !drag || !drag.node) return;
      frames += 1;
      const latest = this.nodeItem(drag.node);
      const anchor = cluster && cluster.anchor;
      const anchorLatest = anchor && this.nodeItem(anchor.node);
      const nodeEl = drag.node.nodeEl;
      const anchorEl = anchorLatest && anchorLatest.node && anchorLatest.node.nodeEl;
      if ((!nodeEl || !anchorEl || !latest || !anchorLatest) && frames < 3) {
        this.snapValidationFrame = this.ownerWindow.requestAnimationFrame(validate);
        return;
      }
      let visible = false;
      if (nodeEl && anchorEl) {
        const left = nodeEl.getBoundingClientRect();
        const right = anchorEl.getBoundingClientRect();
        const separation = Math.hypot(
          left.left + left.width / 2 - right.left - right.width / 2,
          left.top + left.height / 2 - right.top - right.height / 2,
        );
        visible = separation >= 4.5;
      }
      const overlaps = latest && anchorLatest
        && jamDeckCanvasStackOverlapRatio(latest.rect, anchorLatest.rect) > JAM_DECK_STACK_OVERLAP_THRESHOLD;
      const unchanged = latest && Math.abs(latest.rect.x - snap.x) <= 0.0001 && Math.abs(latest.rect.y - snap.y) <= 0.0001;
      if (visible && overlaps && unchanged) return;
      if (generation === this.snapGeneration) {
        this.canAutoSnap = false;
        console.warn("jam-deck canvas stack auto-snap disabled after read-only rendered validation");
      }
    };
    this.snapValidationFrame = this.ownerWindow.requestAnimationFrame(validate);
  }

  finishDrag(drag) {
    if (drag && drag.dispose) drag.dispose();
    if (drag && drag.node && drag.node.nodeEl) drag.node.nodeEl.removeClass("is-jam-deck-stack-dragging");
    if (this.drag === drag) this.drag = null;
    this.scheduleReconcile();
  }

  scheduleReconcile() {
    if (this.destroyed || this.reconcileFrame) return;
    this.reconcileFrame = this.ownerWindow.requestAnimationFrame(() => {
      this.reconcileFrame = 0;
      this.reconcile();
    });
  }

  reconcile() {
    if (this.destroyed || this.drag) return;
    for (const nodeEl of this.markedNodes) {
      nodeEl.removeClass("is-jam-deck-stack-member");
      nodeEl.removeClass("is-jam-deck-stack-anchor");
      nodeEl.style.removeProperty("--jd-stack-depth");
    }
    this.markedNodes.clear();
    this.clusters = jamDeckBuildCanvasStackClusters(this.getStackItems());
    this.clusterByNodeId.clear();
    for (const cluster of this.clusters) {
      const orderedMembers = [cluster.anchor].concat(
        cluster.members.filter((member) => member !== cluster.anchor)
          .sort((left, right) => String(left.id).localeCompare(String(right.id))),
      );
      for (let depth = 0; depth < orderedMembers.length; depth++) {
        const member = orderedMembers[depth];
        this.clusterByNodeId.set(member.id, cluster);
        if (member.node && member.node.nodeEl) {
          member.node.nodeEl.addClass("is-jam-deck-stack-member");
          if (cluster.anchor && member.id === cluster.anchor.id) member.node.nodeEl.addClass("is-jam-deck-stack-anchor");
          member.node.nodeEl.style.setProperty("--jd-stack-depth", String(depth));
          this.markedNodes.add(member.node.nodeEl);
        }
      }
    }
    if (this.previewClusterId && !this.clusters.some((cluster) => cluster.id === this.previewClusterId)) this.collapsePreview();
  }

  togglePreview(cluster) {
    if (!cluster || cluster.members.length < 2) {
      this.collapsePreview();
      return;
    }
    if (this.previewClusterId === cluster.id) {
      this.collapsePreview();
      return;
    }
    this.showPreview(cluster);
  }

  sanitizePreviewSurface(surface) {
    if (!surface) return null;
    surface.querySelectorAll("script, iframe, object, embed, form, button, input, textarea, select, video, audio, source").forEach((element) => {
      element.remove();
    });
    for (const element of [surface, ...surface.querySelectorAll("*")]) {
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (
          name.startsWith("on")
          || name === "id"
          || name === "name"
          || name === "for"
          || name === "srcdoc"
          || name === "tabindex"
          || name === "contenteditable"
        ) {
          element.removeAttribute(attribute.name);
        }
      }
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("draggable", "false");
    }
    surface.setAttribute("aria-hidden", "true");
    surface.setAttribute("draggable", "false");
    return surface;
  }

  createPreviewSurface(member) {
    const nodeEl = member && member.node && member.node.nodeEl;
    const content = nodeEl && nodeEl.querySelector(".canvas-node-content");
    if (content) {
      const surface = this.sanitizePreviewSurface(content.cloneNode(true));
      if (surface) {
        surface.addClass("jam-deck-canvas-stack-preview-surface");
        surface.addClass(`is-${member.kind}`);
        return surface;
      }
    }
    const placeholder = this.entry.ownerDocument.createElement("div");
    placeholder.className = `jam-deck-canvas-stack-preview-surface is-placeholder is-${member.kind}`;
    const label = member.kind === "markdown-note"
      ? String(member.data.file || "").split("/").pop()
      : member.kind === "text" ? "文本笔记" : "图片";
    placeholder.textContent = label || "内容载入中";
    return this.sanitizePreviewSurface(placeholder);
  }

  prepareBystanders(cluster, layout, rootRect) {
    const selectedIds = new Set(cluster.members.map((member) => member.id));
    const focus = {
      left: layout.x,
      top: layout.y,
      right: layout.x + layout.width,
      bottom: layout.y + layout.height,
    };
    const bystanders = [];
    for (const item of this.getCanvasItems()) {
      if (selectedIds.has(item.id) || !item.node || !item.node.nodeEl || !item.node.nodeEl.isConnected) continue;
      const screen = item.node.nodeEl.getBoundingClientRect();
      const rect = {
        left: screen.left - rootRect.left,
        top: screen.top - rootRect.top,
        right: screen.right - rootRect.left,
        bottom: screen.bottom - rootRect.top,
      };
      const shift = jamDeckCanvasStackBystanderShift(
        rect,
        focus,
        { width: rootRect.width, height: rootRect.height },
      );
      if (Math.abs(shift.x) < 0.5 && Math.abs(shift.y) < 0.5) continue;
      const scale = jamDeckCanvasStackScreenScale(item);
      const nodeEl = item.node.nodeEl;
      nodeEl.style.setProperty("--jd-stack-bystander-x", `${shift.x / scale}px`);
      nodeEl.style.setProperty("--jd-stack-bystander-y", `${shift.y / scale}px`);
      nodeEl.addClass("is-jam-deck-stack-bystander");
      bystanders.push(nodeEl);
    }
    return bystanders;
  }

  showPreview(cluster) {
    this.collapsePreview(true);
    if (!this.overlay || !cluster || cluster.members.length < 2) return;
    const rootRect = this.root.getBoundingClientRect();
    const ordered = cluster.members.slice().sort((left, right) => {
      const a = left.node && left.node.nodeEl && left.node.nodeEl.getBoundingClientRect();
      const b = right.node && right.node.nodeEl && right.node.nodeEl.getBoundingClientRect();
      return (a && b ? a.top - b.top || a.left - b.left : 0) || String(left.id).localeCompare(String(right.id));
    });
    const visuals = [];
    for (const member of ordered) {
      const nodeEl = member.node && member.node.nodeEl;
      if (!nodeEl) continue;
      const rect = nodeEl.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const normalization = member.kind === "image" || member.kind === "text"
        ? jamDeckCanvasStackNormalization(member.data, member.kind)
        : null;
      const logicalCanvasSize = normalization ? normalization.originalCanvasSize : member.rect;
      const screenScale = jamDeckCanvasStackScreenScale(member);
      visuals.push({
        member,
        rect,
        logicalWidth: Math.max(1, Number(logicalCanvasSize.width) * screenScale),
        logicalHeight: Math.max(1, Number(logicalCanvasSize.height) * screenScale),
      });
    }
    if (visuals.length < 2) return;
    const anchorVisual = visuals.find((visual) => visual.member.id === cluster.anchor.id) || visuals[0];
    const anchorRect = {
      left: anchorVisual.rect.left - rootRect.left,
      right: anchorVisual.rect.right - rootRect.left,
      top: anchorVisual.rect.top - rootRect.top,
      bottom: anchorVisual.rect.bottom - rootRect.top,
    };
    const layout = jamDeckLayoutCanvasStackPreview(
      visuals.map((visual) => ({ width: visual.logicalWidth, height: visual.logicalHeight })),
      anchorRect,
      { width: rootRect.width, height: rootRect.height },
    );
    if (!layout) return;
    const wrapper = this.entry.ownerDocument.createElement("div");
    wrapper.className = "jam-deck-canvas-stack-preview";
    const backdrop = this.entry.ownerDocument.createElement("div");
    backdrop.className = "jam-deck-canvas-stack-backdrop";
    wrapper.appendChild(backdrop);
    const previewCards = [];
    visuals.forEach((visual, index) => {
      const position = layout.positions[index];
      const source = {
        left: visual.rect.left - rootRect.left,
        top: visual.rect.top - rootRect.top,
        width: visual.rect.width,
        height: visual.rect.height,
      };
      const card = this.entry.ownerDocument.createElement("div");
      card.className = "jam-deck-canvas-stack-preview-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", visual.member.kind === "image"
        ? "图片：单击放大，拖动移出堆叠"
        : visual.member.kind === "text"
          ? "文本：单击编辑，拖动移出堆叠"
          : "笔记：单击打开，拖动移出堆叠");
      card.style.left = `${source.left}px`;
      card.style.top = `${source.top}px`;
      card.style.width = `${source.width}px`;
      card.style.height = `${source.height}px`;
      card.style.setProperty("--jd-stack-index", String(index));
      card.style.setProperty("--jd-stack-delay", `${Math.min(72, index * 18)}ms`);
      card.style.setProperty("--jd-stack-to-x", `${position.x - source.left}px`);
      card.style.setProperty("--jd-stack-to-y", `${position.y - source.top}px`);
      const targetScale = position.width / source.width;
      card.style.setProperty("--jd-stack-to-scale", String(targetScale));
      if (visual.member.kind === "text") {
        card.style.setProperty(
          "--jd-stack-text-font-size",
          `${JAM_DECK_STACK_TEXT_PREVIEW_FONT_PX / Math.max(0.01, targetScale)}px`,
        );
        card.style.setProperty(
          "--jd-stack-text-padding",
          `${JAM_DECK_STACK_TEXT_PREVIEW_PADDING_PX / Math.max(0.01, targetScale)}px`,
        );
      }
      const surface = this.createPreviewSurface(visual.member);
      if (!surface) return;
      card.appendChild(surface);
      wrapper.appendChild(card);
      visual.member.node.nodeEl.addClass("is-jam-deck-stack-source-ghost");
      previewCards.push({ card, member: visual.member, source });
    });
    if (previewCards.length < 2) {
      for (const visual of previewCards) visual.member.node.nodeEl.removeClass("is-jam-deck-stack-source-ghost");
      return;
    }
    this.overlay.appendChild(wrapper);
    this.previewWrapper = wrapper;
    this.previewCards = previewCards;
    this.previewCluster = cluster;
    this.previewClusterId = cluster.id;
    this.previewBystanders = this.prepareBystanders(cluster, layout, rootRect);
    wrapper.getBoundingClientRect();
    this.ownerWindow.requestAnimationFrame(() => {
      this.ownerWindow.requestAnimationFrame(() => {
        if (this.previewWrapper === wrapper && wrapper.isConnected && !wrapper.hasClass("is-closing")) {
          for (const nodeEl of this.previewBystanders) nodeEl.addClass("is-jam-deck-stack-displaced");
          wrapper.addClass("is-visible");
        }
      });
    });
  }

  cleanupPreview(wrapper, cards, bystanders) {
    if (this.previewRemovalTimer) this.ownerWindow.clearTimeout(this.previewRemovalTimer);
    this.previewRemovalTimer = 0;
    for (const visual of cards || []) {
      const nodeEl = visual.member && visual.member.node && visual.member.node.nodeEl;
      if (nodeEl) nodeEl.removeClass("is-jam-deck-stack-source-ghost");
    }
    for (const nodeEl of bystanders || []) {
      nodeEl.removeClass("is-jam-deck-stack-displaced");
      nodeEl.removeClass("is-jam-deck-stack-bystander");
      nodeEl.style.removeProperty("--jd-stack-bystander-x");
      nodeEl.style.removeProperty("--jd-stack-bystander-y");
    }
    if (wrapper && wrapper.isConnected) wrapper.remove();
    if (this.previewWrapper === wrapper) {
      this.previewWrapper = null;
      this.previewCards = [];
      this.previewCluster = null;
      this.previewBystanders = [];
    }
  }

  collapsePreview(immediate = false) {
    this.closeImageFocus();
    if (this.previewPress) this.cancelPreviewPress(this.previewPress, false);
    const wrapper = this.previewWrapper;
    const cards = this.previewCards.slice();
    const bystanders = this.previewBystanders.slice();
    this.previewClusterId = null;
    if (!wrapper) return;
    if (immediate || (this.ownerWindow.matchMedia && this.ownerWindow.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      this.cleanupPreview(wrapper, cards, bystanders);
      return;
    }
    if (wrapper.hasClass("is-closing")) return;
    for (const nodeEl of bystanders) nodeEl.removeClass("is-jam-deck-stack-displaced");
    const rootRect = this.root.getBoundingClientRect();
    cards.forEach((visual, index) => {
      const nodeEl = visual.member && visual.member.node && visual.member.node.nodeEl;
      const latest = nodeEl && nodeEl.isConnected ? nodeEl.getBoundingClientRect() : null;
      const source = visual.source;
      const returnLeft = latest ? latest.left - rootRect.left : source.left;
      const returnTop = latest ? latest.top - rootRect.top : source.top;
      const returnScale = latest && source.width ? latest.width / source.width : 0.985;
      visual.card.style.setProperty("--jd-stack-return-x", `${returnLeft - source.left}px`);
      visual.card.style.setProperty("--jd-stack-return-y", `${returnTop - source.top}px`);
      visual.card.style.setProperty("--jd-stack-return-scale", String(returnScale));
      visual.card.style.setProperty("--jd-stack-exit-delay", `${Math.min(54, (cards.length - index - 1) * 18)}ms`);
    });
    wrapper.removeClass("is-visible");
    wrapper.addClass("is-closing");
    this.previewRemovalTimer = this.ownerWindow.setTimeout(() => this.cleanupPreview(wrapper, cards, bystanders), 340);
  }

  destroy() {
    this.destroyed = true;
    this.closeImageFocus();
    if (this.previewPress) this.cancelPreviewPress(this.previewPress, false);
    this.collapsePreview(true);
    if (this.drag) this.finishDrag(this.drag);
    if (this.observer) this.observer.disconnect();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.reconcileFrame) this.ownerWindow.cancelAnimationFrame(this.reconcileFrame);
    this.snapGeneration += 1;
    if (this.snapValidationFrame) this.ownerWindow.cancelAnimationFrame(this.snapValidationFrame);
    if (this.previewRemovalTimer) this.ownerWindow.clearTimeout(this.previewRemovalTimer);
    for (const dispose of this.disposers) {
      try { dispose(); } catch (error) {}
    }
    this.disposers = [];
    for (const nodeEl of this.markedNodes) {
      nodeEl.removeClass("is-jam-deck-stack-member");
      nodeEl.removeClass("is-jam-deck-stack-anchor");
      nodeEl.removeClass("is-jam-deck-stack-dragging");
      nodeEl.removeClass("is-jam-deck-stack-source-ghost");
      nodeEl.style.removeProperty("--jd-stack-depth");
    }
    for (const nodeEl of this.previewBystanders) {
      nodeEl.removeClass("is-jam-deck-stack-displaced");
      nodeEl.removeClass("is-jam-deck-stack-bystander");
      nodeEl.style.removeProperty("--jd-stack-bystander-x");
      nodeEl.style.removeProperty("--jd-stack-bystander-y");
    }
    this.previewBystanders = [];
    this.markedNodes.clear();
    if (this.overlay) this.overlay.remove();
    if (this.root) {
      this.root.removeClass("has-jam-deck-image-stacks");
      this.root.removeClass("has-jam-deck-mixed-stacks");
    }
  }
}
const CANVAS_RETURN_IFRAME_ARM_TTL_MS = 750;
const CANVAS_RETURN_ENTRY_ARM_TTL_MS = 2000;
const CANVAS_LINK_BRIDGE_ATTRIBUTE = "data-jam-deck-link-frame";
const CANVAS_LINK_BRIDGE_PROBE = "jam-deck-link-frame-probe-v1";
const CANVAS_LINK_BRIDGE_MARKER = "__jamDeckSameFrameLinkV1";

function jamDeckCanvasLinkBridgeScript(action = "install") {
  const marker = JSON.stringify(CANVAS_LINK_BRIDGE_MARKER);
  const requestedAction = JSON.stringify(action);
  return `(() => {
    const marker = ${marker};
    const action = ${requestedAction};
    const current = window[marker];
    if (action === "cleanup") {
      if (current && current.listener) document.removeEventListener("click", current.listener, false);
      try { delete window[marker]; } catch (error) { window[marker] = undefined; }
      return "cleaned";
    }
    if (current && current.listener) return "installed";
    const listener = (event) => {
      if (
        !event
        || event.isTrusted !== true
        || event.defaultPrevented
        || event.button !== 0
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || event.altKey
      ) return;
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      let anchor = path.find((item) => item && item.tagName === "A");
      if (!anchor && event.target && typeof event.target.closest === "function") anchor = event.target.closest("a");
      if (!anchor || typeof anchor.getAttribute !== "function") return;
      const target = String(anchor.getAttribute("target") || "").trim().toLowerCase();
      if (target !== "_blank" || anchor.hasAttribute("download")) return;
      let destination;
      try { destination = new URL(anchor.getAttribute("href"), window.location.href); } catch (error) { return; }
      if (destination.protocol !== "http:" && destination.protocol !== "https:") return;
      event.preventDefault();
      window.location.assign(destination.href);
    };
    document.addEventListener("click", listener, false);
    window[marker] = { listener };
    return "installed";
  })()`;
}

class CanvasLinkNavigationBridge {
  constructor(adapter, entry) {
    this.adapter = adapter;
    this.entry = entry;
    this.ownerWindow = entry.ownerDocument && entry.ownerDocument.defaultView;
    this.canvas = entry.leaf && entry.leaf.view && entry.leaf.view.canvas;
    this.observer = null;
    this.frame = 0;
    this.sequence = 0;
    this.surfaces = new Map();
    this.destroyed = false;
    try { this.webFrame = require("electron").webFrame || null; } catch (error) { this.webFrame = null; }
  }

  install() {
    const root = this.entry.leaf && this.entry.leaf.containerEl;
    if (!root || !this.canvas || !this.canvas.nodes || typeof this.canvas.nodes.values !== "function") return false;
    const MutationObserverCtor = this.ownerWindow && this.ownerWindow.MutationObserver;
    if (typeof MutationObserverCtor === "function") {
      this.observer = new MutationObserverCtor(() => this.scheduleReconcile());
      this.observer.observe(root, { childList: true, subtree: true });
    }
    this.reconcile();
    return true;
  }

  scheduleReconcile() {
    if (this.destroyed || this.frame || !this.ownerWindow) return;
    this.frame = this.ownerWindow.requestAnimationFrame(() => {
      this.frame = 0;
      this.reconcile();
    });
  }

  linkSurfaces() {
    const result = new Set();
    for (const node of this.canvas.nodes.values()) {
      let data;
      try { data = node && typeof node.getData === "function" ? node.getData() : null; } catch (error) { data = null; }
      const nodeEl = node && node.nodeEl;
      if (!data || data.type !== "link" || !nodeEl || !nodeEl.isConnected || typeof nodeEl.querySelectorAll !== "function") continue;
      const surfaces = Array.from(nodeEl.querySelectorAll("iframe, webview"));
      if (surfaces.length === 1) result.add(surfaces[0]);
    }
    return result;
  }

  reconcile() {
    if (this.destroyed) return;
    const current = this.linkSurfaces();
    for (const surface of current) {
      if (this.surfaces.has(surface)) continue;
      const state = {
        token: `jd-link-${Date.now()}-${++this.sequence}`,
        pending: false,
        load: () => this.inject(surface, true),
        domReady: () => this.inject(surface, true),
        fail: () => {},
      };
      this.surfaces.set(surface, state);
      surface.addEventListener("load", state.load, true);
      surface.addEventListener("dom-ready", state.domReady);
      surface.addEventListener("did-fail-load", state.fail);
      void this.inject(surface, true);
    }
    for (const [surface] of this.surfaces) {
      if (!current.has(surface)) this.release(surface);
    }
  }

  getExecutor(surface, state) {
    const tagName = String(surface && surface.tagName || "").toLowerCase();
    if (tagName === "webview" && typeof surface.executeJavaScript === "function") {
      return (script) => surface.executeJavaScript(script, false);
    }
    if (tagName !== "iframe" || !this.webFrame || typeof this.webFrame.getFrameForSelector !== "function") return null;
    surface.setAttribute(CANVAS_LINK_BRIDGE_ATTRIBUTE, state.token);
    const selector = `iframe[${CANVAS_LINK_BRIDGE_ATTRIBUTE}="${state.token}"]`;
    const childFrame = this.webFrame.getFrameForSelector(selector);
    if (!childFrame || typeof childFrame.executeJavaScript !== "function") return null;
    return (script) => childFrame.executeJavaScript(script, false);
  }

  async inject(surface, force = false) {
    const state = this.surfaces.get(surface);
    if (!state || state.pending || this.destroyed || (!force && state.installed)) return false;
    const execute = this.getExecutor(surface, state);
    if (!execute) return false;
    state.pending = true;
    try {
      const probe = await Promise.resolve(execute(`(() => ${JSON.stringify(CANVAS_LINK_BRIDGE_PROBE)})()`));
      if (probe !== CANVAS_LINK_BRIDGE_PROBE || this.destroyed || this.surfaces.get(surface) !== state) return false;
      const installed = await Promise.resolve(execute(jamDeckCanvasLinkBridgeScript("install")));
      state.installed = installed === "installed";
      return state.installed;
    } catch (error) {
      state.installed = false;
      return false;
    } finally {
      state.pending = false;
    }
  }

  release(surface) {
    const state = this.surfaces.get(surface);
    if (!state) return;
    this.surfaces.delete(surface);
    try { surface.removeEventListener("load", state.load, true); } catch (error) {}
    try { surface.removeEventListener("dom-ready", state.domReady); } catch (error) {}
    try { surface.removeEventListener("did-fail-load", state.fail); } catch (error) {}
    try {
      const execute = this.getExecutor(surface, state);
      if (execute) void Promise.resolve(execute(jamDeckCanvasLinkBridgeScript("cleanup"))).catch(() => {});
    } catch (error) {}
    try { surface.removeAttribute(CANVAS_LINK_BRIDGE_ATTRIBUTE); } catch (error) {}
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.observer) this.observer.disconnect();
    if (this.frame && this.ownerWindow) this.ownerWindow.cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const surface of Array.from(this.surfaces.keys())) this.release(surface);
  }
}

class CanvasReturnCoordinator {
  constructor(adapter, ownerWindow) {
    this.adapter = adapter;
    this.ownerWindow = ownerWindow;
    this.ownerDocument = ownerWindow && ownerWindow.document;
    this.entries = new Map();
    this.interactionSeq = 0;
    this.blurToken = 0;
    this.scheduleToken = 0;
    this.iframeArm = null;
    this.entryArm = null;
    this.away = null;
    this.pendingBlurTimer = 0;
    this.pendingReturnTimer = 0;
    this.pendingReturnFrame = 0;
    this.destroyed = false;
    this.boundInteraction = (event) => this.handleDocumentInteraction(event);
    this.boundFrameFocus = (event) => this.handleFrameFocus(event);
    this.boundWindowBlur = () => this.handleWindowBlur();
    this.boundWindowFocus = () => this.handleWindowFocus();
    this.boundVisibility = () => {
      if (this.ownerDocument && this.ownerDocument.visibilityState === "visible") this.handleWindowFocus();
    };
    if (this.ownerDocument) {
      this.ownerDocument.addEventListener("pointerdown", this.boundInteraction, true);
      this.ownerDocument.addEventListener("focusin", this.boundInteraction, true);
      this.ownerDocument.addEventListener("keydown", this.boundInteraction, true);
      this.ownerDocument.addEventListener("focus", this.boundFrameFocus, true);
      this.ownerDocument.addEventListener("visibilitychange", this.boundVisibility, true);
    }
    if (this.ownerWindow) {
      this.ownerWindow.addEventListener("blur", this.boundWindowBlur, true);
      this.ownerWindow.addEventListener("focus", this.boundWindowFocus, true);
    }
  }

  addEntry(entry) {
    if (!entry || this.destroyed) return false;
    this.entries.set(entry.widgetId, entry);
    entry.returnCoordinator = this;
    entry.returnEpoch = Number(entry.returnEpoch) || 0;
    entry.returnParked = !entry.hostEl || !entry.hostEl.isConnected || !entry.leaf || !entry.leaf.containerEl || !entry.leaf.containerEl.isConnected;
    return true;
  }

  removeEntry(entry) {
    if (!entry) return;
    this.invalidateEntry(entry, true);
    if (this.entries.get(entry.widgetId) === entry) this.entries.delete(entry.widgetId);
    if (entry.returnCoordinator === this) entry.returnCoordinator = null;
  }

  invalidateEntry(entry, parked = entry && entry.returnParked) {
    if (!entry) return;
    entry.returnEpoch = (Number(entry.returnEpoch) || 0) + 1;
    entry.returnParked = !!parked;
    if (this.iframeArm && this.iframeArm.entryId === entry.widgetId) this.iframeArm = null;
    if (this.entryArm && this.entryArm.entryId === entry.widgetId) this.entryArm = null;
    if (this.away && this.away.entryId === entry.widgetId) this.clearAway();
  }

  isEligible(entry) {
    return !!(
      entry
      && !entry.closing
      && !entry.returnParked
      && this.entries.get(entry.widgetId) === entry
      && this.adapter.entries.get(entry.widgetId) === entry
      && entry.ownerDocument === this.ownerDocument
      && entry.hostEl
      && entry.hostEl.isConnected
      && entry.leaf
      && entry.leaf.containerEl
      && entry.leaf.containerEl.isConnected
    );
  }

  isFrame(element) {
    return !!(element && element.matches && element.matches("iframe, webview"));
  }

  entryForNode(node) {
    if (!node) return null;
    for (const entry of this.entries.values()) {
      if (!this.isEligible(entry)) continue;
      const target = entry.leaf && entry.leaf.containerEl;
      if (target && (target === node || target.contains(node))) return entry;
    }
    return null;
  }

  isEntryContentTarget(entry, node) {
    if (!this.isEligible(entry) || !node) return false;
    const target = entry.leaf && entry.leaf.containerEl;
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!target || !element || element === target || !target.contains(element)) return false;
    if (!element.closest) return true;
    return !element.closest(
      "[hidden], [aria-hidden='true'], [data-focus-guard], [data-jam-deck-canvas-sentinel], .focus-sentinel, .jam-deck-canvas-parking",
    );
  }

  armEntry(entry) {
    if (!this.isEligible(entry)) return;
    this.entryArm = {
      entryId: entry.widgetId,
      at: Date.now(),
      seq: this.interactionSeq,
      epoch: entry.returnEpoch,
    };
  }

  armFrame(entry, frame) {
    if (!this.isEligible(entry) || !this.isFrame(frame)) return;
    this.iframeArm = {
      entryId: entry.widgetId,
      at: Date.now(),
      seq: this.interactionSeq,
      epoch: entry.returnEpoch,
    };
  }

  handleFrameFocus(event) {
    if (this.destroyed || !event || event.isTrusted === false || !this.isFrame(event.target)) return;
    const entry = this.entryForNode(event.target);
    if (entry) this.armFrame(entry, event.target);
  }

  handleDocumentInteraction(event) {
    if (this.destroyed || !event || event.isTrusted === false) return;
    if (!["pointerdown", "focusin", "keydown"].includes(event.type)) return;
    const entry = this.entryForNode(event.target);
    if (this.isFrame(event.target) && entry) this.armFrame(entry, event.target);
    this.interactionSeq += 1;
    if (this.away) {
      this.entryArm = null;
      this.clearAway();
      return;
    }
    const systemSwitchKey = event.type === "keydown" && (
      event.altKey
      || event.metaKey
      || event.key === "Alt"
      || event.key === "Meta"
      || event.key === "Tab"
    );
    if (systemSwitchKey || !entry || !this.isEntryContentTarget(entry, event.target)) {
      this.entryArm = null;
      return;
    }
    this.armEntry(entry);
  }

  candidateAtBlur() {
    const activeElement = this.ownerDocument && this.ownerDocument.activeElement;
    if (this.isFrame(activeElement)) {
      const direct = this.entryForNode(activeElement);
      if (direct) return direct;
    }
    const entryArm = this.entryArm;
    if (
      entryArm
      && entryArm.seq === this.interactionSeq
      && Date.now() - entryArm.at <= CANVAS_RETURN_ENTRY_ARM_TTL_MS
    ) {
      const recentEntry = this.entries.get(entryArm.entryId);
      if (this.isEligible(recentEntry) && recentEntry.returnEpoch === entryArm.epoch) return recentEntry;
    }
    const iframeArm = this.iframeArm;
    if (!iframeArm || Date.now() - iframeArm.at > CANVAS_RETURN_IFRAME_ARM_TTL_MS) return null;
    const fallback = this.entries.get(iframeArm.entryId);
    return this.isEligible(fallback) && fallback.returnEpoch === iframeArm.epoch ? fallback : null;
  }

  handleWindowBlur() {
    if (this.destroyed) return;
    const token = ++this.blurToken;
    this.cancelScheduledReturn();
    this.away = null;
    const entry = this.candidateAtBlur();
    if (!entry) return;
    const seq = this.interactionSeq;
    if (this.pendingBlurTimer) this.ownerWindow.clearTimeout(this.pendingBlurTimer);
    this.pendingBlurTimer = this.ownerWindow.setTimeout(() => {
      this.pendingBlurTimer = 0;
      if (
        this.destroyed
        || token !== this.blurToken
        || this.interactionSeq !== seq
        || (this.ownerDocument && typeof this.ownerDocument.hasFocus === "function" && this.ownerDocument.hasFocus())
        || !this.isEligible(entry)
      ) return;
      this.away = {
        entryId: entry.widgetId,
        awaySeq: seq,
        epoch: entry.returnEpoch,
        blurToken: token,
      };
    }, 0);
  }

  handleWindowFocus() {
    if (this.destroyed || !this.away) return;
    this.scheduleReturn();
  }

  scheduleReturn() {
    this.cancelScheduledReturn();
    const token = ++this.scheduleToken;
    this.pendingReturnTimer = this.ownerWindow.setTimeout(() => {
      this.pendingReturnTimer = 0;
      this.pendingReturnFrame = this.ownerWindow.requestAnimationFrame(() => {
        this.pendingReturnFrame = 0;
        this.executeReturn(token);
      });
    }, 0);
  }

  executeReturn(token) {
    const away = this.away;
    const entry = away && this.entries.get(away.entryId);
    const visible = !this.ownerDocument || this.ownerDocument.visibilityState == null || this.ownerDocument.visibilityState === "visible";
    const focused = !this.ownerDocument || typeof this.ownerDocument.hasFocus !== "function" || this.ownerDocument.hasFocus();
    if (
      this.destroyed
      || token !== this.scheduleToken
      || !away
      || away.blurToken !== this.blurToken
      || away.awaySeq !== this.interactionSeq
      || !visible
      || !focused
      || !this.isEligible(entry)
      || entry.returnEpoch !== away.epoch
    ) {
      if (token === this.scheduleToken) this.clearAway();
      return false;
    }
    this.away = null;
    return this.adapter.activate(entry, true);
  }

  cancelScheduledReturn() {
    this.scheduleToken += 1;
    if (this.pendingReturnTimer) {
      this.ownerWindow.clearTimeout(this.pendingReturnTimer);
      this.pendingReturnTimer = 0;
    }
    if (this.pendingReturnFrame) {
      this.ownerWindow.cancelAnimationFrame(this.pendingReturnFrame);
      this.pendingReturnFrame = 0;
    }
  }

  clearAway() {
    this.away = null;
    this.cancelScheduledReturn();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearAway();
    if (this.pendingBlurTimer) {
      this.ownerWindow.clearTimeout(this.pendingBlurTimer);
      this.pendingBlurTimer = 0;
    }
    if (this.ownerDocument) {
      this.ownerDocument.removeEventListener("pointerdown", this.boundInteraction, true);
      this.ownerDocument.removeEventListener("focusin", this.boundInteraction, true);
      this.ownerDocument.removeEventListener("keydown", this.boundInteraction, true);
      this.ownerDocument.removeEventListener("focus", this.boundFrameFocus, true);
      this.ownerDocument.removeEventListener("visibilitychange", this.boundVisibility, true);
    }
    if (this.ownerWindow) {
      this.ownerWindow.removeEventListener("blur", this.boundWindowBlur, true);
      this.ownerWindow.removeEventListener("focus", this.boundWindowFocus, true);
    }
    for (const entry of this.entries.values()) {
      if (entry.returnCoordinator === this) entry.returnCoordinator = null;
    }
    this.entryArm = null;
    this.iframeArm = null;
    this.entries.clear();
  }
}

class CanvasRuntimeAdapter {
  constructor(deckView) {
    this.deckView = deckView;
    this.app = deckView.app;
    this.entries = new Map();
    this.returnCoordinators = new Map();
    this.generation = 0;
  }

  probe(hostEl) {
    const hostLeaf = this.deckView.leaf;
    const parent = hostLeaf && hostLeaf.parent;
    const ownerWindow = hostEl && hostEl.ownerDocument && hostEl.ownerDocument.defaultView;
    if (typeof WorkspaceLeaf !== "function") throw new Error("WorkspaceLeaf runtime is unavailable");
    if (!hostEl || !hostEl.ownerDocument || !ownerWindow) throw new Error("Canvas host window is unavailable");
    if (!hostLeaf || !parent || typeof hostLeaf.getRoot !== "function") throw new Error("Jam Deck workspace context is unavailable");
    if (!Array.isArray(parent.children) || !parent.children.includes(hostLeaf)) throw new Error("Jam Deck workspace parent is incompatible");
    return {
      hostLeaf,
      parent,
      root: hostLeaf.getRoot(),
      ownerWindow,
      children: parent.children.slice(),
    };
  }

  assertTreeInvariant(context, leaf) {
    if (!context.parent || !Array.isArray(context.parent.children)) throw new Error("Workspace parent disappeared");
    if (context.parent.children.length !== context.children.length || context.parent.children.some((child, index) => child !== context.children[index])) {
      throw new Error("Canvas adapter changed the Obsidian layout tree");
    }
    if (context.parent.children.includes(leaf)) throw new Error("Detached Canvas leaf entered the Obsidian layout tree");
    if (this.deckView.leaf !== context.hostLeaf || context.hostLeaf.parent !== context.parent) throw new Error("Jam Deck host leaf changed while mounting Canvas");
  }

  parkAll() {
    for (const entry of this.entries.values()) {
      if (entry.returnCoordinator) entry.returnCoordinator.invalidateEntry(entry, true);
      else {
        entry.returnEpoch = (Number(entry.returnEpoch) || 0) + 1;
        entry.returnParked = true;
      }
      if (entry.leaf && entry.leaf.containerEl && entry.leaf.containerEl.isConnected) entry.leaf.containerEl.remove();
    }
  }

  attach(entry, hostEl) {
    if (!entry || entry.closing || !entry.leaf || !entry.leaf.containerEl) return false;
    if (entry.ownerDocument !== hostEl.ownerDocument) return false;
    hostEl.empty();
    hostEl.classList.remove("is-loading", "is-fallback");
    hostEl.addClass("is-ready");
    hostEl.appendChild(entry.leaf.containerEl);
    entry.hostEl = hostEl;
    if (entry.returnCoordinator) entry.returnCoordinator.invalidateEntry(entry, false);
    else {
      entry.returnEpoch = (Number(entry.returnEpoch) || 0) + 1;
      entry.returnParked = false;
    }
    if (entry.resizeObserver) {
      entry.resizeObserver.disconnect();
      entry.resizeObserver.observe(hostEl);
    }
    try { entry.leaf.onResize(); } catch (error) {}
    return true;
  }

  activate(entry, force = false) {
    if (!entry || entry.closing || this.entries.get(entry.widgetId) !== entry || !entry.leaf) return false;
    try {
      const hostLeaf = this.deckView.leaf;
      if (!hostLeaf) return false;
      if (force || this.app.workspace.activeLeaf !== hostLeaf) this.app.workspace.setActiveLeaf(hostLeaf, { focus: false });
      return true;
    } catch (error) {
      console.error("jam-deck canvas activation failed", error);
      return false;
    }
  }

  getSelectedCanvasImage(entry) {
    const canvas = entry && entry.leaf && entry.leaf.view && entry.leaf.view.canvas;
    if (!canvas || typeof canvas.getSelectionData !== "function") return null;
    let selection;
    try { selection = canvas.getSelectionData(); } catch (error) { return null; }
    if (!selection || !Array.isArray(selection.nodes) || selection.nodes.length !== 1) return null;
    const data = selection.nodes[0];
    if (!data || data.type !== "file" || typeof data.file !== "string") return null;
    const file = this.app.vault.getAbstractFileByPath(data.file);
    if (!file || !["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(String(file.extension || "").toLowerCase())) return null;
    return file;
  }

  installCanvasInteractionBridge(entry) {
    if (!entry || entry.interactionInstalled || !entry.leaf || !entry.leaf.containerEl) return;
    const target = entry.leaf.containerEl;
    const activate = () => this.activate(entry);
    const pointerdown = () => {
      activate();
      const ownerWindow = entry.ownerDocument && entry.ownerDocument.defaultView;
      if (ownerWindow) ownerWindow.setTimeout(activate, 0);
    };
    const keydown = (event) => {
      activate();
      const stackController = entry.imageStackController;
      if (stackController && stackController.previewWrapper) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") stackController.collapsePreview();
        return;
      }
      const key = String(event.key || "").toLowerCase();
      const editable = event.target && event.target.closest && event.target.closest("input, textarea, [contenteditable='true']");
      if (editable || key !== "c" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const file = this.getSelectedCanvasImage(entry);
      if (!file) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void this.deckView.plugin.copyCanvasImageFile(file).catch((error) => {
        console.error("jam-deck canvas image copy failed", error);
        new Notice(`Jam Deck：复制 Canvas 图片失败 · ${error.message || "未知错误"}`);
      });
    };
    target.addEventListener("pointerdown", pointerdown, true);
    target.addEventListener("focusin", activate, true);
    target.addEventListener("keydown", keydown, true);
    entry.dropDisposers.push(() => target.removeEventListener("pointerdown", pointerdown, true));
    entry.dropDisposers.push(() => target.removeEventListener("focusin", activate, true));
    entry.dropDisposers.push(() => target.removeEventListener("keydown", keydown, true));
    const ownerWindow = entry.ownerDocument && entry.ownerDocument.defaultView;
    if (ownerWindow) {
      let coordinator = this.returnCoordinators.get(ownerWindow);
      if (!coordinator) {
        coordinator = new CanvasReturnCoordinator(this, ownerWindow);
        this.returnCoordinators.set(ownerWindow, coordinator);
      }
      coordinator.addEntry(entry);
      entry.dropDisposers.push(() => {
        coordinator.removeEntry(entry);
        if (coordinator.entries.size === 0) {
          coordinator.destroy();
          if (this.returnCoordinators.get(ownerWindow) === coordinator) this.returnCoordinators.delete(ownerWindow);
        }
      });
    }
    entry.interactionInstalled = true;
  }

  getClipboardCanvasDrop(entry, transfer) {
    if (!entry || entry.closing || this.entries.get(entry.widgetId) !== entry || !transfer) return null;
    const types = Array.from(transfer.types || []);
    if (!types.includes(CLIPBOARD_DRAG_MIME)) return null;
    const plugin = this.deckView.plugin;
    const item = plugin.getClipboardItemFromTransfer(transfer) || plugin.activeClipboardDragItem;
    const canvas = entry.leaf && entry.leaf.view && entry.leaf.view.canvas;
    if (!item || item.type !== "image" || !item.filename || !canvas || canvas.readonly) return null;
    if (typeof canvas.posFromEvt !== "function" || typeof canvas.createFileNode !== "function" || typeof canvas.requestSave !== "function") return null;
    return { item, canvas };
  }

  installClipboardCanvasDrop(entry) {
    if (!entry || entry.dropInstalled || !entry.leaf || !entry.leaf.containerEl) return;
    const target = entry.leaf.containerEl;
    const dragover = (event) => {
      const context = this.getClipboardCanvasDrop(entry, event.dataTransfer);
      if (!context || entry.activeDropOperation) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.dataTransfer.dropEffect = "copy";
    };
    const drop = (event) => {
      const context = this.getClipboardCanvasDrop(entry, event.dataTransfer);
      if (!context) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (entry.activeDropOperation) {
        new Notice("Jam Deck：上一张图片仍在写入 Canvas");
        return;
      }
      let pos;
      try {
        const raw = context.canvas.posFromEvt(event);
        pos = { x: raw.x, y: raw.y };
      } catch (error) {
        console.error("jam-deck canvas drop position failed", error);
        new Notice("Jam Deck：无法确定图片在 Canvas 中的位置");
        return;
      }
      const operation = {
        id: `canvas-drop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        entryToken: entry.token,
        controller: new AbortController(),
        inserted: false,
        committed: false,
        node: null,
        createdPath: null,
        createdFile: null,
      };
      entry.activeDropOperation = operation;
      entry.dropOperations.set(operation.id, operation);
      void this.commitClipboardImageDrop(entry, context.canvas, context.item, pos, operation);
    };
    target.addEventListener("dragover", dragover, true);
    target.addEventListener("drop", drop, true);
    entry.dropDisposers.push(() => target.removeEventListener("dragover", dragover, true));
    entry.dropDisposers.push(() => target.removeEventListener("drop", drop, true));
    entry.dropInstalled = true;
  }

  canvasReferencesPath(canvas, path) {
    if (!canvas || !canvas.nodes || typeof canvas.nodes.values !== "function") return false;
    for (const node of canvas.nodes.values()) {
      try {
        if (node.file && node.file.path === path) return true;
        const data = typeof node.getData === "function" ? node.getData() : null;
        if (data && data.file === path) return true;
      } catch (error) {}
    }
    return false;
  }

  async removeOwnedCanvasAttachment(operation, canvas) {
    if (!operation.createdPath || this.canvasReferencesPath(canvas, operation.createdPath)) return false;
    const file = this.app.vault.getAbstractFileByPath(operation.createdPath);
    if (!file || file.path !== operation.createdPath) return true;
    try {
      await this.app.vault.delete(file);
      return true;
    } catch (error) {
      console.error("jam-deck canvas orphan attachment cleanup failed", error);
      return false;
    }
  }

  async rollbackCanvasDropNode(entry, canvas, operation) {
    if (!operation.node || !operation.inserted || operation.committed) return true;
    try {
      if (typeof canvas.removeNode !== "function") return false;
      canvas.removeNode(operation.node);
      operation.node = null;
      operation.inserted = false;
      canvas.requestSave();
      const view = entry.leaf && entry.leaf.view;
      if (view && typeof view.saveImmediately === "function") await Promise.resolve(view.saveImmediately());
      return true;
    } catch (error) {
      console.error("jam-deck canvas node rollback failed; attachment retained", error);
      return false;
    }
  }

  async commitClipboardImageDrop(entry, canvas, item, pos, operation) {
    try {
      const created = await this.deckView.plugin.createCanvasAttachmentFromClipboard(item, entry.filePath, operation.controller.signal);
      operation.createdPath = created.path;
      operation.createdFile = created.file;
      if (operation.controller.signal.aborted || entry.closing || entry.token !== operation.entryToken || this.entries.get(entry.widgetId) !== entry) {
        await this.removeOwnedCanvasAttachment(operation, canvas);
        return;
      }
      operation.node = canvas.createFileNode({ pos, position: "center", file: created.file });
      if (!operation.node) throw new Error("Canvas did not create an image node");
      operation.inserted = true;
      canvas.requestSave();
      const view = entry.leaf && entry.leaf.view;
      if (view && typeof view.saveImmediately === "function") await Promise.resolve(view.saveImmediately());
      operation.committed = true;
      try {
        if (typeof canvas.deselectAll === "function") canvas.deselectAll();
        if (typeof canvas.select === "function") canvas.select(operation.node);
        if (canvas.wrapperEl && typeof canvas.wrapperEl.focus === "function") canvas.wrapperEl.focus();
      } catch (error) {}
      new Notice("Jam Deck：图片已保存为 Canvas 附件");
    } catch (error) {
      const rolledBack = await this.rollbackCanvasDropNode(entry, canvas, operation);
      if (!operation.inserted && rolledBack) await this.removeOwnedCanvasAttachment(operation, canvas);
      console.error("jam-deck persistent canvas image drop failed", error);
      new Notice(`Jam Deck：图片加入 Canvas 失败 · ${error.message || "未知错误"}`);
    } finally {
      entry.dropOperations.delete(operation.id);
      if (entry.activeDropOperation === operation) entry.activeDropOperation = null;
    }
  }

  async mount(widget, hostEl, file, onError) {
    const existing = this.entries.get(widget.id);
    if (existing && existing.filePath === file.path && this.attach(existing, hostEl)) return existing;
    if (existing) await this.destroy(widget.id);

    const token = ++this.generation;
    let context;
    let leaf;
    let entry;
    try {
      context = this.probe(hostEl);
      leaf = new WorkspaceLeaf(this.app);
      this.assertTreeInvariant(context, leaf);
      leaf.parent = context.parent;
      if (typeof leaf.getRoot !== "function" || leaf.getRoot() !== context.root) throw new Error("Canvas leaf cannot inherit the Jam Deck workspace root");
      this.assertTreeInvariant(context, leaf);

      leaf.containerEl.addClass("jam-deck-canvas-leaf");
      leaf.containerEl.dataset.jamDeckCanvasOwner = widget.id;
      entry = {
        widgetId: widget.id,
        filePath: file.path,
        token,
        leaf,
        hostEl,
        ownerDocument: hostEl.ownerDocument,
        resizeObserver: null,
        dropDisposers: [],
        dropOperations: new Map(),
        activeDropOperation: null,
        dropInstalled: false,
        interactionInstalled: false,
        returnCoordinator: null,
        returnEpoch: 0,
        returnParked: false,
        imageStackController: null,
        linkNavigationBridge: null,
        closing: false,
      };
      const ResizeObserverCtor = context.ownerWindow.ResizeObserver;
      if (typeof ResizeObserverCtor === "function") {
        entry.resizeObserver = new ResizeObserverCtor(() => {
          if (!entry.closing) {
            try { leaf.onResize(); } catch (error) {}
          }
        });
        entry.resizeObserver.observe(hostEl);
      }
      this.entries.set(widget.id, entry);
      this.attach(entry, hostEl);
      await leaf.openFile(file, { active: false });

      const current = this.entries.get(widget.id);
      if (current !== entry || entry.token !== token || entry.closing) return null;
      if (!leaf.view || leaf.view.getViewType() !== "canvas") throw new Error("Obsidian did not create a Canvas view");
      this.assertTreeInvariant(context, leaf);
      this.installClipboardCanvasDrop(entry);
      this.installCanvasInteractionBridge(entry);
      entry.linkNavigationBridge = new CanvasLinkNavigationBridge(this, entry);
      entry.linkNavigationBridge.install();
      entry.imageStackController = new CanvasImageStackController(this, entry);
      entry.imageStackController.install();
      entry.inkOverlay = await CanvasInkOverlay.create(this, entry);
      try { leaf.onResize(); } catch (error) {}
      return entry;
    } catch (error) {
      console.error("jam-deck true canvas mount failed", error);
      if (entry && this.entries.get(widget.id) === entry) await this.destroy(widget.id);
      else if (leaf) await this.closeOwnedLeaf(leaf, context && context.hostLeaf);
      if (typeof onError === "function") onError(error);
      return null;
    }
  }

  async closeOwnedLeaf(leaf, fallbackLeaf) {
    if (!leaf) return;
    const view = leaf.view;
    try {
      if (view && typeof view.saveImmediately === "function") await Promise.resolve(view.saveImmediately());
    } catch (error) {
      console.error("jam-deck canvas save failed", error);
    }
    try {
      if (this.app.workspace.activeLeaf === leaf && fallbackLeaf) this.app.workspace.setActiveLeaf(fallbackLeaf, { focus: false });
    } catch (error) {}
    try {
      if (view && typeof view.close === "function") await Promise.resolve(view.close());
    } catch (error) {
      console.error("jam-deck canvas close failed", error);
    }
    try {
      if (typeof leaf.unload === "function") leaf.unload();
    } catch (error) {
      console.error("jam-deck canvas leaf unload failed", error);
    }
    try { if (leaf.resizeObserver) leaf.resizeObserver.disconnect(); } catch (error) {}
    try { if (leaf.containerEl) leaf.containerEl.remove(); } catch (error) {}
    try { leaf.parent = null; } catch (error) {}
  }

  async destroy(widgetId) {
    const entry = this.entries.get(widgetId);
    if (!entry || entry.closing) return;
    entry.closing = true;
    entry.token = ++this.generation;
    if (entry.linkNavigationBridge) {
      try { entry.linkNavigationBridge.destroy(); } catch (error) { console.error("jam-deck canvas link bridge cleanup failed", error); }
      entry.linkNavigationBridge = null;
    }
    if (entry.imageStackController) {
      try { entry.imageStackController.destroy(); } catch (error) { console.error("jam-deck canvas stack cleanup failed", error); }
      entry.imageStackController = null;
    }
    if (entry.inkOverlay) {
      try { await entry.inkOverlay.destroy(); } catch (error) { console.error("jam-deck canvas ink cleanup failed", error); }
      entry.inkOverlay = null;
    }
    for (const dispose of entry.dropDisposers || []) {
      try { dispose(); } catch (error) {}
    }
    entry.dropDisposers = [];
    for (const operation of (entry.dropOperations || new Map()).values()) {
      if (!operation.inserted) operation.controller.abort();
    }
    try {
      if (entry.resizeObserver) entry.resizeObserver.disconnect();
    } catch (error) {}
    try {
      await this.closeOwnedLeaf(entry.leaf, this.deckView.leaf);
    } finally {
      if (entry.hostEl) {
        try { entry.hostEl.empty(); } catch (error) {}
      }
      if (this.entries.get(widgetId) === entry) this.entries.delete(widgetId);
    }
  }

  async destroyAll() {
    await Promise.all(Array.from(this.entries.keys()).map((id) => this.destroy(id)));
    for (const coordinator of this.returnCoordinators.values()) coordinator.destroy();
    this.returnCoordinators.clear();
  }
}

const JAM_DECK_WIDGET_MIN_W = 2;
const JAM_DECK_WIDGET_MIN_H = 2;
// Roughly 90px wide / 58px tall on a 1920x1080 deck, so the seam stays easy to hit on the dense grid.
const JAM_DECK_SEAM_HIT = 2.5;

function jamDeckWidgetDisplayMinimum(widgetOrType) {
  const type = typeof widgetOrType === "string" ? widgetOrType : widgetOrType && widgetOrType.type;
  const def = type && WIDGET_DEFS[type];
  if (!def || !Number.isInteger(def.minDisplayW) || !Number.isInteger(def.minDisplayH)) return null;
  return { w: def.minDisplayW, h: def.minDisplayH };
}

function jamDeckWidgetIsCompact(widget) {
  const minimum = jamDeckWidgetDisplayMinimum(widget);
  if (!minimum || !widget) return false;
  return Number(widget.w) < minimum.w || Number(widget.h) < minimum.h;
}

function jamDeckWidgetIntersectionArea(a, b) {
  if (!jamDeckWidgetRectsOverlap(a, b)) return 0;
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

function jamDeckCodeUnitCompare(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function jamDeckRestoreLayoutSignature(layout, lockedIds = new Set()) {
  const geometry = layout.map((item) => `${String(item.id)}:${item.x},${item.y},${item.w},${item.h}`).join("|");
  const locked = Array.from(lockedIds).map(String).sort(jamDeckCodeUnitCompare).join(",");
  return `${geometry}#${locked}`;
}

function jamDeckRestoreStateCompare(left, right) {
  if (left.movedIds.size !== right.movedIds.size) return left.movedIds.size - right.movedIds.size;
  if (left.distance !== right.distance) return left.distance - right.distance;
  for (let index = 0; index < left.layout.length; index++) {
    const a = left.layout[index];
    const b = right.layout[index];
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
  }
  return jamDeckCodeUnitCompare(left.signature, right.signature);
}

function jamDeckRestoreVictimCompare(left, right) {
  const areaDelta = right.victim.w * right.victim.h - left.victim.w * left.victim.h;
  if (areaDelta) return areaDelta;
  const overlapDelta = right.overlap - left.overlap;
  if (overlapDelta) return overlapDelta;
  if (left.index !== right.index) return left.index - right.index;
  return jamDeckCodeUnitCompare(left.victim.id, right.victim.id);
}

function jamDeckRestoreCandidateDirectionRank(candidate, original, trigger) {
  const awayX = (original.x + original.w / 2) - (trigger.x + trigger.w / 2);
  const awayY = (original.y + original.h / 2) - (trigger.y + trigger.h / 2);
  const moveX = candidate.x - original.x;
  const moveY = candidate.y - original.y;
  if (moveX * awayX + moveY * awayY > 0) return 0;
  if (moveX * awayX + moveY * awayY === 0) return 1;
  return 2;
}

function jamDeckRestoreChangedIds(before, after, targetId) {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  return after.filter((item) => {
    if (item.id === targetId) return false;
    const original = beforeById.get(item.id);
    return !original || original.x !== item.x || original.y !== item.y || original.w !== item.w || original.h !== item.h;
  }).map((item) => item.id);
}

function jamDeckTryWidgetRestoreBySashes(widgets, widgetId, targetW, targetH, options = {}) {
  const cols = options.cols || GRID_COLS;
  const rows = options.rows || GRID_ROWS;
  const original = (Array.isArray(widgets) ? widgets : []).filter((item) => item && item.id).map((item) => ({ ...item }));
  const target = original.find((item) => item.id === widgetId);
  if (!target) return null;
  const neededAxes = [];
  if (targetW > target.w) neededAxes.push("x");
  if (targetH > target.h) neededAxes.push("y");
  if (!neededAxes.length) return { status: "OK", layout: original, movedIds: [], mode: "sash" };
  const orders = neededAxes.length === 2 ? [neededAxes, neededAxes.slice().reverse()] : [neededAxes];
  const results = [];

  for (const order of orders) {
    let layout = original.map((item) => ({ ...item }));
    let valid = true;
    for (const axis of order) {
      const current = layout.find((item) => item.id === widgetId);
      const delta = axis === "x" ? targetW - current.w : targetH - current.h;
      if (delta <= 0) continue;
      const boundary = axis === "x" ? current.x + current.w : current.y + current.h;
      const crossStart = axis === "x" ? current.y : current.x;
      const crossEnd = axis === "x" ? current.y + current.h : current.x + current.w;
      const candidates = jamDeckCollectLayoutSashes(layout, options)
        .filter((sash) => sash.axis === axis && sash.line === boundary && sash.beforeIds.includes(widgetId))
        .map((sash) => ({
          sash,
          coverage: Math.max(0, Math.min(crossEnd, sash.end) - Math.max(crossStart, sash.start)),
          afterArea: sash.afterIds.reduce((sum, id) => {
            const item = layout.find((entry) => entry.id === id);
            return sum + (item ? item.w * item.h : 0);
          }, 0),
        }))
        .filter((entry) => entry.coverage > 0)
        .sort((left, right) => right.coverage - left.coverage || right.afterArea - left.afterArea || left.sash.start - right.sash.start || jamDeckCodeUnitCompare(left.sash.id, right.sash.id));
      let applied = null;
      for (const candidate of candidates) {
        const next = jamDeckApplySashDelta(layout, candidate.sash, delta, options);
        const nextTarget = next && next.find((item) => item.id === widgetId);
        const reached = nextTarget && (axis === "x" ? nextTarget.w >= targetW : nextTarget.h >= targetH);
        if (reached) {
          applied = next;
          break;
        }
      }
      if (!applied) {
        valid = false;
        break;
      }
      layout = applied;
    }
    const restored = layout.find((item) => item.id === widgetId);
    if (!valid || !restored || restored.w < targetW || restored.h < targetH || !jamDeckWidgetLayoutCollisionFree(layout, cols, rows)) continue;
    const movedIds = jamDeckRestoreChangedIds(original, layout, widgetId);
    const originalById = new Map(original.map((item) => [item.id, item]));
    const distance = movedIds.reduce((sum, id) => {
      const before = originalById.get(id);
      const after = layout.find((item) => item.id === id);
      return sum + Math.abs(after.x - before.x) + Math.abs(after.y - before.y) + Math.abs(after.w - before.w) + Math.abs(after.h - before.h);
    }, 0);
    results.push({ status: "OK", layout, movedIds, mode: "sash", distance });
  }
  results.sort((left, right) => left.movedIds.length - right.movedIds.length || left.distance - right.distance || jamDeckCodeUnitCompare(jamDeckRestoreLayoutSignature(left.layout), jamDeckRestoreLayoutSignature(right.layout)));
  return results[0] || null;
}

function jamDeckResolveWidgetRestoreLayout(widgets, widgetId, options = {}) {
  const cols = options.cols || GRID_COLS;
  const rows = options.rows || GRID_ROWS;
  const maxStates = Math.max(1, Number(options.maxStates) || 6000);
  const list = (Array.isArray(widgets) ? widgets : []).filter((item) => item && item.id);
  const targetIndex = list.findIndex((item) => item.id === widgetId);
  const widget = list[targetIndex];
  const minimum = jamDeckWidgetDisplayMinimum(widget);
  if (!widget || !minimum) return { status: "INVALID", layout: null, movedIds: [] };
  const targetW = Math.max(Number(widget.w) || 0, minimum.w);
  const targetH = Math.max(Number(widget.h) || 0, minimum.h);
  const sashResult = jamDeckTryWidgetRestoreBySashes(list, widgetId, targetW, targetH, options);
  if (sashResult) return sashResult;
  const originX = Math.max(1, Math.min(cols - targetW + 1, Math.round(Number(widget.x) || 1)));
  const originY = Math.max(1, Math.min(rows - targetH + 1, Math.round(Number(widget.y) || 1)));
  const originalById = new Map(list.map((item) => [item.id, { x: item.x, y: item.y }]));
  const initialLayout = list.map((item, index) => index === targetIndex
    ? { ...item, x: originX, y: originY, w: targetW, h: targetH }
    : { ...item });
  const initialLocked = new Set([widgetId]);
  const initialSignature = jamDeckRestoreLayoutSignature(initialLayout, initialLocked);
  const queue = [{
    layout: initialLayout,
    lockedIds: initialLocked,
    movedIds: new Set(),
    distance: 0,
    signature: initialSignature,
  }];
  const visited = new Set([initialSignature]);
  let processed = 0;

  while (queue.length) {
    if (processed >= maxStates) return { status: "SEARCH_LIMIT", layout: null, movedIds: [] };
    queue.sort(jamDeckRestoreStateCompare);
    const state = queue.shift();
    processed += 1;
    const causalConflicts = [];
    for (let lockedIndex = 0; lockedIndex < state.layout.length; lockedIndex++) {
      const trigger = state.layout[lockedIndex];
      if (!state.lockedIds.has(trigger.id)) continue;
      for (let index = 0; index < state.layout.length; index++) {
        const victim = state.layout[index];
        if (state.lockedIds.has(victim.id) || !jamDeckWidgetRectsOverlap(trigger, victim)) continue;
        causalConflicts.push({ victim, trigger, index, overlap: jamDeckWidgetIntersectionArea(trigger, victim) });
      }
    }
    if (!causalConflicts.length) {
      if (!jamDeckWidgetLayoutCollisionFree(state.layout, cols, rows)) continue;
      return { status: "OK", layout: state.layout, movedIds: Array.from(state.movedIds) };
    }

    causalConflicts.sort(jamDeckRestoreVictimCompare);
    const conflict = causalConflicts[0];
    const original = originalById.get(conflict.victim.id);
    const lockedRects = state.layout.filter((item) => state.lockedIds.has(item.id));
    const candidates = [];
    for (let y = 1; y <= rows - conflict.victim.h + 1; y++) {
      for (let x = 1; x <= cols - conflict.victim.w + 1; x++) {
        const candidate = { ...conflict.victim, x, y };
        if (lockedRects.some((locked) => jamDeckWidgetRectsOverlap(candidate, locked))) continue;
        candidates.push({
          x,
          y,
          direction: jamDeckRestoreCandidateDirectionRank(candidate, conflict.victim, conflict.trigger),
          distance: Math.abs(x - original.x) + Math.abs(y - original.y),
        });
      }
    }
    candidates.sort((left, right) => left.direction - right.direction || left.distance - right.distance || left.y - right.y || left.x - right.x);
    for (const candidate of candidates) {
      const nextLayout = state.layout.map((item, index) => index === conflict.index
        ? { ...item, x: candidate.x, y: candidate.y }
        : { ...item });
      const movedIds = new Set(state.movedIds);
      movedIds.add(conflict.victim.id);
      const lockedIds = new Set(state.lockedIds);
      lockedIds.add(conflict.victim.id);
      const signature = jamDeckRestoreLayoutSignature(nextLayout, lockedIds);
      if (visited.has(signature)) continue;
      visited.add(signature);
      queue.push({
        layout: nextLayout,
        lockedIds,
        movedIds,
        distance: state.distance + candidate.distance,
        signature,
      });
    }
  }
  return { status: "NO_SPACE", layout: null, movedIds: [] };
}

function jamDeckWidgetRectsOverlap(a, b) {
  return !!a && !!b &&
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y;
}

function jamDeckWidgetLayoutBoundsOk(item, cols = GRID_COLS, rows = GRID_ROWS, minW = JAM_DECK_WIDGET_MIN_W, minH = JAM_DECK_WIDGET_MIN_H) {
  return !!item &&
    item.x >= 1 &&
    item.y >= 1 &&
    item.w >= minW &&
    item.h >= minH &&
    item.x + item.w - 1 <= cols &&
    item.y + item.h - 1 <= rows;
}

function jamDeckWidgetLayoutCollisionFree(widgets, cols = GRID_COLS, rows = GRID_ROWS, minW = JAM_DECK_WIDGET_MIN_W, minH = JAM_DECK_WIDGET_MIN_H) {
  const list = Array.isArray(widgets) ? widgets : [];
  for (let i = 0; i < list.length; i++) {
    if (!jamDeckWidgetLayoutBoundsOk(list[i], cols, rows, minW, minH)) return false;
    for (let j = i + 1; j < list.length; j++) {
      if (jamDeckWidgetRectsOverlap(list[i], list[j])) return false;
    }
  }
  return true;
}

function jamDeckScaleWidgetColumns(widgets, factor, cols = GRID_COLS) {
  const scale = Number(factor) || 1;
  return (Array.isArray(widgets) ? widgets : []).map((item) => {
    if (!item) return item;
    const w = Math.max(JAM_DECK_WIDGET_MIN_W, Math.min(cols, Math.round((Number(item.w) || 1) * scale)));
    const x = Math.max(1, Math.min(cols - w + 1, Math.round(((Number(item.x) || 1) - 1) * scale) + 1));
    return { ...item, x, w };
  });
}

function jamDeckMergeSashRanges(ranges) {
  const sorted = (Array.isArray(ranges) ? ranges : [])
    .map((range) => ({
      start: Number(range.start),
      end: Number(range.end),
      beforeIds: Array.from(new Set(range.beforeIds || [])),
      afterIds: Array.from(new Set(range.afterIds || [])),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const range of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && range.start <= prev.end) {
      prev.end = Math.max(prev.end, range.end);
      prev.beforeIds = Array.from(new Set(prev.beforeIds.concat(range.beforeIds)));
      prev.afterIds = Array.from(new Set(prev.afterIds.concat(range.afterIds)));
      continue;
    }
    merged.push({ ...range, beforeIds: range.beforeIds.slice(), afterIds: range.afterIds.slice() });
  }
  return merged;
}

function jamDeckCollectLayoutSashes(widgets, options = {}) {
  const minW = options.minW || JAM_DECK_WIDGET_MIN_W;
  const minH = options.minH || JAM_DECK_WIDGET_MIN_H;
  const list = (Array.isArray(widgets) ? widgets : []).filter((item) => item && item.id);
  const vertical = new Map();
  const horizontal = new Map();

  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const left = list[i];
      const right = list[j];
      if (left.x + left.w === right.x) {
        const start = Math.max(left.y, right.y);
        const end = Math.min(left.y + left.h, right.y + right.h);
        if (end - start < minH) continue;
        const line = right.x;
        const bucket = vertical.get(line) || [];
        bucket.push({ start, end, beforeIds: [left.id], afterIds: [right.id] });
        vertical.set(line, bucket);
      }
      if (left.y + left.h === right.y) {
        const start = Math.max(left.x, right.x);
        const end = Math.min(left.x + left.w, right.x + right.w);
        if (end - start < minW) continue;
        const line = right.y;
        const bucket = horizontal.get(line) || [];
        bucket.push({ start, end, beforeIds: [left.id], afterIds: [right.id] });
        horizontal.set(line, bucket);
      }
    }
  }

  const sashes = [];
  for (const [line, ranges] of vertical) {
    for (const range of jamDeckMergeSashRanges(ranges)) {
      sashes.push({
        id: `x:${line}:${range.start}:${range.end}`,
        axis: "x",
        line,
        start: range.start,
        end: range.end,
        beforeIds: range.beforeIds,
        afterIds: range.afterIds,
      });
    }
  }
  for (const [line, ranges] of horizontal) {
    for (const range of jamDeckMergeSashRanges(ranges)) {
      sashes.push({
        id: `y:${line}:${range.start}:${range.end}`,
        axis: "y",
        line,
        start: range.start,
        end: range.end,
        beforeIds: range.beforeIds,
        afterIds: range.afterIds,
      });
    }
  }
  return sashes.sort((left, right) => left.axis.localeCompare(right.axis) || left.line - right.line || left.start - right.start);
}

function jamDeckCollectLayoutNodes(widgets, options = {}) {
  const sashes = jamDeckCollectLayoutSashes(widgets, options);
  const vertical = sashes.filter((sash) => sash.axis === "x");
  const horizontal = sashes.filter((sash) => sash.axis === "y");
  const nodes = [];

  for (const sashX of vertical) {
    for (const sashY of horizontal) {
      if (sashY.line < sashX.start || sashY.line > sashX.end) continue;
      if (sashX.line < sashY.start || sashX.line > sashY.end) continue;
      nodes.push({
        id: `xy:${sashX.line}:${sashY.line}`,
        axis: "xy",
        x: sashX.line,
        y: sashY.line,
        sashX: sashX.id,
        sashY: sashY.id,
      });
    }
  }

  // Mid-edge nodes fill long gaps; skip when a cross already sits near the midpoint.
  for (const sash of sashes) {
    const mid = (sash.start + sash.end) / 2;
    const nearCross = nodes.some((node) => {
      if (node.axis !== "xy") return false;
      if (sash.axis === "x") return node.sashX === sash.id && Math.abs(node.y - mid) < 2.5;
      return node.sashY === sash.id && Math.abs(node.x - mid) < 2.5;
    });
    if (nearCross) continue;
    if (sash.axis === "x") {
      nodes.push({
        id: `x:${sash.id}`,
        axis: "x",
        x: sash.line,
        y: mid,
        sashX: sash.id,
        sashY: null,
      });
    } else {
      nodes.push({
        id: `y:${sash.id}`,
        axis: "y",
        x: mid,
        y: sash.line,
        sashX: null,
        sashY: sash.id,
      });
    }
  }

  return {
    sashes,
    nodes: nodes.sort((left, right) => left.x - right.x || left.y - right.y || left.axis.localeCompare(right.axis)),
  };
}

function jamDeckApplySashDelta(widgets, sash, delta, options = {}) {
  const cols = options.cols || GRID_COLS;
  const rows = options.rows || GRID_ROWS;
  const minW = options.minW || JAM_DECK_WIDGET_MIN_W;
  const minH = options.minH || JAM_DECK_WIDGET_MIN_H;
  const amount = Math.round(Number(delta) || 0);
  if (!sash || !amount) {
    return (Array.isArray(widgets) ? widgets : []).map((item) => ({ ...item }));
  }

  const layout = (Array.isArray(widgets) ? widgets : []).map((item) => ({ ...item }));
  const byId = new Map(layout.map((item) => [item.id, item]));
  const befores = (sash.beforeIds || []).map((id) => byId.get(id)).filter(Boolean);
  const afters = (sash.afterIds || []).map((id) => byId.get(id)).filter(Boolean);
  if (!befores.length || !afters.length) return null;

  if (sash.axis === "x") {
    // Positive delta moves the shared vertical boundary right: left grows, right shrinks.
    let maxPos = Infinity;
    let maxNeg = Infinity;
    for (const item of befores) maxNeg = Math.min(maxNeg, item.w - minW);
    for (const item of afters) {
      maxPos = Math.min(maxPos, item.w - minW);
      maxNeg = Math.min(maxNeg, item.x - 1);
    }
    const step = Math.max(-maxNeg, Math.min(maxPos, amount));
    if (!step) return null;
    for (const item of befores) item.w += step;
    for (const item of afters) {
      item.x += step;
      item.w -= step;
    }
  } else if (sash.axis === "y") {
    let maxPos = Infinity;
    let maxNeg = Infinity;
    for (const item of befores) maxNeg = Math.min(maxNeg, item.h - minH);
    for (const item of afters) {
      maxPos = Math.min(maxPos, item.h - minH);
      maxNeg = Math.min(maxNeg, item.y - 1);
    }
    const step = Math.max(-maxNeg, Math.min(maxPos, amount));
    if (!step) return null;
    for (const item of befores) item.h += step;
    for (const item of afters) {
      item.y += step;
      item.h -= step;
    }
  } else {
    return null;
  }
  void cols;
  void rows;

  if (!jamDeckWidgetLayoutCollisionFree(layout, cols, rows, minW, minH)) return null;
  return layout;
}

function jamDeckPointInRect(col, row, rect) {
  return !!rect &&
    col >= rect.x &&
    col < rect.x + rect.w &&
    row >= rect.y &&
    row < rect.y + rect.h;
}

function jamDeckCollectFillSlots(widgets, movingId, options = {}) {
  const cols = options.cols || GRID_COLS;
  const rows = options.rows || GRID_ROWS;
  const minW = options.minW || JAM_DECK_WIDGET_MIN_W;
  const minH = options.minH || JAM_DECK_WIDGET_MIN_H;
  // Edge stretches (B → canvas right/bottom with no after neighbor) are Shift-gated.
  const includeEdgeSlots = !!options.includeEdgeSlots;
  const others = (Array.isArray(widgets) ? widgets : []).filter((item) => item && item.id !== movingId);
  const slots = [];

  const pushSlot = (slot) => {
    if (!jamDeckWidgetLayoutBoundsOk(slot, cols, rows, minW, minH)) return;
    if (others.some((item) => jamDeckWidgetRectsOverlap(item, slot))) return;
    slots.push(slot);
  };

  for (const before of others) {
    const nextBelow = others
      .filter((item) => item.x === before.x && item.w === before.w && item.y >= before.y + before.h)
      .sort((left, right) => left.y - right.y || String(left.id).localeCompare(String(right.id)))[0] || null;
    if (!nextBelow && !includeEdgeSlots) continue;
    const y = before.y + before.h;
    const endY = nextBelow ? nextBelow.y : rows + 1;
    const h = endY - y;
    if (h >= minH && before.w >= minW) {
      pushSlot({
        axis: "y",
        x: before.x,
        y,
        w: before.w,
        h,
        beforeId: before.id,
        afterId: nextBelow ? nextBelow.id : null,
      });
    }
  }

  for (const before of others) {
    const nextRight = others
      .filter((item) => item.y === before.y && item.h === before.h && item.x >= before.x + before.w)
      .sort((left, right) => left.x - right.x || String(left.id).localeCompare(String(right.id)))[0] || null;
    if (!nextRight && !includeEdgeSlots) continue;
    const x = before.x + before.w;
    const endX = nextRight ? nextRight.x : cols + 1;
    const w = endX - x;
    if (w >= minW && before.h >= minH) {
      pushSlot({
        axis: "x",
        x,
        y: before.y,
        w,
        h: before.h,
        beforeId: before.id,
        afterId: nextRight ? nextRight.id : null,
      });
    }
  }

  return slots;
}

function jamDeckFindPushSeam(widgets, movingId, col, row, options = {}) {
  const cols = options.cols || GRID_COLS;
  const rows = options.rows || GRID_ROWS;
  const minW = options.minW || JAM_DECK_WIDGET_MIN_W;
  const minH = options.minH || JAM_DECK_WIDGET_MIN_H;
  const hit = options.hit != null ? options.hit : JAM_DECK_SEAM_HIT;
  const others = (Array.isArray(widgets) ? widgets : []).filter((item) => item && item.id !== movingId);
  let best = null;
  let bestDist = Infinity;

  const consider = (candidate) => {
    if (candidate.dist >= bestDist) return;
    bestDist = candidate.dist;
    best = candidate;
  };

  for (const before of others) {
    const after = others
      .filter((item) => item.x === before.x && item.w === before.w && item.y >= before.y + before.h)
      .sort((left, right) => left.y - right.y || String(left.id).localeCompare(String(right.id)))[0];
    if (!after) continue;
    const seam = before.y + before.h;
    // Roomy gaps are handled by the fill rectangle instead.
    if (after.y - seam >= minH) continue;
    if (col < before.x || col >= before.x + before.w) continue;
    const dist = Math.abs(row - seam);
    if (dist > hit) continue;
    consider({ axis: "y", before, after, seam, dist });
  }

  for (const before of others) {
    const after = others
      .filter((item) => item.y === before.y && item.h === before.h && item.x >= before.x + before.w)
      .sort((left, right) => left.x - right.x || String(left.id).localeCompare(String(right.id)))[0];
    if (!after) continue;
    const seam = before.x + before.w;
    if (after.x - seam >= minW) continue;
    if (row < before.y || row >= before.y + before.h) continue;
    const dist = Math.abs(col - seam);
    if (dist > hit) continue;
    consider({ axis: "x", before, after, seam, dist });
  }

  void cols;
  void rows;
  return best;
}

function jamDeckReflowSeamChain(chain, seamStart, insertSize, posKey, sizeKey, minSize, limit) {
  if (!chain.length) return [];
  const gaps = chain.map((item, index) => (index === 0
    ? item[posKey] - seamStart
    : item[posKey] - (chain[index - 1][posKey] + chain[index - 1][sizeKey])));
  const sizes = chain.map((item) => item[sizeKey]);
  const tailEnd = () => {
    let pos = seamStart + insertSize;
    for (let i = 0; i < chain.length; i++) {
      pos += gaps[i] + sizes[i];
    }
    return pos - 1;
  };

  // Trailing widgets slide over first; only what still overflows is taken out of their size.
  let overflow = tailEnd() - limit;
  for (let i = 0; i < chain.length && overflow > 0; i++) {
    const take = Math.min(overflow, sizes[i] - minSize);
    if (take <= 0) continue;
    sizes[i] -= take;
    overflow -= take;
  }
  if (overflow > 0) return null;

  const placed = [];
  let pos = seamStart + insertSize;
  for (let i = 0; i < chain.length; i++) {
    pos += gaps[i];
    placed.push({ item: chain[i], pos, size: sizes[i] });
    pos += sizes[i];
  }
  return placed;
}

function jamDeckApplyPushSeam(widgets, movingId, seam, options = {}) {
  const cols = options.cols || GRID_COLS;
  const rows = options.rows || GRID_ROWS;
  const minW = options.minW || JAM_DECK_WIDGET_MIN_W;
  const minH = options.minH || JAM_DECK_WIDGET_MIN_H;
  if (!seam || !seam.before || !seam.after) return null;

  const layout = (Array.isArray(widgets) ? widgets : []).map((item) => ({ ...item }));
  const mover = layout.find((item) => item && item.id === movingId);
  const before = layout.find((item) => item && item.id === seam.before.id);
  if (!mover || !before) return null;

  if (seam.axis === "y") {
    // Drag always inserts at the widget minimum so a large A does not over-push the chain.
    const insertH = minH;
    const seamY = before.y + before.h;
    const chain = layout
      .filter((item) => item.id !== movingId && item.y >= seamY && item.x < before.x + before.w && item.x + item.w > before.x)
      .sort((left, right) => left.y - right.y);
    const placed = jamDeckReflowSeamChain(chain, seamY, insertH, "y", "h", minH, rows);
    if (!placed) return null;
    for (const entry of placed) {
      entry.item.y = entry.pos;
      entry.item.h = entry.size;
    }
    mover.x = before.x;
    mover.y = seamY;
    mover.w = before.w;
    mover.h = insertH;
  } else if (seam.axis === "x") {
    const insertW = minW;
    const seamX = before.x + before.w;
    const chain = layout
      .filter((item) => item.id !== movingId && item.x >= seamX && item.y < before.y + before.h && item.y + item.h > before.y)
      .sort((left, right) => left.x - right.x);
    const placed = jamDeckReflowSeamChain(chain, seamX, insertW, "x", "w", minW, cols);
    if (!placed) return null;
    for (const entry of placed) {
      entry.item.x = entry.pos;
      entry.item.w = entry.size;
    }
    mover.x = seamX;
    mover.y = before.y;
    mover.w = insertW;
    mover.h = before.h;
  } else {
    return null;
  }

  if (!jamDeckWidgetLayoutCollisionFree(layout, cols, rows, minW, minH)) return null;
  return layout;
}

function jamDeckPickFillSlot(slots, col, row) {
  const list = (Array.isArray(slots) ? slots : []).filter((slot) => jamDeckPointInRect(col, row, slot));
  if (!list.length) return null;
  return list.slice().sort((left, right) => {
    const area = (left.w * left.h) - (right.w * right.h);
    if (area) return area;
    return String(left.beforeId || "").localeCompare(String(right.beforeId || ""));
  })[0];
}

function jamDeckApplyFillSlot(widgets, movingId, slot, options = {}) {
  const cols = options.cols || GRID_COLS;
  const rows = options.rows || GRID_ROWS;
  const minW = options.minW || JAM_DECK_WIDGET_MIN_W;
  const minH = options.minH || JAM_DECK_WIDGET_MIN_H;
  if (!slot) return null;
  const layout = (Array.isArray(widgets) ? widgets : []).map((item) => {
    if (!item || item.id !== movingId) return { ...item };
    return {
      ...item,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
    };
  });
  if (!jamDeckWidgetLayoutCollisionFree(layout, cols, rows, minW, minH)) return null;
  return layout;
}

function jamDeckPreviewWidgetLayout(widgets, movingId, target, options = {}) {
  const cols = options.cols || GRID_COLS;
  const rows = options.rows || GRID_ROWS;
  const minW = options.minW || JAM_DECK_WIDGET_MIN_W;
  const minH = options.minH || JAM_DECK_WIDGET_MIN_H;
  const includeEdgeSlots = !!(options.includeEdgeSlots ?? options.shiftKey);
  const moving = (Array.isArray(widgets) ? widgets : []).find((item) => item && item.id === movingId);
  if (!moving) return { ok: false };

  const col = Number(target && (target.col != null ? target.col : target.x)) || 1;
  const row = Number(target && (target.row != null ? target.row : target.y)) || 1;
  // While dragging, A always collapses to the minimum footprint for hover math and the floating ghost.
  const ghost = {
    x: Math.max(1, Math.min(cols - minW + 1, Math.round(col - minW / 2))),
    y: Math.max(1, Math.min(rows - minH + 1, Math.round(row - minH / 2))),
    w: minW,
    h: minH,
  };

  const slots = jamDeckCollectFillSlots(widgets, movingId, { cols, rows, minW, minH, includeEdgeSlots });
  const floating = () => ({
    ok: true,
    canCommit: false,
    mode: "float",
    widgets: (Array.isArray(widgets) ? widgets : []).map((item) => ({ ...item })),
    ghost,
    slot: null,
    seam: null,
    slots,
    solo: true,
    includeEdgeSlots,
  });

  const slot = jamDeckPickFillSlot(slots, col, row);
  if (slot) {
    const layout = jamDeckApplyFillSlot(widgets, movingId, slot, { cols, rows, minW, minH });
    if (!layout) return floating();
    return {
      ok: true,
      canCommit: true,
      mode: "fill",
      widgets: layout,
      ghost,
      slot: {
        axis: slot.axis,
        x: slot.x,
        y: slot.y,
        w: slot.w,
        h: slot.h,
        beforeId: slot.beforeId,
        afterId: slot.afterId,
      },
      seam: null,
      slots,
      solo: !slot.afterId,
      includeEdgeSlots,
    };
  }

  const seam = jamDeckFindPushSeam(widgets, movingId, col, row, { cols, rows, minW, minH });
  if (seam) {
    const layout = jamDeckApplyPushSeam(widgets, movingId, seam, { cols, rows, minW, minH });
    if (!layout) return floating();
    return {
      ok: true,
      canCommit: true,
      mode: "push",
      widgets: layout,
      ghost,
      slot: null,
      seam: {
        axis: seam.axis,
        beforeId: seam.before.id,
        afterId: seam.after.id,
      },
      slots,
      solo: false,
      includeEdgeSlots,
    };
  }

  return floating();
}

class JamDeckView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.launcherViewId = `view-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.launcherSessionToken = `session-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    this.launcherDragState = null;
    this.launcherSuppressClick = null;
    this.canvasRuntime = new CanvasRuntimeAdapter(this);
    this.handleDeckActivation = (event) => {
      if (event.target && event.target.closest && event.target.closest(".jam-deck-canvas-leaf")) return;
      try {
        if (this.app.workspace.activeLeaf !== this.leaf) this.app.workspace.setActiveLeaf(this.leaf, { focus: false });
      } catch (error) {}
    };
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Jam Deck";
  }

  getIcon() {
    return "layout-dashboard";
  }

  async onOpen() {
    this.contentEl.addEventListener("pointerdown", this.handleDeckActivation, true);
    this.contentEl.addEventListener("focusin", this.handleDeckActivation, true);
    this.render();
  }

  async onClose() {
    this.cleanupLayoutSashes();
    this.contentEl.removeEventListener("pointerdown", this.handleDeckActivation, true);
    this.contentEl.removeEventListener("focusin", this.handleDeckActivation, true);
    await this.canvasRuntime.destroyAll();
  }

  cleanupLayoutSashes() {
    if (this._sashMove) window.removeEventListener("pointermove", this._sashMove);
    if (this._sashUp) window.removeEventListener("pointerup", this._sashUp);
    if (this._sashGrid && this._sashProbe) {
      this._sashGrid.removeEventListener("pointermove", this._sashProbe);
      this._sashGrid.removeEventListener("pointerleave", this._sashLeave);
    }
    if (this._sashFrame) window.cancelAnimationFrame(this._sashFrame);
    this._sashMove = null;
    this._sashUp = null;
    this._sashProbe = null;
    this._sashLeave = null;
    this._sashGrid = null;
    this._sashFrame = 0;
  }

  render() {
    const root = this.contentEl;
    this.cleanupLayoutSashes();
    this.canvasRuntime.parkAll();
    root.empty();
    root.addClass("jam-deck-root");

    const toolbar = root.createDiv({ cls: "jam-deck-toolbar" });
    const title = toolbar.createDiv({ cls: "jam-deck-title" });
    title.createSpan({ text: "Jam Deck", cls: "jam-deck-title-main" });
    title.createSpan({ text: "副屏工作台", cls: "jam-deck-title-sub" });

    const actions = toolbar.createDiv({ cls: "jam-deck-actions" });
    this.makeToolbarButton(actions, "+ 添加", "添加组件", () => {
      new WidgetPickerModal(this.app, this.plugin).open();
    });
    this.makeToolbarButton(
      actions,
      this.plugin.settings.editMode ? "完成" : "编辑",
      "切换布局编辑模式",
      async () => {
        this.plugin.settings.editMode = !this.plugin.settings.editMode;
        await this.plugin.saveSettings();
        this.plugin.renderAllViews();
      },
      this.plugin.settings.editMode
    );
    this.makeToolbarButton(actions, "整理", "自动整理所有组件", async () => {
      await this.plugin.autoArrange();
    });

    const grid = root.createDiv({ cls: "jam-deck-grid" });
    grid.style.setProperty("--deck-cols", String(GRID_COLS));
    grid.style.setProperty("--deck-rows", String(GRID_ROWS));

    for (const widget of this.plugin.settings.widgets) {
      this.renderWidget(grid, widget);
    }
    this.enableLayoutSashes(grid);
    const liveCanvasIds = new Set(this.plugin.settings.widgets
      .filter((widget) => widget.type === "canvas-embed")
      .map((widget) => widget.id));
    for (const id of Array.from(this.canvasRuntime.entries.keys())) {
      if (!liveCanvasIds.has(id)) void this.canvasRuntime.destroy(id);
    }
  }

  makeToolbarButton(parent, text, title, handler, active) {
    const button = parent.createEl("button", {
      text,
      cls: active ? "jam-deck-action is-active" : "jam-deck-action",
      attr: { title },
    });
    button.addEventListener("click", handler);
  }

  renderWidget(grid, widget) {
    const def = WIDGET_DEFS[widget.type];
    if (!def) {
      console.warn(`jam-deck ignored unknown widget type: ${String(widget && widget.type || "")}`);
      return;
    }

    const el = grid.createDiv({ cls: "jam-deck-widget" });
    el.addClass(`is-${widget.type}`);
    const compact = jamDeckWidgetIsCompact(widget);
    el.toggleClass("is-compact", compact);
    el.dataset.widgetId = widget.id;
    el.style.gridColumn = `${widget.x} / span ${widget.w}`;
    el.style.gridRow = `${widget.y} / span ${widget.h}`;

    const restore = el.createEl("button", {
      cls: "jam-deck-widget-compact-restore",
      attr: {
        type: "button",
        title: `恢复${def.label}到最小完整尺寸`,
        "aria-label": `恢复${def.label}到最小完整尺寸`,
      },
    });
    restore.createSpan({ text: def.icon, cls: "jam-deck-widget-compact-icon", attr: { "aria-hidden": "true" } });
    restore.addEventListener("pointerdown", (event) => event.stopPropagation());
    restore.addEventListener("keydown", (event) => event.stopPropagation());
    restore.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (restore.disabled) return;
      restore.disabled = true;
      restore.setAttribute("aria-disabled", "true");
      restore.setAttribute("aria-busy", "true");
      try {
        await this.plugin.restoreWidgetDisplay(widget.id);
      } finally {
        if (restore.isConnected) {
          restore.disabled = false;
          restore.setAttribute("aria-disabled", "false");
          restore.removeAttribute("aria-busy");
        }
      }
    });

    const header = el.createDiv({ cls: "jam-deck-widget-header" });
    header.createSpan({ text: def.icon, cls: "jam-deck-widget-icon" });
    const displayTitle = widget.type === "canvas-embed" && widget.config && widget.config.filePath
      ? widget.config.filePath.split("/").pop().replace(/\.canvas$/i, "")
      : def.label;
    header.createSpan({ text: displayTitle, cls: "jam-deck-widget-title", attr: { title: displayTitle } });
    if (widget.type === "canvas-embed") {
      header.createSpan({ text: "Beta", cls: "jam-deck-canvas-beta", attr: { title: "真实 Canvas 工作区；当前 Obsidian 版本待验证" } });
    }

    const headerActions = header.createDiv({ cls: "jam-deck-widget-actions" });
    if (widget.type === "browser") {
      const setting = headerActions.createEl("button", { text: "URL", cls: "jam-deck-widget-action" });
      setting.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.plugin.configureBrowser(widget.id);
      });
    }
    if (widget.type === "clipboard") {
      const clear = headerActions.createEl("button", { text: "清空", cls: "jam-deck-widget-action is-danger", attr: { title: "清空全部剪贴板记录" } });
      clear.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.plugin.clearClipboard();
      });
    }
    if (widget.type === "tasks") {
      const archive = headerActions.createEl("button", { text: "归档", cls: "jam-deck-widget-action", attr: { title: "查看归档待办" } });
      archive.addEventListener("click", (event) => {
        event.stopPropagation();
        new ArchiveViewerModal(this.app, this.plugin).open();
      });
    }
    if (widget.type === "launcher") {
      const add = headerActions.createEl("button", { text: "+", cls: "jam-deck-widget-action", attr: { title: "添加快捷方式" } });
      add.addEventListener("click", (event) => {
        event.stopPropagation();
        new ShortcutEditorModal(this.app, this.plugin, widget.id).open();
      });
    }
    if (widget.type === "canvas-embed") {
      const choose = headerActions.createEl("button", { text: widget.config && widget.config.filePath ? "更换" : "选择", cls: "jam-deck-widget-action", attr: { title: "选择 Canvas 文件" } });
      choose.addEventListener("click", (event) => {
        event.stopPropagation();
        new CanvasFilePickerModal(this.app, this.plugin, widget.id).open();
      });
      if (widget.config && widget.config.filePath) {
        const open = headerActions.createEl("button", { text: "打开", cls: "jam-deck-widget-action", attr: { title: "在原生 Canvas 标签中打开" } });
        open.addEventListener("click", async (event) => {
          event.stopPropagation();
          await this.plugin.openCanvasFile(widget.config.filePath);
        });
      }
    }
    if (this.plugin.settings.editMode) {
      const remove = headerActions.createEl("button", { text: "×", cls: "jam-deck-widget-action is-danger", attr: { title: "删除组件" } });
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.plugin.removeWidget(widget.id);
      });
    }

    const body = el.createDiv({ cls: "jam-deck-widget-body" });
    if (widget.type === "canvas-embed") body.addClass("jam-deck-canvas-embed-body");
    this.renderWidgetBody(body, widget);

    if (this.plugin.settings.editMode) {
      el.addClass("is-editing");
      if (compact) {
        this.enableDrag(el, el, widget);
      } else {
        header.createSpan({ text: "拖动", cls: "jam-deck-drag-hint" });
        this.enableDrag(header, el, widget);
      }
    }
  }

  renderWidgetBody(body, widget) {
    switch (widget.type) {
      case "clock":
        this.renderClock(body, widget);
        break;
      case "clipboard":
        this.renderClipboard(body);
        break;
      case "tasks":
        this.renderTasks(body);
        break;
      case "calendar":
        this.renderCalendar(body, widget);
        break;
      case "canvas":
        this.renderCanvasLauncher(body);
        break;
      case "canvas-embed":
        this.renderCanvasEmbed(body, widget);
        break;
      case "browser":
        this.renderBrowser(body, widget);
        break;
      case "launcher":
        this.renderLauncher(body, widget);
        break;
      case "music":
        this.renderMusicPlayer(body, widget);
        break;
    }
  }

  renderClock(body, widget) {
    const time = body.createDiv({ cls: "jam-deck-clock-time" });
    const date = body.createDiv({ cls: "jam-deck-clock-date" });
    const countdown = body.createDiv({ cls: "jam-deck-countdown" });
    countdown.dataset.widgetId = widget.id;
    const toggleLabel = countdown.createEl("label", { cls: "jam-deck-countdown-toggle" });
    const toggle = toggleLabel.createEl("input", {
      type: "checkbox",
      attr: { "aria-label": "启用倒计时" },
    });
    const toggleText = toggleLabel.createSpan({ text: "倒计时" });
    const editor = countdown.createDiv({
      cls: "jam-deck-countdown-editor",
      attr: { role: "group", "aria-label": "倒计时时长，依次为时、分、秒" },
    });
    const durationInputs = {};
    [
      ["hours", "时"],
      ["minutes", "分"],
      ["seconds", "秒"],
    ].forEach(([unit, label], index) => {
      if (index > 0) editor.createSpan({ cls: "jam-deck-countdown-editor-separator", text: ":" });
      durationInputs[unit] = editor.createEl("input", {
        cls: `jam-deck-countdown-duration jam-deck-countdown-duration-${unit}`,
        type: "text",
        attr: {
          inputmode: "numeric",
          maxlength: "2",
          spellcheck: "false",
          "aria-label": `倒计时${label}`,
          title: label,
        },
      });
    });
    const flip = countdown.createDiv({
      cls: "jam-deck-countdown-flip",
      attr: { role: "timer", "aria-live": "off" },
    });
    const state = jamDeckCountdownState(widget);
    const writeEditor = (seconds) => {
      const parts = jamDeckCountdownDurationParts(seconds);
      durationInputs.hours.value = parts.hours;
      durationInputs.minutes.value = parts.minutes;
      durationInputs.seconds.value = parts.seconds;
    };
    const readEditor = () => `${durationInputs.hours.value || "0"}:${durationInputs.minutes.value || "0"}:${durationInputs.seconds.value || "0"}`;
    toggle.checked = state.enabled;
    writeEditor(state.durationSeconds);
    jamDeckRenderCountdownFlip(flip, jamDeckFormatCountdownClock(state.remainingSeconds));
    Object.values(durationInputs).forEach((input) => { input.disabled = state.enabled; });
    countdown.toggleClass("is-running", state.enabled);
    toggleText.setText(state.enabled ? "计时中" : "倒计时");

    const saveEditor = async () => {
      const saved = await this.plugin.setCountdownDuration(widget.id, readEditor());
      if (!saved) {
        const latest = jamDeckCountdownState(widget);
        writeEditor(latest.durationSeconds);
      } else {
        writeEditor(jamDeckCountdownState(widget).durationSeconds);
      }
    };
    Object.values(durationInputs).forEach((input) => {
      input.addEventListener("focus", () => input.select());
      input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, "").slice(0, 2);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
      input.addEventListener("change", saveEditor);
    });
    toggle.addEventListener("change", async () => {
      toggle.disabled = true;
      Object.values(durationInputs).forEach((input) => { input.disabled = true; });
      const changed = await this.plugin.setCountdownEnabled(widget.id, toggle.checked, readEditor());
      if (!changed) {
        const latest = jamDeckCountdownState(widget);
        toggle.checked = latest.enabled;
        writeEditor(latest.durationSeconds);
        toggle.disabled = false;
        Object.values(durationInputs).forEach((input) => { input.disabled = latest.enabled; });
      }
    });
    const update = () => {
      const now = new Date();
      time.setText(now.toLocaleTimeString("zh-CN", { hour12: false }));
      date.setText(now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }));
    };
    update();
  }

  renderClipboard(body) {
    const items = this.plugin.settings.clipboardItems || [];
    if (!items.length) {
      body.createDiv({ text: "暂无记录\n复制文字或截图后会自动出现", cls: "jam-deck-empty" });
      return;
    }

    const gallery = body.createDiv({ cls: "jam-deck-clipboard-gallery" });
    for (const item of items.slice(0, 10)) {
      const timeLabel = this.plugin.formatTime(item.ts);
      const card = gallery.createDiv({
        cls: item.type === "image" ? "jam-deck-clip-image" : "jam-deck-clip-text",
        attr: {
          draggable: "true",
          tabindex: "0",
          role: "group",
          title: "拖到待办、Canvas 或其他应用",
          "aria-label": `${item.type === "image" ? "剪贴板图片" : "剪贴板文字"}，${timeLabel}`,
        },
      });

      if (item.type === "image") {
        const path = `${CLIPBOARD_DIR}/${item.filename}`;
        const src = this.app.vault.adapter.getResourcePath(path);
        const media = card.createDiv({ cls: "jam-deck-clip-media" });
        media.createEl("img", { attr: { src, loading: "lazy", decoding: "async", draggable: "false", alt: item.filename || "剪贴板图片" } });
        const meta = card.createDiv({ cls: "jam-deck-clip-meta" });
        meta.createSpan({ text: timeLabel, cls: "jam-deck-clip-overlay" });
        meta.createSpan({ text: "IMAGE", cls: "jam-deck-clip-kind" });
        this.plugin.hydrateClipboardImageDrag(card, item, path, src);
      } else {
        card.createSpan({ text: timeLabel, cls: "jam-deck-clip-text-time" });
        card.createDiv({ text: item.content, cls: "jam-deck-clip-text-body" });
      }

      const toolbar = card.createDiv({ cls: "jam-deck-clip-toolbar", attr: { "aria-label": "剪贴板操作" } });
      toolbar.addEventListener("pointerdown", (event) => event.stopPropagation());
      const copyBtn = toolbar.createEl("button", { cls: "jam-deck-clip-btn", attr: { type: "button", title: "复制到剪贴板", "aria-label": "复制到剪贴板" } });
      setIcon(copyBtn, "copy");
      copyBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.plugin.copyClipboardItem(item);
        new Notice("Jam Deck：已复制");
      });
      const delBtn = toolbar.createEl("button", { cls: "jam-deck-clip-btn is-danger", attr: { type: "button", title: "删除该条记录及附件", "aria-label": "删除该条剪贴板记录" } });
      setIcon(delBtn, "trash-2");
      delBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.plugin.deleteClipboardItem(item);
      });
      card.addEventListener("dragstart", (event) => {
        if (event.target && event.target.closest && event.target.closest(".jam-deck-clip-toolbar")) {
          event.preventDefault();
          return;
        }
        this.plugin.prepareClipboardDrag(event, item, card);
      });
      card.addEventListener("dragend", () => {
        card.removeClass("is-dragging");
        if (this.plugin.activeClipboardDragItem === item) this.plugin.activeClipboardDragItem = null;
      });
    }
    body.createDiv({ text: "拖到待办可自动创建 · 图片外拖兼容部分应用", cls: "jam-deck-clipboard-drag-hint" });
  }

  renderTasks(body) {
    const createDrop = body.createDiv({ cls: "jam-deck-task-create-drop", text: "＋ 创建新待办" });
    this.plugin.enableTaskDrop(body, null, createDrop);

    const active = this.plugin.settings.deckTasks.filter((task) => task.status === "active");
    const completed = this.plugin.settings.deckTasks.filter((task) => task.status === "completed");
    const archivedCount = this.plugin.settings.deckTasks.filter((task) => task.status === "archived").length;
    const list = body.createDiv({ cls: "jam-deck-task-list" });

    if (!active.length && !completed.length) {
      list.createDiv({ text: "没有待办，点击日历日期创建。", cls: "jam-deck-task-empty" });
    }

    for (const task of [...active, ...completed]) {
      const row = list.createDiv({ cls: task.status === "completed" ? "jam-deck-task is-completed" : "jam-deck-task" });
      const isArchiving = this.plugin.archivingTaskIds.has(task.id);
      if (isArchiving) row.addClass("is-archiving");
      const checkbox = row.createEl("input", { type: "checkbox", cls: "jam-deck-task-check" });
      checkbox.checked = task.status === "completed";
      checkbox.disabled = isArchiving;
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", async (event) => {
        event.stopPropagation();
        await this.plugin.toggleDeckTask(task.id);
      });
      const taskMain = row.createEl("button", {
        cls: "jam-deck-task-main",
        attr: { type: "button", title: "打开待办详情", "aria-label": `打开待办详情：${task.text}` },
      });
      const category = this.plugin.resolveTaskCategory(task);
      taskMain.createSpan({ text: category === "work" ? "工作" : "生活", cls: `jam-deck-task-category is-${category}` });
      taskMain.createSpan({ text: task.text, cls: "jam-deck-task-title" });
      if (task.dueDate) {
        const overdue = task.status === "active" && task.dueDate < this.plugin.formatLocalDate(new Date());
        taskMain.createSpan({ text: task.dueDate.slice(5), cls: `jam-deck-task-due${overdue ? " is-overdue" : ""}` });
      }
      taskMain.disabled = isArchiving;
      taskMain.addEventListener("click", (event) => {
        event.stopPropagation();
        this.plugin.openTaskDetail(task.id);
      });
      this.plugin.enableExistingTaskDrop(row, task.id);
      const taskActions = row.createDiv({ cls: "jam-deck-task-actions" });
      if (task.status === "completed") {
        const archive = taskActions.createEl("button", { text: "归档", cls: "jam-deck-task-archive", attr: { type: "button", title: "按分类归档", "aria-label": "按分类归档" } });
        archive.disabled = isArchiving;
        archive.addEventListener("click", async (event) => {
          event.stopPropagation();
          await this.plugin.archiveDeckTask(task.id);
        });
      }
      const remove = taskActions.createEl("button", { text: "×", cls: "jam-deck-task-delete", attr: { type: "button", title: "删除待办", "aria-label": `删除待办：${task.text}` } });
      remove.disabled = isArchiving;
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (window.confirm(`删除待办“${task.text}”？\n\n任务附件会保留，不会删除文件。`)) await this.plugin.deleteDeckTask(task.id);
      });
    }

    body.createDiv({ text: `进行中 ${active.length} · 已完成 ${completed.length} · 已归档 ${archivedCount}`, cls: "jam-deck-task-foot" });
  }

  renderCalendar(body, widget) {
    const today = new Date();
    const todayKey = this.plugin.formatLocalDate(today);
    const stored = widget.config && this.plugin.isValidLocalDate(widget.config.viewWeek) ? widget.config.viewWeek : todayKey;
    const [anchorYear, anchorMonth, anchorDay] = stored.split("-").map(Number);
    const anchor = new Date(anchorYear, anchorMonth - 1, anchorDay);
    const mondayOffset = (anchor.getDay() + 6) % 7;
    const currentWeekStart = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - mondayOffset);
    const rangeStart = new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate() - 7);
    const rangeEnd = new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate() + 20);
    const setWeek = async (date) => {
      widget.config = widget.config || {};
      widget.config.viewWeek = this.plugin.formatLocalDate(date);
      await this.plugin.saveSettings();
      this.render();
    };
    const header = body.createDiv({ cls: "jam-deck-calendar-toolbar" });
    const previous = header.createEl("button", { text: "‹", attr: { type: "button", title: "上一周" } });
    const sameYear = rangeStart.getFullYear() === rangeEnd.getFullYear();
    const sameMonth = sameYear && rangeStart.getMonth() === rangeEnd.getMonth();
    const label = sameMonth
      ? `${rangeStart.getFullYear()} 年 ${rangeStart.getMonth() + 1} 月 · ${rangeStart.getDate()}—${rangeEnd.getDate()}`
      : sameYear
        ? `${rangeStart.getFullYear()} 年 ${rangeStart.getMonth() + 1}/${rangeStart.getDate()} — ${rangeEnd.getMonth() + 1}/${rangeEnd.getDate()}`
        : `${rangeStart.getFullYear()}/${rangeStart.getMonth() + 1}/${rangeStart.getDate()} — ${rangeEnd.getFullYear()}/${rangeEnd.getMonth() + 1}/${rangeEnd.getDate()}`;
    header.createDiv({ text: label, cls: "jam-deck-calendar-month" });
    const todayButton = header.createEl("button", { text: "今", attr: { type: "button", title: "回到今天" } });
    const next = header.createEl("button", { text: "›", attr: { type: "button", title: "下一周" } });
    previous.addEventListener("click", () => setWeek(new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate() - 7)));
    todayButton.addEventListener("click", () => setWeek(today));
    next.addEventListener("click", () => setWeek(new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate() + 7)));

    const weekdays = body.createDiv({ cls: "jam-deck-calendar-weekdays" });
    for (const text of ["一", "二", "三", "四", "五", "六", "日"]) weekdays.createSpan({ text });
    const days = body.createDiv({ cls: "jam-deck-calendar-days" });
    const dueTasks = this.plugin.settings.deckTasks.filter((task) => this.plugin.isValidLocalDate(task.dueDate) && !task.tombstone);
    let rangeTaskCount = 0;
    for (let index = 0; index < 28; index++) {
      const date = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + index);
      const dateKey = this.plugin.formatLocalDate(date);
      const tasks = dueTasks.filter((task) => task.dueDate === dateKey);
      const completedCount = tasks.filter((task) => task.status === "completed" || task.status === "archived").length;
      const activeTasks = tasks.filter((task) => task.status === "active");
      const completionLevel = Math.min(5, completedCount);
      rangeTaskCount += tasks.length;
      const cell = days.createDiv({ cls: `jam-deck-calendar-day${dateKey === todayKey ? " is-today" : ""}` });
      const completionText = completedCount ? ` · 已完成 ${completedCount} 项` : "";
      const dateButton = cell.createEl("button", { text: String(date.getDate()), cls: `jam-deck-calendar-date${completionLevel ? ` has-completed heat-${completionLevel}` : ""}`, attr: { type: "button", title: `${dateKey} · 新建截止待办${completionText}`, "aria-label": `${dateKey} 新建待办${completionText}` } });
      dateButton.addEventListener("click", () => this.plugin.openNewTaskForDate(dateKey));
      if (activeTasks.length) {
        const markers = cell.createDiv({ cls: "jam-deck-calendar-markers" });
        for (const task of activeTasks.slice(0, 3)) {
          const overdue = dateKey < todayKey;
          const marker = markers.createEl("button", { cls: `jam-deck-calendar-task-marker is-${task.status}${overdue ? " is-overdue" : ""}`, attr: { type: "button", title: task.text, "aria-label": `打开待办：${task.text}` } });
          marker.addEventListener("click", (event) => { event.stopPropagation(); this.plugin.openTaskDetail(task.id); });
        }
        if (activeTasks.length > 3) cell.createSpan({ text: `+${activeTasks.length - 3}`, cls: "jam-deck-calendar-more" });
      }
    }
    const overdueCount = dueTasks.filter((task) => task.status === "active" && task.dueDate < todayKey).length;
    body.createDiv({ text: `四周内截止 ${rangeTaskCount} 项${overdueCount ? ` · 已逾期 ${overdueCount}` : ""}`, cls: "jam-deck-calendar-foot" });
  }

  showCanvasEmbedState(host, widget, message, canRetry) {
    host.empty();
    host.classList.remove("is-loading", "is-ready");
    host.addClass("is-fallback");
    const state = host.createDiv({ cls: "jam-deck-canvas-embed-state" });
    state.createDiv({ cls: "jam-deck-canvas-embed-state-icon", text: "◎" });
    state.createDiv({ cls: "jam-deck-canvas-embed-state-title", text: message });
    if (widget.config && widget.config.filePath) state.createDiv({ cls: "jam-deck-canvas-embed-state-path", text: widget.config.filePath });
    const actions = state.createDiv({ cls: "jam-deck-canvas-embed-state-actions" });
    const choose = actions.createEl("button", { text: "选择 Canvas" });
    choose.addEventListener("click", () => new CanvasFilePickerModal(this.app, this.plugin, widget.id).open());
    if (canRetry) {
      const retry = actions.createEl("button", { text: "重新加载" });
      retry.addEventListener("click", () => {
        void this.canvasRuntime.destroy(widget.id).then(() => this.render());
      });
    }
    if (widget.config && widget.config.filePath) {
      const open = actions.createEl("button", { text: "原生打开" });
      open.addEventListener("click", () => this.plugin.openCanvasFile(widget.config.filePath));
    }
  }

  renderCanvasEmbed(body, widget) {
    const path = widget.config && typeof widget.config.filePath === "string" ? widget.config.filePath : "";
    if (!path) {
      void this.canvasRuntime.destroy(widget.id);
      const host = body.createDiv({ cls: "jam-deck-canvas-embed-host" });
      this.showCanvasEmbedState(host, widget, "选择一个 Canvas 放进工作台", false);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || file.extension !== "canvas") {
      void this.canvasRuntime.destroy(widget.id);
      const host = body.createDiv({ cls: "jam-deck-canvas-embed-host" });
      this.showCanvasEmbedState(host, widget, "Canvas 文件不存在", false);
      return;
    }
    const host = body.createDiv({ cls: "jam-deck-canvas-embed-host is-loading" });
    host.createDiv({ cls: "jam-deck-canvas-embed-loading", text: "正在启动可编辑 Canvas…" });
    void this.canvasRuntime.mount(widget, host, file, (error) => {
      if (!host.isConnected) return;
      const detail = error && error.message ? `：${error.message}` : "";
      this.showCanvasEmbedState(host, widget, `Canvas 工作区启动失败${detail}`, true);
    });
  }

  renderCanvasLauncher(body) {
    const canvases = this.app.vault.getFiles()
      .filter((file) => file.extension === "canvas")
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 6);
    if (!canvases.length) {
      body.createDiv({ text: "Vault 内暂无 Canvas 文件", cls: "jam-deck-empty" });
      return;
    }
    const list = body.createDiv({ cls: "jam-deck-canvas-list" });
    for (const file of canvases) {
      const button = list.createEl("button", { text: file.basename, cls: "jam-deck-canvas-item" });
      button.addEventListener("click", async () => {
        await this.app.workspace.getLeaf("tab").openFile(file);
      });
    }
  }

  renderBrowser(body, widget) {
    const url = (widget.config && widget.config.url) || "";
    if (!url) {
      const empty = body.createDiv({ cls: "jam-deck-browser-empty" });
      empty.createDiv({ text: "尚未设置网址" });
      const button = empty.createEl("button", { text: "设置 URL", cls: "jam-deck-primary-button" });
      button.addEventListener("click", () => this.plugin.configureBrowser(widget.id));
      return;
    }
    const frame = body.createEl("iframe", {
      cls: "jam-deck-browser-frame",
      attr: { src: url, title: "Jam Deck browser", sandbox: "allow-scripts allow-forms allow-same-origin allow-popups" },
    });
    const fallback = body.createEl("a", { text: "网页无法显示？在系统浏览器打开", cls: "jam-deck-browser-fallback", attr: { href: url } });
    fallback.addEventListener("click", (event) => {
      event.preventDefault();
      window.open(url, "_blank");
    });
  }

  renderLauncher(body, widget) {
    this.plugin.enableLauncherDrop(body, widget.id);
    const shortcuts = (widget.config && widget.config.shortcuts) || [];
    if (!shortcuts.length) {
      const empty = body.createDiv({ cls: "jam-deck-empty" });
      empty.createDiv({ text: "拖入文件、文件夹或剪贴板网页链接\n也可点击标题栏 + 添加" });
      return;
    }

    const grid = body.createDiv({ cls: "jam-deck-launcher-grid" });
    const live = body.createDiv({ cls: "jam-deck-launcher-live", attr: { "aria-live": "polite", "aria-atomic": "true" } });
    for (const shortcut of shortcuts) {
      const target = this.plugin.getShortcutTarget(shortcut);
      const isUrl = this.plugin.isUrlShortcut(shortcut);
      const item = grid.createDiv({
        cls: `jam-deck-launcher-item${isUrl ? " is-url" : ""}`,
        attr: {
          title: `${target}${isUrl ? "\n域名名称与图标由 Jam Deck 本地生成" : ""}\nAlt + 方向键可排序`,
          tabindex: "0",
          role: "button",
          draggable: "true",
          "aria-label": `${shortcut.name}，${isUrl ? "网页快捷方式" : shortcut.isFolder ? "文件夹快捷方式" : "本地快捷方式"}。Alt 加方向键可调整顺序`,
        },
      });
      item.dataset.shortcutId = shortcut.id;

      const iconWrap = item.createDiv({ cls: "jam-deck-launcher-icon" });
      if (isUrl) {
        const visual = this.plugin.getUrlShortcutVisual(shortcut);
        iconWrap.addClass("is-domain");
        iconWrap.addClass(`is-tone-${visual.tone}`);
        if (visual.label) iconWrap.createSpan({ text: visual.label, cls: "jam-deck-launcher-domain-letter", attr: { "aria-hidden": "true" } });
        else {
          const globe = iconWrap.createSpan({ cls: "jam-deck-launcher-domain-fallback", attr: { "aria-hidden": "true" } });
          setIcon(globe, "globe-2");
        }
      } else {
        const resolvedIconPath = this.plugin.resolveShortcutIconPath(shortcut);
        if (resolvedIconPath) {
          const src = this.app.vault.adapter.getResourcePath(resolvedIconPath);
          const image = iconWrap.createEl("img", { attr: { src, loading: "lazy", decoding: "async", alt: "" } });
          image.addEventListener("error", () => {
            image.remove();
            if (!iconWrap.querySelector(".jam-deck-launcher-fallback")) iconWrap.createSpan({ text: shortcut.isFolder ? "📁" : "📦", cls: "jam-deck-launcher-fallback" });
          }, { once: true });
        } else {
          iconWrap.createSpan({ text: shortcut.isFolder ? "📁" : "📦", cls: "jam-deck-launcher-fallback" });
        }
      }

      item.createSpan({ text: shortcut.name, cls: "jam-deck-launcher-name" });

      item.addEventListener("click", (event) => {
        if (this.launcherSuppressClick === shortcut.id) {
          event.preventDefault();
          this.launcherSuppressClick = null;
          return;
        }
        this.plugin.openShortcut(shortcut);
      });

      this.enableLauncherItemReorder(item, grid, live, widget, shortcut, shortcuts);

      if (this.plugin.settings.editMode) {
        const edit = item.createEl("button", { text: "编辑", cls: "jam-deck-launcher-edit is-edit" });
        edit.addEventListener("click", (event) => {
          event.stopPropagation();
          new ShortcutEditorModal(this.app, this.plugin, widget.id, shortcut).open();
        });
      }
      const del = item.createEl("button", { text: "×", cls: "jam-deck-launcher-edit is-danger", attr: { type: "button", title: "删除快捷方式", "aria-label": `删除快捷方式：${shortcut.name}` } });
      del.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (window.confirm(`删除快捷方式“${shortcut.name}”？\n\n只会从 Jam Deck 移除，不会删除原文件或文件夹。`)) await this.plugin.deleteShortcut(widget.id, shortcut.id);
      });
    }
    this.enableLauncherGridEndDrop(grid, live, widget);
  }

  renderMusicPlayer(body, widget) {
    body.addClass("jam-deck-music-body");
    const player = body.createDiv({
      cls: "jam-deck-music-player",
      attr: { tabindex: "0", role: "group", "aria-label": "音乐播放器" },
    });
    player.dataset.widgetId = widget.id;

    const sourceControl = player.createDiv({ cls: "jam-deck-music-source-control" });
    const sourceButton = sourceControl.createEl("button", {
      cls: "jam-deck-music-source-button",
      attr: {
        type: "button",
        title: "选择音源",
        "aria-label": "选择音源",
        "aria-haspopup": "menu",
        "aria-expanded": "false",
      },
    });
    setIcon(sourceButton, "audio-lines");
    const sourceMenu = sourceControl.createDiv({
      cls: "jam-deck-music-source-menu",
      attr: { role: "menu", "aria-label": "系统媒体音源" },
    });
    sourceMenu.hidden = true;

    const hero = player.createDiv({ cls: "jam-deck-music-hero" });
    const discStage = hero.createDiv({ cls: "jam-deck-music-disc-stage", attr: { "aria-hidden": "true" } });
    const disc = discStage.createDiv({ cls: "jam-deck-music-disc" });
    disc.createDiv({ cls: "jam-deck-music-disc-grooves" });
    const cover = disc.createEl("img", {
      cls: "jam-deck-music-cover",
      attr: { alt: "", draggable: "false", decoding: "async" },
    });
    disc.createSpan({ cls: "jam-deck-music-cover-fallback", text: "♫" });
    disc.createSpan({ cls: "jam-deck-music-spindle" });
    const tonearm = discStage.createDiv({ cls: "jam-deck-music-tonearm", attr: { "aria-hidden": "true" } });
    tonearm.createSpan({ cls: "jam-deck-music-tonearm-pivot" });
    tonearm.createSpan({ cls: "jam-deck-music-tonearm-shaft" });
    tonearm.createSpan({ cls: "jam-deck-music-tonearm-head" });

    const meta = hero.createDiv({ cls: "jam-deck-music-meta" });
    const closeSourceMenu = (restoreFocus = false) => {
      sourceMenu.hidden = true;
      sourceButton.setAttribute("aria-expanded", "false");
      if (restoreFocus) sourceButton.focus();
    };
    const openSourceMenu = () => {
      this.rebuildMusicSourceMenu(player, widget);
      if (!sourceMenu.querySelector("button")) return;
      sourceMenu.hidden = false;
      sourceButton.setAttribute("aria-expanded", "true");
      const current = sourceMenu.querySelector('[aria-checked="true"]:not(:disabled)')
        || sourceMenu.querySelector("button:not(:disabled)");
      if (current) current.focus();
    };
    sourceButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (sourceMenu.hidden) openSourceMenu();
      else closeSourceMenu(true);
    });
    sourceMenu.addEventListener("keydown", (event) => {
      const items = Array.from(sourceMenu.querySelectorAll("button:not(:disabled)"));
      const index = items.indexOf(sourceMenu.ownerDocument.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        closeSourceMenu(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !items.length) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    });
    sourceControl.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!sourceControl.contains(sourceControl.ownerDocument.activeElement)) closeSourceMenu(false);
      }, 0);
    });
    meta.createDiv({ cls: "jam-deck-music-title", text: "等待播放" });
    meta.createDiv({ cls: "jam-deck-music-artist", text: "打开本地音乐软件即可显示" });

    const transportStage = player.createDiv({ cls: "jam-deck-music-transport-stage" });
    const timeline = transportStage.createDiv({ cls: "jam-deck-music-timeline" });
    const progress = timeline.createEl("input", {
      cls: "jam-deck-music-progress",
      attr: { type: "range", min: "0", max: "0", step: "250", value: "0", "aria-label": "播放进度" },
    });
    const times = timeline.createDiv({ cls: "jam-deck-music-times" });
    times.createSpan({ cls: "jam-deck-music-time-current", text: "--:--" });
    times.createSpan({ cls: "jam-deck-music-time-total", text: "--:--" });
    progress.addEventListener("pointerdown", () => {
      player._jamDeckMusicSeeking = true;
      player._jamDeckMusicSeekTrack = this.plugin.musicSnapshot.selected && this.plugin.musicSnapshot.selected.trackKey || "";
    });
    progress.addEventListener("input", () => {
      if (!player._jamDeckMusicSeeking) {
        player._jamDeckMusicSeekTrack = this.plugin.musicSnapshot.selected && this.plugin.musicSnapshot.selected.trackKey || "";
      }
      player._jamDeckMusicSeeking = true;
      player._jamDeckMusicSeekValue = Math.round(Number(progress.value) || 0);
      const current = player.querySelector(".jam-deck-music-time-current");
      if (current) current.textContent = jamDeckFormatMediaTime(player._jamDeckMusicSeekValue);
      const max = Math.max(0, Number(progress.max) || 0);
      progress.style.setProperty("--jd-music-progress", max > 0 ? `${player._jamDeckMusicSeekValue / max * 100}%` : "0%");
    });
    progress.addEventListener("change", async () => {
      const value = Math.round(Number(progress.value) || 0);
      player._jamDeckMusicSeeking = false;
      player._jamDeckMusicSeekValue = null;
      await this.plugin.controlMusic(widget.id, "seek", value);
    });
    progress.addEventListener("pointercancel", () => {
      player._jamDeckMusicSeeking = false;
      player._jamDeckMusicSeekValue = null;
      this.updateMusicPlayerEl(player, widget);
    });

    const controls = transportStage.createDiv({ cls: "jam-deck-music-controls" });
    const makeControl = (role, icon, label, handler, extraClass = "") => {
      const button = controls.createEl("button", {
        cls: `jam-deck-music-control ${extraClass}`.trim(),
        attr: { type: "button", "data-role": role, title: label, "aria-label": label },
      });
      setIcon(button, icon);
      button.addEventListener("click", handler);
      return button;
    };
    makeControl("previous", "skip-back", "上一首", () => this.plugin.controlMusic(widget.id, "previous"));
    makeControl("toggle", "play", "播放", () => this.plugin.controlMusic(widget.id, "toggle"), "is-primary");
    makeControl("next", "skip-forward", "下一首", () => this.plugin.controlMusic(widget.id, "next"));
    player.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch" && !event.target.closest("button, input")) player.focus();
    });

    cover.addEventListener("error", () => {
      cover.removeAttribute("src");
      player.removeClass("has-artwork");
    });
    this.updateMusicPlayerEl(player, widget);
    void this.plugin.ensureMusicMedia();
  }

  rebuildMusicSourceMenu(player, widget) {
    const menu = player.querySelector(".jam-deck-music-source-menu");
    if (!menu) return;
    const snapshot = this.plugin.musicSnapshot || {};
    const selected = snapshot.selected || null;
    const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
    menu.empty();
    for (const session of sessions) {
      const info = jamDeckMediaProvider(session.sourceAppId);
      const ambiguous = !!session.ambiguous || Number(session.sessionCount) !== 1;
      const item = menu.createEl("button", {
        text: ambiguous ? `${info.label}（多个会话）` : info.label,
        cls: "jam-deck-music-source-item",
        attr: {
          type: "button",
          role: "menuitemradio",
          "aria-checked": selected && selected.sourceAppId === session.sourceAppId ? "true" : "false",
          "aria-label": ambiguous ? `${info.label}，存在多个会话，暂不可选择` : `选择 ${info.label}`,
        },
      });
      item.disabled = ambiguous;
      item.addEventListener("click", async () => {
        await this.plugin.setMusicSource(widget.id, session.sourceAppId);
        menu.hidden = true;
        const button = player.querySelector(".jam-deck-music-source-button");
        if (button) {
          button.setAttribute("aria-expanded", "false");
          button.focus();
        }
      });
    }
    menu.dataset.signature = sessions.map((item) => `${item.sourceAppId}:${item.sessionCount}:${item.playbackStatus}`).join("|");
  }

  updateMusicPlayerEl(player, widget) {
    if (!player || !widget) return;
    const snapshot = this.plugin.musicSnapshot || {};
    const selected = snapshot.selected || null;
    const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
    const connection = snapshot.connection || "idle";
    const playing = selected && selected.playbackStatus === "playing";
    const pending = this.plugin.musicPending || null;
    player.toggleClass("is-playing", !!playing);
    player.toggleClass("is-pending", !!pending);
    player.toggleClass("is-disconnected", connection !== "ready");

    const title = player.querySelector(".jam-deck-music-title");
    const artist = player.querySelector(".jam-deck-music-artist");
    if (title) {
      title.textContent = selected && selected.title ? selected.title : "等待播放";
      title.setAttribute("title", title.textContent);
    }
    if (artist) {
      artist.textContent = selected && selected.artist ? selected.artist : selected ? "未知歌手" : "打开本地音乐软件即可显示";
      artist.setAttribute("title", artist.textContent);
    }
    const sourceButton = player.querySelector(".jam-deck-music-source-button");
    if (sourceButton) {
      const provider = jamDeckMediaProvider(selected && selected.sourceAppId);
      const label = selected ? provider.label : "未连接音源";
      sourceButton.setAttribute("title", label);
      sourceButton.setAttribute("aria-label", `选择音源，当前${label}`);
      sourceButton.disabled = !sessions.length || connection !== "ready";
    }
    const sourceMenu = player.querySelector(".jam-deck-music-source-menu");
    if (sourceMenu && !sourceMenu.hidden) {
      const signature = sessions.map((item) => `${item.sourceAppId}:${item.sessionCount}:${item.playbackStatus}`).join("|");
      if (sourceMenu.dataset.signature !== signature) {
        this.rebuildMusicSourceMenu(player, widget);
        sourceMenu.dataset.signature = signature;
      }
    }

    const cover = player.querySelector(".jam-deck-music-cover");
    if (cover) {
      const artworkUrl = selected && selected.artworkUrl ? selected.artworkUrl : "";
      if (artworkUrl && cover.getAttribute("src") !== artworkUrl) cover.setAttribute("src", artworkUrl);
      if (!artworkUrl) cover.removeAttribute("src");
      player.toggleClass("has-artwork", !!artworkUrl);
    }

    let position = jamDeckProjectedMediaPosition(snapshot);
    const duration = selected && selected.timeline ? Math.max(0, Number(selected.timeline.durationMs) || 0) : 0;
    const trackChangedWhileSeeking = player._jamDeckMusicSeeking
      && player._jamDeckMusicSeekTrack
      && selected && selected.trackKey !== player._jamDeckMusicSeekTrack;
    if (trackChangedWhileSeeking) {
      player._jamDeckMusicSeeking = false;
      player._jamDeckMusicSeekValue = null;
    }
    if (player._jamDeckMusicSeeking && Number.isFinite(player._jamDeckMusicSeekValue)) {
      position = player._jamDeckMusicSeekValue;
    } else if (pending && pending.action === "seek" && pending.trackKey === (selected && selected.trackKey)) {
      position = pending.targetPositionMs;
    }
    const ratio = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
    const progress = player.querySelector(".jam-deck-music-progress");
    if (progress) {
      progress.max = String(Math.round(duration));
      if (!player._jamDeckMusicSeeking) progress.value = String(Math.round(Math.min(position, duration || position)));
      progress.disabled = !selected || !selected.capabilities || !selected.capabilities.canSeek || duration <= 0 || connection !== "ready" || !!pending;
      progress.style.setProperty("--jd-music-progress", `${ratio * 100}%`);
    }
    const current = player.querySelector(".jam-deck-music-time-current");
    const total = player.querySelector(".jam-deck-music-time-total");
    if (current) current.textContent = duration > 0 ? jamDeckFormatMediaTime(position) : "--:--";
    if (total) total.textContent = duration > 0 ? jamDeckFormatMediaTime(duration) : "--:--";

    const capabilities = selected && selected.capabilities || {};
    const previous = player.querySelector('[data-role="previous"]');
    const toggle = player.querySelector('[data-role="toggle"]');
    const next = player.querySelector('[data-role="next"]');
    if (previous) previous.disabled = !capabilities.canPrevious || connection !== "ready" || !!pending;
    if (next) next.disabled = !capabilities.canNext || connection !== "ready" || !!pending;
    if (toggle) {
      const canToggle = capabilities.canToggle || (playing ? capabilities.canPause : capabilities.canPlay);
      const canLaunch = !selected && !!(this.plugin.settings.musicLauncher && this.plugin.settings.musicLauncher.lastConnectedProvider);
      toggle.disabled = connection !== "ready" || !!pending || (!canToggle && !canLaunch);
      toggle.empty();
      setIcon(toggle, playing ? "pause" : "play");
      toggle.setAttribute("title", playing ? "暂停" : "播放");
      toggle.setAttribute("aria-label", playing ? "暂停" : "播放");
    }
  }

  updateMusicPlayers() {
    for (const player of this.contentEl.querySelectorAll(".jam-deck-music-player")) {
      const widgetId = player.dataset.widgetId;
      const widget = this.plugin.settings.widgets.find((item) => item.id === widgetId && item.type === "music");
      if (widget) this.updateMusicPlayerEl(player, widget);
    }
  }

  clearLauncherDropIndicators(grid) {
    grid.removeClass("is-insert-at-end");
    for (const element of grid.querySelectorAll(".is-insert-before, .is-insert-after")) {
      element.removeClass("is-insert-before");
      element.removeClass("is-insert-after");
    }
  }

  launcherPayloadMatches(payload, widgetId) {
    return payload && payload.v === 1 && payload.plugin === "jam-deck"
      && payload.sessionToken === this.launcherSessionToken
      && payload.viewId === this.launcherViewId
      && payload.widgetId === widgetId;
  }

  enableLauncherItemReorder(item, grid, live, widget, shortcut, shortcuts) {
    item.addEventListener("dragstart", (event) => {
      if (event.target && event.target.closest && event.target.closest("button")) {
        event.preventDefault();
        return;
      }
      const payload = { v: 1, plugin: "jam-deck", sessionToken: this.launcherSessionToken, viewId: this.launcherViewId, widgetId: widget.id, shortcutId: shortcut.id };
      this.launcherDragState = payload;
      this.launcherSuppressClick = shortcut.id;
      item.addClass("is-reordering");
      try { event.dataTransfer.setData(SHORTCUT_DRAG_MIME, JSON.stringify(payload)); } catch (error) {}
      try { event.dataTransfer.setData("text/plain", this.plugin.getShortcutTarget(shortcut)); } catch (error) {}
      event.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragover", (event) => {
      if (!this.launcherPayloadMatches(this.launcherDragState, widget.id) || this.launcherDragState.shortcutId === shortcut.id) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      this.clearLauncherDropIndicators(grid);
      const rect = item.getBoundingClientRect();
      const after = event.clientX >= rect.left + rect.width / 2;
      item.addClass(after ? "is-insert-after" : "is-insert-before");
      this.launcherDragState.after = after;
      this.launcherDragState.targetId = shortcut.id;
    });
    item.addEventListener("drop", async (event) => {
      if (!this.launcherPayloadMatches(this.launcherDragState, widget.id) || this.launcherDragState.shortcutId === shortcut.id) return;
      event.preventDefault();
      event.stopPropagation();
      const payload = this.launcherDragState;
      this.clearLauncherDropIndicators(grid);
      this.launcherDragState = null;
      const result = await this.plugin.reorderShortcut(widget.id, payload.shortcutId, payload.targetId, payload.after);
      this.announceLauncherMove(live, result, payload.shortcutId);
    });
    item.addEventListener("dragend", () => {
      this.clearLauncherDropIndicators(grid);
      item.removeClass("is-reordering");
      this.launcherDragState = null;
      window.setTimeout(() => { if (this.launcherSuppressClick === shortcut.id) this.launcherSuppressClick = null; }, 350);
    });
    item.addEventListener("keydown", async (event) => {
      if (event.target !== item) return;
      if ((event.key === "Enter" || event.key === " ") && !event.altKey) {
        event.preventDefault();
        this.plugin.openShortcut(shortcut);
        return;
      }
      if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const from = shortcuts.findIndex((entry) => entry.id === shortcut.id);
      if (from < 0) return;
      const targetIndex = event.key === "Home" ? 0 : event.key === "End" ? shortcuts.length - 1
        : from + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
      if (targetIndex < 0 || targetIndex >= shortcuts.length || targetIndex === from) return;
      const target = shortcuts[targetIndex];
      const result = await this.plugin.reorderShortcut(widget.id, shortcut.id, target.id, targetIndex > from);
      this.announceLauncherMove(live, result, shortcut.id);
    });
  }

  enableLauncherGridEndDrop(grid, live, widget) {
    grid.addEventListener("dragover", (event) => {
      if (!this.launcherPayloadMatches(this.launcherDragState, widget.id) || event.target.closest(".jam-deck-launcher-item")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      this.clearLauncherDropIndicators(grid);
      this.launcherDragState.targetId = null;
      this.launcherDragState.after = true;
      grid.addClass("is-insert-at-end");
    });
    grid.addEventListener("drop", async (event) => {
      if (!this.launcherPayloadMatches(this.launcherDragState, widget.id) || event.target.closest(".jam-deck-launcher-item")) return;
      event.preventDefault();
      event.stopPropagation();
      const payload = this.launcherDragState;
      this.clearLauncherDropIndicators(grid);
      this.launcherDragState = null;
      const result = await this.plugin.reorderShortcut(widget.id, payload.shortcutId, null, true);
      this.announceLauncherMove(live, result, payload.shortcutId);
    });
  }

  announceLauncherMove(live, result, shortcutId) {
    if (!result) return;
    window.setTimeout(() => {
      const moved = Array.from(this.contentEl.querySelectorAll(".jam-deck-launcher-item")).find((item) => item.dataset.shortcutId === shortcutId);
      const currentLive = moved && moved.closest(".jam-deck-widget")?.querySelector(".jam-deck-launcher-live");
      (currentLive || live).setText(result.message || "");
      if (moved) moved.focus();
    }, 0);
  }

  clearLayoutInsertIndicators(grid) {
    if (!grid) return;
    const overlay = grid.querySelector(".jam-deck-layout-slot");
    if (overlay) {
      overlay.removeClass("is-visible");
      overlay.removeAttribute("data-axis");
    }
    const seamClasses = [
      "is-layout-seam-top",
      "is-layout-seam-bottom",
      "is-layout-seam-left",
      "is-layout-seam-right",
    ];
    for (const element of grid.querySelectorAll(seamClasses.map((name) => `.${name}`).join(", "))) {
      for (const name of seamClasses) element.removeClass(name);
    }
  }

  ensureLayoutSashLayer(grid) {
    let layer = grid.querySelector(".jam-deck-sash-layer");
    if (!layer) {
      layer = grid.createDiv({ cls: "jam-deck-sash-layer", attr: { "aria-hidden": "true" } });
    }
    return layer;
  }

  placeLayoutSashHandle(handle, node, sashMap, widgetEls, gridRect) {
    const pointFromVertical = (sash, atY) => {
      const before = widgetEls.get(sash.beforeIds[0]);
      const after = widgetEls.get(sash.afterIds[0]);
      if (!before || !after) return null;
      const br = before.getBoundingClientRect();
      const ar = after.getBoundingClientRect();
      const overlapTop = Math.max(br.top, ar.top);
      const overlapBottom = Math.min(br.bottom, ar.bottom);
      if (overlapBottom <= overlapTop) return null;
      const yRatio = (atY - sash.start) / Math.max(0.0001, sash.end - sash.start);
      return {
        x: (br.right + ar.left) / 2 - gridRect.left,
        y: overlapTop + (overlapBottom - overlapTop) * Math.min(1, Math.max(0, yRatio)) - gridRect.top,
      };
    };
    const pointFromHorizontal = (sash, atX) => {
      const before = widgetEls.get(sash.beforeIds[0]);
      const after = widgetEls.get(sash.afterIds[0]);
      if (!before || !after) return null;
      const br = before.getBoundingClientRect();
      const ar = after.getBoundingClientRect();
      const overlapLeft = Math.max(br.left, ar.left);
      const overlapRight = Math.min(br.right, ar.right);
      if (overlapRight <= overlapLeft) return null;
      const xRatio = (atX - sash.start) / Math.max(0.0001, sash.end - sash.start);
      return {
        x: overlapLeft + (overlapRight - overlapLeft) * Math.min(1, Math.max(0, xRatio)) - gridRect.left,
        y: (br.bottom + ar.top) / 2 - gridRect.top,
      };
    };

    let point = null;
    if (node.axis === "xy") {
      const sashX = sashMap.get(node.sashX);
      const sashY = sashMap.get(node.sashY);
      const fromX = sashX ? pointFromVertical(sashX, node.y) : null;
      const fromY = sashY ? pointFromHorizontal(sashY, node.x) : null;
      if (fromX && fromY) point = { x: fromX.x, y: fromY.y };
      else point = fromX || fromY;
    } else if (node.axis === "x") {
      point = pointFromVertical(sashMap.get(node.sashX), node.y);
    } else if (node.axis === "y") {
      point = pointFromHorizontal(sashMap.get(node.sashY), node.x);
    }
    if (!point) {
      handle.style.display = "none";
      return;
    }
    handle.style.display = "";
    handle.style.left = `${point.x}px`;
    handle.style.top = `${point.y}px`;
  }

  enableLayoutSashes(grid) {
    if (!grid) return;
    const layer = this.ensureLayoutSashLayer(grid);
    layer.empty();
    const baseline = this.plugin.settings.widgets.map((item) => ({ ...item }));
    const { sashes, nodes } = jamDeckCollectLayoutNodes(baseline);
    if (!nodes.length) return;

    const sashMap = new Map(sashes.map((sash) => [sash.id, sash]));
    const widgetEls = new Map(
      Array.from(grid.querySelectorAll(".jam-deck-widget[data-widget-id]"))
        .map((el) => [el.dataset.widgetId, el])
    );
    const gridRect = grid.getBoundingClientRect();
    let active = null;

    const applyLive = (layout) => {
      const byId = new Map(layout.map((item) => [item.id, item]));
      for (const [id, el] of widgetEls) {
        const next = byId.get(id);
        if (!next) continue;
        el.style.gridColumn = `${next.x} / span ${next.w}`;
        el.style.gridRow = `${next.y} / span ${next.h}`;
        const nextCompact = jamDeckWidgetIsCompact(next);
        const committedCompact = el.hasClass("is-compact");
        el.toggleClass("is-compact-preview", nextCompact && !committedCompact);
        el.toggleClass("is-compact-live-full", !nextCompact && committedCompact);
      }
    };

    const reposition = () => {
      const rect = grid.getBoundingClientRect();
      for (const handle of layer.querySelectorAll(".jam-deck-sash-handle")) {
        const node = nodes.find((item) => item.id === handle.dataset.nodeId);
        if (!node) continue;
        this.placeLayoutSashHandle(handle, node, sashMap, widgetEls, rect);
      }
    };

    for (const node of nodes) {
      const handle = layer.createDiv({
        cls: `jam-deck-sash-handle is-axis-${node.axis}`,
        attr: {
          "data-node-id": node.id,
          "data-axis": node.axis,
          title: node.axis === "xy"
            ? "拖动调整四周组件间距"
            : node.axis === "x"
              ? "左右拖动调整间距"
              : "上下拖动调整间距",
          role: "slider",
          tabindex: "0",
        },
      });
      handle.createDiv({ cls: "jam-deck-sash-dot" });
      this.placeLayoutSashHandle(handle, node, sashMap, widgetEls, gridRect);

      handle.addEventListener("pointerdown", (event) => {
        if (event.button != null && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        handle.setPointerCapture(event.pointerId);
        grid.addClass("is-sash-dragging");
        handle.addClass("is-dragging");
        active = {
          node,
          startX: event.clientX,
          startY: event.clientY,
          lastLayout: baseline.map((item) => ({ ...item })),
        };
      });
    }

    const onMove = (event) => {
      if (!active) return;
      const rect = grid.getBoundingClientRect();
      const dx = Math.round(((event.clientX - active.startX) / Math.max(1, rect.width)) * GRID_COLS);
      const dy = Math.round(((event.clientY - active.startY) / Math.max(1, rect.height)) * GRID_ROWS);
      let layout = baseline.map((item) => ({ ...item }));
      if ((active.node.axis === "x" || active.node.axis === "xy") && dx) {
        const sash = sashMap.get(active.node.sashX);
        const next = jamDeckApplySashDelta(layout, sash, dx);
        if (next) layout = next;
      }
      if ((active.node.axis === "y" || active.node.axis === "xy") && dy) {
        const sash = sashMap.get(active.node.sashY);
        const next = jamDeckApplySashDelta(layout, sash, dy);
        if (next) layout = next;
      }
      active.lastLayout = layout;
      if (!this._sashFrame) {
        this._sashFrame = window.requestAnimationFrame(() => {
          this._sashFrame = 0;
          if (!active) return;
          applyLive(active.lastLayout);
          reposition();
        });
      }
    };

    const onUp = async (event) => {
      if (!active) return;
      const finished = active;
      active = null;
      if (this._sashFrame) {
        window.cancelAnimationFrame(this._sashFrame);
        this._sashFrame = 0;
      }
      grid.removeClass("is-sash-dragging");
      for (const handle of layer.querySelectorAll(".jam-deck-sash-handle.is-dragging")) {
        handle.removeClass("is-dragging");
      }
      const baseById = new Map(baseline.map((item) => [item.id, item]));
      const didChange = finished.lastLayout.some((item) => {
        const base = baseById.get(item.id);
        return !base || base.x !== item.x || base.y !== item.y || base.w !== item.w || base.h !== item.h;
      });
      if (didChange) {
        await this.plugin.commitWidgetLayout(finished.lastLayout);
        return;
      }
      applyLive(baseline);
      reposition();
    };

    const probe = (event) => {
      if (active) return;
      const rect = grid.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      for (const handle of layer.querySelectorAll(".jam-deck-sash-handle")) {
        const hx = Number.parseFloat(handle.style.left) || 0;
        const hy = Number.parseFloat(handle.style.top) || 0;
        const near = Math.hypot(x - hx, y - hy) <= 18;
        handle.toggleClass("is-hot", near);
      }
    };
    const leave = () => {
      if (active) return;
      for (const handle of layer.querySelectorAll(".jam-deck-sash-handle.is-hot")) {
        handle.removeClass("is-hot");
      }
    };

    this.cleanupLayoutSashes();
    this._sashMove = onMove;
    this._sashUp = onUp;
    this._sashProbe = probe;
    this._sashLeave = leave;
    this._sashGrid = grid;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    grid.addEventListener("pointermove", probe);
    grid.addEventListener("pointerleave", leave);
    // Reposition after layout/paint so bounding boxes match the painted grid.
    window.requestAnimationFrame(reposition);
  }

  ensureLayoutShiftHint(root) {
    let hint = root && root.querySelector(".jam-deck-layout-shift-hint");
    if (!hint && root) {
      hint = root.createDiv({
        cls: "jam-deck-layout-shift-hint",
        attr: { "aria-hidden": "true" },
      });
      hint.createSpan({
        cls: "jam-deck-layout-shift-hint-text",
        text: "按住 Shift 可延伸填充到画布边缘",
      });
    }
    return hint;
  }

  setLayoutShiftHintVisible(hint, visible) {
    if (!hint) return;
    hint.toggleClass("is-visible", !!visible);
  }

  applyLayoutSeamPreview(grid, seam) {
    if (!grid || !seam) return;
    const nodes = Array.from(grid.querySelectorAll(".jam-deck-widget[data-widget-id]"));
    const findNode = (id) => nodes.find((node) => node.dataset.widgetId === id);
    const before = findNode(seam.beforeId);
    const after = findNode(seam.afterId);
    if (seam.axis === "y") {
      if (before) before.addClass("is-layout-seam-bottom");
      if (after) after.addClass("is-layout-seam-top");
    } else if (seam.axis === "x") {
      if (before) before.addClass("is-layout-seam-right");
      if (after) after.addClass("is-layout-seam-left");
    }
  }

  applyNeighborLayoutPreview(grid, layout, movingId) {
    if (!grid || !Array.isArray(layout)) return;
    const byId = new Map(layout.map((item) => [item.id, item]));
    for (const node of grid.querySelectorAll(".jam-deck-widget[data-widget-id]")) {
      const id = node.dataset.widgetId;
      if (id === movingId) continue;
      const next = byId.get(id);
      if (!next) continue;
      node.style.gridColumn = `${next.x} / span ${next.w}`;
      node.style.gridRow = `${next.y} / span ${next.h}`;
      const nextCompact = jamDeckWidgetIsCompact(next);
      const committedCompact = node.hasClass("is-compact");
      node.toggleClass("is-compact-preview", nextCompact && !committedCompact);
      node.toggleClass("is-compact-live-full", !nextCompact && committedCompact);
    }
  }

  ensureLayoutSlotOverlay(grid) {
    let overlay = grid.querySelector(".jam-deck-layout-slot");
    if (!overlay) {
      overlay = grid.createDiv({ cls: "jam-deck-layout-slot", attr: { "aria-hidden": "true" } });
    }
    return overlay;
  }

  applyLayoutSlotPreview(grid, slot) {
    if (!grid) return;
    this.clearLayoutInsertIndicators(grid);
    if (!slot) return;
    const overlay = this.ensureLayoutSlotOverlay(grid);
    overlay.style.gridColumn = `${slot.x} / span ${slot.w}`;
    overlay.style.gridRow = `${slot.y} / span ${slot.h}`;
    overlay.dataset.axis = slot.axis || "";
    overlay.addClass("is-visible");
  }

  enableDrag(handle, el, widget) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      event.preventDefault();
      const grid = el.parentElement;
      const rect = grid.getBoundingClientRect();
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const baseline = this.plugin.settings.widgets.map((item) => ({ ...item }));
      let lastCommitLayout = null;
      let lastPointer = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey };
      el.addClass("is-moving");
      grid.addClass("is-layout-dragging");
      this.ensureLayoutSlotOverlay(grid);
      const shiftHint = this.ensureLayoutShiftHint(this.contentEl);
      // Collapse the floating A to the minimum footprint for hover math and visual feedback.
      el.style.gridColumn = `${widget.x} / span ${JAM_DECK_WIDGET_MIN_W}`;
      el.style.gridRow = `${widget.y} / span ${JAM_DECK_WIDGET_MIN_H}`;
      if (!el.hasClass("is-compact")) el.addClass("is-compact-preview");

      const applyPreview = (pointer) => {
        const dx = pointer.clientX - startClientX;
        const dy = pointer.clientY - startClientY;
        el.style.transform = `translate3d(${dx}px, ${dy - 6}px, 0) scale(1.02)`;
        const colFloat = ((pointer.clientX - rect.left) / Math.max(1, rect.width)) * GRID_COLS + 1;
        const rowFloat = ((pointer.clientY - rect.top) / Math.max(1, rect.height)) * GRID_ROWS + 1;
        const shiftKey = !!pointer.shiftKey;
        const preview = jamDeckPreviewWidgetLayout(baseline, widget.id, {
          col: colFloat,
          row: rowFloat,
        }, { shiftKey });
        this.setLayoutShiftHintVisible(shiftHint, !shiftKey);
        el.removeClass("is-collision");
        if (preview.canCommit && preview.slot) {
          lastCommitLayout = preview.widgets;
          this.applyNeighborLayoutPreview(grid, baseline, widget.id);
          this.applyLayoutSlotPreview(grid, preview.slot);
        } else if (preview.canCommit && preview.seam) {
          lastCommitLayout = preview.widgets;
          this.applyNeighborLayoutPreview(grid, preview.widgets, widget.id);
          this.clearLayoutInsertIndicators(grid);
          this.applyLayoutSeamPreview(grid, preview.seam);
        } else {
          lastCommitLayout = null;
          this.applyNeighborLayoutPreview(grid, baseline, widget.id);
          this.clearLayoutInsertIndicators(grid);
        }
      };

      const move = (e) => {
        lastPointer = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
        applyPreview(lastPointer);
      };
      const onKey = (e) => {
        if (e.key !== "Shift") return;
        lastPointer = { ...lastPointer, shiftKey: e.type === "keydown" };
        applyPreview(lastPointer);
      };
      const up = async () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKey);
        el.style.transform = "";
        el.removeClass("is-moving");
        el.removeClass("is-collision");
        el.removeClass("is-compact-preview");
        grid.removeClass("is-layout-dragging");
        this.clearLayoutInsertIndicators(grid);
        this.setLayoutShiftHintVisible(shiftHint, false);
        if (lastCommitLayout) {
          await this.plugin.commitWidgetLayout(lastCommitLayout);
          return;
        }
        this.render();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      applyPreview(lastPointer);
    });
  }

}

class JamDeckPlugin extends Plugin {
  async onload() {
    this.settingsSaveQueue = Promise.resolve();
    this.shortcutMutationQueue = Promise.resolve();
    this.pendingShortcutUrls = new Set();
    this.archiveQueue = Promise.resolve();
    this.archivingTaskIds = new Set();
    this.countdownCompletionLocks = new Set();
    this.widgetRestoreLocks = new Set();
    this.mediaBridge = null;
    this.mediaPollBusy = false;
    this.musicPending = null;
    this.musicLastPollAt = 0;
    this.musicBridgeFailures = 0;
    this.musicBridgeRetryAt = 0;
    this.musicLaunchTimer = null;
    this.musicLaunchGeneration = 0;
    this.musicProviderSaveTimer = null;
    this.musicArtworkUrls = new Map();
    this.musicSnapshot = {
      connection: process.platform === "win32" ? "idle" : "unsupported",
      sessions: [],
      selected: null,
      receivedAt: Date.now(),
      revision: 0,
    };
    await this.loadSettings();
    await this.ensureClipboardDir();
    this.clipboardBusy = false;
    this.canvasInkOwners = new Map();
    this.primeClipboard();

    this.registerView(VIEW_TYPE, (leaf) => new JamDeckView(leaf, this));
    this.addRibbonIcon("layout-dashboard", "Open Jam Deck", () => this.openDeck());
    this.addCommand({ id: "open-jam-deck", name: "Open dashboard", callback: () => this.openDeck() });
    this.addCommand({ id: "toggle-edit-mode", name: "Toggle edit mode", callback: async () => {
      this.settings.editMode = !this.settings.editMode;
      await this.saveSettings();
      this.renderAllViews();
    }});
    this.addCommand({ id: "auto-arrange", name: "Auto arrange widgets", callback: () => this.autoArrange() });
    this.addCommand({ id: "clear-clipboard", name: "Clear clipboard history", callback: () => this.clearClipboard() });

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.handleCanvasFileRenamed(file, oldPath).catch((error) => console.error("jam-deck canvas rename sync failed", error));
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file && file.extension === "canvas") this.handleCanvasInkDeleted(file.path).catch((error) => console.error("jam-deck canvas ink delete sync failed", error));
      if (file && file.extension === "canvas" && this.hasCanvasEmbedPath(file.path)) this.renderAllViews();
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file && file.extension === "canvas" && this.hasCanvasEmbedPath(file.path)) this.renderAllViews();
    }));

    this.registerInterval(window.setInterval(() => this.pollClipboard(), this.settings.clipboardPollMs));
    this.registerInterval(window.setInterval(() => this.updateClockDisplays(), 1000));
    this.registerInterval(window.setInterval(() => this.pollMusicMedia(), 1000));
    this.registerInterval(window.setInterval(() => this.cleanupClipboard(), 60 * 60 * 1000));
    setTimeout(() => this.cleanupClipboard(), 3000);
    setTimeout(() => {
      this.migrateArchivedTaskAssets().catch((error) => console.error("jam-deck archived attachment migration failed", error));
    }, 4000);
    setTimeout(() => {
      this.resumePendingJournalOperations().catch((error) => console.error("jam-deck pending journal recovery failed", error));
    }, 5500);
  }

  onunload() {
    for (const owner of (this.canvasInkOwners || new Map()).values()) void owner.flush();
    void this.stopMusicMedia();
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => leaf.detach());
  }

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    this.settings.widgets = Array.isArray(this.settings.widgets) ? this.settings.widgets : DEFAULT_SETTINGS.widgets;
    this.settings.clipboardItems = Array.isArray(this.settings.clipboardItems) ? this.settings.clipboardItems : [];
    this.settings.deckTasks = Array.isArray(this.settings.deckTasks)
      ? this.settings.deckTasks.map((task) => this.normalizeDeckTask(task))
      : [];
    this.settings.musicLikes = Array.isArray(this.settings.musicLikes)
      ? this.settings.musicLikes.filter((value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)).slice(0, 500)
      : [];
    const lastConnectedProvider = this.settings.musicLauncher && this.settings.musicLauncher.lastConnectedProvider;
    this.settings.musicLauncher = {
      schemaVersion: 1,
      lastConnectedProvider: ["qqmusic", "netease", "qishui"].includes(lastConnectedProvider) ? lastConnectedProvider : null,
    };
    const savedVersion = saved ? Number(saved.dataVersion) || 0 : DEFAULT_SETTINGS.dataVersion;
    if (savedVersion < 4) {
      const previousWidgets = this.settings.widgets;
      // Existing decks were authored on a 12-column grid; keep their proportions on the denser grid.
      if (savedVersion > 0) {
        this.settings.widgets = jamDeckScaleWidgetColumns(this.settings.widgets, GRID_COLS / JAM_DECK_LEGACY_GRID_COLS);
      }
      this.settings.dataVersion = 4;
      try {
        await this.saveSettings();
      } catch (error) {
        this.settings.dataVersion = savedVersion;
        this.settings.widgets = previousWidgets;
        console.error("jam-deck settings migration failed", error);
        new Notice("Jam Deck：布局数据升级保存失败，本次仍会兼容读取");
      }
    }
  }

  async saveSettings() {
    const operation = this.settingsSaveQueue.then(() => this.saveData(this.settings));
    this.settingsSaveQueue = operation.catch(() => {});
    return operation;
  }

  normalizeDeckTask(task) {
    const source = task && typeof task === "object" ? task : {};
    return {
      ...source,
      id: source.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: typeof source.text === "string" ? source.text : "未命名待办",
      status: ["active", "completed", "archived"].includes(source.status) ? source.status : "active",
      createdAt: Number(source.createdAt) || Date.now(),
      completedAt: Number(source.completedAt) || null,
      archivedAt: Number(source.archivedAt) || null,
      description: typeof source.description === "string" ? source.description : "",
      links: Array.isArray(source.links) ? source.links : [],
      images: Array.isArray(source.images) ? source.images : [],
      category: ["work", "life"].includes(source.category) ? source.category : null,
      dueDate: this.isValidLocalDate(source.dueDate) ? source.dueDate : null,
      journalPath: typeof source.journalPath === "string" ? source.journalPath : null,
      archiveFormat: source.archiveFormat === "section-v2" ? "section-v2" : null,
      archiveTargetDate: typeof source.archiveTargetDate === "string" ? source.archiveTargetDate : null,
      archiveTargetPath: typeof source.archiveTargetPath === "string" ? source.archiveTargetPath : null,
      archiveRef: source.archiveRef && typeof source.archiveRef === "object" ? source.archiveRef : null,
      pendingJournalOp: source.pendingJournalOp && typeof source.pendingJournalOp === "object" ? source.pendingJournalOp : null,
      tombstone: source.tombstone === true,
    };
  }

  isValidLocalDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
  }

  resolveTaskCategory(task) {
    if (task && ["work", "life"].includes(task.category)) return task.category;
    return /【[^】]+】/.test(String(task && task.text || "")) ? "work" : "life";
  }

  formatLocalDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  getDeckTask(id) {
    return this.settings.deckTasks.find((task) => task.id === id) || null;
  }

  getSafeTaskLinks(task) {
    if (!task || !Array.isArray(task.links)) return [];
    return task.links.map((link, index) => {
      if (typeof link === "string") return { id: `link-${index}`, label: "", url: link };
      if (!link || typeof link.url !== "string") return null;
      return { id: link.id || `link-${index}`, label: typeof link.label === "string" ? link.label : "", url: link.url };
    }).filter(Boolean);
  }

  getSafeTaskImages(task) {
    if (!task || !Array.isArray(task.images)) return [];
    return task.images.map((image, index) => {
      if (typeof image === "string") return { id: `image-${index}`, path: image, caption: "" };
      if (!image || typeof image.path !== "string") return null;
      return { id: image.id || `image-${index}`, path: image.path, caption: typeof image.caption === "string" ? image.caption : "" };
    }).filter(Boolean);
  }

  parseTaskLinks(value) {
    const links = [];
    for (const [index, rawLine] of String(value || "").split(/\r?\n/).entries()) {
      const line = rawLine.trim();
      if (!line) continue;
      const separator = line.indexOf("|");
      const label = separator >= 0 ? line.slice(0, separator).trim() : "";
      const url = separator >= 0 ? line.slice(separator + 1).trim() : line;
      let parsed;
      try { parsed = new URL(url); } catch (error) { throw new Error(`第 ${index + 1} 行不是有效链接`); }
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`第 ${index + 1} 行仅支持 http / https`);
      links.push({ id: `link-${Date.now()}-${index}`, label, url: parsed.href });
    }
    return links;
  }

  async ensureClipboardDir() {
    if (!this.app.vault.getAbstractFileByPath(CLIPBOARD_DIR)) {
      try { await this.app.vault.createFolder(CLIPBOARD_DIR); } catch (e) {}
    }
  }

  primeClipboard() {
    try {
      this.clipboard = require("electron").clipboard;
      this.lastText = this.clipboard.readText() || "";
      const image = this.clipboard.readImage();
      this.lastImageSignature = image && !image.isEmpty() ? this.imageSignature(image) : "";
    } catch (e) {
      this.clipboard = null;
      new Notice("Jam Deck：Electron 剪贴板 API 不可用");
    }
  }

  imageSignature(image) {
    const size = image.getSize();
    let bitmap;
    try {
      bitmap = image.resize({ width: 24, height: 24, quality: "good" }).toBitmap();
    } catch (error) {
      bitmap = typeof image.getBitmap === "function" ? image.getBitmap() : image.toBitmap();
    }
    let hash = 2166136261;
    const step = Math.max(1, Math.floor(bitmap.length / 2304));
    for (let index = 0; index < bitmap.length; index += step) {
      hash ^= bitmap[index];
      hash = Math.imul(hash, 16777619);
    }
    return `${size.width}x${size.height}:${(hash >>> 0).toString(16)}`;
  }

  async pollClipboard() {
    if (!this.clipboard || this.clipboardBusy) return;
    this.clipboardBusy = true;
    try {
      const text = this.clipboard.readText() || "";
      const image = this.clipboard.readImage();
      if (image && !image.isEmpty()) {
        const signature = this.imageSignature(image);
        if (signature !== this.lastImageSignature) {
          this.lastImageSignature = signature;
          if (text) this.lastText = text;
          const ts = Date.now();
          const filename = `clip-${ts}.png`;
          const png = image.toPNG();
          const arrayBuffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
          await this.app.vault.createBinary(`${CLIPBOARD_DIR}/${filename}`, arrayBuffer);
          this.settings.clipboardItems.unshift({ type: "image", ts, filename });
          await this.trimClipboardHistory();
          await this.saveSettings();
          this.renderClipboardViews();
          return;
        }
      }
      if (text && text !== this.lastText) {
        this.lastText = text;
        this.settings.clipboardItems.unshift({ type: "text", ts: Date.now(), content: text.slice(0, 2000) });
        await this.trimClipboardHistory();
        await this.saveSettings();
        this.renderClipboardViews();
      }
    } catch (e) {
      console.error("jam-deck clipboard poll error", e);
    } finally {
      this.clipboardBusy = false;
    }
  }

  async removeClipboardAttachment(filename) {
    const file = this.app.vault.getAbstractFileByPath(`${CLIPBOARD_DIR}/${filename}`);
    if (!file) return true;
    try {
      await this.app.vault.delete(file);
      return true;
    } catch (e) {
      console.error("jam-deck attachment delete failed", e);
      return false;
    }
  }

  async trimClipboardHistory() {
    const maxItems = Math.max(10, Number(this.settings.clipboardMaxItems) || 60);
    if (this.settings.clipboardItems.length <= maxItems) return;
    const overflow = this.settings.clipboardItems.slice(maxItems);
    const retained = this.settings.clipboardItems.slice(0, maxItems);
    for (const item of overflow) {
      if (item.type === "image" && item.filename) await this.removeClipboardAttachment(item.filename);
    }
    this.settings.clipboardItems = retained;
  }

  async cleanupClipboard() {
    const threshold = Date.now() - CLIPBOARD_MAX_AGE_MS;
    let changed = false;
    const retained = [];

    for (const item of this.settings.clipboardItems) {
      if (item.ts >= threshold) {
        retained.push(item);
        continue;
      }
      if (item.type !== "image" || !item.filename || await this.removeClipboardAttachment(item.filename)) {
        changed = true;
      } else {
        retained.push(item);
      }
    }
    this.settings.clipboardItems = retained;

    const attachments = this.app.vault.getFiles().filter((file) =>
      file.path.startsWith(`${CLIPBOARD_DIR}/`) && file.stat.mtime < threshold
    );
    for (const attachment of attachments) {
      try {
        await this.app.vault.delete(attachment);
        changed = true;
      } catch (e) {
        console.error("jam-deck orphan attachment cleanup failed", e);
      }
    }

    if (changed) {
      await this.saveSettings();
      this.renderAllViews();
    }
  }

  async clearClipboard() {
    const retained = [];
    for (const item of this.settings.clipboardItems) {
      if (item.type !== "image" || !item.filename || await this.removeClipboardAttachment(item.filename)) {
        continue;
      }
      retained.push(item);
    }
    this.settings.clipboardItems = retained;
    await this.saveSettings();
    this.renderAllViews();
    new Notice(retained.length ? "Jam Deck：部分附件删除失败，记录已保留" : "Jam Deck：剪贴板记录已清空");
  }

  async deleteClipboardItem(item) {
    if (item.type === "image" && item.filename) {
      await this.removeClipboardAttachment(item.filename);
    }
    this.settings.clipboardItems = this.settings.clipboardItems.filter((entry) => entry.ts !== item.ts || entry.type !== item.type);
    await this.saveSettings();
    this.renderAllViews();
  }

  async copyClipboardItem(item) {
    if (!this.clipboard) return;
    if (item.type === "text") {
      this.clipboard.writeText(item.content);
      this.lastText = item.content;
    } else if (item.type === "image" && item.filename) {
      const file = this.app.vault.getAbstractFileByPath(`${CLIPBOARD_DIR}/${item.filename}`);
      if (file) {
        const data = await this.app.vault.readBinary(file);
        const nativeImage = require("electron").nativeImage;
        const image = nativeImage.createFromBuffer(Buffer.from(data));
        this.clipboard.writeImage(image);
        this.lastImageSignature = this.imageSignature(image);
      }
    }
  }

  async copyCanvasImageFile(file) {
    if (!file || !file.path) throw new Error("未找到选中的图片文件");
    const data = await this.app.vault.readBinary(file);
    const electron = require("electron");
    let image = electron.nativeImage.createFromBuffer(Buffer.from(data));
    if (!image || image.isEmpty()) {
      const mime = this.imageMimeFromName(file.name || file.path);
      image = electron.nativeImage.createFromDataURL(`data:${mime};base64,${Buffer.from(data).toString("base64")}`);
    }
    if (!image || image.isEmpty()) throw new Error("该图片格式无法写入系统剪贴板");
    const clipboard = this.clipboard || electron.clipboard;
    clipboard.writeImage(image);
    this.clipboard = clipboard;
    this.lastImageSignature = this.imageSignature(image);
    new Notice("Jam Deck：Canvas 图片已复制");
    return true;
  }

  async hydrateClipboardImageDrag(card, item, vaultPath, resourceUrl) {
    const file = this.app.vault.getAbstractFileByPath(vaultPath);
    if (!file) return;
    try {
      const data = await this.app.vault.readBinary(file);
      const bytes = new Uint8Array(data);
      const mime = this.imageMimeFromName(item.filename);
      if (typeof File === "function") card._jamDeckDragFile = new File([bytes], item.filename, { type: mime });
      card._jamDeckDragDataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
      card._jamDeckDragResourceUrl = resourceUrl;
      try {
        const { pathToFileURL } = require("url");
        const path = require("path");
        const base = this.app.vault.adapter.getBasePath();
        card._jamDeckDragFileUrl = pathToFileURL(path.join(base, ...vaultPath.split("/"))).href;
      } catch (error) {}
    } catch (error) {
      console.error("jam-deck prepare image drag failed", error);
    }
  }

  imageMimeFromName(name) {
    const ext = String(name || "").toLowerCase().split(".").pop();
    return ({ jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml" })[ext] || "image/png";
  }

  async createCanvasAttachmentFromClipboard(item, canvasFilePath, signal) {
    if (!item || item.type !== "image" || !item.filename) throw new Error("剪贴板图片无效");
    const operation = async () => {
      if (signal && signal.aborted) throw new Error("Canvas 已关闭");
      const sourcePath = `${CLIPBOARD_DIR}/${item.filename}`;
      const source = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!source) throw new Error("剪贴板临时图片不存在");
      let targetPath = "";
      if (this.app.fileManager && typeof this.app.fileManager.getAvailablePathForAttachment === "function") {
        targetPath = await this.app.fileManager.getAvailablePathForAttachment(item.filename, canvasFilePath);
      }
      const safeName = String(item.filename).replace(/[\\/:*?"<>|]/g, "-");
      if (!targetPath || targetPath === sourcePath || targetPath.startsWith(`${CLIPBOARD_DIR}/`)) {
        targetPath = `${CANVAS_ASSET_DIR}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`;
      }
      if (signal && signal.aborted) throw new Error("Canvas 已关闭");
      const folder = targetPath.includes("/") ? targetPath.slice(0, targetPath.lastIndexOf("/")) : "";
      if (folder) await this.ensureVaultFolder(folder);
      if (this.app.vault.getAbstractFileByPath(targetPath)) {
        targetPath = `${CANVAS_ASSET_DIR}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`;
        await this.ensureVaultFolder(CANVAS_ASSET_DIR);
      }
      const data = await this.app.vault.readBinary(source);
      if (signal && signal.aborted) throw new Error("Canvas 已关闭");
      await this.app.vault.createBinary(targetPath, data);
      const file = this.app.vault.getAbstractFileByPath(targetPath);
      if (!file) throw new Error("Canvas 附件创建失败");
      return { path: targetPath, file };
    };
    if (!this.canvasAttachmentQueue) this.canvasAttachmentQueue = Promise.resolve();
    const result = this.canvasAttachmentQueue.then(operation, operation);
    this.canvasAttachmentQueue = result.catch(() => {});
    return result;
  }

  prepareObsidianImageDrag(event, item) {
    if (!item || item.type !== "image" || !item.filename) return false;
    const file = this.app.vault.getAbstractFileByPath(`${CLIPBOARD_DIR}/${item.filename}`);
    const dragManager = this.app.dragManager;
    if (!file || !dragManager || typeof dragManager.dragFile !== "function" || typeof dragManager.onDragStart !== "function") return false;
    try {
      const draggable = dragManager.dragFile(event, file);
      if (!draggable) return false;
      dragManager.onDragStart(event, draggable);
      return true;
    } catch (error) {
      console.error("jam-deck native image drag failed", error);
      return false;
    }
  }

  prepareClipboardDrag(event, item, card) {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    card.addClass("is-dragging");
    transfer.effectAllowed = "copy";
    const payload = JSON.stringify({ ts: item.ts, type: item.type });
    try { transfer.setData(CLIPBOARD_DRAG_MIME, payload); } catch (error) {}
    this.activeClipboardDragItem = item;
    if (item.type === "text") {
      transfer.setData("text/plain", item.content || "");
      return;
    }
    this.prepareObsidianImageDrag(event, item);
    const mime = this.imageMimeFromName(item.filename);
    if (card._jamDeckDragFile && transfer.items && typeof transfer.items.add === "function") {
      try { transfer.items.add(card._jamDeckDragFile); } catch (error) {}
    }
    const fileUrl = card._jamDeckDragFileUrl || card._jamDeckDragResourceUrl || "";
    const imageUrl = card._jamDeckDragDataUrl || card._jamDeckDragResourceUrl || fileUrl;
    if (fileUrl) {
      try { transfer.setData("text/uri-list", fileUrl); } catch (error) {}
      try { transfer.setData("DownloadURL", `${mime}:${item.filename}:${fileUrl}`); } catch (error) {}
      try { transfer.setData("text/plain", fileUrl); } catch (error) {}
    }
    if (imageUrl) {
      try { transfer.setData("text/html", `<img src="${imageUrl}" alt="${this.escapeHtml(item.filename || "clipboard image")}">`); } catch (error) {}
    }
    const image = card.querySelector("img");
    if (image && typeof transfer.setDragImage === "function") transfer.setDragImage(image, Math.min(40, image.width / 2), Math.min(40, image.height / 2));
  }

  escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  getClipboardItemFromTransfer(transfer) {
    if (!transfer) return null;
    let raw = "";
    try { raw = transfer.getData(CLIPBOARD_DRAG_MIME); } catch (error) {}
    if (!raw) return null;
    try {
      const payload = JSON.parse(raw);
      return (this.settings.clipboardItems || []).find((item) => item.ts === payload.ts && item.type === payload.type) || null;
    } catch (error) {
      return null;
    }
  }

  transferHasTaskContent(transfer) {
    if (!transfer) return false;
    const types = Array.from(transfer.types || []);
    return types.includes(CLIPBOARD_DRAG_MIME) || types.includes("Files") || types.includes("text/plain");
  }

  enableTaskDrop(body, input, createDrop) {
    body.addClass("jam-deck-task-dropzone");
    const clear = () => {
      body.removeClass("is-drag-active");
      if (createDrop) createDrop.removeClass("is-drop-target");
    };
    body.addEventListener("dragover", (event) => {
      if (!this.transferHasTaskContent(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      body.addClass("is-drag-active");
    });
    body.addEventListener("dragleave", (event) => {
      if (!body.contains(event.relatedTarget)) clear();
    });
    body.addEventListener("drop", (event) => {
      if (!this.transferHasTaskContent(event.dataTransfer)) return;
      event.preventDefault();
      clear();
    });
    if (createDrop) {
      createDrop.addEventListener("dragover", (event) => {
        if (!this.transferHasTaskContent(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        body.addClass("is-drag-active");
        createDrop.addClass("is-drop-target");
      });
      createDrop.addEventListener("dragleave", () => createDrop.removeClass("is-drop-target"));
      createDrop.addEventListener("drop", async (event) => {
        if (!this.transferHasTaskContent(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        clear();
        await this.handleTaskDrop(event.dataTransfer);
      });
    }
    if (!input) return;
    input.addEventListener("dragover", (event) => {
      const item = this.getClipboardItemFromTransfer(event.dataTransfer);
      const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
      const types = Array.from((event.dataTransfer && event.dataTransfer.types) || []);
      if ((item && item.type === "text") || (!item && !files.length && types.includes("text/plain"))) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    input.addEventListener("drop", (event) => {
      const item = this.getClipboardItemFromTransfer(event.dataTransfer);
      const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
      if ((item && item.type === "text") || (!item && !files.length)) {
        const text = item ? item.content : event.dataTransfer.getData("text/plain");
        if (text) {
          event.preventDefault();
          event.stopPropagation();
          input.value = String(text).split(/\r?\n/).find((line) => line.trim())?.trim() || "";
          input.focus();
          clear();
        }
      }
    });
  }

  enableExistingTaskDrop(row, taskId) {
    const clear = () => row.removeClass("is-drop-target");
    row.addEventListener("dragover", (event) => {
      if (!this.transferHasTaskContent(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      row.addClass("is-drop-target");
      const body = row.closest(".jam-deck-task-dropzone");
      if (body) body.addClass("is-drag-active");
    });
    row.addEventListener("dragleave", (event) => {
      if (!row.contains(event.relatedTarget)) clear();
    });
    row.addEventListener("drop", async (event) => {
      if (!this.transferHasTaskContent(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      clear();
      const body = row.closest(".jam-deck-task-dropzone");
      if (body) body.removeClass("is-drag-active");
      await this.appendDropToTask(taskId, event.dataTransfer);
    });
  }

  async appendDropToTask(taskId, transfer) {
    if (this.archivingTaskIds.has(taskId)) return false;
    const task = this.getDeckTask(taskId);
    if (!task || task.status === "archived") return false;
    const previousDescription = task.description || "";
    const previousImages = this.getSafeTaskImages(task).slice();
    const createdAssetPaths = [];
    try {
      const internal = this.getClipboardItemFromTransfer(transfer);
      if (internal && internal.type === "text") {
        const text = String(internal.content || "").trim();
        if (!text) return false;
        task.description = [previousDescription.trim(), text].filter(Boolean).join("\n");
      } else if (internal && internal.type === "image") {
        const sourcePath = `${CLIPBOARD_DIR}/${internal.filename}`;
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!file) throw new Error("剪贴板图片已经过期");
        const image = await this.createTaskAssetFromBuffer(
          await this.app.vault.readBinary(file),
          internal.filename,
          task.id,
          previousImages.length
        );
        createdAssetPaths.push(image.path);
        task.images = [...previousImages, image];
      } else {
        const files = Array.from((transfer && transfer.files) || []);
        if (files.length) {
          const imagesOnly = files.filter((file) => file && file.type && file.type.startsWith("image/"));
          if (!imagesOnly.length) throw new Error("拖入的文件不是图片");
          const added = [];
          for (let index = 0; index < imagesOnly.length; index++) {
            const image = await this.importTaskImage(imagesOnly[index], task.id, previousImages.length + index);
            createdAssetPaths.push(image.path);
            added.push(image);
          }
          task.images = [...previousImages, ...added];
        } else {
          const text = String(transfer.getData("text/plain") || "").trim();
          if (!text) throw new Error("没有可添加的文字或图片");
          task.description = [previousDescription.trim(), text].filter(Boolean).join("\n");
        }
      }
      await this.saveSettings();
      this.renderAllViews();
      new Notice("Jam Deck：内容已添加到待办详情");
      return true;
    } catch (error) {
      task.description = previousDescription;
      task.images = previousImages;
      await this.removeVaultFiles(createdAssetPaths);
      console.error("jam-deck append task drop failed", error);
      new Notice(`Jam Deck：添加失败 · ${error.message || "未知错误"}`);
      return false;
    }
  }

  makeDeckTask(id, text, description, images, options) {
    const extra = options || {};
    return {
      id,
      text,
      status: "active",
      createdAt: Date.now(),
      completedAt: null,
      archivedAt: null,
      description: description || "",
      links: [],
      images: images || [],
      category: ["work", "life"].includes(extra.category) ? extra.category : null,
      dueDate: this.isValidLocalDate(extra.dueDate) ? extra.dueDate : null,
      journalPath: null,
      archiveFormat: null,
      archiveTargetDate: null,
      archiveTargetPath: null,
      archiveRef: null,
      pendingJournalOp: null,
      tombstone: false,
    };
  }

  async persistNewDroppedTask(task, createdAssetPaths) {
    this.settings.deckTasks.unshift(task);
    try {
      await this.saveSettings();
    } catch (error) {
      this.settings.deckTasks = this.settings.deckTasks.filter((item) => item.id !== task.id);
      await this.removeVaultFiles(createdAssetPaths || []);
      throw error;
    }
    this.renderAllViews();
  }

  async createTaskFromDroppedText(content) {
    const raw = String(content || "").trim();
    if (!raw) return false;
    const lines = raw.split(/\r?\n/);
    const firstIndex = lines.findIndex((line) => line.trim());
    const title = lines[firstIndex].trim().slice(0, 120);
    const description = lines.slice(firstIndex + 1).join("\n").trim();
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await this.persistNewDroppedTask(this.makeDeckTask(id, title, description, []), []);
    return true;
  }

  async createTaskFromClipboardImage(item) {
    const sourcePath = `${CLIPBOARD_DIR}/${item.filename}`;
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!file) throw new Error("剪贴板图片已经过期");
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const image = await this.createTaskAssetFromBuffer(await this.app.vault.readBinary(file), item.filename, id, 0);
    const task = this.makeDeckTask(id, `图片待办 · ${item.filename}`, "", [image]);
    await this.persistNewDroppedTask(task, [image.path]);
  }

  async createTaskFromExternalImages(files) {
    const imagesOnly = files.filter((file) => file && file.type && file.type.startsWith("image/"));
    if (!imagesOnly.length) throw new Error("拖入待办的文件不是图片");
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const images = [];
    try {
      for (let index = 0; index < imagesOnly.length; index++) images.push(await this.importTaskImage(imagesOnly[index], id, index));
      const title = imagesOnly.length === 1 ? `图片待办 · ${imagesOnly[0].name}` : `图片待办 · ${imagesOnly.length} 张图片`;
      await this.persistNewDroppedTask(this.makeDeckTask(id, title, "", images), images.map((image) => image.path));
    } catch (error) {
      await this.removeVaultFiles(images.map((image) => image.path));
      throw error;
    }
  }

  async handleTaskDrop(transfer) {
    try {
      const internal = this.getClipboardItemFromTransfer(transfer);
      if (internal) {
        if (internal.type === "text") await this.createTaskFromDroppedText(internal.content);
        else await this.createTaskFromClipboardImage(internal);
        new Notice("Jam Deck：已从剪贴板创建待办");
        return;
      }
      const files = Array.from(transfer.files || []);
      if (files.length) {
        await this.createTaskFromExternalImages(files);
        new Notice("Jam Deck：已从图片创建待办");
        return;
      }
      const text = transfer.getData("text/plain");
      if (await this.createTaskFromDroppedText(text)) new Notice("Jam Deck：已从文字创建待办");
    } catch (error) {
      console.error("jam-deck task drop failed", error);
      new Notice(`Jam Deck：拖入待办失败 — ${error.message || "未知错误"}`);
    }
  }

  async addDeckTask(text) {
    this.settings.deckTasks.unshift(this.makeDeckTask(`task-${Date.now()}`, text, "", []));
    await this.saveSettings();
    this.renderAllViews();
  }

  openNewTaskForDate(dueDate) {
    if (!this.isValidLocalDate(dueDate)) return;
    new TaskDetailModal(this.app, this, null, () => this.renderAllViews(), { dueDate }).open();
  }

  async createDeckTaskFromDraft(draft) {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const imported = [];
    try {
      for (let index = 0; index < (draft.pendingFiles || []).length; index++) {
        imported.push(await this.importTaskImage(draft.pendingFiles[index], id, index));
      }
      const task = this.makeDeckTask(id, draft.text, draft.description, imported, {
        category: draft.category,
        dueDate: draft.dueDate,
      });
      task.links = this.getSafeTaskLinks({ links: draft.links });
      this.settings.deckTasks.unshift(task);
      try {
        await this.saveSettings();
      } catch (error) {
        this.settings.deckTasks = this.settings.deckTasks.filter((item) => item.id !== id);
        throw error;
      }
      this.renderAllViews();
      return id;
    } catch (error) {
      await this.removeVaultFiles(imported.map((image) => image.path));
      throw error;
    }
  }

  async completeAndArchiveDeckTask(id) {
    const task = this.getDeckTask(id);
    if (!task || task.status === "archived") return false;
    if (task.status !== "completed") {
      task.status = "completed";
      task.completedAt = Date.now();
      await this.saveSettings();
      this.renderAllViews();
    }
    return this.archiveDeckTask(id);
  }

  async toggleDeckTask(id) {
    if (this.archivingTaskIds.has(id)) return;
    const task = this.settings.deckTasks.find((item) => item.id === id);
    if (!task || task.status === "archived") return;
    const completed = task.status === "completed";
    if (completed && task.archiveTargetPath) {
      const targetFile = this.app.vault.getAbstractFileByPath(task.archiveTargetPath);
      if (targetFile) {
        try {
          const journal = await this.app.vault.read(targetFile);
          if (this.journalContainsTask(journal, task.id)) {
            new Notice("Jam Deck：日记已写入，请再次点击归档完成同步");
            return;
          }
        } catch (error) {
          new Notice("Jam Deck：无法确认归档日记状态，请稍后重试");
          return;
        }
      }
      task.archiveTargetDate = null;
      task.archiveTargetPath = null;
    }
    task.status = completed ? "active" : "completed";
    task.completedAt = completed ? null : Date.now();
    await this.saveSettings();
    this.renderAllViews();
  }

  openTaskDetail(id, onSaved) {
    if (this.archivingTaskIds.has(id)) {
      new Notice("Jam Deck：正在归档，请稍候");
      return;
    }
    new TaskDetailModal(this.app, this, id, onSaved).open();
  }

  async ensureVaultFolder(path) {
    const parts = String(path).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (this.app.vault.getAbstractFileByPath(current)) continue;
      try {
        await this.app.vault.createFolder(current);
      } catch (error) {
        if (!this.app.vault.getAbstractFileByPath(current)) throw error;
      }
    }
  }

  sanitizeFilename(name) {
    const cleaned = String(name || "image.png")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || "image.png";
  }

  async importTaskImage(file, taskId, index) {
    if (!file || !file.type || !file.type.startsWith("image/")) throw new Error("只能添加图片文件");
    return this.createTaskAssetFromBuffer(await file.arrayBuffer(), file.name, taskId, index);
  }

  async createTaskAssetFromBuffer(buffer, sourceName, taskId, index) {
    const context = this.getLocalDayContext(new Date());
    const dir = `${TASK_ASSET_DIR}/${context.date}`;
    await this.ensureVaultFolder(dir);
    const safeName = this.sanitizeFilename(sourceName);
    const dot = safeName.lastIndexOf(".");
    const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot > 0 ? safeName.slice(dot) : ".png";
    const token = String(taskId).replace(/[^a-zA-Z0-9_-]/g, "-").slice(-32);
    for (let attempt = 0; attempt < 20; attempt++) {
      const suffix = `${Date.now()}-${index}-${attempt}-${Math.random().toString(36).slice(2, 7)}`;
      const path = `${dir}/${stem}-${token}-${suffix}${ext}`;
      if (this.app.vault.getAbstractFileByPath(path)) continue;
      try {
        await this.app.vault.createBinary(path, buffer);
        return { id: `image-${Date.now()}-${index}-${attempt}`, path, caption: safeName };
      } catch (error) {
        if (!this.app.vault.getAbstractFileByPath(path)) throw error;
      }
    }
    throw new Error("图片文件名冲突，请重试");
  }

  taskAssetDigest(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let hash = 2166136261;
    for (let index = 0; index < bytes.length; index++) {
      hash ^= bytes[index];
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `${bytes.length.toString(36)}-${hash.toString(16).padStart(8, "0")}`;
  }

  isManagedTaskAssetPath(path) {
    return String(path || "").replace(/\\/g, "/").startsWith(`${TASK_ASSET_DIR}/`);
  }

  async getJournalAttachmentPath(sourcePath, taskId, digest, journalPath) {
    const sourceName = this.sanitizeFilename(String(sourcePath || "image.png").split("/").pop());
    const dot = sourceName.lastIndexOf(".");
    const stem = dot > 0 ? sourceName.slice(0, dot) : sourceName;
    const ext = dot > 0 ? sourceName.slice(dot) : ".png";
    const token = String(taskId || "task").replace(/[^a-zA-Z0-9_-]/g, "-").slice(-24);
    const candidateName = `${stem}--jd-${token}-${digest}${ext}`;
    let availablePath = "";
    if (this.app.fileManager && typeof this.app.fileManager.getAvailablePathForAttachment === "function") {
      availablePath = await this.app.fileManager.getAvailablePathForAttachment(candidateName, journalPath);
    }
    if (!availablePath) {
      const journalDir = String(journalPath || "").split("/").slice(0, -1).join("/");
      availablePath = `${journalDir ? `${journalDir}/` : ""}附件/${candidateName}`;
    }
    const normalized = String(availablePath).replace(/\\/g, "/");
    const folder = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    const candidatePath = folder ? `${folder}/${candidateName}` : candidateName;
    const existing = this.app.vault.getAbstractFileByPath(candidatePath);
    if (!existing) return candidatePath;
    const existingDigest = this.taskAssetDigest(await this.app.vault.readBinary(existing));
    if (existingDigest === digest) return candidatePath;
    return normalized;
  }

  async copyTaskImagesToJournal(task, journalPath) {
    const images = this.getSafeTaskImages(task);
    const migrated = [];
    const moves = [];
    for (const image of images) {
      if (!this.isManagedTaskAssetPath(image.path)) {
        migrated.push({ ...image });
        continue;
      }
      const source = this.app.vault.getAbstractFileByPath(image.path);
      if (!source) throw new Error(`待办图片不存在：${image.path}`);
      const buffer = await this.app.vault.readBinary(source);
      const digest = this.taskAssetDigest(buffer);
      const targetPath = await this.getJournalAttachmentPath(image.path, task.id, digest, journalPath);
      const folder = targetPath.includes("/") ? targetPath.slice(0, targetPath.lastIndexOf("/")) : "";
      if (folder) await this.ensureVaultFolder(folder);
      let target = this.app.vault.getAbstractFileByPath(targetPath);
      let created = false;
      if (!target) {
        await this.app.vault.createBinary(targetPath, buffer);
        target = this.app.vault.getAbstractFileByPath(targetPath);
        created = true;
      }
      if (!target || this.taskAssetDigest(await this.app.vault.readBinary(target)) !== digest) {
        throw new Error(`归档图片校验失败：${targetPath}`);
      }
      migrated.push({ ...image, path: targetPath });
      moves.push({ sourcePath: image.path, targetPath, created });
    }
    return { images: migrated, moves };
  }

  async cleanupCommittedTaskAssets(taskId, moves) {
    const token = String(taskId || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(-32);
    for (const move of moves || []) {
      if (!this.isManagedTaskAssetPath(move.sourcePath)) continue;
      const filename = move.sourcePath.split("/").pop() || "";
      if (!token || !filename.includes(token)) continue;
      const shared = this.settings.deckTasks.some((task) => task.id !== taskId && this.getSafeTaskImages(task).some((image) => image.path === move.sourcePath));
      if (shared) continue;
      const source = this.app.vault.getAbstractFileByPath(move.sourcePath);
      if (!source || !this.app.vault.getAbstractFileByPath(move.targetPath)) continue;
      try { await this.app.vault.delete(source); } catch (error) { console.error("jam-deck archived source cleanup failed", error); }
    }
  }

  async removeVaultFiles(paths) {
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) continue;
      try { await this.app.vault.delete(file); } catch (error) { console.error("jam-deck attachment rollback failed", error); }
    }
  }

  async saveTaskDetails(id, draft) {
    if (this.archivingTaskIds.has(id)) throw new Error("该待办正在归档");
    const imported = [];
    let journalUpdated = false;
    let lockedHere = false;
    let attachmentMoves = [];
    let archiveMoveOldRef = null;
    try {
      const beforeImport = this.getDeckTask(id);
      if (!beforeImport) throw new Error("待办不存在");
      if (beforeImport.status === "archived") {
        this.archivingTaskIds.add(id);
        lockedHere = true;
      }
      for (let index = 0; index < draft.pendingFiles.length; index++) {
        const image = await this.importTaskImage(draft.pendingFiles[index], id, index);
        imported.push(image);
      }
      if (!lockedHere && this.archivingTaskIds.has(id)) throw new Error("该待办已开始归档");
      const task = this.getDeckTask(id);
      if (!task) throw new Error("待办不存在");
      const previous = {
        text: task.text,
        description: task.description,
        links: task.links,
        images: task.images,
        journalPath: task.journalPath,
        archiveFormat: task.archiveFormat,
        archiveTargetDate: task.archiveTargetDate,
        archiveTargetPath: task.archiveTargetPath,
        category: task.category,
        dueDate: task.dueDate,
        archiveRef: task.archiveRef,
        pendingJournalOp: task.pendingJournalOp,
      };
      const nextTask = {
        ...task,
        text: draft.text,
        description: draft.description,
        links: draft.links,
        images: [...draft.images, ...imported],
        category: ["work", "life"].includes(draft.category) ? draft.category : null,
        dueDate: this.isValidLocalDate(draft.dueDate) ? draft.dueDate : null,
      };
      if (task.status === "archived") {
        const result = await this.updateArchivedTaskJournal(task, nextTask);
        nextTask.images = result.images;
        attachmentMoves = result.moves;
        nextTask.journalPath = result.journalPath;
        nextTask.archiveRef = result.archiveRef;
        archiveMoveOldRef = result.oldRefToRemove;
        nextTask.archiveFormat = "section-v2";
        journalUpdated = true;
      }
      task.text = nextTask.text;
      task.description = nextTask.description;
      task.links = nextTask.links;
      task.images = nextTask.images;
      task.category = nextTask.category;
      task.dueDate = nextTask.dueDate;
      task.journalPath = nextTask.journalPath;
      task.archiveFormat = nextTask.archiveFormat;
      task.archiveRef = nextTask.archiveRef;
      task.pendingJournalOp = task.status === "archived"
        ? { ...(task.pendingJournalOp || {}), stage: archiveMoveOldRef ? "targetCommitted" : "committed" }
        : null;
      try {
        await this.saveSettings();
      } catch (error) {
        const recoveryPending = journalUpdated && task.pendingJournalOp
          ? { ...task.pendingJournalOp, stage: "targetWritten" }
          : task.pendingJournalOp;
        Object.assign(task, previous);
        if (journalUpdated) task.pendingJournalOp = recoveryPending;
        if (journalUpdated && imported.length) {
          draft.images.push(...imported);
          draft.pendingFiles.splice(0);
          imported.length = 0;
        }
        throw error;
      }
      if (archiveMoveOldRef) {
        await this.removeTaskFromArchiveRef(id, archiveMoveOldRef);
        task.pendingJournalOp = { ...(task.pendingJournalOp || {}), stage: "sourceRemoved" };
        await this.saveSettings();
      }
      if (task.status === "archived") {
        task.pendingJournalOp = null;
        await this.saveSettings();
      }
      if (attachmentMoves.length) await this.cleanupCommittedTaskAssets(id, attachmentMoves);
      this.renderAllViews();
    } catch (error) {
      if (!journalUpdated) await this.removeVaultFiles(imported.map((image) => image.path));
      throw error;
    } finally {
      if (lockedHere) this.archivingTaskIds.delete(id);
    }
  }

  async archiveDeckTask(id) {
    if (this.archivingTaskIds.has(id)) return false;
    const initial = this.getDeckTask(id);
    if (!initial || initial.status !== "completed") return false;
    this.archivingTaskIds.add(id);
    this.renderAllViews();

    const operation = this.archiveQueue.then(async () => {
      const task = this.getDeckTask(id);
      if (!task || task.status !== "completed") throw new Error("待办状态已改变，未归档");
      let pending = task.pendingJournalOp && task.pendingJournalOp.type === "archive" ? task.pendingJournalOp : null;
      if (!pending) {
        const dateKey = this.formatLocalDate(new Date());
        const category = this.resolveTaskCategory(task);
        const targetRef = this.buildArchiveRef(task, dateKey, category);
        task.archiveTargetDate = dateKey;
        task.archiveTargetPath = targetRef.notePath;
        task.pendingJournalOp = { type: "archive", taskId: task.id, targetCategory: category, targetDate: dateKey, targetRef, stage: "prepared" };
        try {
          await this.saveSettings();
        } catch (error) {
          task.archiveTargetDate = null;
          task.archiveTargetPath = null;
          task.pendingJournalOp = null;
          throw error;
        }
        pending = task.pendingJournalOp;
      }
      const targetRef = pending.targetRef || this.buildArchiveRef(task, pending.targetDate || task.archiveTargetDate, pending.targetCategory);
      const completedAtToken = task.completedAt;
      await this.ensureArchiveFile(targetRef);
      const attachmentResult = await this.copyTaskImagesToJournal(task, targetRef.notePath);
      const taskSnapshot = {
        ...task,
        links: this.getSafeTaskLinks(task).map((link) => ({ ...link })),
        images: attachmentResult.images.map((image) => ({ ...image })),
      };
      const journalPath = await this.writeTaskToArchive(taskSnapshot, targetRef);
      task.pendingJournalOp = { ...pending, targetRef, resolvedImages: attachmentResult.images, stage: "targetWritten" };
      await this.saveSettings();
      const current = this.getDeckTask(id);
      if (!current || current.status !== "completed" || current.completedAt !== completedAtToken) {
        throw new Error("待办在归档期间发生变化；日记已保留，状态未覆盖");
      }
      const previous = {
        status: current.status,
        archivedAt: current.archivedAt,
        journalPath: current.journalPath,
        archiveFormat: current.archiveFormat,
        archiveTargetDate: current.archiveTargetDate,
        archiveTargetPath: current.archiveTargetPath,
        images: current.images,
        archiveRef: current.archiveRef,
        pendingJournalOp: current.pendingJournalOp,
      };
      current.status = "archived";
      current.archivedAt = Date.now();
      current.journalPath = journalPath;
      current.archiveFormat = "section-v2";
      current.archiveRef = targetRef;
      current.archiveDate = targetRef.dateKey;
      current.archiveTargetDate = null;
      current.archiveTargetPath = null;
      current.images = attachmentResult.images;
      current.pendingJournalOp = { ...current.pendingJournalOp, stage: "committed" };
      try {
        await this.saveSettings();
      } catch (error) {
        Object.assign(current, previous);
        throw error;
      }
      await this.cleanupCommittedTaskAssets(id, attachmentResult.moves);
      current.pendingJournalOp = null;
      try { await this.saveSettings(); } catch (error) { current.pendingJournalOp = { ...pending, targetRef, resolvedImages: attachmentResult.images, stage: "committed" }; }
      new Notice(`Jam Deck：已归档到 ${journalPath}`);
      return true;
    });
    this.archiveQueue = operation.catch(() => {});
    try {
      return await operation;
    } catch (error) {
      console.error("jam-deck archive failed", error);
      new Notice(`Jam Deck：归档失败 — ${error.message || "未知错误"}`);
      return false;
    } finally {
      this.archivingTaskIds.delete(id);
      this.renderAllViews();
    }
  }

  getLocalDayContext(now) {
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    return { date, weekday: weekdays[now.getDay()], path: `${WORK_JOURNAL_DIR}/${date}.md` };
  }

  buildArchiveRef(task, dateKey, category) {
    const resolved = category || this.resolveTaskCategory(task);
    return resolved === "work"
      ? { kind: "work-daily-v2", notePath: `${WORK_JOURNAL_DIR}/${dateKey}.md`, dateKey, blockId: task.id }
      : { kind: "life-daily", notePath: LIFE_DAILY_PATH, dateKey, blockId: task.id };
  }

  getTaskArchiveRef(task) {
    if (task && task.archiveRef && task.archiveRef.notePath && task.archiveRef.blockId) return task.archiveRef;
    const path = this.getTaskJournalPath(task);
    if (!path) return null;
    const dateKey = task.archiveDate || task.archiveTargetDate || (String(path).match(/(\d{4}-\d{2}-\d{2})\.md$/) || [])[1] || this.formatLocalDate(new Date(task.archivedAt || Date.now()));
    return path === LIFE_DAILY_PATH
      ? { kind: "life-daily", notePath: path, dateKey, blockId: task.id }
      : { kind: "work-daily-v2", notePath: path, dateKey, blockId: task.id };
  }

  formatLifeDateHeading(dateKey) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    return `# ${year}年${month}月${day}日`;
  }

  lifeTaskMarker(taskId, boundary) {
    return `<!-- jam-deck-life-task:${String(taskId).replace(/--/g, "-")}:${boundary}:v1 -->`;
  }

  findLifeTaskBlock(markdown, taskId, dateKey) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const startMarker = this.lifeTaskMarker(taskId, "start");
    const endMarker = this.lifeTaskMarker(taskId, "end");
    const starts = [];
    const ends = [];
    lines.forEach((line, index) => {
      if (line === startMarker) starts.push(index);
      if (line === endMarker) ends.push(index);
    });
    if (!starts.length && !ends.length) return { lines, range: null };
    if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) throw new Error("Life/Daily 中的待办归档标记不完整或重复");
    const crossedHeading = lines.slice(starts[0] + 1, ends[0]).some((line) => /^# (?!#)/.test(line));
    if (crossedHeading) throw new Error("Life/Daily 待办归档块跨越了日期标题");
    if (dateKey) {
      const heading = this.formatLifeDateHeading(dateKey);
      const headings = lines.map((line, index) => line === heading ? index : -1).filter((index) => index >= 0);
      if (headings.length !== 1) throw new Error(headings.length ? `Life/Daily 中存在重复日期标题：${heading}` : `Life/Daily 中缺少日期标题：${heading}`);
      const startHeading = headings[0];
      let sectionEnd = lines.length;
      for (let index = startHeading + 1; index < lines.length; index++) {
        if (/^# (?!#)/.test(lines[index])) { sectionEnd = index; break; }
      }
      if (starts[0] <= startHeading || ends[0] >= sectionEnd) throw new Error("Life/Daily 待办归档块不在对应日期章节内");
    }
    return { lines, range: { start: starts[0], end: ends[0] } };
  }

  renderLifeTaskBlock(task) {
    const lines = [
      this.lifeTaskMarker(task.id, "start"),
      `- [x] ${this.safeMarkdownText(task.text) || "未命名待办"}`,
      "  - 分类：生活",
    ];
    if (task.dueDate) lines.push(`  - 截止：${task.dueDate}`);
    for (const note of String(task.description || "").split(/\r?\n/).map((line) => this.safeMarkdownText(line)).filter(Boolean)) lines.push(`  - 说明：${note}`);
    for (const link of this.getSafeTaskLinks(task)) {
      const label = this.safeMarkdownText(link.label || "链接").replace(/\]/g, "\\]");
      lines.push(`  - 链接：[${label}](${link.url})`);
    }
    for (const image of this.getSafeTaskImages(task)) {
      const path = image.path.replace(/\\/g, "/").replace(/[\[\]|]/g, "-");
      lines.push(`  - 图片：![[${path}]]`);
    }
    lines.push(this.lifeTaskMarker(task.id, "end"));
    return lines;
  }

  upsertTaskInLifeDaily(markdown, task, dateKey) {
    const eol = String(markdown).includes("\r\n") ? "\r\n" : "\n";
    const heading = this.formatLifeDateHeading(dateKey);
    const normalizedLines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const headingCount = normalizedLines.filter((line) => line === heading).length;
    if (headingCount > 1) throw new Error(`Life/Daily 中存在重复日期标题：${heading}`);
    const found = this.findLifeTaskBlock(markdown, task.id, headingCount ? dateKey : null);
    if (found.range && !headingCount) throw new Error(`Life/Daily 中缺少任务对应日期标题：${heading}`);
    const block = this.renderLifeTaskBlock(task);
    if (found.range) {
      const result = [...found.lines.slice(0, found.range.start), ...block, ...found.lines.slice(found.range.end + 1)];
      return result.join("\n").replace(/\n/g, eol);
    }
    const headingIndexes = found.lines.map((line, index) => line === heading ? index : -1).filter((index) => index >= 0);
    if (headingIndexes.length > 1) throw new Error(`Life/Daily 中存在重复日期标题：${heading}`);
    let lines = found.lines.slice();
    if (!headingIndexes.length) {
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      if (lines.length) lines.push("");
      lines.push(heading, "", ...block, "");
      return lines.join("\n").replace(/\n/g, eol);
    }
    const start = headingIndexes[0];
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index++) {
      if (/^# (?!#)/.test(lines[index])) { end = index; break; }
    }
    const before = lines.slice(0, end);
    while (before.length && before[before.length - 1] === "") before.pop();
    before.push("", ...block, "");
    return [...before, ...lines.slice(end)].join("\n").replace(/\n/g, eol);
  }

  removeTaskFromLifeDaily(markdown, taskId, dateKey) {
    const eol = String(markdown).includes("\r\n") ? "\r\n" : "\n";
    const found = this.findLifeTaskBlock(markdown, taskId, dateKey);
    if (!found.range) return markdown;
    let start = found.range.start;
    let end = found.range.end;
    if (start > 0 && found.lines[start - 1] === "") start--;
    else if (end + 1 < found.lines.length && found.lines[end + 1] === "") end++;
    return [...found.lines.slice(0, start), ...found.lines.slice(end + 1)].join("\n").replace(/\n/g, eol);
  }

  async ensureLifeDailyFile(dateKey) {
    await this.ensureVaultFolder("Life");
    let file = this.app.vault.getAbstractFileByPath(LIFE_DAILY_PATH);
    if (file) return file;
    try { await this.app.vault.create(LIFE_DAILY_PATH, `${this.formatLifeDateHeading(dateKey)}\n\n`); }
    catch (error) {
      file = this.app.vault.getAbstractFileByPath(LIFE_DAILY_PATH);
      if (!file) throw error;
      return file;
    }
    file = this.app.vault.getAbstractFileByPath(LIFE_DAILY_PATH);
    if (!file) throw new Error("无法创建 Life/Daily.md");
    return file;
  }

  async ensureArchiveFile(ref) {
    return ref.kind === "life-daily" ? this.ensureLifeDailyFile(ref.dateKey) : this.ensureDailyJournalFile(ref.notePath);
  }

  async writeTaskToArchive(task, ref) {
    const file = await this.ensureArchiveFile(ref);
    if (ref.kind === "life-daily") {
      await this.app.vault.process(file, (current) => this.upsertTaskInLifeDaily(current, task, ref.dateKey));
      return ref.notePath;
    }
    return this.writeTaskToDailyJournal(task, ref.notePath);
  }

  archiveMarker(id) {
    return `<!-- jam-deck-task:${String(id).replace(/--/g, "-")} -->`;
  }

  archiveBlockMarker(id, sectionKey, boundary) {
    const safeId = String(id).replace(/--/g, "-");
    return `<!-- jam-deck-task:${safeId}:${sectionKey}:${boundary}:v2 -->`;
  }

  journalContainsTask(markdown, taskId) {
    const scan = this.scanJournal(markdown);
    if (scan.visibleLines.includes(this.archiveMarker(taskId))) return true;
    return JOURNAL_SECTIONS.some((section) => scan.visibleLines.includes(this.archiveBlockMarker(taskId, JOURNAL_SECTION_KEYS[section], "start")));
  }

  safeMarkdownText(value) {
    return String(value || "").replace(/\r?\n/g, " ").replace(/([\\`*_{}\[\]<>])/g, "\\$1").trim();
  }

  getArchiveSectionContent(task) {
    const title = this.safeMarkdownText(task.text) || "未命名待办";
    const images = this.getSafeTaskImages(task)
      .map((image) => image.path.replace(/\\/g, "/").replace(/[\[\]|]/g, "-"))
      .filter(Boolean)
      .map((path) => `- ![[${path}]]`);
    const links = this.getSafeTaskLinks(task).map((link) => ({ ...link }));
    const seenUrls = new Set(links.map((link) => link.url));
    const sourceText = `${task.text || ""}\n${task.description || ""}`;
    for (const match of sourceText.matchAll(/https?:\/\/[^\s<>()]+/gi)) {
      const url = match[0].replace(/[.,;!?，。；！？]+$/g, "");
      if (!seenUrls.has(url)) {
        links.push({ id: `auto-${links.length}`, label: "链接", url });
        seenUrls.add(url);
      }
    }
    const linkLines = links.map((link) => {
      const label = this.safeMarkdownText(link.label || "链接").replace(/\]/g, "\\]");
      return `- [${label} →](${link.url})`;
    });
    const notes = String(task.description || "").split(/\r?\n/).map((line) => this.safeMarkdownText(line)).filter(Boolean).map((line) => `- ${line}`);
    return {
      "工作内容": [`- ${title}`],
      "效果图 / 视频": images,
      "链接": linkLines,
      "备注": notes,
    };
  }

  getArchiveFragments(task) {
    const marker = this.archiveMarker(task.id);
    const sections = this.getArchiveSectionContent(task);
    return { marker, sections: { ...sections, "工作内容": [`${marker}\n${sections["工作内容"][0]}`] } };
  }

  renderTaskSectionBlock(task, sectionTitle) {
    const key = JOURNAL_SECTION_KEYS[sectionTitle];
    const content = this.getArchiveSectionContent(task)[sectionTitle] || [];
    return [
      this.archiveBlockMarker(task.id, key, "start"),
      ...content,
      this.archiveBlockMarker(task.id, key, "end"),
    ].join("\n");
  }

  scanJournal(markdown) {
    const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
    const headings = [];
    const visibleLines = [];
    const visibleIndexes = [];
    let inFrontmatter = lines[0] === "---";
    let fence = null;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (inFrontmatter) {
        if (index > 0 && line.trim() === "---") inFrontmatter = false;
        continue;
      }
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        const char = fenceMatch[1][0];
        if (!fence) fence = char;
        else if (fence === char) fence = null;
        continue;
      }
      if (fence) continue;
      visibleLines.push(line);
      visibleIndexes.push(index);
      const heading = line.match(/^## ([^#].*?)\s*$/);
      if (heading) headings.push({ index, title: heading[1] });
    }
    return { lines, headings, visibleLines, visibleIndexes, visibleText: visibleLines.join("\n") };
  }

  getJournalSectionRange(scan, title) {
    const heading = scan.headings.find((item) => item.title === title);
    if (!heading) return null;
    const next = scan.headings.find((item) => item.index > heading.index);
    return { start: heading.index + 1, end: next ? next.index : scan.lines.length };
  }

  getTaskBlockRanges(markdown, taskId) {
    const scan = this.scanJournal(markdown);
    const visible = new Set(scan.visibleIndexes);
    const ranges = {};
    for (const section of JOURNAL_SECTIONS) {
      const key = JOURNAL_SECTION_KEYS[section];
      const startLine = this.archiveBlockMarker(taskId, key, "start");
      const endLine = this.archiveBlockMarker(taskId, key, "end");
      const starts = scan.lines.map((line, index) => visible.has(index) && line === startLine ? index : -1).filter((index) => index >= 0);
      const ends = scan.lines.map((line, index) => visible.has(index) && line === endLine ? index : -1).filter((index) => index >= 0);
      if (!starts.length && !ends.length) {
        ranges[section] = null;
        continue;
      }
      if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) throw new Error(`日记中的 ${section} 归档标记不完整`);
      const sectionRange = this.getJournalSectionRange(scan, section);
      if (!sectionRange || starts[0] < sectionRange.start || ends[0] >= sectionRange.end) throw new Error(`日记中的 ${section} 归档标记位置异常`);
      ranges[section] = { start: starts[0], end: ends[0] };
    }
    const count = Object.values(ranges).filter(Boolean).length;
    if (count !== 0 && count !== JOURNAL_SECTIONS.length) throw new Error("日记中的任务归档块不完整");
    return { scan, ranges, count };
  }

  findVisibleSequence(scan, range, sequence) {
    if (!sequence.length) return [];
    const visible = new Set(scan.visibleIndexes);
    const matches = [];
    for (let index = range.start; index + sequence.length <= range.end; index++) {
      let matched = true;
      for (let offset = 0; offset < sequence.length; offset++) {
        if (!visible.has(index + offset) || scan.lines[index + offset] !== sequence[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) matches.push({ start: index, end: index + sequence.length - 1 });
    }
    return matches;
  }

  upgradeLegacyTaskInJournal(markdown, task) {
    const eol = String(markdown).includes("\r\n") ? "\r\n" : "\n";
    const normalized = String(markdown).replace(/\r\n/g, "\n");
    const scan = this.scanJournal(normalized);
    const marker = this.archiveMarker(task.id);
    const markerIndexes = scan.visibleIndexes.filter((index) => scan.lines[index] === marker);
    if (!markerIndexes.length) return null;
    if (markerIndexes.length !== 1) throw new Error("旧版日记标记不唯一，已停止自动修改");
    const content = this.getArchiveSectionContent(task);
    const remove = new Set();
    const workRange = this.getJournalSectionRange(scan, "工作内容");
    const markerIndex = markerIndexes[0];
    const expectedWork = content["工作内容"];
    if (!workRange || markerIndex < workRange.start || markerIndex + 1 >= workRange.end || expectedWork.length !== 1 || scan.lines[markerIndex + 1] !== expectedWork[0]) {
      throw new Error("旧版工作内容已被修改，无法安全同步");
    }
    remove.add(markerIndex);
    remove.add(markerIndex + 1);

    for (const section of JOURNAL_SECTIONS.slice(1)) {
      const expected = content[section] || [];
      if (!expected.length) continue;
      const range = this.getJournalSectionRange(scan, section);
      if (!range) throw new Error(`旧版日记缺少 ${section} 章节`);
      const matches = this.findVisibleSequence(scan, range, expected);
      if (matches.length !== 1) throw new Error(`旧版 ${section} 内容无法唯一定位`);
      for (let index = matches[0].start; index <= matches[0].end; index++) remove.add(index);
    }

    let result = scan.lines.filter((line, index) => !remove.has(index)).join("\n");
    for (const section of JOURNAL_SECTIONS) result = this.insertJournalSection(result, section, [this.renderTaskSectionBlock(task, section)]);
    return result.replace(/\n/g, eol);
  }

  removeTaskV2Blocks(markdown, taskId) {
    const eol = String(markdown).includes("\r\n") ? "\r\n" : "\n";
    const normalized = String(markdown).replace(/\r\n/g, "\n");
    const found = this.getTaskBlockRanges(normalized, taskId);
    if (!found.count) return normalized.replace(/\n/g, eol);
    const remove = new Set();
    for (const range of Object.values(found.ranges)) {
      for (let index = range.start; index <= range.end; index++) remove.add(index);
    }
    return found.scan.lines.filter((line, index) => !remove.has(index)).join("\n").replace(/\n/g, eol);
  }

  ensureTaskV2Blocks(markdown, task, allowInsert) {
    const found = this.getTaskBlockRanges(markdown, task.id);
    if (found.count === JOURNAL_SECTIONS.length) return markdown;
    const upgraded = this.upgradeLegacyTaskInJournal(markdown, task);
    if (upgraded !== null) return upgraded;
    if (!allowInsert) return markdown;
    let result = markdown;
    for (const section of JOURNAL_SECTIONS) result = this.insertJournalSection(result, section, [this.renderTaskSectionBlock(task, section)]);
    return result;
  }

  replaceTaskBlocksInJournal(markdown, oldTask, nextTask) {
    const eol = String(markdown).includes("\r\n") ? "\r\n" : "\n";
    let result = this.ensureTaskV2Blocks(String(markdown).replace(/\r\n/g, "\n"), oldTask, false);
    const found = this.getTaskBlockRanges(result, oldTask.id);
    if (!found.count) throw new Error("未找到可安全编辑的工作日记归档块");
    result = this.removeTaskV2Blocks(result, oldTask.id);
    for (const section of JOURNAL_SECTIONS) result = this.insertJournalSection(result, section, [this.renderTaskSectionBlock(nextTask, section)]);
    return result.replace(/\r\n/g, "\n").replace(/\n/g, eol);
  }

  removeTaskFromJournal(markdown, task) {
    const eol = String(markdown).includes("\r\n") ? "\r\n" : "\n";
    let result = this.ensureTaskV2Blocks(String(markdown).replace(/\r\n/g, "\n"), task, false);
    const found = this.getTaskBlockRanges(result, task.id);
    if (!found.count) return result.replace(/\r\n/g, "\n").replace(/\n/g, eol);
    return this.removeTaskV2Blocks(result, task.id).replace(/\r\n/g, "\n").replace(/\n/g, eol);
  }

  insertJournalSection(markdown, title, blocks) {
    const scan = this.scanJournal(markdown);
    const exact = scan.headings.find((heading) => heading.title === title);
    const blockLines = blocks.flatMap((block) => String(block).split("\n"));
    if (!exact) {
      const suffix = blockLines.length ? `\n\n## ${title}\n\n${blockLines.join("\n")}` : `\n\n## ${title}\n`;
      return markdown.replace(/\s*$/, "") + suffix + "\n";
    }
    if (!blockLines.length) return markdown;
    const nextHeading = scan.headings.find((heading) => heading.index > exact.index);
    const insertAt = nextHeading ? nextHeading.index : scan.lines.length;
    const before = scan.lines.slice(0, insertAt);
    while (before.length && before[before.length - 1] === "") before.pop();
    before.push("", ...blockLines, "");
    const after = scan.lines.slice(insertAt);
    return [...before, ...after].join("\n");
  }

  upsertTaskInJournal(markdown, task) {
    const eol = String(markdown).includes("\r\n") ? "\r\n" : "\n";
    const normalized = String(markdown).replace(/\r\n/g, "\n");
    let result = this.ensureTaskV2Blocks(normalized, task, true);
    result = this.replaceTaskBlocksInJournal(result, task, task);
    return result.replace(/\n/g, eol);
  }

  buildDailyJournalSkeleton(context) {
    return `---\ndate: ${context.date}\nweekday: ${context.weekday}\ntags: [工作日记]\n---\n\n# ${context.date} ${context.weekday}\n\n## 工作内容\n\n## 效果图 / 视频\n\n## 链接\n\n## 备注\n`;
  }

  buildNewDailyJournal(context, task) {
    return this.upsertTaskInJournal(this.buildDailyJournalSkeleton(context), task);
  }

  getDayContextFromPath(path) {
    const match = String(path || "").match(/(\d{4}-\d{2}-\d{2})\.md$/);
    if (!match) return this.getLocalDayContext(new Date());
    const [year, month, day] = match[1].split("-").map(Number);
    const local = new Date(year, month - 1, day);
    return { ...this.getLocalDayContext(local), path };
  }

  getTaskJournalPath(task) {
    if (task && task.journalPath) return task.journalPath;
    if (task && task.archiveTargetPath) return task.archiveTargetPath;
    if (task && task.archivedAt) return this.getLocalDayContext(new Date(task.archivedAt)).path;
    return null;
  }

  async ensureDailyJournalFile(targetPath) {
    const context = targetPath ? this.getDayContextFromPath(targetPath) : this.getLocalDayContext(new Date());
    await this.ensureVaultFolder(WORK_JOURNAL_DIR);
    let file = this.app.vault.getAbstractFileByPath(context.path);
    if (file) return file;
    try {
      await this.app.vault.create(context.path, this.buildDailyJournalSkeleton(context));
    } catch (error) {
      file = this.app.vault.getAbstractFileByPath(context.path);
      if (!file) throw error;
      return file;
    }
    file = this.app.vault.getAbstractFileByPath(context.path);
    if (!file) throw new Error(`无法创建工作日记：${context.path}`);
    return file;
  }

  async writeTaskToDailyJournal(task, targetPath) {
    const context = targetPath ? this.getDayContextFromPath(targetPath) : this.getLocalDayContext(new Date());
    const file = await this.ensureDailyJournalFile(context.path);
    await this.app.vault.process(file, (current) => this.upsertTaskInJournal(current, task));
    return context.path;
  }

  async updateArchivedTaskJournal(oldTask, nextTask) {
    const oldRef = this.getTaskArchiveRef(oldTask);
    if (!oldRef) throw new Error("该归档没有可安全定位的日记块");
    const targetCategory = ["work", "life"].includes(nextTask.category)
      ? nextTask.category
      : (oldRef.kind === "life-daily" ? "life" : "work");
    const targetRef = targetCategory === "life"
      ? { kind: "life-daily", notePath: LIFE_DAILY_PATH, dateKey: oldRef.dateKey, blockId: oldTask.id }
      : { kind: "work-daily-v2", notePath: `${WORK_JOURNAL_DIR}/${oldRef.dateKey}.md`, dateKey: oldRef.dateKey, blockId: oldTask.id };
    const moving = oldRef.kind !== targetRef.kind || oldRef.notePath !== targetRef.notePath;
    oldTask.pendingJournalOp = {
      type: moving ? "move" : "update",
      taskId: oldTask.id,
      oldRef,
      targetRef,
      targetCategory,
      targetDate: targetRef.dateKey,
      stage: "prepared",
    };
    await this.saveSettings();
    await this.ensureArchiveFile(targetRef);
    const attachmentResult = await this.copyTaskImagesToJournal(nextTask, targetRef.notePath);
    const snapshot = { ...nextTask, images: attachmentResult.images };
    await this.writeTaskToArchive(snapshot, targetRef);
    oldTask.pendingJournalOp = { ...oldTask.pendingJournalOp, resolvedImages: attachmentResult.images, stage: "targetWritten" };
    await this.saveSettings();
    return {
      images: attachmentResult.images,
      moves: attachmentResult.moves,
      journalPath: targetRef.notePath,
      archiveRef: targetRef,
      oldRefToRemove: moving ? oldRef : null,
    };
  }

  async replaceArchivedTaskInJournal(oldTask, nextTask) {
    const ref = this.getTaskArchiveRef(oldTask);
    const path = ref && ref.notePath;
    if (!path) throw new Error("该归档没有可定位的工作日记路径");
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error(`工作日记不存在：${path}`);
    if (ref.kind === "life-daily") await this.app.vault.process(file, (current) => this.upsertTaskInLifeDaily(current, nextTask, ref.dateKey));
    else await this.app.vault.process(file, (current) => this.replaceTaskBlocksInJournal(current, oldTask, nextTask));
    return path;
  }

  async migrateArchivedTaskAssets() {
    const candidates = this.settings.deckTasks.filter((task) =>
      task.status === "archived" &&
      task.journalPath &&
      this.getSafeTaskImages(task).some((image) => this.isManagedTaskAssetPath(image.path))
    );
    let migrated = 0;
    let skipped = 0;
    for (const candidate of candidates) {
      if (this.archivingTaskIds.has(candidate.id)) {
        skipped++;
        continue;
      }
      this.archivingTaskIds.add(candidate.id);
      try {
        const task = this.getDeckTask(candidate.id);
        if (!task || task.status !== "archived" || !task.journalPath) {
          skipped++;
          continue;
        }
        const journal = this.app.vault.getAbstractFileByPath(task.journalPath);
        if (!journal) {
          skipped++;
          continue;
        }
        const markdown = await this.app.vault.read(journal);
        if (this.getTaskBlockRanges(markdown, task.id).count !== JOURNAL_SECTIONS.length) {
          skipped++;
          continue;
        }
        const result = await this.copyTaskImagesToJournal(task, task.journalPath);
        if (!result.moves.length) continue;
        const nextTask = { ...task, images: result.images };
        await this.replaceArchivedTaskInJournal(task, nextTask);
        const previousImages = task.images;
        task.images = result.images;
        try {
          await this.saveSettings();
        } catch (error) {
          task.images = previousImages;
          throw error;
        }
        migrated++;
      } catch (error) {
        skipped++;
        console.error(`jam-deck archived attachment migration failed for ${candidate.id}`, error);
      } finally {
        this.archivingTaskIds.delete(candidate.id);
      }
    }
    if (migrated) {
      this.renderAllViews();
      new Notice(`Jam Deck：已将 ${migrated} 条归档的图片迁移到工作日记附件${skipped ? `，${skipped} 条已安全跳过` : ""}`);
    }
    return { migrated, skipped };
  }

  async resumePendingJournalOperations() {
    const tasks = this.settings.deckTasks.filter((task) => task.pendingJournalOp || task.tombstone);
    let resumed = 0;
    for (const task of tasks) {
      if (this.archivingTaskIds.has(task.id)) continue;
      const pending = task.pendingJournalOp;
      try {
        if (task.tombstone || (pending && pending.type === "delete")) {
          if (await this.deleteArchivedTask(task.id, true)) resumed++;
        } else if (pending && pending.type === "restore" && task.status === "archived") {
          if (await this.restoreArchivedTask(task.id)) resumed++;
        } else if (pending && pending.type === "archive" && task.status === "completed") {
          if (await this.archiveDeckTask(task.id)) resumed++;
        } else if (pending && pending.type === "move" && pending.stage === "targetCommitted" && pending.oldRef) {
          this.archivingTaskIds.add(task.id);
          try {
            await this.removeTaskFromArchiveRef(task.id, pending.oldRef);
            task.pendingJournalOp = null;
            await this.saveSettings();
            resumed++;
          } finally {
            this.archivingTaskIds.delete(task.id);
          }
        } else if (pending && ["committed", "sourceRemoved", "restored"].includes(pending.stage)) {
          task.pendingJournalOp = null;
          await this.saveSettings();
          resumed++;
        }
      } catch (error) {
        console.error(`jam-deck pending journal recovery failed for ${task.id}`, error);
      }
    }
    if (resumed) {
      this.renderAllViews();
      new Notice(`Jam Deck：已恢复 ${resumed} 项未完成的日记同步`);
    }
    return resumed;
  }

  async removeTaskFromArchiveRef(taskId, ref) {
    if (!ref || !ref.notePath) throw new Error("该归档没有可定位的日记路径");
    const file = this.app.vault.getAbstractFileByPath(ref.notePath);
    if (!file) return;
    if (ref.kind === "life-daily") await this.app.vault.process(file, (current) => this.removeTaskFromLifeDaily(current, taskId, ref.dateKey));
    else await this.app.vault.process(file, (current) => this.removeTaskFromJournal(current, { id: taskId }));
  }

  async removeArchivedTaskFromJournal(task) {
    const ref = this.getTaskArchiveRef(task);
    if (!ref) throw new Error("该归档没有可定位的日记路径");
    await this.removeTaskFromArchiveRef(task.id, ref);
  }

  async restoreArchivedTask(id) {
    if (this.archivingTaskIds.has(id)) return false;
    const task = this.getDeckTask(id);
    if (!task || task.status !== "archived") return false;
    this.archivingTaskIds.add(id);
    try {
      const oldRef = this.getTaskArchiveRef(task);
      const previousPending = task.pendingJournalOp;
      task.pendingJournalOp = { type: "restore", taskId: id, oldRef, stage: "prepared" };
      try { await this.saveSettings(); } catch (error) { task.pendingJournalOp = previousPending; throw error; }
      await this.removeArchivedTaskFromJournal({ ...task, links: this.getSafeTaskLinks(task), images: this.getSafeTaskImages(task) });
      task.pendingJournalOp = { ...task.pendingJournalOp, stage: "sourceRemoved" };
      await this.saveSettings();
      const previous = {
        status: task.status,
        completedAt: task.completedAt,
        archivedAt: task.archivedAt,
        journalPath: task.journalPath,
        archiveFormat: task.archiveFormat,
        archiveTargetDate: task.archiveTargetDate,
        archiveTargetPath: task.archiveTargetPath,
        archiveRef: task.archiveRef,
        pendingJournalOp: task.pendingJournalOp,
      };
      task.status = "active";
      task.completedAt = null;
      task.archivedAt = null;
      task.journalPath = null;
      task.archiveFormat = null;
      task.archiveTargetDate = null;
      task.archiveTargetPath = null;
      task.archiveRef = null;
      task.pendingJournalOp = null;
      try {
        await this.saveSettings();
      } catch (error) {
        Object.assign(task, previous);
        throw error;
      }
      new Notice("Jam Deck：已恢复，工作日记中的归档内容已移除");
      return true;
    } catch (error) {
      console.error("jam-deck restore archive failed", error);
      new Notice(`Jam Deck：恢复失败 — ${error.message || "未知错误"}`);
      return false;
    } finally {
      this.archivingTaskIds.delete(id);
      this.renderAllViews();
    }
  }

  async deleteArchivedTask(id, quiet) {
    if (this.archivingTaskIds.has(id)) return false;
    const task = this.getDeckTask(id);
    if (!task || task.status !== "archived") return false;
    this.archivingTaskIds.add(id);
    const index = this.settings.deckTasks.indexOf(task);
    try {
      const oldRef = this.getTaskArchiveRef(task);
      const previousPending = task.pendingJournalOp;
      task.tombstone = true;
      task.pendingJournalOp = { type: "delete", taskId: id, oldRef, stage: "prepared" };
      try { await this.saveSettings(); } catch (error) { task.tombstone = false; task.pendingJournalOp = previousPending; throw error; }
      await this.removeArchivedTaskFromJournal({ ...task, links: this.getSafeTaskLinks(task), images: this.getSafeTaskImages(task) });
      task.pendingJournalOp = { ...task.pendingJournalOp, stage: "sourceRemoved" };
      await this.saveSettings();
      this.settings.deckTasks.splice(index, 1);
      try {
        await this.saveSettings();
      } catch (error) {
        this.settings.deckTasks.splice(Math.max(0, index), 0, task);
        throw error;
      }
      if (!quiet) new Notice("Jam Deck：归档与工作日记内容已同步删除；附件文件已保留");
      return true;
    } catch (error) {
      console.error("jam-deck purge archive failed", error);
      if (!quiet) new Notice(`Jam Deck：删除失败 — ${error.message || "未知错误"}`);
      return false;
    } finally {
      this.archivingTaskIds.delete(id);
      this.renderAllViews();
    }
  }

  async deleteDeckTask(id) {
    if (this.archivingTaskIds.has(id)) return false;
    const task = this.getDeckTask(id);
    if (!task) return false;
    if (task.status === "archived") return this.deleteArchivedTask(id);
    this.archivingTaskIds.add(id);
    const index = this.settings.deckTasks.indexOf(task);
    try {
      if (task.archiveTargetPath || task.journalPath) {
        await this.removeArchivedTaskFromJournal({
          ...task,
          links: this.getSafeTaskLinks(task),
          images: this.getSafeTaskImages(task),
        });
      }
      this.settings.deckTasks.splice(index, 1);
      try {
        await this.saveSettings();
      } catch (error) {
        this.settings.deckTasks.splice(Math.max(0, index), 0, task);
        throw error;
      }
      new Notice("Jam Deck：待办已删除；附件文件已保留");
      return true;
    } catch (error) {
      console.error("jam-deck delete task failed", error);
      new Notice(`Jam Deck：删除失败 · ${error.message || "未知错误"}`);
      return false;
    } finally {
      this.archivingTaskIds.delete(id);
      this.renderAllViews();
    }
  }

  async deleteAllArchivedTasks() {
    const ids = this.settings.deckTasks.filter((task) => task.status === "archived").map((task) => task.id);
    let completed = 0;
    for (const id of ids) {
      if (!await this.deleteArchivedTask(id, true)) {
        new Notice(`Jam Deck：清理在 ${completed}/${ids.length} 项后停止，请检查对应工作日记`);
        return;
      }
      completed++;
    }
    new Notice(`Jam Deck：已同步清理 ${completed} 项归档；附件文件已保留`);
  }

  formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
  }

  async openDeck() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  renderAllViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view && typeof leaf.view.render === "function") leaf.view.render();
    }
  }

  renderClipboardViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (!view || !view.contentEl || typeof view.renderClipboard !== "function") continue;
      for (const widgetEl of view.contentEl.querySelectorAll(".jam-deck-widget")) {
        const widget = this.settings.widgets.find((item) => item.id === widgetEl.dataset.widgetId);
        if (!widget || widget.type !== "clipboard") continue;
        const body = widgetEl.querySelector(":scope > .jam-deck-widget-body");
        if (!body) continue;
        body.empty();
        view.renderClipboard(body);
      }
    }
  }

  updateClockDisplays() {
    const now = Date.now();
    const current = new Date(now);
    const time = current.toLocaleTimeString("zh-CN", { hour12: false });
    const date = current.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    const countdownStates = new Map();
    for (const widget of this.settings.widgets) {
      if (!widget || widget.type !== "clock") continue;
      const state = jamDeckCountdownState(widget, now);
      countdownStates.set(widget.id, state);
      if (state.enabled && state.remainingSeconds === 0) void this.completeCountdown(widget.id, state.endsAt);
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      leaf.view.contentEl.querySelectorAll(".jam-deck-clock-time").forEach((el) => el.setText(time));
      leaf.view.contentEl.querySelectorAll(".jam-deck-clock-date").forEach((el) => el.setText(date));
      leaf.view.contentEl.querySelectorAll(".jam-deck-countdown").forEach((el) => {
        const widget = this.settings.widgets.find((item) => item.id === el.dataset.widgetId && item.type === "clock");
        if (!widget) return;
        const state = countdownStates.get(widget.id) || jamDeckCountdownState(widget, now);
        const inputs = {
          hours: el.querySelector(".jam-deck-countdown-duration-hours"),
          minutes: el.querySelector(".jam-deck-countdown-duration-minutes"),
          seconds: el.querySelector(".jam-deck-countdown-duration-seconds"),
        };
        const flip = el.querySelector(".jam-deck-countdown-flip");
        const toggle = el.querySelector(".jam-deck-countdown-toggle input");
        const label = el.querySelector(".jam-deck-countdown-toggle span");
        if (flip) jamDeckRenderCountdownFlip(flip, jamDeckFormatCountdownClock(state.remainingSeconds));
        Object.values(inputs).forEach((input) => {
          if (input) input.disabled = state.enabled;
        });
        if (toggle) toggle.checked = state.enabled;
        if (label) label.setText(state.enabled ? "计时中" : "倒计时");
        el.toggleClass("is-running", state.enabled);
      });
      if (leaf.view && typeof leaf.view.updateMusicPlayers === "function") leaf.view.updateMusicPlayers();
    }
  }

  async setCountdownDuration(widgetId, rawValue) {
    const widget = this.settings.widgets.find((item) => item.id === widgetId && item.type === "clock");
    if (!widget) return false;
    const seconds = jamDeckParseCountdownDuration(rawValue);
    if (!seconds) {
      new Notice("Jam Deck：请输入有效倒计时，例如 25:00 或 01:30:00");
      return false;
    }
    const state = jamDeckCountdownState(widget);
    if (state.enabled) return false;
    const previous = { ...(widget.config || {}) };
    widget.config = { ...previous, countdownDurationSec: seconds };
    try {
      await this.saveSettings();
      return true;
    } catch (error) {
      widget.config = previous;
      new Notice("Jam Deck：倒计时时长保存失败");
      return false;
    }
  }

  requestCountdownNotificationPermission() {
    if (typeof process !== "undefined" && process.platform === "win32") return;
    try {
      const NotificationCtor = window.Notification;
      if (
        typeof NotificationCtor === "function"
        && NotificationCtor.permission === "default"
        && typeof NotificationCtor.requestPermission === "function"
      ) {
        void Promise.resolve(NotificationCtor.requestPermission()).then((permission) => {
          if (permission === "denied") new Notice("Jam Deck：Windows 通知权限未开启，倒计时结束时将使用 Obsidian 提示");
        });
      }
    } catch (error) {
      console.warn("jam-deck countdown notification permission unavailable", error);
    }
  }

  async setCountdownEnabled(widgetId, enabled, rawDuration) {
    const widget = this.settings.widgets.find((item) => item.id === widgetId && item.type === "clock");
    if (!widget) return false;
    const previous = { ...(widget.config || {}) };
    const current = jamDeckCountdownState(widget);
    if (enabled) {
      const seconds = jamDeckParseCountdownDuration(rawDuration);
      if (!seconds) {
        new Notice("Jam Deck：请输入有效倒计时，例如 25:00 或 01:30:00");
        return false;
      }
      this.requestCountdownNotificationPermission();
      widget.config = {
        ...previous,
        countdownDurationSec: seconds,
        countdownEnabled: true,
        countdownEndsAt: Date.now() + seconds * 1000,
      };
    } else {
      widget.config = {
        ...previous,
        countdownDurationSec: current.durationSeconds,
        countdownEnabled: false,
        countdownEndsAt: null,
      };
    }
    try {
      await this.saveSettings();
      this.renderAllViews();
      return true;
    } catch (error) {
      widget.config = previous;
      this.renderAllViews();
      new Notice("Jam Deck：倒计时状态保存失败");
      return false;
    }
  }

  async sendCountdownSystemNotification() {
    if (typeof process !== "undefined" && process.platform === "win32") {
      const sent = await this.sendWindowsNativeCountdownNotification();
      if (sent) return true;
    }
    try {
      const NotificationCtor = window.Notification;
      if (typeof NotificationCtor !== "function" || NotificationCtor.permission === "denied") return false;
      if (NotificationCtor.permission === "default" && typeof NotificationCtor.requestPermission === "function") {
        const permission = await NotificationCtor.requestPermission();
        if (permission !== "granted") return false;
      }
      const notification = new NotificationCtor("Jam Deck · 倒计时结束", {
        body: "设定时间已到。",
        silent: false,
      });
      notification.onclick = () => {
        try { window.focus(); } catch (error) {}
      };
      return true;
    } catch (error) {
      console.error("jam-deck countdown system notification failed", error);
      return false;
    }
  }

  sendWindowsNativeCountdownNotification() {
    return new Promise((resolve) => {
      try {
        const { execFile } = require("child_process");
        const encoded = Buffer.from(jamDeckWindowsToastPowerShellScript(), "utf16le").toString("base64");
        execFile(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
          { windowsHide: true, timeout: 5000 },
          (error) => {
            if (error) {
              console.error("jam-deck native Windows countdown notification failed", error);
              resolve(false);
              return;
            }
            resolve(true);
          },
        );
      } catch (error) {
        console.error("jam-deck native Windows countdown notification unavailable", error);
        resolve(false);
      }
    });
  }

  async completeCountdown(widgetId, expectedEndsAt) {
    if (!this.countdownCompletionLocks) this.countdownCompletionLocks = new Set();
    if (!widgetId || this.countdownCompletionLocks.has(widgetId)) return false;
    this.countdownCompletionLocks.add(widgetId);
    try {
      const widget = this.settings.widgets.find((item) => item.id === widgetId && item.type === "clock");
      const state = jamDeckCountdownState(widget);
      if (!widget || !state.enabled || state.endsAt !== expectedEndsAt || Date.now() < state.endsAt) return false;
      const previous = { ...(widget.config || {}) };
      widget.config = {
        ...previous,
        countdownEnabled: false,
        countdownEndsAt: null,
        countdownCompletedAt: Date.now(),
      };
      try {
        await this.saveSettings();
      } catch (error) {
        widget.config = previous;
        new Notice("Jam Deck：倒计时完成状态保存失败，将在下一次计时更新时重试");
        return false;
      }
      this.renderAllViews();
      const notified = await this.sendCountdownSystemNotification();
      if (!notified) new Notice("Jam Deck：倒计时结束");
      return true;
    } finally {
      this.countdownCompletionLocks.delete(widgetId);
    }
  }

  getMusicWidgets() {
    return (this.settings.widgets || []).filter((widget) => widget && widget.type === "music");
  }

  async ensureMusicMedia() {
    if (!this.getMusicWidgets().length || process.platform !== "win32") {
      if (process.platform !== "win32") this.musicSnapshot.connection = "unsupported";
      return false;
    }
    if (this.mediaBridge && this.mediaBridge.ready) return true;
    if (Date.now() < this.musicBridgeRetryAt) return false;
    if (!this.mediaBridge) this.mediaBridge = new WindowsMediaBridge(this);
    this.musicSnapshot.connection = "starting";
    this.updateMusicViews();
    try {
      await this.mediaBridge.start();
      this.musicBridgeFailures = 0;
      this.musicBridgeRetryAt = 0;
      this.musicSnapshot.connection = "ready";
      return true;
    } catch (error) {
      this.musicBridgeFailures = Math.min(4, (this.musicBridgeFailures || 0) + 1);
      const delays = [1000, 2000, 5000, 30000];
      this.musicBridgeRetryAt = Date.now() + delays[this.musicBridgeFailures - 1];
      this.musicSnapshot.connection = error && error.code === "UNSUPPORTED_PLATFORM" ? "unsupported" : "degraded";
      this.updateMusicViews();
      return false;
    }
  }

  updateMusicViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view && typeof leaf.view.updateMusicPlayers === "function") leaf.view.updateMusicPlayers();
    }
  }

  musicArtworkUrl(artwork) {
    if (!artwork || typeof artwork.artworkKey !== "string" || typeof artwork.base64 !== "string") return null;
    const byteLength = Number(artwork.byteLength);
    if (!Number.isInteger(byteLength) || byteLength < 1 || byteLength > MEDIA_ARTWORK_MAX_BYTES) return null;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(String(artwork.mime || ""))) return null;
    const existing = this.musicArtworkUrls.get(artwork.artworkKey);
    if (existing) {
      existing.usedAt = Date.now();
      return existing.url;
    }
    let bytes;
    try {
      const binary = Buffer.from(artwork.base64, "base64");
      if (binary.byteLength !== byteLength) return null;
      bytes = new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength);
    } catch (error) {
      return null;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: artwork.mime }));
    this.musicArtworkUrls.set(artwork.artworkKey, { url, byteLength, usedAt: Date.now() });
    let total = Array.from(this.musicArtworkUrls.values()).reduce((sum, item) => sum + item.byteLength, 0);
    while (this.musicArtworkUrls.size > 6 || total > 4 * 1024 * 1024) {
      const oldest = Array.from(this.musicArtworkUrls.entries()).sort((a, b) => a[1].usedAt - b[1].usedAt)[0];
      if (!oldest || oldest[0] === artwork.artworkKey && this.musicArtworkUrls.size === 1) break;
      this.musicArtworkUrls.delete(oldest[0]);
      total -= oldest[1].byteLength;
      URL.revokeObjectURL(oldest[1].url);
    }
    return url;
  }

  adoptMusicSnapshot(payload) {
    let selected = payload && payload.selected && typeof payload.selected === "object"
      ? { ...payload.selected }
      : null;
    if (selected && jamDeckMediaProvider(selected.sourceAppId).id === "other") selected = null;
    if (selected) {
      const artwork = selected.artwork;
      delete selected.artwork;
      if (artwork && artwork.artworkKey === selected.artworkKey) {
        selected.artworkUrl = this.musicArtworkUrl(artwork);
      } else {
        const cached = this.musicArtworkUrls.get(selected.artworkKey);
        selected.artworkUrl = cached ? cached.url : null;
        if (cached) cached.usedAt = Date.now();
      }
      selected.provider = jamDeckMediaProvider(selected.sourceAppId).id;
    }
    const nextRevision = (Number(this.musicSnapshot.revision) || 0) + 1;
    this.musicSnapshot = {
      connection: "ready",
      sessions: Array.isArray(payload && payload.sessions) ? payload.sessions.map((session) => ({
        sourceAppId: String(session.sourceAppId || "").slice(0, 256),
        playbackStatus: String(session.playbackStatus || "unknown").toLowerCase(),
        provider: jamDeckMediaProvider(session.sourceAppId).id,
        sessionCount: Math.max(0, Number(session.sessionCount) || 0),
        ambiguous: !!session.ambiguous || Number(session.sessionCount) !== 1,
      })).filter((session) => session.provider !== "other") : [],
      selected,
      bridgeGeneration: String(payload && payload.bridgeGeneration || ""),
      snapshotSeq: Math.max(0, Number(payload && payload.snapshotSeq) || 0),
      receivedAt: Date.now(),
      revision: nextRevision,
    };
    const pending = this.musicPending;
    if (pending && nextRevision > pending.issuedRevision) {
      let confirmed = false;
      if (pending.action === "launch") {
        confirmed = !!selected && selected.provider === pending.provider;
      } else if (selected && selected.sourceAppId === pending.sourceAppId) {
        confirmed = pending.action === "toggle"
          ? pending.wasPlaying ? selected.playbackStatus !== "playing" : selected.playbackStatus === "playing"
          : pending.action === "seek"
            ? selected.trackKey === pending.trackKey
              && Math.abs((Number(selected.timeline && selected.timeline.positionMs) || 0) - pending.targetPositionMs) <= 2000
            : selected.trackKey && selected.trackKey !== pending.trackKey;
      }
      if (confirmed) {
        this.musicPending = null;
        this.cancelMusicLaunchProbe();
      }
    }
    this.maybePersistMusicProvider(selected);
    this.updateMusicViews();
  }

  maybePersistMusicProvider(selected) {
    if (!selected || !["qqmusic", "netease", "qishui"].includes(selected.provider)) return;
    const session = (this.musicSnapshot.sessions || []).find((item) => item.sourceAppId === selected.sourceAppId);
    const capabilities = selected.capabilities || {};
    if (!session || session.ambiguous || !Object.values(capabilities).some(Boolean)) return;
    const launcher = this.settings.musicLauncher || { schemaVersion: 1, lastConnectedProvider: null };
    if (launcher.lastConnectedProvider === selected.provider || this.musicProviderPersisting === selected.provider) return;
    const previous = launcher.lastConnectedProvider || null;
    this.settings.musicLauncher = { schemaVersion: 1, lastConnectedProvider: selected.provider };
    this.musicProviderPersisting = selected.provider;
    void this.saveSettings().catch((error) => {
      if (this.settings.musicLauncher.lastConnectedProvider === selected.provider) {
        this.settings.musicLauncher = { schemaVersion: 1, lastConnectedProvider: previous };
      }
      console.error("jam-deck music provider preference save failed", error);
    }).finally(() => {
      if (this.musicProviderPersisting === selected.provider) this.musicProviderPersisting = null;
    });
  }

  async pollMusicMedia(force = false, preferredOverride = null) {
    const widgets = this.getMusicWidgets();
    if (!widgets.length) {
      if (this.mediaBridge) await this.stopMusicMedia();
      return false;
    }
    if (this.mediaPollBusy) return false;
    const now = Date.now();
    const visible = !document.hidden && this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0;
    const playing = this.musicSnapshot.selected && this.musicSnapshot.selected.playbackStatus === "playing";
    const interval = !visible ? 15000 : playing ? 2000 : 5000;
    if (!force && now - this.musicLastPollAt < interval) return false;
    if (!(await this.ensureMusicMedia())) return false;
    this.mediaPollBusy = true;
    this.musicLastPollAt = now;
    try {
      const preferredSource = preferredOverride != null
        ? preferredOverride
        : String(widgets[0].config && widgets[0].config.mediaSourceId
          || this.musicSnapshot.selected && this.musicSnapshot.selected.sourceAppId
          || "");
      const knownArtworkKey = this.musicSnapshot.selected && this.musicSnapshot.selected.artworkKey || "";
      let payload = await this.mediaBridge.request("snapshot", { preferredSource, knownArtworkKey });
      if (payload && payload.selected && jamDeckMediaProvider(payload.selected.sourceAppId).id === "other") {
        const known = (payload.sessions || []).find((session) =>
          jamDeckMediaProvider(session.sourceAppId).id !== "other" && !session.ambiguous && Number(session.sessionCount) === 1
        );
        if (known) {
          payload = await this.mediaBridge.request("snapshot", {
            preferredSource: known.sourceAppId,
            knownArtworkKey,
          });
        }
      }
      this.adoptMusicSnapshot(payload);
      return true;
    } catch (error) {
      if (!this.mediaBridge || !this.mediaBridge.ready) this.musicSnapshot.connection = "degraded";
      this.updateMusicViews();
      return false;
    } finally {
      this.mediaPollBusy = false;
    }
  }

  async controlMusic(widgetId, action, targetPositionMs = null) {
    const widget = this.settings.widgets.find((item) => item.id === widgetId && item.type === "music");
    const selected = this.musicSnapshot.selected;
    if (!widget || !["toggle", "previous", "next", "seek"].includes(action)) return false;
    if (this.musicPending) return false;
    if (!selected && action === "toggle") return this.launchLastMusicProvider(widget);
    if (!selected) return false;
    const capabilities = selected.capabilities || {};
    const allowed = action === "toggle"
      ? capabilities.canToggle || (selected.playbackStatus === "playing" ? capabilities.canPause : capabilities.canPlay)
      : action === "previous" ? capabilities.canPrevious
        : action === "next" ? capabilities.canNext
          : capabilities.canSeek && Number.isFinite(targetPositionMs);
    if (!allowed) return false;
    const duration = Math.max(0, Number(selected.timeline && selected.timeline.durationMs) || 0);
    const seekPosition = action === "seek"
      ? Math.round(Math.max(0, Math.min(duration, Number(targetPositionMs) || 0)))
      : null;
    const pending = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action,
      sourceAppId: selected.sourceAppId,
      trackKey: selected.trackKey,
      wasPlaying: selected.playbackStatus === "playing",
      targetPositionMs: seekPosition,
      issuedRevision: Number(this.musicSnapshot.revision) || 0,
      deadline: Date.now() + (action === "seek" ? 4000 : 3200),
    };
    this.musicPending = pending;
    this.updateMusicViews();
    try {
      const response = await this.mediaBridge.request("control", {
        bridgeGeneration: this.musicSnapshot.bridgeGeneration,
        sourceAppId: selected.sourceAppId,
        trackKey: selected.trackKey,
        positionMs: seekPosition,
        action,
      });
      if (!response || response.accepted !== true) throw Object.assign(new Error("media command rejected"), { code: "COMMAND_REJECTED" });
      window.setTimeout(() => void this.pollMusicMedia(true), 220);
      window.setTimeout(() => void this.pollMusicMedia(true), 900);
      window.setTimeout(() => {
        if (!this.musicPending || this.musicPending.id !== pending.id) return;
        this.musicPending = null;
        this.updateMusicViews();
        new Notice("Jam Deck：播放器接受了请求，但未确认状态变化");
      }, action === "seek" ? 4100 : 3300);
      return true;
    } catch (error) {
      if (this.musicPending && this.musicPending.id === pending.id) this.musicPending = null;
      this.updateMusicViews();
      new Notice("Jam Deck：当前播放器未响应这个控制");
      return false;
    }
  }

  async launchLastMusicProvider(widget) {
    const provider = this.settings.musicLauncher && this.settings.musicLauncher.lastConnectedProvider;
    if (!widget || !["qqmusic", "netease", "qishui"].includes(provider)) {
      new Notice("Jam Deck：请先打开一次受支持的音乐软件");
      return false;
    }
    if (!(await this.ensureMusicMedia()) || this.musicPending) return false;
    const pending = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action: "launch",
      provider,
      issuedRevision: Number(this.musicSnapshot.revision) || 0,
      deadline: Date.now() + MEDIA_LAUNCH_TIMEOUT_MS,
    };
    this.musicPending = pending;
    this.updateMusicViews();
    try {
      const response = await this.mediaBridge.request("control", { action: "launch_provider", provider });
      if (!response || response.accepted !== true) throw new Error("launch rejected");
      this.startMusicLaunchProbe(pending);
      return true;
    } catch (error) {
      if (this.musicPending && this.musicPending.id === pending.id) this.musicPending = null;
      this.updateMusicViews();
      new Notice("Jam Deck：无法启动上次连接的音乐软件");
      return false;
    }
  }

  startMusicLaunchProbe(pending) {
    this.cancelMusicLaunchProbe(false);
    const generation = ++this.musicLaunchGeneration;
    const probe = async () => {
      if (generation !== this.musicLaunchGeneration || !this.musicPending || this.musicPending.id !== pending.id) return;
      await this.pollMusicMedia(true);
      const selected = this.musicSnapshot.selected;
      if (selected && selected.provider === pending.provider) {
        this.musicPending = null;
        this.cancelMusicLaunchProbe();
        this.updateMusicViews();
        return;
      }
      if (Date.now() >= pending.deadline) {
        this.musicPending = null;
        this.cancelMusicLaunchProbe();
        this.updateMusicViews();
        new Notice("Jam Deck：音乐软件已启动，但尚未发现媒体会话");
        return;
      }
      this.musicLaunchTimer = window.setTimeout(probe, MEDIA_LAUNCH_POLL_MS);
    };
    this.musicLaunchTimer = window.setTimeout(probe, MEDIA_LAUNCH_POLL_MS);
  }

  cancelMusicLaunchProbe(invalidate = true) {
    if (this.musicLaunchTimer != null) window.clearTimeout(this.musicLaunchTimer);
    this.musicLaunchTimer = null;
    if (invalidate) this.musicLaunchGeneration += 1;
  }

  async setMusicSource(widgetId, sourceAppId) {
    const widget = this.settings.widgets.find((item) => item.id === widgetId && item.type === "music");
    const source = String(sourceAppId || "").slice(0, 256);
    if (!widget) return false;
    const exists = (this.musicSnapshot.sessions || []).some((session) => session.sourceAppId === source);
    const session = (this.musicSnapshot.sessions || []).find((item) => item.sourceAppId === source);
    if (source && (!exists || !session || session.ambiguous)) return false;
    widget.config = { ...(widget.config || {}), mediaSourceId: source, musicSchemaVersion: 1 };
    await this.saveSettings();
    this.musicPending = null;
    await this.pollMusicMedia(true, source);
    return true;
  }

  async stopMusicMedia() {
    const bridge = this.mediaBridge;
    this.mediaBridge = null;
    this.musicPending = null;
    this.cancelMusicLaunchProbe();
    if (this.musicProviderSaveTimer != null) window.clearTimeout(this.musicProviderSaveTimer);
    this.musicProviderSaveTimer = null;
    if (bridge) await bridge.stop();
    for (const item of this.musicArtworkUrls.values()) URL.revokeObjectURL(item.url);
    this.musicArtworkUrls.clear();
    this.musicSnapshot = {
      connection: process.platform === "win32" ? "idle" : "unsupported",
      sessions: [],
      selected: null,
      receivedAt: Date.now(),
      revision: (Number(this.musicSnapshot.revision) || 0) + 1,
    };
  }

  hasCollision(candidate, widgets) {
    return widgets.some((other) =>
      candidate.x < other.x + other.w &&
      candidate.x + candidate.w > other.x &&
      candidate.y < other.y + other.h &&
      candidate.y + candidate.h > other.y
    );
  }

  findSpace(widgets, w, h, preferredX, preferredY) {
    const maxX = GRID_COLS - w + 1;
    const maxY = GRID_ROWS - h + 1;
    const originX = Math.max(1, Math.min(maxX, preferredX || 1));
    const originY = Math.max(1, Math.min(maxY, preferredY || 1));
    const first = { x: originX, y: originY, w, h };
    if (!this.hasCollision(first, widgets)) return first;

    for (let distance = 1; distance <= GRID_ROWS; distance++) {
      for (let y = Math.max(1, originY - distance); y <= Math.min(maxY, originY + distance); y++) {
        for (let x = Math.max(1, originX - distance); x <= Math.min(maxX, originX + distance); x++) {
          if (Math.abs(x - originX) !== distance && Math.abs(y - originY) !== distance) continue;
          const candidate = { x, y, w, h };
          if (!this.hasCollision(candidate, widgets)) return candidate;
        }
      }
    }
    return null;
  }

  async addWidget(type) {
    const def = WIDGET_DEFS[type];
    if (!def) return;
    if (type === "music" && this.settings.widgets.some((widget) => widget.type === "music")) {
      new Notice("Jam Deck：音乐播放器组件已经存在");
      return;
    }
    const space = this.findSpace(this.settings.widgets, def.w, def.h, 1, 1);
    if (!space) {
      new Notice("Jam Deck：当前固定网格已满，请缩小或删除一个组件");
      return;
    }
    const id = `${type}-${Date.now()}`;
    const config = type === "browser" ? { url: "" }
      : type === "music" ? { mediaSourceId: "", musicSchemaVersion: 1 }
        : {};
    this.settings.widgets.push({ id, type, x: space.x, y: space.y, w: def.w, h: def.h, config });
    await this.saveSettings();
    this.renderAllViews();
    if (type === "music") void this.pollMusicMedia(true);
  }

  hasCanvasEmbedPath(path) {
    return this.settings.widgets.some((widget) => widget.type === "canvas-embed" && widget.config && widget.config.filePath === path);
  }

  canvasInkOwnerKey(path) {
    return jamDeckInkNormalizePath(path).toLocaleLowerCase("en-US");
  }

  getCanvasInkSidecarPath(path, suffix = "") {
    return jamDeckInkSidecarPath(path, suffix);
  }

  async acquireCanvasInkOwner(canvasPath) {
    if (!this.canvasInkOwners) this.canvasInkOwners = new Map();
    const key = this.canvasInkOwnerKey(canvasPath);
    let owner = this.canvasInkOwners.get(key);
    if (!owner) {
      owner = new CanvasInkOwner(this, canvasPath);
      this.canvasInkOwners.set(key, owner);
    }
    owner.refCount++;
    await owner.loading;
    return owner;
  }

  async releaseCanvasInkOwner(owner) {
    if (!owner) return;
    owner.refCount = Math.max(0, owner.refCount - 1);
    if (owner.refCount > 0) return;
    await owner.flush();
    if (owner.refCount === 0 && !owner.dirty && this.canvasInkOwners) this.canvasInkOwners.delete(this.canvasInkOwnerKey(owner.canvasPath));
  }

  async moveCanvasInkFiles(oldCanvasPath, newCanvasPath) {
    for (const suffix of ["", ".tmp", ".bak"]) {
      const oldPath = jamDeckInkSidecarPath(oldCanvasPath, suffix);
      const newPath = jamDeckInkSidecarPath(newCanvasPath, suffix);
      const source = this.app.vault.getAbstractFileByPath(oldPath);
      if (!source) continue;
      if (this.app.vault.getAbstractFileByPath(newPath)) throw new Error(`绘图数据目标已存在：${newPath}`);
      await this.app.vault.rename(source, newPath);
    }
  }

  async relocateCanvasInkOwner(oldCanvasPath, newCanvasPath) {
    const oldKey = this.canvasInkOwnerKey(oldCanvasPath);
    const owner = this.canvasInkOwners && this.canvasInkOwners.get(oldKey);
    if (owner) {
      if (owner.writer && typeof owner.writer.exit === "function") owner.writer.exit();
      await owner.flush();
    }
    try {
      await this.moveCanvasInkFiles(oldCanvasPath, newCanvasPath);
    } catch (error) {
      if (owner) owner.readonly = true;
      new Notice(`Jam Deck：Canvas 绘图数据未随文件移动 · ${error.message || "目标冲突"}`);
      return false;
    }
    if (owner) {
      this.canvasInkOwners.delete(oldKey);
      owner.canvasPath = jamDeckInkNormalizePath(newCanvasPath);
      owner.sidecarPath = jamDeckInkSidecarPath(owner.canvasPath);
      owner.document.canvas.path = owner.canvasPath;
      owner.markChanged();
      this.canvasInkOwners.set(this.canvasInkOwnerKey(newCanvasPath), owner);
    }
    return true;
  }

  async handleCanvasInkDeleted(canvasPath) {
    const key = this.canvasInkOwnerKey(canvasPath);
    const owner = this.canvasInkOwners && this.canvasInkOwners.get(key);
    if (owner) {
      owner.readonly = true;
      if (owner.writer && typeof owner.writer.exit === "function") owner.writer.exit();
    }
    for (const suffix of ["", ".tmp", ".bak"]) {
      const path = jamDeckInkSidecarPath(canvasPath, suffix);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) continue;
      try {
        if (!this.app.fileManager || typeof this.app.fileManager.trashFile !== "function") throw new Error("回收站接口不可用");
        await this.app.fileManager.trashFile(file);
      } catch (error) {
        console.error("jam-deck canvas ink orphan retained", error);
        new Notice("Jam Deck：Canvas 已删除，绘图 sidecar 已保留以便恢复");
        break;
      }
    }
    if (owner && this.canvasInkOwners) this.canvasInkOwners.delete(key);
  }

  async addCanvasEmbedWidget(filePath) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || file.extension !== "canvas") {
      new Notice("Jam Deck：请选择有效的 Canvas 文件");
      return false;
    }
    const def = WIDGET_DEFS["canvas-embed"];
    const space = this.findSpace(this.settings.widgets, def.w, def.h, 1, 1);
    if (!space) {
      new Notice("Jam Deck：没有足够空间放置原生 Canvas，请先整理或缩小其他组件");
      return false;
    }
    this.settings.widgets.push({
      id: `canvas-embed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "canvas-embed",
      x: space.x,
      y: space.y,
      w: def.w,
      h: def.h,
      config: { filePath: file.path, schemaVersion: 1 },
    });
    await this.saveSettings();
    this.renderAllViews();
    return true;
  }

  async setCanvasEmbedFile(widgetId, filePath) {
    const widget = this.settings.widgets.find((item) => item.id === widgetId && item.type === "canvas-embed");
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!widget || !file || file.extension !== "canvas") {
      new Notice("Jam Deck：请选择有效的 Canvas 文件");
      return false;
    }
    widget.config = { ...(widget.config || {}), filePath: file.path, schemaVersion: 1 };
    await this.saveSettings();
    this.renderAllViews();
    return true;
  }

  async handleCanvasFileRenamed(file, oldPath) {
    if (!file || file.extension !== "canvas" || !oldPath) return;
    await this.relocateCanvasInkOwner(oldPath, file.path);
    let changed = false;
    for (const widget of this.settings.widgets) {
      if (widget.type !== "canvas-embed" || !widget.config || widget.config.filePath !== oldPath) continue;
      widget.config.filePath = file.path;
      widget.config.schemaVersion = 1;
      changed = true;
    }
    if (!changed) return;
    await this.saveSettings();
    this.renderAllViews();
  }

  async openCanvasFile(filePath) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || file.extension !== "canvas") {
      new Notice("Jam Deck：Canvas 文件不存在，请重新选择");
      return false;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
    return true;
  }

  async removeWidget(id) {
    const removed = this.settings.widgets.find((widget) => widget.id === id);
    this.settings.widgets = this.settings.widgets.filter((widget) => widget.id !== id);
    await this.saveSettings();
    this.renderAllViews();
    if (removed && removed.type === "music" && !this.getMusicWidgets().length) await this.stopMusicMedia();
  }

  async placeWidget(id, x, y, w, h) {
    const moving = this.settings.widgets.find((widget) => widget.id === id);
    if (!moving) return;
    const others = this.settings.widgets.filter((widget) => widget.id !== id);
    const safeX = Math.max(1, Math.min(GRID_COLS - w + 1, x));
    const safeY = Math.max(1, Math.min(GRID_ROWS - h + 1, y));
    let spot = { x: safeX, y: safeY, w, h };
    if (this.hasCollision(spot, others)) {
      spot = this.findSpace(others, w, h, safeX, safeY);
    }
    if (!spot) {
      new Notice("Jam Deck：没有足够的空位，请缩小其他组件");
      this.renderAllViews();
      return;
    }
    Object.assign(moving, spot);
    await this.saveSettings();
    this.renderAllViews();
  }

  async restoreWidgetDisplay(id) {
    if (!this.widgetRestoreLocks) this.widgetRestoreLocks = new Set();
    if (this.widgetRestoreLocks.has(id)) return false;
    this.widgetRestoreLocks.add(id);
    try {
      const widget = this.settings.widgets.find((item) => item.id === id);
      const minimum = jamDeckWidgetDisplayMinimum(widget);
      if (!widget || !minimum || !jamDeckWidgetIsCompact(widget)) return false;
      const result = jamDeckResolveWidgetRestoreLayout(this.settings.widgets, id);
      if (result.status === "SEARCH_LIMIT") {
        new Notice(`Jam Deck：恢复${WIDGET_DEFS[widget.type].label}的自动让位计算达到上限，布局未更改`);
        this.renderAllViews();
        return false;
      }
      if (result.status !== "OK" || !result.layout) {
        new Notice(`Jam Deck：没有足够空间恢复${WIDGET_DEFS[widget.type].label}，布局未更改`);
        this.renderAllViews();
        return false;
      }
      if (!jamDeckWidgetLayoutCollisionFree(result.layout)) {
        new Notice(`Jam Deck：${WIDGET_DEFS[widget.type].label}恢复布局校验失败`);
        this.renderAllViews();
        return false;
      }
      try {
        await this.commitWidgetLayout(result.layout);
      } catch (error) {
        console.error("jam-deck widget restore failed", error);
        new Notice(`Jam Deck：恢复${WIDGET_DEFS[widget.type].label}失败，布局已回滚`);
        return false;
      }
      if (result.movedIds.length) new Notice(`Jam Deck：已恢复${WIDGET_DEFS[widget.type].label}，并自动让位 ${result.movedIds.length} 个组件`);
      return true;
    } finally {
      this.widgetRestoreLocks.delete(id);
    }
  }

  async commitWidgetLayout(layout) {
    if (!Array.isArray(layout) || !layout.length) return false;
    const previous = this.settings.widgets.map((widget) => ({
      id: widget.id,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
    }));
    const byId = new Map(layout.map((item) => [item.id, item]));
    let changed = false;
    for (const widget of this.settings.widgets) {
      const next = byId.get(widget.id);
      if (!next) continue;
      const x = Math.max(1, Math.min(GRID_COLS - next.w + 1, Number(next.x) || widget.x));
      const y = Math.max(1, Math.min(GRID_ROWS - next.h + 1, Number(next.y) || widget.y));
      const w = Math.max(JAM_DECK_WIDGET_MIN_W, Math.min(GRID_COLS - x + 1, Number(next.w) || widget.w));
      const h = Math.max(JAM_DECK_WIDGET_MIN_H, Math.min(GRID_ROWS - y + 1, Number(next.h) || widget.h));
      if (widget.x !== x || widget.y !== y || widget.w !== w || widget.h !== h) {
        widget.x = x;
        widget.y = y;
        widget.w = w;
        widget.h = h;
        changed = true;
      }
    }
    if (!changed) {
      this.renderAllViews();
      return true;
    }
    try {
      await this.saveSettings();
      this.renderAllViews();
      return true;
    } catch (error) {
      const previousById = new Map(previous.map((item) => [item.id, item]));
      for (const widget of this.settings.widgets) {
        const before = previousById.get(widget.id);
        if (before) Object.assign(widget, before);
      }
      this.renderAllViews();
      throw error;
    }
  }

  async autoArrange() {
    const sorted = [...this.settings.widgets].sort((a, b) => a.y - b.y || a.x - b.x);
    const placed = [];
    for (const widget of sorted) {
      const spot = this.findSpace(placed, widget.w, widget.h, 1, 1);
      if (spot) Object.assign(widget, spot);
      placed.push(widget);
    }
    this.settings.widgets = sorted;
    await this.saveSettings();
    this.renderAllViews();
  }

  async configureBrowser(id) {
    new BrowserConfigModal(this.app, this, id).open();
  }

  async setBrowserUrl(id, url) {
    const widget = this.settings.widgets.find((item) => item.id === id);
    if (!widget) return;
    widget.config = Object.assign({}, widget.config, { url });
    await this.saveSettings();
    this.renderAllViews();
  }

  enableLauncherDrop(body, widgetId) {
    body.addClass("jam-deck-launcher-dropzone");
    const clear = () => body.removeClass("is-drop-target");
    body.addEventListener("dragover", (event) => {
      const types = Array.from((event.dataTransfer && event.dataTransfer.types) || []);
      if (types.includes(SHORTCUT_DRAG_MIME)) return;
      if (!types.some((type) => [CLIPBOARD_DRAG_MIME, "text/uri-list", "Files", "text/plain"].includes(type))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      body.addClass("is-drop-target");
    });
    body.addEventListener("dragleave", (event) => {
      if (!body.contains(event.relatedTarget)) clear();
    });
    body.addEventListener("drop", async (event) => {
      const types = Array.from((event.dataTransfer && event.dataTransfer.types) || []);
      if (types.includes(SHORTCUT_DRAG_MIME)) return;
      event.preventDefault();
      clear();
      await this.handleLauncherDrop(widgetId, event.dataTransfer);
    });
  }

  normalizeHttpUrl(raw) {
    if (typeof raw !== "string") return null;
    const value = raw.trim();
    if (!value || value.length > SHORTCUT_URL_LIMIT || /[\u0000-\u001F\u007F]/.test(value)) return null;
    let parsed;
    try { parsed = new URL(value); } catch (error) { return null; }
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
    parsed.hash = "";
    if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) parsed.port = "";
    if (!parsed.pathname) parsed.pathname = "/";
    return { url: parsed.toString(), hostname: parsed.hostname.toLowerCase() };
  }

  isUrlShortcut(shortcut) {
    return Boolean(shortcut && shortcut.kind === "url" && this.normalizeHttpUrl(shortcut.url));
  }

  getShortcutTarget(shortcut) {
    if (this.isUrlShortcut(shortcut)) return this.normalizeHttpUrl(shortcut.url).url;
    return String(shortcut && shortcut.path || "");
  }

  getUrlDisplayName(normalized) {
    const ascii = String(normalized && normalized.hostname || "").replace(/^www\./i, "");
    if (!ascii) return "网页";
    let display = ascii;
    try {
      const { domainToASCII, domainToUnicode } = require("url");
      const unicode = domainToUnicode(ascii);
      if (unicode && domainToASCII(unicode).toLowerCase() === ascii.toLowerCase()) display = unicode;
    } catch (error) {}
    return Array.from(display).slice(0, 80).join("");
  }

  getUrlShortcutVisual(shortcut) {
    const normalized = this.normalizeHttpUrl(shortcut && shortcut.url);
    const hostname = normalized ? normalized.hostname.replace(/^www\./i, "") : "";
    const first = Array.from(hostname).find((char) => /[\p{L}\p{N}]/u.test(char));
    let hash = 2166136261;
    for (const char of hostname) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return { label: first ? first.toLocaleUpperCase().slice(0, 2) : "", tone: hash % 6 };
  }

  normalizeShortcutIconPath(value) {
    const raw = String(value || "").replace(/\\/g, "/").normalize("NFC");
    if (!raw || raw.includes("\0") || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
    const parts = raw.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) return null;
    const normalized = typeof normalizePath === "function" ? normalizePath(raw) : raw.replace(/\/{2,}/g, "/");
    return normalized && !normalized.startsWith("../") ? normalized : null;
  }

  resolveShortcutIconPath(shortcut) {
    const path = this.normalizeShortcutIconPath(shortcut && shortcut.iconPath);
    if (!path) return null;
    const exact = this.app && this.app.vault && this.app.vault.getAbstractFileByPath(path);
    if (exact && !exact.children) return exact.path || path;
    if (!/\.(png|jpe?g)$/i.test(path)) return null;
    const slash = path.lastIndexOf("/");
    const directory = slash >= 0 ? path.slice(0, slash) : "";
    const stem = path.slice(slash + 1).replace(/\.[^.]+$/, "").normalize("NFC").toLowerCase();
    const candidates = [];
    const add = (candidate) => {
      const candidatePath = this.normalizeShortcutIconPath(candidate && (candidate.path || candidate));
      if (!candidatePath || candidates.includes(candidatePath)) return;
      const candidateSlash = candidatePath.lastIndexOf("/");
      const candidateDir = candidateSlash >= 0 ? candidatePath.slice(0, candidateSlash) : "";
      const candidateName = candidatePath.slice(candidateSlash + 1);
      if (candidateDir.normalize("NFC").toLowerCase() !== directory.normalize("NFC").toLowerCase()) return;
      if (!/\.webp$/i.test(candidateName) || candidateName.replace(/\.[^.]+$/, "").normalize("NFC").toLowerCase() !== stem) return;
      candidates.push(candidatePath);
    };
    const direct = path.replace(/\.[^.]+$/, ".webp");
    const directFile = this.app.vault.getAbstractFileByPath(direct);
    if (directFile && !directFile.children) add(directFile);
    const folder = directory ? this.app.vault.getAbstractFileByPath(directory) : null;
    if (folder && Array.isArray(folder.children)) {
      for (const file of folder.children) add(file);
    } else if (typeof this.app.vault.getFiles === "function") {
      for (const file of this.app.vault.getFiles()) add(file);
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  parseLauncherUriList(raw) {
    const urls = [];
    for (const line of String(raw || "").split(/\r?\n/)) {
      const value = line.trim();
      if (!value || value.startsWith("#")) continue;
      const normalized = this.normalizeHttpUrl(value);
      if (normalized) urls.push(normalized.url);
      if (urls.length >= SHORTCUT_URI_LIST_LIMIT) break;
    }
    return [...new Set(urls)];
  }

  async handleLauncherDrop(widgetId, transfer) {
    if (!transfer) return false;
    const internal = this.getClipboardItemFromTransfer(transfer);
    if (internal) {
      if (internal.type !== "text") return false;
      const normalized = this.normalizeHttpUrl(String(internal.content || ""));
      return normalized ? this.addUrlShortcuts(widgetId, [normalized.url]) : false;
    }
    let uriList = "";
    try { uriList = transfer.getData("text/uri-list"); } catch (error) {}
    const uriUrls = this.parseLauncherUriList(uriList);
    if (uriUrls.length) return this.addUrlShortcuts(widgetId, uriUrls);
    const files = Array.from(transfer.files || []);
    if (files.length) {
      await this.addDroppedShortcuts(widgetId, files);
      return true;
    }
    let plain = "";
    try { plain = transfer.getData("text/plain"); } catch (error) {}
    const normalized = this.normalizeHttpUrl(plain);
    return normalized ? this.addUrlShortcuts(widgetId, [normalized.url]) : false;
  }

  enqueueShortcutMutation(operation) {
    if (!this.shortcutMutationQueue) this.shortcutMutationQueue = Promise.resolve();
    const queued = this.shortcutMutationQueue.then(operation);
    this.shortcutMutationQueue = queued.catch(() => {});
    return queued;
  }

  async addUrlShortcuts(widgetId, values) {
    if (!this.pendingShortcutUrls) this.pendingShortcutUrls = new Set();
    const normalized = values.map((value) => this.normalizeHttpUrl(value)).filter(Boolean);
    const unique = [...new Map(normalized.map((entry) => [entry.url, entry])).values()];
    const reserved = unique.filter((entry) => !this.pendingShortcutUrls.has(entry.url));
    for (const entry of reserved) this.pendingShortcutUrls.add(entry.url);
    if (!reserved.length) return false;
    return this.enqueueShortcutMutation(async () => {
      try {
        const widget = this.settings.widgets.find((item) => item.id === widgetId);
        if (!widget) return false;
        widget.config = widget.config || {};
        const current = Array.isArray(widget.config.shortcuts) ? widget.config.shortcuts : [];
        const existing = new Set(current.filter((shortcut) => shortcut && shortcut.kind === "url")
          .map((shortcut) => this.normalizeHttpUrl(shortcut.url)).filter(Boolean).map((entry) => entry.url));
        const additions = reserved.filter((entry) => !existing.has(entry.url)).map((entry, index) => ({
          id: `sc-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
          name: this.getUrlDisplayName(entry),
          kind: "url",
          url: entry.url,
          isFolder: false,
        }));
        if (!additions.length) {
          new Notice("Jam Deck：该网页快捷方式已存在");
          return false;
        }
        const before = current.slice();
        widget.config.shortcuts = [...current, ...additions];
        this.renderAllViews();
        try {
          await this.saveSettings();
        } catch (error) {
          widget.config.shortcuts = before;
          this.renderAllViews();
          new Notice("Jam Deck：网页快捷方式保存失败，已恢复");
          return false;
        }
        new Notice(`Jam Deck：已添加 ${additions.length} 个网页快捷方式`);
        return true;
      } finally {
        for (const entry of reserved) this.pendingShortcutUrls.delete(entry.url);
      }
    });
  }

  async reorderShortcut(widgetId, movedId, targetId, after) {
    return this.enqueueShortcutMutation(async () => {
      const widget = this.settings.widgets.find((item) => item.id === widgetId);
      const shortcuts = widget && widget.config && Array.isArray(widget.config.shortcuts) ? widget.config.shortcuts : null;
      if (!shortcuts) return null;
      const before = shortcuts.slice();
      const from = shortcuts.findIndex((item) => item.id === movedId);
      if (from < 0) return null;
      const moved = shortcuts[from];
      const next = shortcuts.slice();
      next.splice(from, 1);
      let insertAt = next.length;
      if (targetId) {
        const targetIndex = next.findIndex((item) => item.id === targetId);
        if (targetIndex < 0) return null;
        insertAt = targetIndex + (after ? 1 : 0);
      }
      next.splice(insertAt, 0, moved);
      if (next.every((item, index) => item.id === before[index].id)) return null;
      widget.config.shortcuts = next;
      this.renderAllViews();
      try {
        await this.saveSettings();
      } catch (error) {
        widget.config.shortcuts = before;
        this.renderAllViews();
        new Notice("Jam Deck：排序保存失败，已恢复原位置");
        return { ok: false, message: "排序保存失败，已恢复原位置。" };
      }
      const position = next.findIndex((item) => item.id === movedId) + 1;
      return { ok: true, position, total: next.length, message: `已将 ${moved.name} 移动到第 ${position} 项，共 ${next.length} 项。` };
    });
  }

  getDroppedFilePath(file) {
    try {
      const electron = require("electron");
      if (electron.webUtils && typeof electron.webUtils.getPathForFile === "function") {
        const resolved = electron.webUtils.getPathForFile(file);
        if (resolved) return resolved;
      }
    } catch (error) {}
    return file && typeof file.path === "string" ? file.path : "";
  }

  async addDroppedShortcuts(widgetId, files) {
    const widget = this.settings.widgets.find((item) => item.id === widgetId);
    if (!widget) return;
    let fs;
    let pathApi;
    try {
      fs = require("fs");
      pathApi = require("path");
    } catch (error) {
      new Notice("Jam Deck：当前环境无法读取系统路径，不能添加快捷方式");
      return;
    }
    widget.config = widget.config || {};
    widget.config.shortcuts = Array.isArray(widget.config.shortcuts) ? widget.config.shortcuts : [];
    const pathKey = (value) => pathApi.resolve(value).replace(/\//g, "\\").replace(/[\\]+$/, "").toLowerCase();
    const seen = new Set(widget.config.shortcuts.map((shortcut) => {
      try { return pathKey(shortcut.path); } catch (error) { return String(shortcut.path || "").toLowerCase(); }
    }));
    const added = [];
    const failed = [];
    const iconPaths = [];
    for (const file of files) {
      const droppedPath = this.getDroppedFilePath(file);
      if (!droppedPath) {
        failed.push(file.name || "未知项目（无系统路径）");
        continue;
      }
      try {
        const absolutePath = pathApi.resolve(droppedPath);
        const key = pathKey(absolutePath);
        if (seen.has(key)) continue;
        const stat = fs.statSync(absolutePath);
        const isFolder = stat.isDirectory();
        const id = `sc-${Date.now()}-${added.length}-${Math.random().toString(36).slice(2, 6)}`;
        const parsed = pathApi.parse(absolutePath);
        const name = isFolder ? parsed.base : parsed.name;
        let iconPath = null;
        if (!isFolder) {
          iconPath = await this.extractExeIcon(absolutePath, id);
          if (iconPath) iconPaths.push(iconPath);
        }
        added.push({ id, name, path: absolutePath, isFolder, iconPath });
        seen.add(key);
      } catch (error) {
        failed.push(file.name || droppedPath);
      }
    }
    if (!added.length) {
      new Notice(failed.length ? `Jam Deck：没有可添加的项目（失败 ${failed.length} 项）` : "Jam Deck：拖入的项目已存在");
      return;
    }
    widget.config.shortcuts.push(...added);
    try {
      await this.saveSettings();
    } catch (error) {
      const addedIds = new Set(added.map((shortcut) => shortcut.id));
      widget.config.shortcuts = widget.config.shortcuts.filter((shortcut) => !addedIds.has(shortcut.id));
      await this.removeVaultFiles(iconPaths);
      new Notice("Jam Deck：快捷方式保存失败");
      return;
    }
    this.renderAllViews();
    new Notice(`Jam Deck：已添加 ${added.length} 项${failed.length ? `，跳过 ${failed.length} 项` : ""}`);
  }

  async ensureIconDir() {
    const { vault } = this.app;
    if (!vault.getAbstractFileByPath(ICON_DIR)) {
      try { await vault.createFolder(ICON_DIR); } catch (e) {}
    }
  }

  async extractExeIcon(exePath, shortcutId) {
    await this.ensureIconDir();
    const { exec } = require("child_process");
    const fs = require("fs");
    const vaultBase = this.app.vault.adapter.getBasePath();
    const iconDirFs = `${vaultBase}/${ICON_DIR}`;
    if (!fs.existsSync(iconDirFs)) fs.mkdirSync(iconDirFs, { recursive: true });
    const outputPath = `${iconDirFs}/${shortcutId}.png`;
    const iconRelPath = `${ICON_DIR}/${shortcutId}.png`;

    const safeExe = exePath.replace(/'/g, "''");
    const safeOut = outputPath.replace(/'/g, "''");
    const psScript = `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Icon]::ExtractAssociatedIcon('${safeExe}'); if($i){$b=$i.ToBitmap(); $b.Save('${safeOut}',[System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); $i.Dispose()}`;
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");

    return new Promise((resolve) => {
      exec(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 15000 }, (error) => {
        if (error) {
          console.error("jam-deck icon extract failed", error);
          resolve(null);
        } else {
          resolve(iconRelPath);
        }
      });
    });
  }

  async saveShortcut(widgetId, existingId, name, path) {
    const normalizedUrl = this.normalizeHttpUrl(path);
    return this.enqueueShortcutMutation(async () => {
      const widget = this.settings.widgets.find((item) => item.id === widgetId);
      if (!widget) return false;
      widget.config = widget.config || {};
      widget.config.shortcuts = Array.isArray(widget.config.shortcuts) ? widget.config.shortcuts : [];
      const before = widget.config.shortcuts.map((shortcut) => ({ ...shortcut }));
      const id = existingId || `sc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const existing = existingId ? widget.config.shortcuts.find((shortcut) => shortcut.id === existingId) : null;
      if (normalizedUrl) {
        const duplicate = widget.config.shortcuts.some((shortcut) => shortcut.id !== existingId && shortcut.kind === "url" && this.normalizeHttpUrl(shortcut.url)?.url === normalizedUrl.url);
        if (duplicate) {
          new Notice("Jam Deck：该网页快捷方式已存在");
          return false;
        }
        const next = existing || { id };
        Object.assign(next, { name, kind: "url", url: normalizedUrl.url, isFolder: false });
        delete next.path;
        delete next.iconPath;
        if (!existing) widget.config.shortcuts.push(next);
      } else {
        const isFolder = !/\.(exe|lnk|bat|cmd|app)$/i.test(path);
        let iconPath = existing ? this.resolveShortcutIconPath(existing) || existing.iconPath || null : null;
        if (!isFolder && (!existing || existing.path !== path || !iconPath)) iconPath = await this.extractExeIcon(path, id);
        const next = existing || { id };
        Object.assign(next, { name, path, isFolder, iconPath });
        delete next.kind;
        delete next.url;
        if (!existing) widget.config.shortcuts.push(next);
      }
      this.renderAllViews();
      try {
        await this.saveSettings();
      } catch (error) {
        widget.config.shortcuts = before;
        this.renderAllViews();
        new Notice("Jam Deck：快捷方式保存失败，已恢复");
        return false;
      }
      this.renderAllViews();
      return true;
    });
  }

  async deleteShortcut(widgetId, shortcutId) {
    return this.enqueueShortcutMutation(async () => {
      const widget = this.settings.widgets.find((item) => item.id === widgetId);
      if (!widget || !widget.config || !Array.isArray(widget.config.shortcuts)) return false;
      const shortcut = widget.config.shortcuts.find((item) => item.id === shortcutId);
      if (!shortcut) return false;
      const before = widget.config.shortcuts.slice();
      widget.config.shortcuts = before.filter((item) => item.id !== shortcutId);
      this.renderAllViews();
      try {
        await this.saveSettings();
      } catch (error) {
        widget.config.shortcuts = before;
        this.renderAllViews();
        new Notice("Jam Deck：快捷方式删除失败，已恢复");
        return false;
      }
      await this.cleanupManagedShortcutIcon(shortcut);
      this.renderAllViews();
      return true;
    });
  }

  getAllShortcuts() {
    const shortcuts = [];
    for (const widget of this.settings.widgets || []) {
      if (widget && widget.config && Array.isArray(widget.config.shortcuts)) shortcuts.push(...widget.config.shortcuts);
    }
    return shortcuts;
  }

  async cleanupManagedShortcutIcon(shortcut) {
    const candidate = this.resolveShortcutIconPath(shortcut);
    if (!candidate || !shortcut || !/^sc-[A-Za-z0-9_-]+$/.test(String(shortcut.id || ""))) return false;
    const normalized = this.normalizeShortcutIconPath(candidate);
    if (!normalized) return false;
    const prefix = `${ICON_DIR}/`;
    if (!normalized.toLowerCase().startsWith(prefix.toLowerCase())) return false;
    const relative = normalized.slice(prefix.length);
    if (relative.includes("/") || !new RegExp(`^${String(shortcut.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(png|jpe?g|webp|ico)$`, "i").test(relative)) return false;
    const targetKey = normalized.normalize("NFC").toLowerCase();
    const shared = this.getAllShortcuts().some((item) => {
      const exact = this.normalizeShortcutIconPath(item && item.iconPath);
      const resolved = this.resolveShortcutIconPath(item);
      return [exact, resolved].filter(Boolean).some((value) => value.normalize("NFC").toLowerCase() === targetKey);
    });
    if (shared) return false;
    let fs;
    let pathApi;
    let base;
    try {
      fs = require("fs");
      pathApi = require("path");
      base = this.app.vault.adapter.getBasePath();
      const iconDirReal = fs.realpathSync(pathApi.resolve(base, ICON_DIR));
      const fileReal = fs.realpathSync(pathApi.resolve(base, normalized));
      const realRelative = pathApi.relative(iconDirReal, fileReal);
      if (!realRelative || realRelative.startsWith("..") || pathApi.isAbsolute(realRelative) || realRelative.includes(pathApi.sep)) return false;
    } catch (error) {
      return false;
    }
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!file) return false;
    try {
      if (this.app.fileManager && typeof this.app.fileManager.trashFile === "function") await this.app.fileManager.trashFile(file);
      else await this.app.vault.delete(file);
      return true;
    } catch (error) {
      console.error("jam-deck managed icon cleanup failed", error);
      return false;
    }
  }

  async openShortcut(shortcut) {
    try {
      const { shell } = require("electron");
      if (shortcut && shortcut.kind === "url") {
        const normalized = this.normalizeHttpUrl(shortcut.url);
        if (!normalized) {
          new Notice("Jam Deck：网页链接无效，未打开");
          return false;
        }
        await shell.openExternal(normalized.url);
        return true;
      }
      const error = await shell.openPath(shortcut.path);
      if (error) {
        new Notice(`Jam Deck：打开失败 — ${error}`);
        return false;
      }
      return true;
    } catch (e) {
      new Notice("Jam Deck：无法打开，请检查路径");
      return false;
    }
  }
}

JamDeckPlugin.CanvasImageStackController = CanvasImageStackController;
JamDeckPlugin.CanvasRuntimeAdapter = CanvasRuntimeAdapter;
JamDeckPlugin.CanvasReturnCoordinator = CanvasReturnCoordinator;
JamDeckPlugin.CanvasLinkNavigationBridge = CanvasLinkNavigationBridge;
JamDeckPlugin.canvasLinkBridgeScript = jamDeckCanvasLinkBridgeScript;
JamDeckPlugin.canvasReturnIframeArmTtlMs = CANVAS_RETURN_IFRAME_ARM_TTL_MS;
JamDeckPlugin.countdownHelpers = {
  parse: jamDeckParseCountdownDuration,
  format: jamDeckFormatCountdownDuration,
  formatClock: jamDeckFormatCountdownClock,
  parts: jamDeckCountdownDurationParts,
  state: jamDeckCountdownState,
  windowsToastScript: jamDeckWindowsToastPowerShellScript,
  windowsAppId: COUNTDOWN_WINDOWS_APP_ID,
  defaultSeconds: COUNTDOWN_DEFAULT_SECONDS,
  maxSeconds: COUNTDOWN_MAX_SECONDS,
};
JamDeckPlugin.mediaHelpers = {
  provider: jamDeckMediaProvider,
  formatTime: jamDeckFormatMediaTime,
  projectedPosition: jamDeckProjectedMediaPosition,
  favoriteId: jamDeckMediaFavoriteId,
  bridgeScript: jamDeckMediaBridgePowerShellScript,
  protocolVersion: MEDIA_PROTOCOL_VERSION,
};
JamDeckPlugin.WindowsMediaBridge = WindowsMediaBridge;
JamDeckPlugin.canvasStackGeometry = {
  kind: jamDeckCanvasStackKind,
  rect: jamDeckCanvasStackRect,
  intersectionArea: jamDeckCanvasStackIntersectionArea,
  overlapRatio: jamDeckCanvasStackOverlapRatio,
  normalization: jamDeckCanvasStackNormalization,
  anchor: jamDeckCanvasStackAnchor,
  clusters: jamDeckBuildCanvasStackClusters,
  chooseTarget: jamDeckChooseCanvasStackTarget,
  normalizeImage: jamDeckNormalizeCanvasStackImage,
  restoreImage: jamDeckRestoreCanvasStackImage,
  slots: jamDeckCanvasStackSlotOffsets,
  snap: jamDeckComputeCanvasStackSnap,
  layoutPreview: jamDeckLayoutCanvasStackPreview,
  bystanderShift: jamDeckCanvasStackBystanderShift,
};
JamDeckPlugin.widgetLayoutHelpers = {
  displayMinimum: jamDeckWidgetDisplayMinimum,
  isCompact: jamDeckWidgetIsCompact,
  resolveRestore: jamDeckResolveWidgetRestoreLayout,
  overlap: jamDeckWidgetRectsOverlap,
  boundsOk: jamDeckWidgetLayoutBoundsOk,
  collisionFree: jamDeckWidgetLayoutCollisionFree,
  pointInRect: jamDeckPointInRect,
  collectSlots: jamDeckCollectFillSlots,
  pickSlot: jamDeckPickFillSlot,
  applySlot: jamDeckApplyFillSlot,
  findSeam: jamDeckFindPushSeam,
  applySeam: jamDeckApplyPushSeam,
  scaleColumns: jamDeckScaleWidgetColumns,
  collectSashes: jamDeckCollectLayoutSashes,
  collectNodes: jamDeckCollectLayoutNodes,
  applySash: jamDeckApplySashDelta,
  preview: jamDeckPreviewWidgetLayout,
  minW: JAM_DECK_WIDGET_MIN_W,
  minH: JAM_DECK_WIDGET_MIN_H,
  cols: GRID_COLS,
  rows: GRID_ROWS,
};

module.exports = JamDeckPlugin;
