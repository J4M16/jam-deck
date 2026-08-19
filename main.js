"use strict";

const { ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, normalizePath, requestUrl, setIcon } = require("obsidian");
const { spawn } = require("child_process");
const crypto = require("crypto");
const nodePath = require("path");
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
const SHORTCUT_LINK_DIR = "attachments/jam-deck-shortcuts";
const TASK_ASSET_DIR = "attachments/jam-deck-task-assets";
const WORK_JOURNAL_DIR = "Work/工作日记";
const LIFE_DAILY_PATH = "Life/Daily.md";
const JOURNAL_SECTIONS = ["工作内容", "效果图 / 视频", "链接", "备注"];
const JOURNAL_SECTION_KEYS = { "工作内容": "work", "效果图 / 视频": "media", "链接": "links", "备注": "notes" };
const CLIPBOARD_DRAG_MIME = "application/x-jam-deck-clipboard+json";
const CANVAS_EXTERNAL_IMAGE_MAX_BYTES = 64 * 1024 * 1024;
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
const AI_LOCAL_WEB_URL = "http://127.0.0.1:3080/";
const AI_LOCAL_RPC_BASE = "http://127.0.0.1:3080/api/";
const AI_LOCAL_RPC_TIMEOUT_MS = 6000;
const AI_LOCAL_RPC_METHODS = new Set(["workspace.create", "workspace.list", "session.list", "session.create"]);

function jamDeckPathImpl() {
  return process.platform === "win32" ? nodePath.win32 : nodePath.posix;
}

function jamDeckCanonicalWindowsPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const impl = jamDeckPathImpl();
  if (!impl.isAbsolute(raw)) return null;
  return impl.normalize(raw).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}

function jamDeckVaultBasePath(app) {
  const adapter = app && app.vault && app.vault.adapter;
  if (!adapter || typeof adapter.getBasePath !== "function") return "";
  try {
    return String(adapter.getBasePath() || "");
  } catch (error) {
    return "";
  }
}

function jamDeckLocalWorkspacePath(configured, vaultBasePath) {
  const fromSetting = typeof configured === "string" ? configured.trim() : "";
  if (jamDeckCanonicalWindowsPath(fromSetting)) return fromSetting;
  const fromVault = typeof vaultBasePath === "string" ? vaultBasePath.trim() : "";
  if (jamDeckCanonicalWindowsPath(fromVault)) return fromVault;
  return "";
}

function jamDeckWorkspaceFolderLabel(workspacePath) {
  const path = typeof workspacePath === "string" ? workspacePath.trim() : "";
  if (!path) return "未设置";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function jamDeckDshValue(response, rpcId, method) {
  if (!response || response.status !== 200) {
    throw new Error(response ? `本地 Web 返回 HTTP ${response.status}` : "本地 Web 没有响应");
  }
  const body = response.json;
  if (!body || body.type !== "server-response" || body.rpcId !== rpcId || !body.result || typeof body.result.ok !== "boolean") {
    throw new Error(`${method} 返回了无法识别的协议数据`);
  }
  if (!body.result.ok) {
    const detail = body.result.error && typeof body.result.error.message === "string"
      ? body.result.error.message
      : `${method} 执行失败`;
    throw new Error(detail);
  }
  return body.result.value;
}

async function jamDeckDshRpc(method, payload, options = {}) {
  if (!AI_LOCAL_RPC_METHODS.has(method)) throw new Error("不允许的本地 Web 请求");
  const transport = options.transport || requestUrl;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : AI_LOCAL_RPC_TIMEOUT_MS;
  const rpcId = typeof options.rpcId === "string" ? options.rpcId : crypto.randomUUID();
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("连接本地 Web 超时")), timeoutMs);
  });
  try {
    const response = await Promise.race([
      transport({
        url: `${AI_LOCAL_RPC_BASE}${method}`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
        throw: false,
      }),
      timeout,
    ]);
    return jamDeckDshValue(response, rpcId, method);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function jamDeckDshWorkspaceFromList(value, workspacePath) {
  if (!value || !Array.isArray(value.items) || !Array.isArray(value.archivedSessionIds)) {
    throw new Error("workspace.list 返回缺少工作区数据");
  }
  const target = jamDeckCanonicalWindowsPath(workspacePath);
  if (!target) throw new Error("未配置本地工作区路径");
  const matches = value.items.filter((item) => item
    && typeof item.workspaceId === "string"
    && Array.isArray(item.sessionIds)
    && jamDeckCanonicalWindowsPath(item.path) === target);
  if (matches.length !== 1) {
    throw new Error(matches.length ? "本地工作区注册重复" : "没有找到本地工作区");
  }
  return { workspace: matches[0], archivedSessionIds: value.archivedSessionIds };
}

function jamDeckDshSessions(value) {
  if (!value || !Array.isArray(value.items)) throw new Error("session.list 返回缺少会话数据");
  return value.items;
}

async function jamDeckPrepareDshWorkspace(rpc = jamDeckDshRpc, workspacePath = "") {
  const path = typeof workspacePath === "string" ? workspacePath.trim() : "";
  if (!jamDeckCanonicalWindowsPath(path)) throw new Error("未配置本地工作区路径");
  await rpc("workspace.create", { path });
  let workspaceList = await rpc("workspace.list", {});
  let resolved = jamDeckDshWorkspaceFromList(workspaceList, path);
  let sessions = jamDeckDshSessions(await rpc("session.list", {}));
  const target = jamDeckCanonicalWindowsPath(path);
  const archived = new Set(resolved.archivedSessionIds.filter((id) => typeof id === "string"));
  const memberIds = new Set(resolved.workspace.sessionIds.filter((id) => typeof id === "string"));
  let session = sessions.find((item) => item
    && typeof item.sessionId === "string"
    && memberIds.has(item.sessionId)
    && !archived.has(item.sessionId)
    && item.blank === true
    && jamDeckCanonicalWindowsPath(item.cwd) === target);
  let created = false;
  if (!session) {
    const value = await rpc("session.create", { workspaceId: resolved.workspace.workspaceId });
    if (!value || typeof value.sessionId !== "string") throw new Error("session.create 没有返回会话 ID");
    created = true;
    workspaceList = await rpc("workspace.list", {});
    resolved = jamDeckDshWorkspaceFromList(workspaceList, path);
    sessions = jamDeckDshSessions(await rpc("session.list", {}));
    if (!resolved.workspace.sessionIds.includes(value.sessionId)) throw new Error("新会话没有归入本地工作区");
    session = sessions.find((item) => item && item.sessionId === value.sessionId);
    if (!session || jamDeckCanonicalWindowsPath(session.cwd) !== target) {
      throw new Error("新会话的工作区校验失败");
    }
  }
  return { workspaceId: resolved.workspace.workspaceId, sessionId: session.sessionId, created };
}
// 多图拖入 canvas 时相邻两张的世界坐标间距（同一行横排）。
const CANVAS_DROP_AUTO_GAP = 28;
// Canvas 节点按住多久后才判定为"按住"并悬浮（300ms 内松手视为单击，不悬浮）。
const CANVAS_STACK_LIFT_DELAY_MS = 300;
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
  savedLayout: null,
  animationsEnabled: true,
  clipboardPollMs: 700,
  clipboardMaxItems: 60,
  aiApiKey: "",
  aiModel: "deepseek-v4-flash",
  qwenApiKey: "",
  qwenModel: "qwen3.8-max",
  aiProvider: "deepseek",
  aiLocalWorkspacePath: "",
  canvasExportDir: "",
  aiFabPos: null,
  // 归档路径可配置（P1-1 + 0.30）：mode 决定「文件 / 目录」两种形式，默认都是文件。
  // 文件模式 = 单个 markdown 按日期分节；目录模式 = 目录下按日期建 YYYY-MM-DD.md。
  workArchiveMode: "file",   // "file" | "dir"
  workArchiveFile: "Work/工作.md",     // 文件模式：单文件路径
  workArchiveDir: WORK_JOURNAL_DIR,    // 目录模式：目录路径
  lifeArchiveMode: "file",   // "file" | "dir"
  lifeArchivePath: LIFE_DAILY_PATH,    // 文件模式：单文件路径
  lifeArchiveDir: "Life/生活日记",     // 目录模式：目录路径
  widgets: [
    { id: "clock-1", type: "clock", x: 1, y: 1, w: 5, h: 6, config: {} },
    { id: "music-1", type: "music", x: 6, y: 1, w: 5, h: 6, config: { mediaSourceId: "", musicSchemaVersion: 1 } },
    { id: "launcher-1", type: "launcher", x: 11, y: 1, w: 30, h: 6, config: { shortcuts: [] } },
    { id: "tasks-1", type: "tasks", x: 1, y: 7, w: 5, h: 10, config: {} },
    { id: "canvas-embed-1", type: "canvas-embed", x: 6, y: 7, w: 35, h: 30, config: { schemaVersion: 1 } },
    { id: "calendar-1", type: "calendar", x: 1, y: 17, w: 5, h: 9, config: {} },
    { id: "clipboard-1", type: "clipboard", x: 1, y: 26, w: 5, h: 11, config: {} },
  ],
  clipboardItems: [],
  deckTasks: [],
  musicLikes: [],
  musicLauncher: { schemaVersion: 1, lastConnectedProvider: null },
};

function jamDeckIsTypingTarget(target) {
  return !!(target && target.closest && target.closest("input, textarea, select, [contenteditable='true']"));
}

function jamDeckIsModalEvent(event) {
  const target = event && event.target;
  return !!(target && target.closest && target.closest(".modal-container, .prompt, .suggestion-container"));
}

function jamDeckShieldModalTyping(modal) {
  const root = modal && modal.containerEl;
  if (!root || root.dataset.jamDeckTypingShield === "1") return;
  root.dataset.jamDeckTypingShield = "1";
  const shield = (event) => {
    if (event.key === "Escape") return;
    if (!jamDeckIsTypingTarget(event.target)) return;
    event.stopPropagation();
  };
  for (const type of ["keydown", "keyup", "keypress", "beforeinput", "compositionstart", "compositionupdate", "compositionend"]) {
    root.addEventListener(type, shield);
  }
}

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
    jamDeckShieldModalTyping(this);
    setTimeout(() => { try { search.focus(); } catch (error) {} }, 0);
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
    jamDeckShieldModalTyping(this);
    setTimeout(() => { try { input.focus(); input.select(); } catch (error) {} }, 0);

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

class FolderRenameModal extends Modal {
  constructor(app, initialValue, onConfirm) {
    super(app);
    this.initialValue = initialValue || "";
    this.onConfirm = onConfirm || null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "重命名文件夹" });
    const input = contentEl.createEl("input", {
      type: "text",
      cls: "jam-deck-folder-rename-input",
      attr: { placeholder: "文件夹名称" },
    });
    input.value = this.initialValue;
    const submit = (value) => {
      const trimmed = String(value || "").trim();
      if (!trimmed) return;
      if (this.onConfirm) this.onConfirm(trimmed);
      this.close();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit(input.value);
    });
    const actions = contentEl.createDiv({ cls: "jam-deck-folder-rename-actions" });
    const cancel = actions.createEl("button", { text: "取消", cls: "jam-deck-folder-rename-btn" });
    cancel.addEventListener("click", () => this.close());
    const ok = actions.createEl("button", { text: "确定", cls: "mod-cta jam-deck-folder-rename-btn" });
    ok.addEventListener("click", () => submit(input.value));
    jamDeckShieldModalTyping(this);
    input.select();
    setTimeout(() => input.focus(), 0);
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
    const refs = this.renderTaskFields(form, task);
    const images = this.renderTaskImages(form, task);
    this.renderTaskActions(form, task, refs, images);
    jamDeckShieldModalTyping(this);
    setTimeout(() => { try { refs.titleInput.focus(); } catch (error) {} }, 0);
  }

  renderTaskFields(form, task) {
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

    return { titleInput, categoryInput, dueInput, descriptionInput, linksInput };
  }

  renderTaskImages(form, task) {
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

    return {
      getRetained: () => retainedImages,
      setRetained: (value) => { retainedImages = value; },
      renderImages,
    };
  }

  renderTaskActions(form, task, refs, images) {
    const { titleInput, categoryInput, dueInput, descriptionInput, linksInput } = refs;
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
        images: images.getRetained(),
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
      if (savedTask) images.setRetained(this.plugin.getSafeTaskImages(savedTask).map((image) => ({ ...image })));
      images.renderImages();
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

    jamDeckShieldModalTyping(this);
    setTimeout(() => { try { nameInput.focus(); nameInput.select(); } catch (error) {} }, 0);
    const hint = form.createDiv({ text: "支持应用、文件夹和 http / https 网页链接。本地项目会在库内保存一份 .lnk 记录，原快捷方式被挪走后仍可打开。", cls: "jam-deck-shortcut-hint" });

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
    await this.plugin.ensureVaultFileParent(path);
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
    const button = parent.createEl("button", { cls, attr: { type: "button", "aria-label": label } });
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

  exit(flush = true) {
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
    if (flush) void this.owner.flush();
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

  async destroy(options = {}) {
    this.exit(!options.quiet);
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
const JAM_DECK_CANVAS_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "mkv", "ogv"]);
const JAM_DECK_STACK_OVERLAP_THRESHOLD = 0.5;
const JAM_DECK_STACK_DETACH_THRESHOLD = 0.4;
const JAM_DECK_STACK_SHRINK_DEAD_BAND = 0.95;
const JAM_DECK_STACK_AMBIGUITY_MARGIN = 0.05;
const JAM_DECK_STACK_NORMALIZATION_VERSION = 1;
const JAM_DECK_STACK_TEXT_PREVIEW_FONT_PX = 12;
const JAM_DECK_STACK_TEXT_PREVIEW_PADDING_PX = 16;
const JAM_DECK_STACK_TEXT_PREVIEW_MIN_WIDTH = 220;
const JAM_DECK_STACK_TEXT_PREVIEW_MIN_HEIGHT = 260;
const JAM_DECK_STACK_TEXT_PREVIEW_HEIGHT_RATIO = 0.9;
const JAM_DECK_STACK_TEXT_PREVIEW_WIDTH_FROM_IMAGE = 0.42;
const JAM_DECK_STACK_TEXT_PREVIEW_ASPECT = 0.78;

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
  const extension = jamDeckCanvasFileExtension(data);
  if (extension === "md") return "markdown-note";
  return JAM_DECK_CANVAS_IMAGE_EXTENSIONS.has(extension) ? "image" : null;
}

function jamDeckCanvasFileExtension(data) {
  if (!data || data.type !== "file" || typeof data.file !== "string" || !data.file.trim()) return "";
  return data.file.toLowerCase().split(/[?#]/)[0].split(".").pop() || "";
}

function jamDeckIsCanvasExportableMedia(data) {
  const extension = jamDeckCanvasFileExtension(data);
  return JAM_DECK_CANVAS_IMAGE_EXTENSIONS.has(extension) || JAM_DECK_CANVAS_VIDEO_EXTENSIONS.has(extension);
}

function jamDeckSelectedExportableCanvasFiles(canvas, vault) {
  if (!canvas || !canvas.selection || typeof canvas.selection.values !== "function") return [];
  const files = [];
  const seen = new Set();
  for (const node of canvas.selection.values()) {
    let data = null;
    try { data = node && typeof node.getData === "function" ? node.getData() : null; } catch (error) { data = null; }
    if (!jamDeckIsCanvasExportableMedia(data)) continue;
    const file = vault && typeof vault.getAbstractFileByPath === "function" ? vault.getAbstractFileByPath(data.file) : null;
    if (!file || !file.path || Array.isArray(file.children)) continue;
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    files.push(file);
  }
  return files;
}

function jamDeckUniqueOsCopyPath(dir, filename, existsSync) {
  const pathApi = require("path");
  const name = String(filename || "").replace(/[\\/]/g, "");
  if (!dir || !name) return "";
  const parsed = pathApi.parse(name);
  let dest = pathApi.join(dir, name);
  let n = 1;
  const exists = typeof existsSync === "function" ? existsSync : () => false;
  while (exists(dest)) {
    dest = pathApi.join(dir, `${parsed.name} (${n})${parsed.ext}`);
    n += 1;
    if (n > 9999) break;
  }
  return dest;
}

function jamDeckNextCanvasFileName(fileExists) {
  let path = "未命名.canvas";
  let index = 1;
  while (fileExists(path)) {
    path = `未命名 ${index}.canvas`;
    index += 1;
  }
  return path;
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

function jamDeckRequestFrame(ownerWindow) {
  if (ownerWindow && typeof ownerWindow.requestAnimationFrame === "function") {
    return ownerWindow.requestAnimationFrame.bind(ownerWindow);
  }
  return (callback) => ownerWindow.setTimeout(callback, 0);
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

function jamDeckClientPointInRect(x, y, rect) {
  if (!rect) return false;
  const left = Number(rect.left);
  const top = Number(rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![x, y, left, top, width, height].every(Number.isFinite) || width < 1 || height < 1) return false;
  return x >= left && x <= left + width && y >= top && y <= top + height;
}

function jamDeckCanvasRectContainsPoint(rect, x, y) {
  const box = jamDeckCanvasStackRect(rect);
  if (!box || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

// Icon-drop onto a collapsed folder: the dragged centre inside the shell
// already covers wide/short images, but a larger image can cover the folder
// while its own centre stays outside the 200×180 shell.  Treating "the
// folder centre is under this image" as a hit keeps the same icon semantics.
function jamDeckCanvasFolderShellDropRatio(sourceRect, shellBounds) {
  const rect = jamDeckCanvasStackRect(sourceRect);
  const shell = jamDeckCanvasStackRect(shellBounds);
  if (!rect || !shell) return 0;
  const sourceCenterInside = jamDeckCanvasRectContainsPoint(shell, rect.x + rect.width / 2, rect.y + rect.height / 2);
  const shellCenterInside = jamDeckCanvasRectContainsPoint(rect, shell.x + shell.width / 2, shell.y + shell.height / 2);
  if (sourceCenterInside || shellCenterInside) return 1;
  return jamDeckCanvasStackOverlapRatio(rect, shell);
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

function jamDeckMedianNumber(values) {
  const sorted = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function jamDeckCanvasStackPreviewLogicalSize(kind, nativeWidth, nativeHeight, imageSizes) {
  const width = Math.max(1, Number(nativeWidth) || 1);
  const height = Math.max(1, Number(nativeHeight) || 1);
  if (kind !== "text" && kind !== "markdown-note") return { width, height };
  const images = Array.isArray(imageSizes) ? imageSizes : [];
  const imageHeight = jamDeckMedianNumber(images.map((size) => size && size.height));
  const imageWidth = jamDeckMedianNumber(images.map((size) => size && size.width));
  if (!imageHeight || !imageWidth) {
    return {
      width: JAM_DECK_STACK_TEXT_PREVIEW_MIN_WIDTH,
      height: JAM_DECK_STACK_TEXT_PREVIEW_MIN_HEIGHT,
    };
  }
  const paperHeight = imageHeight * JAM_DECK_STACK_TEXT_PREVIEW_HEIGHT_RATIO;
  const paperWidth = Math.min(
    imageWidth * JAM_DECK_STACK_TEXT_PREVIEW_WIDTH_FROM_IMAGE,
    paperHeight * JAM_DECK_STACK_TEXT_PREVIEW_ASPECT,
  );
  return {
    width: Math.max(1, paperWidth),
    height: Math.max(1, paperHeight),
  };
}

function jamDeckCanvasEdgeSide(side) {
  const value = String(side || "").toLowerCase();
  if (value === "left" || value === "right" || value === "top" || value === "bottom") return value;
  return "";
}

function jamDeckCanvasPresentSpatialDirection(fromRect, toRect) {
  if (!fromRect || !toRect) return "";
  const dx = (Number(toRect.x) + Number(toRect.width) / 2) - (Number(fromRect.x) + Number(fromRect.width) / 2);
  const dy = (Number(toRect.y) + Number(toRect.height) / 2) - (Number(fromRect.y) + Number(fromRect.height) / 2);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return "";
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function jamDeckCanvasPresentEdgeHop(edge, nodeId, rectForId) {
  const id = String(nodeId || "");
  const from = String(edge && edge.fromNode || "");
  const to = String(edge && edge.toNode || "");
  if (!id || !from || !to || from === to) return null;
  let neighborId = "";
  let direction = "";
  if (from === id) {
    neighborId = to;
    direction = jamDeckCanvasEdgeSide(edge.fromSide);
  } else if (to === id) {
    neighborId = from;
    direction = jamDeckCanvasEdgeSide(edge.toSide);
  } else return null;
  const selfRect = typeof rectForId === "function" ? rectForId(id) : null;
  const otherRect = typeof rectForId === "function" ? rectForId(neighborId) : null;
  if (!direction) direction = jamDeckCanvasPresentSpatialDirection(selfRect, otherRect);
  if (!direction) return null;
  const distance = selfRect && otherRect
    ? Math.hypot(
      (Number(otherRect.x) + Number(otherRect.width) / 2) - (Number(selfRect.x) + Number(selfRect.width) / 2),
      (Number(otherRect.y) + Number(otherRect.height) / 2) - (Number(selfRect.y) + Number(selfRect.height) / 2),
    )
    : 0;
  return { direction, neighborId, distance };
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

// Canvas folders intentionally live in the Canvas node's `jamdeck` payload.
// Keep this schema small and deterministic so reopening a Canvas (or undoing a
// mutation) never depends on a runtime-only registry or a screenshot cache.
const JAM_DECK_CANVAS_FOLDER_SCHEMA_VERSION = 1;
// NZS4 Figma "文件夹样式" (134:143) board solids: 纸灰/浅红/樱粉/月黄/草绿/天蓝.
const JAM_DECK_CANVAS_FOLDER_COLORS = ["#C1C1C1", "#F7BDB1", "#F0C5DA", "#EDD0AE", "#BBE0AF", "#AFD0E0"];
// Older presets persisted in Canvas metadata map onto the closest NZS4 Figma
// solid so existing folders keep a stable appearance: 0.19.0 blue-gray and the
// 0.28.6 hand-tuned light red both land on 浅红; the 0.28.6 neutrals land on
// 纸灰; sage/lilac/sand/rose/sky follow their hue.
const JAM_DECK_CANVAS_FOLDER_LEGACY_COLORS = new Map([
  ["#8EAFCC", "#F7BDB1"],
  ["#DDDCDC", "#C1C1C1"],
  ["#9BC287", "#BBE0AF"],
  ["#CC96BA", "#F0C5DA"],
  ["#E9B85C", "#EDD0AE"],
  ["#E3846A", "#F7BDB1"],
  ["#5E9BD6", "#AFD0E0"],
]);
// NZS4 Figma front-panel tints (封面 gradient solid), keyed by board color:
// each front runs top 50% alpha to bottom 100% of its tint over the blur.
const JAM_DECK_CANVAS_FOLDER_FRONT_TINTS = new Map([
  ["#C1C1C1", "#E7E7E7"],
  ["#F7BDB1", "#FAC0C0"],
  ["#F0C5DA", "#F8CECE"],
  ["#EDD0AE", "#FBE2BB"],
  ["#BBE0AF", "#CCF2C0"],
  ["#AFD0E0", "#BEE1F3"],
]);
const JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES = 4;
const JAM_DECK_CANVAS_FOLDER_BASE_WIDTH = 200;
const JAM_DECK_CANVAS_FOLDER_BASE_HEIGHT = 150;
// The native Canvas group node keeps its own slightly taller 200×180 bbox;
// it is data-only in Jam Deck (CSS hides .canvas-group), so the extra height
// never fights the authored 200×150 shell surface.
const JAM_DECK_NATIVE_GROUP_BASE_HEIGHT = 180;
// Folder preview motion follows the reference flap/card timing while the
// existing Canvas stack keeps its 300/260 ms member transitions.  The front
// waits for cards to return before it closes, so the two surfaces never race.
const JAM_DECK_CANVAS_FOLDER_PREVIEW_OPEN_MS = 450;
const JAM_DECK_CANVAS_FOLDER_PREVIEW_CLOSE_MS = 600;
const JAM_DECK_CANVAS_FOLDER_PREVIEW_CARD_RETURN_MS = 260;
const JAM_DECK_STACK_PREVIEW_CLEANUP_MS = 340;
const JAM_DECK_FOLDER_FALLBACK_WIDTH_RATIO = 0.46;
const JAM_DECK_FOLDER_FALLBACK_HEIGHT_RATIO = 0.42;

// Figma file R3sGYRg1Q0XIRMGXCDkg34, node 102:6.  These are the authored
// screen-space representative slots at the 200 x 150 folder baseline.  The
// visual bounds include each card's rotation, while contentWidth/contentHeight
// are the native Canvas node bounds before that rotation is applied.
//
// Runtime folders persist at most four representatives.  A one-item folder is
// not a Figma state, so it receives a quiet centered fallback that keeps the
// native node readable without inventing another stacked-card treatment.
const JAM_DECK_CANVAS_FOLDER_REPRESENTATIVE_SLOTS = Object.freeze({
  1: Object.freeze([
    Object.freeze({ x: 54.5, y: 12, width: 91, height: 60, contentWidth: 91, contentHeight: 60, rotate: 0 }),
  ]),
  2: Object.freeze([
    Object.freeze({ x: 4.741, y: 18.745, width: 95.518, height: 67.103, contentWidth: 91, contentHeight: 60, rotate: -4.6 }),
    Object.freeze({ x: 103.451, y: 5, width: 93.039, height: 63.139, contentWidth: 91, contentHeight: 60, rotate: 2 }),
  ]),
  3: Object.freeze([
    Object.freeze({ x: 4.741, y: 18.745, width: 95.518, height: 67.103, contentWidth: 91, contentHeight: 60, rotate: -4.6 }),
    Object.freeze({ x: 103.451, y: 5, width: 93.039, height: 63.139, contentWidth: 91, contentHeight: 60, rotate: 2 }),
    Object.freeze({ x: 14.997, y: 23.384, width: 105.773, height: 73.116, contentWidth: 102.363, contentHeight: 67.852, rotate: 3 }),
  ]),
  4: Object.freeze([
    Object.freeze({ x: 4.741, y: 18.745, width: 95.518, height: 67.103, contentWidth: 91, contentHeight: 60, rotate: -4.6 }),
    Object.freeze({ x: 103.451, y: 5, width: 93.039, height: 63.139, contentWidth: 91, contentHeight: 60, rotate: 2 }),
    Object.freeze({ x: 14.997, y: 23.384, width: 105.773, height: 73.116, contentWidth: 102.363, contentHeight: 67.852, rotate: 3 }),
    Object.freeze({ x: 101.357, y: 18.176, width: 93.039, height: 63.139, contentWidth: 91, contentHeight: 60, rotate: -2 }),
  ]),
});

function jamDeckCanvasFolderRepresentativeSlot(bounds, count, index) {
  const shellWidth = Math.max(1, Number(bounds && bounds.width) || JAM_DECK_CANVAS_FOLDER_BASE_WIDTH);
  const shellHeight = Math.max(1, Number(bounds && bounds.height) || JAM_DECK_CANVAS_FOLDER_BASE_HEIGHT);
  const shellLeft = Number(bounds && (bounds.left !== undefined ? bounds.left : bounds.x)) || 0;
  const shellTop = Number(bounds && (bounds.top !== undefined ? bounds.top : bounds.y)) || 0;
  const numericCount = Math.floor(Number(count));
  if (!Number.isFinite(numericCount) || numericCount <= 0) return null;
  const stateCount = numericCount === 1 ? 1 : Math.min(JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES, numericCount);
  const authored = JAM_DECK_CANVAS_FOLDER_REPRESENTATIVE_SLOTS[stateCount]
    || JAM_DECK_CANVAS_FOLDER_REPRESENTATIVE_SLOTS[1];
  if (!authored || !authored.length) return null;
  const safeIndex = Math.max(0, Math.min(authored.length - 1, Math.floor(Number(index) || 0)));
  const slot = authored[safeIndex];
  const scaleX = shellWidth / JAM_DECK_CANVAS_FOLDER_BASE_WIDTH;
  const scaleY = shellHeight / JAM_DECK_CANVAS_FOLDER_BASE_HEIGHT;
  const visualLeft = shellLeft + slot.x * scaleX;
  const visualTop = shellTop + slot.y * scaleY;
  const visualWidth = slot.width * scaleX;
  const visualHeight = slot.height * scaleY;
  return {
    left: visualLeft,
    top: visualTop,
    width: visualWidth,
    height: visualHeight,
    centerX: visualLeft + visualWidth / 2,
    centerY: visualTop + visualHeight / 2,
    visualLeft,
    visualTop,
    visualWidth,
    visualHeight,
    rotate: slot.rotate,
    contentWidth: slot.contentWidth * scaleX,
    contentHeight: slot.contentHeight * scaleY,
  };
}

function jamDeckCanvasFolderPath(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .normalize("NFC")
    .toLocaleLowerCase("en-US");
}

function jamDeckCanvasFolderPathEquivalent(left, right) {
  const leftValue = left && typeof left === "object" ? left.file : left;
  const rightValue = right && typeof right === "object" ? right.file : right;
  const leftPath = jamDeckCanvasFolderPath(leftValue);
  const rightPath = jamDeckCanvasFolderPath(rightValue);
  const a = `${leftPath}\n${String(left && typeof left === "object" ? left.subpath || "" : "")}`;
  const b = `${rightPath}\n${String(right && typeof right === "object" ? right.subpath || "" : "")}`;
  return !!leftPath && !!rightPath && a === b;
}

function jamDeckCanvasFolderDataKey(data) {
  if (!data || typeof data !== "object") return "";
  const file = jamDeckCanvasFolderPath(data.file);
  const subpath = String(data.subpath || "").trim().normalize("NFC");
  return [String(data.type || ""), file, subpath].join("\n");
}

function jamDeckCanvasFolderStableId(memberIds, salt = "") {
  const ids = [...new Set((Array.isArray(memberIds) ? memberIds : [memberIds])
    .map((value) => String(value || "").trim())
    .filter(Boolean))].sort();
  if (!ids.length) return null;
  const seed = `${String(salt || "")}\n${ids.join("\n")}`;
  return `folder-${crypto.createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 16)}`;
}

function jamDeckCanvasFolderNormalizeColor(value) {
  const color = String(value || "").trim();
  if (JAM_DECK_CANVAS_FOLDER_COLORS.includes(color)) return color;
  if (JAM_DECK_CANVAS_FOLDER_LEGACY_COLORS.has(color)) return JAM_DECK_CANVAS_FOLDER_LEGACY_COLORS.get(color);
  return JAM_DECK_CANVAS_FOLDER_COLORS[0];
}

// Native folders (schema additions, v1 kept): each member keeps its authored
// rectangle in `positions` (expanded) and its stacked rectangle in `stacked`
// (collapsed), so collapse/expand are plain coordinate transactions.  `label`
// feeds the native Canvas group node name; `nativeGroupId` maps the persisted
// group node (a node with type "group" in Obsidian 1.13) back to the folder.
function jamDeckCanvasFolderRects(value) {
  if (!value || typeof value !== "object") return null;
  const out = {};
  for (const [id, rect] of Object.entries(value)) {
    if (!id || !rect || typeof rect !== "object") continue;
    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue;
    out[String(id)] = { x, y, width, height };
  }
  return Object.keys(out).length ? out : null;
}

function jamDeckCanvasFolderSchema(data) {
  if (!data || typeof data !== "object") return null;
  const jamdeck = data.jamdeck && typeof data.jamdeck === "object" ? data.jamdeck : null;
  const raw = jamdeck && jamdeck.folder && typeof jamdeck.folder === "object" ? jamdeck.folder : null;
  const id = String((raw && raw.id) || (jamdeck && jamdeck.folderId) || "").trim();
  if (!id) return null;
  const memberIds = [...new Set((raw && Array.isArray(raw.memberIds) ? raw.memberIds : [data.id])
    .map((value) => String(value || "").trim())
    .filter(Boolean))].sort();
  // Only the anchor (the node carrying the full folder record) owns an
  // anchorId.  Plain members only carry folderId, so defaulting anchorId to
  // data.id here would make every member claim anchor and poison
  // collectGroups/validateFolderGroup with "嵌套或重复文件夹锚点".
  const anchorId = String((raw && raw.anchorId) || "").trim();
  return {
    version: Number(raw && raw.version) || JAM_DECK_CANVAS_FOLDER_SCHEMA_VERSION,
    id,
    anchorId,
    memberIds,
    collapsed: raw && Object.prototype.hasOwnProperty.call(raw, "collapsed") ? !!raw.collapsed : true,
    color: jamDeckCanvasFolderNormalizeColor(raw && raw.color),
    layoutMode: raw && raw.layoutMode === "grid" ? "grid" : "stack",
    native: !!(raw && raw.native),
    label: String((raw && raw.label) || "文件夹").trim() || "文件夹",
    nativeGroupId: String((raw && raw.nativeGroupId) || "").trim(),
    positions: jamDeckCanvasFolderRects(raw && raw.positions),
    stacked: jamDeckCanvasFolderRects(raw && raw.stacked),
    hiddenEdges: raw && Array.isArray(raw.hiddenEdges)
      ? raw.hiddenEdges.filter((edge) => edge && typeof edge === "object" && edge.id)
      : null,
    representativeIds: jamDeckCanvasFolderMemberSort(
      [...new Set((raw && Array.isArray(raw.representativeIds) ? raw.representativeIds : memberIds.slice(0, JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES))
        .map((value) => String(value || "").trim())
        .filter(Boolean))],
      anchorId,
    ).slice(0, JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES),
    representativeColumns: jamDeckCanvasFolderRepresentativeColumns(memberIds),
  };
}

function jamDeckCanvasFolderMemberSort(members, anchorId = "") {
  const values = (Array.isArray(members) ? members : []).slice();
  return values.sort((left, right) => {
    const leftId = typeof left === "object" ? String(left && left.id || "") : String(left || "");
    const rightId = typeof right === "object" ? String(right && right.id || "") : String(right || "");
    if (leftId === String(anchorId || "")) return -1;
    if (rightId === String(anchorId || "")) return 1;
    return leftId.localeCompare(rightId);
  });
}

function jamDeckCanvasFolderRepresentatives(members, anchorId = "", max = JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES) {
  const limit = Math.max(1, Math.min(JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES, Math.floor(Number(max) || JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES)));
  return jamDeckCanvasFolderMemberSort(members, anchorId).slice(0, limit);
}

function jamDeckCanvasFolderRepresentativeColumns(members) {
  const count = Array.isArray(members) ? Math.min(JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES, members.length) : 0;
  return count > 1 ? 2 : 1;
}

// Expanded grid geometry may use a third column for five or more members;
// this is derived at runtime and is intentionally not persisted in schema v1.
function jamDeckCanvasFolderExpansionColumns(members) {
  const count = Array.isArray(members) ? members.length : 0;
  if (count <= 1) return 1;
  return count <= 4 ? 2 : 3;
}

function jamDeckCanvasFolderBounds(members) {
  const rects = (Array.isArray(members) ? members : []).map((member) => jamDeckCanvasStackRect(member && member.rect ? member.rect : member)).filter(Boolean);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function jamDeckCanvasFolderGridLayout(items, bounds, options = {}) {
  const sourceItems = (Array.isArray(items) ? items : []).map((item) => {
    const rect = jamDeckCanvasStackRect(item && item.rect ? item.rect : item);
    return rect ? { item, rect } : null;
  }).filter(Boolean);
  const outer = jamDeckCanvasStackRect(bounds);
  if (!sourceItems.length || !outer) return null;
  const gap = Math.max(0, Number(options.gap) || 16);
  const requestedColumns = Math.floor(Number(options.columns) || 0);
  const aspect = Math.max(0.5, Math.min(2, outer.width / Math.max(1, outer.height)));
  const autoColumns = Math.max(1, Math.min(sourceItems.length, Math.ceil(Math.sqrt(sourceItems.length * aspect))));
  const columns = Math.max(1, Math.min(sourceItems.length, requestedColumns || autoColumns));
  const rows = Math.ceil(sourceItems.length / columns);
  const cellWidth = Math.max(1, (outer.width - gap * (columns - 1)) / columns);
  const maxSourceHeight = Math.max(...sourceItems.map(({ rect }) => rect.height));
  const requestedCellHeight = Number(options.cellHeight);
  const cellHeight = Math.max(1, Math.min(
    outer.height / rows,
    Number.isFinite(requestedCellHeight) && requestedCellHeight > 0 ? requestedCellHeight : maxSourceHeight,
  ));
  const height = cellHeight * rows + gap * Math.max(0, rows - 1);
  const positions = sourceItems.map(({ rect }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const scale = Math.min(1, cellWidth / rect.width, cellHeight / rect.height);
    const width = Math.max(1, jamDeckRoundCanvasStackValue(rect.width * scale));
    const itemHeight = Math.max(1, jamDeckRoundCanvasStackValue(rect.height * scale));
    return {
      x: jamDeckRoundCanvasStackValue(outer.x + column * (cellWidth + gap) + (cellWidth - width) / 2),
      y: jamDeckRoundCanvasStackValue(outer.y + row * (cellHeight + gap) + (cellHeight - itemHeight) / 2),
      width,
      height: itemHeight,
    };
  });
  return {
    x: outer.x,
    y: outer.y,
    width: outer.width,
    height,
    rows,
    columns,
    gap,
    positions,
  };
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
    // Preview clusters owned by CanvasFolderController are intentionally
    // absent from the implicit overlap-cluster list. Keep them registered
    // while their preview is open so the overlay MutationObserver does not
    // immediately reconcile them away.
    this.externalPreviewClusters = new Map();
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

  // Folder shells are a separate visual layer from the native Canvas stack.
  // Keep the bridge optional so ordinary overlap stacks and older fixtures do
  // not acquire a hard dependency on CanvasFolderController.
  notifyFolderPreview(cluster, state, options = {}) {
    const controller = this.entry && this.entry.folderController;
    if (!controller || typeof controller.onStackPreviewState !== "function" || !cluster) return;
    try { controller.onStackPreviewState(cluster, state, options); } catch (error) {
      console.error("jam-deck folder preview bridge failed", error);
    }
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
      if (this.imageFocus) {
        const onMedia = !!(event.target && event.target.closest && event.target.closest(".jam-deck-canvas-stack-image-focus-media"));
        if (event.type === "wheel" && onMedia) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === "contextmenu" && !onMedia) this.closeImageFocus();
        return;
      }
      if (!this.previewWrapper) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.collapsePreview();
    };
    const keydown = (event) => {
      if (this.imageFocus) {
        this.onPresentKeydown(event);
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
      this.observer = new MutationObserverCtor((mutations) => {
        // The preview overlay is fully runtime-owned. Its card mount/unmount
        // does not change Canvas geometry, so feeding those mutations back
        // into the O(n²) overlap reconciler only burns frames during motion.
        const ownedPreviewOnly = mutations.length > 0 && mutations.every((mutation) => (
          this.overlay
          && (mutation.target === this.overlay || this.overlay.contains(mutation.target))
        ));
        if (ownedPreviewOnly) return;
        if (!this.drag) this.scheduleReconcile();
      });
      this.observer.observe(this.root, { subtree: true, childList: true });
    }
    const ResizeObserverCtor = this.ownerWindow.ResizeObserver;
    if (typeof ResizeObserverCtor === "function") {
      this.resizeObserver = new ResizeObserverCtor(() => {
        if (this.imageFocus) return;
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

  getStackItems(includeExplicitFolders = true) {
    if (!this.canvas || !this.canvas.nodes || typeof this.canvas.nodes.values !== "function") return [];
    const items = [];
    for (const node of this.canvas.nodes.values()) {
      const item = this.nodeItem(node);
      const explicitFolder = item && item.data && item.data.jamdeck && (item.data.jamdeck.folderId || item.data.jamdeck.folder);
      if (item && (includeExplicitFolders || !explicitFolder)) items.push(item);
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
      if (!this.isPresentChrome(event.target)) this.closeImageFocus();
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
    const lift = () => {
      if (node.nodeEl) node.nodeEl.addClass("is-jam-deck-stack-dragging");
    };
    drag.liftTimer = this.ownerWindow.setTimeout(lift, CANVAS_STACK_LIFT_DELAY_MS);
    const move = (next) => {
      if (this.drag !== drag || next.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(next.clientX - drag.startClientX, next.clientY - drag.startClientY) >= 5) {
        drag.moved = true;
        this.ownerWindow.clearTimeout(drag.liftTimer);
        lift();
        this.collapsePreview(true);
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
      this.ownerWindow.clearTimeout(drag.liftTimer);
      this.ownerWindow.removeEventListener("pointermove", move, true);
      this.ownerWindow.removeEventListener("pointerup", up, true);
      this.ownerWindow.removeEventListener("pointercancel", cancel, true);
    };
    this.ownerWindow.addEventListener("pointermove", move, true);
    this.ownerWindow.addEventListener("pointerup", up, true);
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
      // Explicit folder clusters are intentionally absent from the implicit
      // clusterByNodeId map.  Preserve the exact external cluster so a
      // viewport change or drag-out cancellation can rebuild the same folder
      // preview instead of silently losing it.
      previewCluster: this.previewCluster,
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
    const cluster = this.previewCluster;
    const cards = this.previewCards.slice();
    const bystanders = this.previewBystanders.slice();
    // A dragged card leaves the preview wrapper instead of passing through
    // collapsePreview().  Tell the folder front to begin its return/close
    // sequence before the wrapper is detached, so drag-out has the same
    // visible lifecycle as backdrop, Escape, and wheel dismissal.
    this.notifyFolderPreview(cluster, "closing", {
      reason: "drag-out",
      delay: JAM_DECK_CANVAS_FOLDER_PREVIEW_CARD_RETURN_MS,
    });
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
    if (cluster && cluster.id) this.externalPreviewClusters.delete(cluster.id);
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
        const cluster = press.previewCluster || this.clusterByNodeId.get(press.nodeId);
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
      const folderId = press.previewCluster && press.previewCluster.folderId;
      const folderController = this.entry && this.entry.folderController;
      if (folderId && folderController && typeof folderController.detachPreviewMember === "function") {
        folderController.detachPreviewMember(folderId, press.nodeId, finalRect, {
          removeNormalization: !!restored,
          normalizationKind: press.kind,
        });
      } else {
        this.commitGestureNodePatch(press.member.node, finalRect, {
          removeNormalization: !!restored,
          normalizationKind: press.kind,
          flushHistory: true,
        });
      }
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
    this.openNodeFocus(press.member.node, press.visual && press.visual.card);
  }

  openImageFocus(visual) {
    const node = visual && visual.member && visual.member.node;
    return this.openNodeFocus(node, visual && visual.card);
  }

  isPresentChrome(target) {
    const el = target && target.nodeType === 3 ? target.parentElement : target;
    return !!(el && typeof el.closest === "function" && el.closest(
      ".jam-deck-canvas-stack-image-focus-media, .jam-deck-canvas-stack-image-focus-close, .jam-deck-canvas-stack-image-focus-nav"
    ));
  }

  presentResourcePath(filePath) {
    const app = this.runtime && this.runtime.deckView && this.runtime.deckView.app;
    const adapter = app && app.vault && app.vault.adapter;
    const path = String(filePath || "").trim();
    if (!path || !adapter || typeof adapter.getResourcePath !== "function") return "";
    try { return String(adapter.getResourcePath(path) || ""); } catch (error) { return ""; }
  }

  presentablePreviewNodes() {
    const nodes = [];
    for (const visual of this.previewCards || []) {
      const node = visual && visual.member && visual.member.node;
      if (node && this.resolvePresentContent(node)) nodes.push(node);
    }
    return nodes;
  }

  resolvePresentContent(node) {
    if (!node) return null;
    let data = null;
    try { data = typeof node.getData === "function" ? node.getData() : null; } catch (error) { data = null; }
    if (data && data.type === "group") return null;
    const kind = jamDeckCanvasStackKind(data);
    const nodeEl = node.nodeEl;
    const imageEl = nodeEl && nodeEl.querySelector(".canvas-node-content.media-embed > img");
    const videoEl = nodeEl && nodeEl.querySelector(".canvas-node-content.media-embed > video, .canvas-node-content video");
    const imageSrc = (imageEl && (imageEl.currentSrc || imageEl.src))
      || (kind === "image" ? this.presentResourcePath((node.file && node.file.path) || (data && data.file)) : "");
    if (imageSrc) return { type: "image", src: imageSrc, data, label: "图片预览" };
    if (videoEl) return { type: "video", videoEl, data, label: "视频预览" };
    const content = nodeEl && nodeEl.querySelector(".canvas-node-content");
    const liveText = String(
      (data && data.type === "text" && data.text)
      || (content && (content.innerText || content.textContent))
      || "",
    ).replace(/\s+$/g, "");
    if (liveText || content || (data && data.type === "text") || kind === "markdown-note") {
      return { type: "note", liveText, content, data, label: "笔记预览" };
    }
    return null;
  }

  fillPresentMedia(media, content) {
    const doc = this.entry && this.entry.ownerDocument;
    if (!media || !content || !doc) return null;
    media.replaceChildren();
    media.classList.remove("is-video", "is-node", "is-image");
    if (content.type === "image") {
      media.classList.add("is-image");
      const focusedImage = doc.createElement("img");
      focusedImage.src = content.src;
      focusedImage.alt = "";
      focusedImage.setAttribute("draggable", "false");
      media.appendChild(focusedImage);
      return null;
    }
    if (content.type === "video") {
      media.classList.add("is-video");
      const video = content.videoEl;
      const focusedVideo = video.cloneNode(true);
      focusedVideo.removeAttribute("id");
      if (!focusedVideo.getAttribute("src") && video.currentSrc) focusedVideo.src = video.currentSrc;
      focusedVideo.controls = true;
      focusedVideo.setAttribute("playsinline", "");
      focusedVideo.setAttribute("controlslist", "nodownload nofullscreen noremoteplayback");
      focusedVideo.disablePictureInPicture = true;
      focusedVideo.tabIndex = -1;
      focusedVideo.setAttribute("tabindex", "-1");
      try { focusedVideo.currentTime = video.currentTime || 0; } catch (error) {}
      media.appendChild(focusedVideo);
      return focusedVideo;
    }
    media.classList.add("is-node");
    const note = doc.createElement("div");
    note.className = "jam-deck-present-note-body";
    if (content.liveText) note.textContent = content.liveText;
    else if (content.content) {
      const clone = content.content.cloneNode(true);
      clone.removeAttribute("id");
      clone.style.pointerEvents = "none";
      note.appendChild(clone);
    }
    media.appendChild(note);
    return null;
  }

  attachPresentVideo(focusedVideo, sourceVideo, wrapper) {
    if (!focusedVideo) return () => {};
    const time = Number(sourceVideo && sourceVideo.currentTime) || Number(focusedVideo.currentTime) || 0;
    const restoreTime = () => { try { focusedVideo.currentTime = time; } catch (error) {} };
    focusedVideo.addEventListener("loadedmetadata", restoreTime, { once: true });
    if (typeof focusedVideo.load === "function") {
      try { focusedVideo.load(); } catch (error) {}
    }
    return this.lockPresentVideoFocus(focusedVideo, wrapper);
  }

  createPresentNavButton(direction) {
    const spec = direction === "left" ? { icon: "chevron-left", label: "向左", cls: "prev", key: "ArrowLeft" }
      : direction === "right" ? { icon: "chevron-right", label: "向右", cls: "next", key: "ArrowRight" }
        : direction === "top" ? { icon: "chevron-up", label: "向上", cls: "up", key: "ArrowUp" }
          : direction === "bottom" ? { icon: "chevron-down", label: "向下", cls: "down", key: "ArrowDown" }
            : null;
    if (!spec) return null;
    const button = this.entry.ownerDocument.createElement("button");
    button.className = `jam-deck-canvas-stack-image-focus-nav is-${spec.cls}`;
    button.type = "button";
    button.setAttribute("aria-label", spec.label);
    button.setAttribute("data-tooltip-position", direction === "bottom" ? "top" : direction === "top" ? "bottom" : "top");
    setIcon(button, spec.icon);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onPresentArrow(spec.key);
    });
    return button;
  }

  presentNavDirections() {
    const shown = [];
    const playlist = this.imageFocus && this.imageFocus.playlist;
    if (Array.isArray(playlist) && playlist.length > 1) shown.push("left", "right");
    for (const direction of ["left", "right", "top", "bottom"]) {
      if (shown.includes(direction)) continue;
      if (this.findPresentNeighbor(direction)) shown.push(direction);
    }
    return shown;
  }

  syncPresentNav() {
    const wrapper = this.imageFocus && this.imageFocus.wrapper;
    if (!wrapper) return;
    for (const button of Array.from(wrapper.querySelectorAll(".jam-deck-canvas-stack-image-focus-nav"))) {
      button.remove();
    }
    for (const direction of this.presentNavDirections()) {
      const button = this.createPresentNavButton(direction);
      if (button) wrapper.appendChild(button);
    }
  }

  stepPresent(delta) {
    const focus = this.imageFocus;
    if (!focus || !Array.isArray(focus.playlist) || focus.playlist.length < 2) return false;
    const nextIndex = (focus.index + Number(delta || 0) + focus.playlist.length) % focus.playlist.length;
    return this.stepPresentToNode(focus.playlist[nextIndex], Number(delta) < 0 ? "left" : "right", nextIndex);
  }

  stepPresentToNode(node, motion, nextIndex = null) {
    const focus = this.imageFocus;
    const content = this.resolvePresentContent(node);
    if (!focus || !content || !focus.media) return false;
    if (focus.video && typeof focus.video.pause === "function") {
      try { focus.video.pause(); } catch (error) {}
    }
    if (typeof focus.disposeVideo === "function") {
      try { focus.disposeVideo(); } catch (error) {}
    }
    const focusedVideo = this.fillPresentMedia(focus.media, content);
    this.playPresentStep(focus.media, motion);
    if (focus.titleEl) focus.titleEl.textContent = content.label;
    focus.wrapper.removeAttribute("aria-label");
    if (focus.titleEl && focus.titleEl.id) focus.wrapper.setAttribute("aria-labelledby", focus.titleEl.id);
    focus.video = focusedVideo;
    focus.node = node;
    if (Number.isInteger(nextIndex)) focus.index = nextIndex;
    else if (Array.isArray(focus.playlist) && focus.playlist.length) {
      const found = focus.playlist.findIndex((item) => item === node || String(item && item.id) === String(node && node.id));
      if (found >= 0) focus.index = found;
    }
    focus.disposeVideo = focusedVideo ? this.attachPresentVideo(focusedVideo, content.videoEl, focus.wrapper) : () => {};
    this.syncPresentNav();
    try { focus.wrapper.focus({ preventScroll: true }); } catch (error) { focus.wrapper.focus(); }
    return true;
  }

  canvasNodeId(node) {
    if (!node) return "";
    if (node.id != null && String(node.id)) return String(node.id);
    try {
      const data = typeof node.getData === "function" ? node.getData() : null;
      return String((data && data.id) || "");
    } catch (error) { return ""; }
  }

  findCanvasNodeById(id) {
    const key = String(id || "");
    if (!key || !this.canvas || !this.canvas.nodes) return null;
    if (typeof this.canvas.nodes.get === "function") {
      const direct = this.canvas.nodes.get(key);
      if (direct) return direct;
    }
    if (typeof this.canvas.nodes.values !== "function") return null;
    for (const node of this.canvas.nodes.values()) {
      if (this.canvasNodeId(node) === key) return node;
    }
    return null;
  }

  canvasNodeRectById(id) {
    const node = this.findCanvasNodeById(id);
    if (!node || typeof node.getData !== "function") return null;
    try { return jamDeckCanvasStackRect(node.getData()); } catch (error) { return null; }
  }

  getCanvasEdges() {
    try {
      const data = this.canvas && typeof this.canvas.getData === "function" ? this.canvas.getData() : null;
      return Array.isArray(data && data.edges) ? data.edges : [];
    } catch (error) { return []; }
  }

  findPresentNeighbor(direction) {
    const focus = this.imageFocus;
    const current = (focus && focus.node) || (focus && Array.isArray(focus.playlist) && focus.playlist[focus.index]);
    const currentId = this.canvasNodeId(current);
    if (!currentId || !direction) return null;
    const hops = [];
    for (const edge of this.getCanvasEdges()) {
      const hop = jamDeckCanvasPresentEdgeHop(edge, currentId, (nodeId) => this.canvasNodeRectById(nodeId));
      if (!hop || hop.direction !== direction) continue;
      const node = this.findCanvasNodeById(hop.neighborId);
      if (!node || !this.resolvePresentContent(node)) continue;
      hops.push({ node, distance: Number(hop.distance) || 0 });
    }
    hops.sort((left, right) => left.distance - right.distance);
    return hops[0] ? hops[0].node : null;
  }

  presentNeighbor(direction) {
    const node = this.findPresentNeighbor(direction);
    return node ? this.stepPresentToNode(node, direction) : false;
  }

  presentArrowDirection(key) {
    if (key === "ArrowLeft" || key === "Left") return "left";
    if (key === "ArrowRight" || key === "Right") return "right";
    if (key === "ArrowUp" || key === "Up") return "top";
    if (key === "ArrowDown" || key === "Down") return "bottom";
    return "";
  }

  onPresentArrow(key) {
    const direction = this.presentArrowDirection(key);
    if (!direction) return false;
    const playlist = this.imageFocus && this.imageFocus.playlist;
    if (Array.isArray(playlist) && playlist.length > 1 && (direction === "left" || direction === "right")) {
      return this.stepPresent(direction === "left" ? -1 : 1);
    }
    return this.presentNeighbor(direction);
  }

  playPresentStep(media, motion) {
    if (!media) return;
    const reduced = !!(this.root && this.root.closest && this.root.closest(".jam-deck-root.jam-deck-no-motion"));
    media.classList.remove("is-step-next", "is-step-prev", "is-step-up", "is-step-down", "is-step-in");
    if (reduced) return;
    const axis = motion === "left" || motion === -1 ? "prev"
      : motion === "top" ? "up"
        : motion === "bottom" ? "down"
          : "next";
    media.classList.add(`is-step-${axis}`);
    const run = () => { if (media.isConnected) media.classList.add("is-step-in"); };
    if (this.ownerWindow && typeof this.ownerWindow.requestAnimationFrame === "function") {
      this.ownerWindow.requestAnimationFrame(() => this.ownerWindow.requestAnimationFrame(run));
      return;
    }
    run();
  }

  openNodeFocus(node, origin = null) {
    if (!node || this.imageFocus || !this.overlay || !this.entry || !this.entry.ownerDocument) return false;
    const content = this.resolvePresentContent(node);
    if (!content) return false;
    const doc = this.entry.ownerDocument;
    const wrapper = doc.createElement("div");
    wrapper.className = "jam-deck-canvas-stack-image-focus";
    const title = doc.createElement("span");
    title.className = "jam-deck-canvas-stack-image-focus-title";
    title.id = "jam-deck-present-title";
    title.textContent = content.label;
    wrapper.setAttribute("role", "dialog");
    wrapper.setAttribute("aria-modal", "true");
    wrapper.setAttribute("aria-labelledby", title.id);
    const media = doc.createElement("div");
    media.className = "jam-deck-canvas-stack-image-focus-media";
    const focusedVideo = this.fillPresentMedia(media, content);
    const close = doc.createElement("button");
    close.className = "jam-deck-canvas-stack-image-focus-close";
    close.type = "button";
    close.setAttribute("aria-label", "关闭预览");
    setIcon(close, "x");
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeImageFocus();
    });
    const playlist = this.presentablePreviewNodes();
    const index = playlist.findIndex((item) => item === node || String(item.id) === String(node.id));
    const usePlaylist = index >= 0 && playlist.length > 1;
    wrapper.tabIndex = -1;
    wrapper.appendChild(title);
    wrapper.appendChild(media);
    wrapper.appendChild(close);
    const host = this.getPresentHost();
    host.appendChild(wrapper);
    host.addClass("is-jam-deck-presenting");
    const onBackdrop = (event) => {
      if (!this.imageFocus || this.imageFocus.wrapper !== wrapper) return;
      if (this.isPresentChrome(event.target)) return;
      const onMedia = !!(event.target && event.target.closest && event.target.closest(".jam-deck-canvas-stack-image-focus-media"));
      if (event.type === "wheel" && onMedia) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== "wheel") this.closeImageFocus();
    };
    wrapper.addEventListener("pointerdown", onBackdrop, true);
    wrapper.addEventListener("wheel", onBackdrop, true);
    wrapper.addEventListener("contextmenu", onBackdrop, true);
    const onPresentKey = (event) => this.onPresentKeydown(event);
    const keyTargets = [this.ownerWindow, this.ownerWindow && this.ownerWindow.document, host, wrapper].filter(Boolean);
    for (const target of keyTargets) target.addEventListener("keydown", onPresentKey, true);
    this.imageFocus = {
      wrapper,
      media,
      origin,
      video: focusedVideo,
      host,
      playlist: usePlaylist ? playlist : [],
      index: usePlaylist ? index : 0,
      node,
      titleEl: title,
      disposeVideo: focusedVideo ? this.attachPresentVideo(focusedVideo, content.videoEl, wrapper) : () => {},
      disposeKeys: () => {
        for (const target of keyTargets) {
          try { target.removeEventListener("keydown", onPresentKey, true); } catch (error) {}
        }
      },
    };
    this.syncPresentNav();
    this.ownerWindow.requestAnimationFrame(() => {
      wrapper.addClass("is-visible");
      try { wrapper.focus({ preventScroll: true }); } catch (error) { wrapper.focus(); }
    });
    return true;
  }

  getPresentHost() {
    const deckRoot = this.root && this.root.closest && this.root.closest(".jam-deck-root");
    return deckRoot || this.overlay;
  }

  lockPresentVideoFocus(video, wrapper) {
    if (!video || !wrapper) return () => {};
    const restore = () => {
      if (!this.imageFocus || this.imageFocus.wrapper !== wrapper) return;
      try { video.blur(); } catch (error) {}
      try { wrapper.focus({ preventScroll: true }); } catch (error) {
        try { wrapper.focus(); } catch (focusError) {}
      }
    };
    video.addEventListener("focusin", restore, true);
    video.addEventListener("pointerup", restore, true);
    return () => {
      try { video.removeEventListener("focusin", restore, true); } catch (error) {}
      try { video.removeEventListener("pointerup", restore, true); } catch (error) {}
    };
  }

  onPresentKeydown(event) {
    if (!this.imageFocus || !event) return false;
    if (jamDeckIsTypingTarget(event.target) || jamDeckIsModalEvent(event)) return false;
    const key = String(event.key || "");
    const code = String(event.code || "");
    const isF = key === "f" || key === "F" || code === "KeyF";
    const isArrow = key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown"
      || key === "Left" || key === "Right" || key === "Up" || key === "Down";
    if (key === "Escape" || isF) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.closeImageFocus();
      return true;
    }
    if (key === " " || key === "Spacebar") {
      if (event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.togglePresentVideo();
      return true;
    }
    if (isArrow) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (key === "ArrowLeft" || key === "Left" || key === "ArrowRight" || key === "Right"
        || key === "ArrowUp" || key === "Up" || key === "ArrowDown" || key === "Down") {
        this.onPresentArrow(key);
      }
      return true;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  togglePresentVideo() {
    const video = this.imageFocus && (this.imageFocus.video || (this.imageFocus.wrapper && this.imageFocus.wrapper.querySelector("video")));
    if (!video) return false;
    if (video.paused) {
      const play = video.play();
      if (play && typeof play.catch === "function") play.catch(() => {});
    } else {
      video.pause();
    }
    return true;
  }

  closeImageFocus() {
    const focus = this.imageFocus;
    if (!focus) return;
    this.imageFocus = null;
    if (typeof focus.disposeVideo === "function") {
      try { focus.disposeVideo(); } catch (error) {}
    }
    if (typeof focus.disposeKeys === "function") {
      try { focus.disposeKeys(); } catch (error) {}
    }
    if (focus.host) focus.host.removeClass("is-jam-deck-presenting");
    if (focus.video && typeof focus.video.pause === "function") {
      try { focus.video.pause(); } catch (error) {}
    }
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
    // Explicit Jam Deck folders own their membership and geometry.  Leave the
    // legacy overlap stack controller out of those gestures so a folder drop
    // cannot be followed by an implicit second grouping/snap operation.
    if (
      currentItem && currentItem.node && currentItem.node.nodeEl
      && currentItem.node.nodeEl.hasClass && currentItem.node.nodeEl.hasClass("is-jam-deck-folder-member")
    ) return false;
    if (currentItem && currentItem.data && currentItem.data.jamdeck && (currentItem.data.jamdeck.folderId || currentItem.data.jamdeck.folder)) return false;
    // Folder members are buried at the anchor and mutually overlap, so they
    // look exactly like a legacy stack cluster.  Folders own grouping now —
    // the legacy auto-snap must never normalize/snap onto folder-owned nodes.
    const candidates = this.getStackItems(false).filter((item) => item.id !== currentItem.id);
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
    if (
      currentItem.node && currentItem.node.nodeEl && currentItem.node.nodeEl.hasClass
      && currentItem.node.nodeEl.hasClass("is-jam-deck-folder-member")
    ) return false;
    if (currentItem.data && currentItem.data.jamdeck && (currentItem.data.jamdeck.folderId || currentItem.data.jamdeck.folder)) return false;
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
    // Explicit folder members are owned by CanvasFolderController and must
    // not also appear as an implicit legacy overlap stack.
    this.clusters = jamDeckBuildCanvasStackClusters(this.getStackItems(false));
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
    if (
      this.previewClusterId
      && !this.clusters.some((cluster) => cluster.id === this.previewClusterId)
      && !this.externalPreviewClusters.has(this.previewClusterId)
    ) this.collapsePreview();
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
    // Folder members are hidden while collapsed, so Obsidian may never hydrate
    // their native <img> DOM before the folder asks for a thumbnail.  Resolve
    // image nodes from the canonical Canvas file path instead of cloning that
    // timing-dependent DOM; this also keeps the expanded preview deterministic.
    if (member && member.kind === "image" && this.entry && this.entry.ownerDocument) {
      const app = this.runtime && this.runtime.deckView && this.runtime.deckView.app;
      const filePath = String(
        member.node && member.node.file && member.node.file.path
        || member.data && member.data.file
        || "",
      ).trim();
      const adapter = app && app.vault && app.vault.adapter;
      if (filePath && adapter && typeof adapter.getResourcePath === "function") {
        try {
          const src = adapter.getResourcePath(filePath);
          if (src) {
            const surface = this.entry.ownerDocument.createElement("div");
            surface.className = "jam-deck-canvas-stack-preview-surface is-image";
            surface.setAttribute("aria-hidden", "true");
            surface.setAttribute("draggable", "false");
            const image = this.entry.ownerDocument.createElement("img");
            image.src = src;
            image.alt = "";
            image.setAttribute("aria-hidden", "true");
            image.setAttribute("draggable", "false");
            surface.appendChild(image);
            return surface;
          }
        } catch (error) {}
      }
    }
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
    // Explicit folders only displace nodes actually covered by the opened
    // cards. Legacy free stacks retain their softer 64px influence field.
    // This restores the folder's spatial push without recreating dozens of
    // compositor layers across an image-heavy board.
    const explicitFolder = Boolean(cluster && cluster.folderId);
    const selectedIds = new Set(cluster.members.map((member) => member.id));
    const focus = {
      left: layout.x,
      top: layout.y,
      right: layout.x + layout.width,
      bottom: layout.y + layout.height,
    };
    const pending = [];
    for (const item of this.getCanvasItems()) {
      if (selectedIds.has(item.id) || !item.node || !item.node.nodeEl || !item.node.nodeEl.isConnected) continue;
      const jamdeck = item.data && item.data.jamdeck;
      if (explicitFolder && jamdeck && (jamdeck.folderId || jamdeck.folder || jamdeck.folderGroupId)) continue;
      if (
        explicitFolder
        && item.node.nodeEl.classList
        && (
          item.node.nodeEl.classList.contains("is-jam-deck-folder-proxy-hidden")
          || item.node.nodeEl.classList.contains("is-jam-deck-folder-collapsed")
          || item.node.nodeEl.classList.contains("is-jam-deck-folder-hidden-member")
        )
      ) continue;
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
        20,
        explicitFolder ? 0 : 64,
      );
      if (Math.abs(shift.x) < 0.5 && Math.abs(shift.y) < 0.5) continue;
      const scale = jamDeckCanvasStackScreenScale(item);
      pending.push({ nodeEl: item.node.nodeEl, x: shift.x / scale, y: shift.y / scale });
    }
    // Keep layout reads above and style writes below so one preview does not
    // repeatedly force synchronous layout for every bystander.
    const bystanders = [];
    for (const { nodeEl, x, y } of pending) {
      nodeEl.style.setProperty("--jd-stack-bystander-x", `${x}px`);
      nodeEl.style.setProperty("--jd-stack-bystander-y", `${y}px`);
      nodeEl.addClass("is-jam-deck-stack-bystander");
      bystanders.push(nodeEl);
    }
    return bystanders;
  }

  showPreview(cluster) {
    this.collapsePreview(true);
    if (!this.overlay || !cluster || cluster.members.length < 2) return;
    const isExternal = !this.clusters.some((candidate) => candidate.id === cluster.id);
    if (isExternal) this.externalPreviewClusters.set(cluster.id, cluster);
    const rootRect = this.root.getBoundingClientRect();
    const visuals = this.buildPreviewVisuals(cluster, rootRect);
    if (visuals.length < 2) {
      this.externalPreviewClusters.delete(cluster.id);
      return;
    }
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
      const built = this.createPreviewCard(visual, layout.positions[index], rootRect, index);
      if (!built) return;
      wrapper.appendChild(built.card);
      previewCards.push(built);
    });
    if (previewCards.length < 2) {
      for (const visual of previewCards) visual.member.node.nodeEl.removeClass("is-jam-deck-stack-source-ghost");
      this.externalPreviewClusters.delete(cluster.id);
      return;
    }
    // Measure the existing Canvas before mounting the overlay or hiding source
    // nodes. This avoids a write -> full-board layout-read flush on open.
    const previewBystanders = this.prepareBystanders(cluster, layout, rootRect);
    for (const visual of previewCards) visual.member.node.nodeEl.addClass("is-jam-deck-stack-source-ghost");
    this.overlay.appendChild(wrapper);
    this.previewWrapper = wrapper;
    this.previewCards = previewCards;
    this.previewCluster = cluster;
    this.previewClusterId = cluster.id;
    this.previewBystanders = previewBystanders;
    this.notifyFolderPreview(cluster, "opening", { reason: "stack-open" });
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

  buildPreviewVisuals(cluster, rootRect) {
    // Explicit folders render read-only proxies while their real Canvas nodes
    // are hidden.  Their preview therefore carries canonical screen-space
    // source rects instead of sampling presentation-mutated native DOM.
    const suppliedSourceRects = cluster.sourceRects instanceof Map ? cluster.sourceRects : null;
    const sourceRectFor = (member) => {
      const supplied = suppliedSourceRects && suppliedSourceRects.get(String(member && member.id || ""));
      if (supplied && Number(supplied.width) > 0 && Number(supplied.height) > 0) {
        return {
          left: Number(supplied.left),
          top: Number(supplied.top),
          width: Number(supplied.width),
          height: Number(supplied.height),
          right: Number.isFinite(Number(supplied.right)) ? Number(supplied.right) : Number(supplied.left) + Number(supplied.width),
          bottom: Number.isFinite(Number(supplied.bottom)) ? Number(supplied.bottom) : Number(supplied.top) + Number(supplied.height),
        };
      }
      const nodeEl = member && member.node && member.node.nodeEl;
      return nodeEl && typeof nodeEl.getBoundingClientRect === "function" ? nodeEl.getBoundingClientRect() : null;
    };
    const ordered = cluster.members.slice().sort((left, right) => {
      const a = sourceRectFor(left);
      const b = sourceRectFor(right);
      return (a && b ? a.top - b.top || a.left - b.left : 0) || String(left.id).localeCompare(String(right.id));
    });
    const pending = [];
    for (const member of ordered) {
      const nodeEl = member.node && member.node.nodeEl;
      if (!nodeEl) continue;
      const rect = sourceRectFor(member);
      if (!rect || !rect.width || !rect.height) continue;
      const normalization = member.kind === "image" || member.kind === "text"
        ? jamDeckCanvasStackNormalization(member.data, member.kind)
        : null;
      const logicalCanvasSize = normalization ? normalization.originalCanvasSize : member.rect;
      const screenScale = jamDeckCanvasStackScreenScale(member);
      pending.push({
        member,
        rect,
        nativeWidth: Math.max(1, Number(logicalCanvasSize.width) * screenScale),
        nativeHeight: Math.max(1, Number(logicalCanvasSize.height) * screenScale),
      });
    }
    const imageSizes = pending
      .filter((item) => item.member.kind === "image")
      .map((item) => ({ width: item.nativeWidth, height: item.nativeHeight }));
    return pending.map((item) => {
      const paper = jamDeckCanvasStackPreviewLogicalSize(
        item.member.kind,
        item.nativeWidth,
        item.nativeHeight,
        imageSizes,
      );
      return {
        member: item.member,
        rect: item.rect,
        logicalWidth: paper.width,
        logicalHeight: paper.height,
      };
    });
  }

  createPreviewCard(visual, position, rootRect, index) {
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
        ? "文本：单击放大，拖动移出堆叠"
        : "笔记：单击放大，拖动移出堆叠");
    card.style.left = `${position.x}px`;
    card.style.top = `${position.y}px`;
    card.style.width = `${position.width}px`;
    card.style.height = `${position.height}px`;
    card.style.setProperty("--jd-stack-index", String(index));
    card.style.setProperty("--jd-stack-delay", `${Math.min(72, index * 18)}ms`);
    card.style.setProperty("--jd-stack-from-x", `${source.left - position.x}px`);
    card.style.setProperty("--jd-stack-from-y", `${source.top - position.y}px`);
    card.style.setProperty("--jd-stack-from-scale", String(source.width && position.width ? source.width / position.width : 1));
    if (visual.member.kind === "text") {
      card.style.setProperty(
        "--jd-stack-text-font-size",
        `${JAM_DECK_STACK_TEXT_PREVIEW_FONT_PX}px`,
      );
      card.style.setProperty(
        "--jd-stack-text-padding",
        `${JAM_DECK_STACK_TEXT_PREVIEW_PADDING_PX}px`,
      );
    }
    const surface = this.createPreviewSurface(visual.member);
    if (!surface) return null;
    card.appendChild(surface);
    return { card, member: visual.member, source, position };
  }

  cleanupPreview(wrapper, cards, bystanders, options = {}) {
    if (this.previewRemovalTimer) this.ownerWindow.clearTimeout(this.previewRemovalTimer);
    this.previewRemovalTimer = 0;
    const cluster = this.previewWrapper === wrapper ? this.previewCluster : null;
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
    // During the normal collapse path the cards are removed after 340ms, but
    // the folder flap is still finishing its delayed 600ms close animation.
    // Only immediate/reduced-motion cleanup may force the visual bridge to
    // "closed" here; otherwise onStackPreviewState's WAAPI completion owns
    // the final class/style reset.
    if (cluster && options.forceClosed) this.notifyFolderPreview(cluster, "closed", { reason: "stack-cleanup", immediate: true });
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
    const cluster = this.previewCluster;
    const cards = this.previewCards.slice();
    const bystanders = this.previewBystanders.slice();
    this.externalPreviewClusters.clear();
    this.previewClusterId = null;
    const reducedMotion = !!(
      this.root
      && this.root.closest
      && this.root.closest(".jam-deck-root.jam-deck-no-motion")
    );
    this.notifyFolderPreview(cluster, "closing", {
      reason: immediate ? "stack-immediate-collapse" : "stack-collapse",
      immediate: immediate || reducedMotion,
      delay: JAM_DECK_CANVAS_FOLDER_PREVIEW_CARD_RETURN_MS,
    });
    if (!wrapper) {
      if (cluster) this.notifyFolderPreview(cluster, "closed", { reason: "stack-no-wrapper", immediate: true });
      return;
    }
    if (immediate || reducedMotion) {
      this.cleanupPreview(wrapper, cards, bystanders, { forceClosed: true });
      return;
    }
    if (wrapper.hasClass("is-closing")) return;
    for (const nodeEl of bystanders) nodeEl.removeClass("is-jam-deck-stack-displaced");
    const rootRect = this.root.getBoundingClientRect();
    cards.forEach((visual, index) => {
      const target = visual.position || visual.source;
      const targetLeft = Number.isFinite(Number(target.left)) ? Number(target.left) : Number(target.x) || 0;
      const targetTop = Number.isFinite(Number(target.top)) ? Number(target.top) : Number(target.y) || 0;
      const folderSource = cluster && cluster.folderId ? visual.source : null;
      const nodeEl = visual.member && visual.member.node && visual.member.node.nodeEl;
      const latest = !folderSource && nodeEl && nodeEl.isConnected ? nodeEl.getBoundingClientRect() : null;
      const returnLeft = folderSource ? folderSource.left : latest ? latest.left - rootRect.left : targetLeft;
      const returnTop = folderSource ? folderSource.top : latest ? latest.top - rootRect.top : targetTop;
      const returnScale = folderSource && target.width
        ? folderSource.width / target.width
        : latest && target.width ? latest.width / target.width : 1;
      visual.card.style.setProperty("--jd-stack-return-x", `${returnLeft - targetLeft}px`);
      visual.card.style.setProperty("--jd-stack-return-y", `${returnTop - targetTop}px`);
      visual.card.style.setProperty("--jd-stack-return-scale", String(returnScale));
      visual.card.style.setProperty("--jd-stack-exit-delay", `${Math.min(54, (cards.length - index - 1) * 18)}ms`);
    });
    wrapper.removeClass("is-visible");
    wrapper.addClass("is-closing");
    this.previewRemovalTimer = this.ownerWindow.setTimeout(() => this.cleanupPreview(wrapper, cards, bystanders, { forceClosed: false }), JAM_DECK_STACK_PREVIEW_CLEANUP_MS);
  }

  destroy() {
    this.destroyed = true;
    this.closeImageFocus();
    if (this.previewPress) this.cancelPreviewPress(this.previewPress, false);
    this.collapsePreview(true);
    this.externalPreviewClusters.clear();
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

/**
 * Explicit Canvas folder groups.  Obsidian's internal group API has changed
 * across releases, so this controller uses capability-gated node setData()
 * mutations and keeps the canonical folder record on the anchor node.  The
 * other members only carry folderId, which makes the state portable and
 * undoable without touching data.json.  Obsidian 1.12 exposes createGroupNode
 * but does not persist member identity (and bbox containment is ambiguous),
 * therefore the explicit anchor/member metadata is deliberate and remains
 * the portable fallback when that native capability is absent.
 */
class CanvasFolderController {
  constructor(runtime, entry) {
    this.runtime = runtime;
    this.entry = entry;
    this.canvas = entry.leaf && entry.leaf.view && entry.leaf.view.canvas;
    this.root = entry.leaf && entry.leaf.containerEl;
    this.ownerWindow = entry.ownerDocument && entry.ownerDocument.defaultView;
    this.ownerDocument = entry.ownerDocument;
    // The explicit-folder surface is only a visual replacement for the old
    // geometric stack.  Keep accepting the historical entry key while the
    // runtime migrates to the shorter stackController alias.
    this.stack = entry.stackController || entry.imageStackController || null;
    this.disposers = [];
    this.groups = new Map();
    this.nodeToGroup = new Map();
    // Runtime-only folder state.  Persisted folder metadata deliberately
    // stays in schema v1; transitions, DOM handles and focus requests never
    // enter Canvas node data.
    this.folderRuntimes = new Map();
    this.folderViews = new Map();
    // Runtime-only bridge state for the old stack preview.  A folder shell is
    // not expanded in Canvas data when its preview opens, so this map owns the
    // flap animation/timer independently of persisted collapsed state.
    this.folderPreviewRuntimes = new Map();
    this.focusRequestToken = null;
    this.reconcileGeneration = 0;
    this.currentFrame = 0;
    this.drag = null;
    this.shellDrag = null;
    this.layer = null;
    this.popoverLayer = null;
    this.activePopover = null;
    this.toolbarMenu = null;
    this.toolbarButtons = new Map();
    this.toolbarFrame = 0;
    this.observer = null;
    this.resizeObserver = null;
    this.reconcileFrame = 0;
    this.destroyed = false;
    this.boundKeydown = (event) => this.onDocumentKeydown(event);
    if (this.ownerDocument) this.ownerDocument.addEventListener("keydown", this.boundKeydown, true);
  }

  // Obsidian's connection/resizer UI is a single overlay
  // (canvas.nodeInteractionLayer, a direct child of canvasEl) positioned over
  // whichever node its geometric hit-test targets.  Folded members keep their
  // data rects at the anchor — including oversized members that extend beyond
  // the shell — so hovering near the folder targets a HIDDEN member (or the
  // native group node) and the purple connection dot surfaces.  Intercept
  // setTarget at the source: folder-owned nodes never become the target.
  patchNodeInteractionLayer() {
    const layer = this.canvas && this.canvas.nodeInteractionLayer;
    if (!layer || layer.jamDeckFolderPatched || typeof layer.setTarget !== "function") return false;
    const original = layer.setTarget;
    const self = this;
    layer.setTarget = function patchedJamDeckSetTarget(node) {
      if (self.isFolderOwnedNode(node)) return original.call(this, null);
      return original.call(this, node);
    };
    layer.jamDeckFolderPatched = true;
    if (self.isFolderOwnedNode(layer.target)) original.call(layer, null);
    this.disposers.push(() => {
      try {
        if (layer.jamDeckFolderPatched) {
          layer.setTarget = original;
          delete layer.jamDeckFolderPatched;
        }
      } catch (error) {}
    });
    return true;
  }

  isFolderOwnedNode(node) {
    if (!node) return false;
    const id = String(node.id || "");
    let data = null;
    try { data = typeof node.getData === "function" ? node.getData() : node.data || null; } catch (error) { data = null; }
    if (data && data.jamdeck && (data.jamdeck.folderId || data.jamdeck.folder || data.jamdeck.folderGroupId)) return true;
    for (const group of this.groups.values()) {
      if (this.isNativeFolder(group) && String(group.nativeGroupId) === id) return true;
    }
    return false;
  }

  install() {
    if (
      this.destroyed || !this.canvas || !this.root || !this.ownerWindow || !this.ownerDocument
      || !this.root.hasClass || !this.root.hasClass("jam-deck-canvas-leaf")
    ) return false;
    if (!this.getAtomicFolderCapability()) {
      this.reportFolderSafetyOnce("atomic-capability", "当前 Obsidian 版本无法验证安全的 Canvas 整图事务，文件夹功能未启用");
      return false;
    }
    this.root.addClass("has-jam-deck-canvas-folders");
    this.purgeStaleNativeGroupNodes();
    this.patchNodeInteractionLayer();
    this.layer = this.ownerDocument.createElement("div");
    this.layer.className = "jam-deck-canvas-folder-layer";
    this.layer.setAttribute("aria-hidden", "false");
    this.layer.style.pointerEvents = "none";
    this.root.appendChild(this.layer);
    this.popoverLayer = this.ownerDocument.createElement("div");
    this.popoverLayer.className = "jam-deck-canvas-folder-popover-layer";
    this.popoverLayer.style.pointerEvents = "none";
    this.root.appendChild(this.popoverLayer);

    const pointerdown = (event) => this.onPointerDown(event);
    const pointermove = (event) => this.onPointerMove(event);
    const sync = () => this.scheduleToolbarSync();
    const viewportSync = (event) => {
      // Native Canvas pans and zooms do not always mutate the node list.  A
      // cheap frame-level reconcile keeps the real representative nodes in
      // lockstep with the world viewport while avoiding the active drag path.
      if (this.drag || this.shellDrag) return;
      if (event && event.type === "pointermove" && !event.buttons && !(this.canvas && (this.canvas.isPanning || this.canvas.isDragging))) return;
      this.scheduleReconcile();
    };
    this.root.addEventListener("pointerdown", pointerdown, true);
    this.ownerWindow.addEventListener("pointermove", pointermove, true);
    this.root.addEventListener("pointerdown", sync, true);
    this.root.addEventListener("focusin", sync, true);
    this.root.addEventListener("pointermove", viewportSync, true);
    this.root.addEventListener("wheel", viewportSync, true);
    this.disposers.push(() => this.root.removeEventListener("pointerdown", pointerdown, true));
    this.disposers.push(() => this.ownerWindow.removeEventListener("pointermove", pointermove, true));
    this.disposers.push(() => this.root.removeEventListener("pointerdown", sync, true));
    this.disposers.push(() => this.root.removeEventListener("focusin", sync, true));
    this.disposers.push(() => this.root.removeEventListener("pointermove", viewportSync, true));
    this.disposers.push(() => this.root.removeEventListener("wheel", viewportSync, true));

    const pointerup = (event) => this.onPointerUp(event, false);
    const pointercancel = (event) => this.onPointerUp(event, true);
    this.ownerWindow.addEventListener("pointerup", pointerup, true);
    this.ownerWindow.addEventListener("pointercancel", pointercancel, true);
    this.disposers.push(() => this.ownerWindow.removeEventListener("pointerup", pointerup, true));
    this.disposers.push(() => this.ownerWindow.removeEventListener("pointercancel", pointercancel, true));

    const MutationObserverCtor = this.ownerWindow.MutationObserver;
    if (typeof MutationObserverCtor === "function") {
      this.observer = new MutationObserverCtor((mutations) => {
        const stackOverlay = this.stack && this.stack.overlay;
        const relevant = mutations.some((mutation) => !(
          this.layer && (mutation.target === this.layer || this.layer.contains(mutation.target))
          || this.popoverLayer && (mutation.target === this.popoverLayer || this.popoverLayer.contains(mutation.target))
          || stackOverlay && (mutation.target === stackOverlay || stackOverlay.contains(mutation.target))
        ));
        if (relevant && !this.drag && !this.shellDrag) this.scheduleReconcile();
        this.scheduleToolbarSync();
      });
      this.observer.observe(this.root, { subtree: true, childList: true });
      if (this.canvas && this.canvas.canvasEl) {
        this.observer.observe(this.canvas.canvasEl, { attributes: true, attributeFilter: ["style"] });
      }
    }
    const ResizeObserverCtor = this.ownerWindow.ResizeObserver;
    if (typeof ResizeObserverCtor === "function") {
      this.resizeObserver = new ResizeObserverCtor(() => {
        if (!this.drag && !this.shellDrag) this.scheduleReconcile();
      });
      this.resizeObserver.observe(this.root);
    }
    this.scheduleReconcile();
    this.syncToolbar();
    return true;
  }

  getItems() {
    if (this.stack && typeof this.stack.getStackItems === "function") {
      return this.stack.getStackItems().filter((item) => item && item.node && item.rect);
    }
    if (!this.canvas || !this.canvas.nodes || typeof this.canvas.nodes.values !== "function") return [];
    const items = [];
    for (const node of this.canvas.nodes.values()) {
      if (!node || typeof node.getData !== "function") continue;
      let data;
      try { data = node.getData(); } catch (error) { continue; }
      const kind = jamDeckCanvasStackKind(data);
      const rect = jamDeckCanvasStackRect(data);
      if (!kind || !rect) continue;
      items.push({ id: String(data.id || node.id), node, data, rect, kind });
    }
    return items;
  }

  findNodeFromElement(element) {
    if (this.stack && typeof this.stack.findNodeFromElement === "function") return this.stack.findNodeFromElement(element);
    const nodeEl = element && element.closest ? element.closest(".canvas-node") : null;
    if (!nodeEl || !this.root.contains(nodeEl) || !this.canvas || !this.canvas.nodes) return null;
    for (const node of this.canvas.nodes.values()) if (node && node.nodeEl === nodeEl) return node;
    return null;
  }

  findItem(node) {
    if (!node) return null;
    const id = String(node.id || "");
    return this.getItems().find((item) => item.node === node || item.id === id) || null;
  }

  isBlockedTarget(target) {
    return !!(target && target.closest && target.closest(
      "button, input, textarea, [contenteditable='true'], .canvas-node-resizer, .canvas-control-point, .canvas-card-menu, .canvas-menu, .jam-deck-drawing-palette, .jam-deck-canvas-ink-layer, .jam-deck-canvas-folder-control, .jam-deck-canvas-folder-popover, .jam-deck-canvas-folder-front, .jam-deck-canvas-folder-meta"
    ));
  }

  onPointerDown(event) {
    if (
      this.destroyed || !event.isPrimary || event.button !== 0 || this.canvas.readonly
      || this.isBlockedTarget(event.target) || this.root.hasClass("is-jam-deck-drawing")
      || this.canvas.isHoldingSpace
    ) return;
    const node = this.findNodeFromElement(event.target);
    const item = this.findItem(node);
    if (!item) return;
    const selection = this.getSelectedItems();
    if (selection.length > 1 && selection.some((selected) => selected.id === item.id)) return;
    const schema = jamDeckCanvasFolderSchema(item.data);
    this.drag = {
      pointerId: event.pointerId,
      node,
      nodeId: item.id,
      beforeRect: { ...item.rect },
      beforeFolderId: schema && schema.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      moved: false,
    };
  }

  onPointerMove(event) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;
    if (!drag.moved && Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) >= 5) drag.moved = true;
  }

  onPointerUp(event, cancelled) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;
    this.drag = null;
    if (cancelled || !drag.moved) return;
    this.ownerWindow.setTimeout(() => this.finishDrop(drag), 0);
  }

  getSelectedItems() {
    const items = this.getItems();
    if (!this.canvas || !this.canvas.nodes) return [];
    const selectedNodes = new Set();
    if (this.canvas.selection && typeof this.canvas.selection.values === "function") {
      for (const node of this.canvas.selection.values()) selectedNodes.add(node);
    }
    const selected = items.filter((item) => selectedNodes.has(item.node) || (
      item.node && item.node.nodeEl && item.node.nodeEl.matches && item.node.nodeEl.matches(".is-selected, .is-focused")
    ));
    return selected;
  }

  collectGroups() {
    const items = this.getItems();
    const byId = new Map(items.map((item) => [item.id, item]));
    const groups = new Map();
    for (const item of items) {
      const schema = jamDeckCanvasFolderSchema(item.data);
      if (!schema) continue;
      const group = groups.get(schema.id) || {
        id: schema.id,
        anchorId: schema.anchorId,
        anchorNodeId: schema.anchorId,
        memberIds: new Set(),
        collapsed: schema.collapsed,
        color: schema.color,
        layoutMode: schema.layoutMode,
        native: schema.native,
        label: schema.label,
        nativeGroupId: schema.nativeGroupId,
        positions: schema.positions,
        stacked: schema.stacked,
        hiddenEdges: schema.hiddenEdges,
        representativeIds: schema.representativeIds,
        representativeColumns: schema.representativeColumns,
      };
      group.memberIds.add(item.id);
      if (schema.anchorId === item.id || item.data.jamdeck && item.data.jamdeck.folder) {
        group.anchorId = item.id;
        group.anchorNodeId = item.id;
        group.collapsed = schema.collapsed;
        group.color = schema.color;
        group.layoutMode = schema.layoutMode;
        group.native = schema.native;
        group.label = schema.label;
        group.nativeGroupId = schema.nativeGroupId;
        group.positions = schema.positions;
        group.stacked = schema.stacked;
        group.hiddenEdges = schema.hiddenEdges;
        group.representativeIds = schema.representativeIds;
        group.representativeColumns = schema.representativeColumns;
      }
      for (const memberId of schema.memberIds) if (byId.has(memberId)) group.memberIds.add(memberId);
      groups.set(schema.id, group);
    }
    const result = [];
    for (const group of groups.values()) {
      const members = [...group.memberIds].map((id) => byId.get(id)).filter(Boolean);
      if (members.length < 2) continue;
      const anchor = byId.get(group.anchorId)
        || members.slice().sort((left, right) => String(left.id).localeCompare(String(right.id)))[0]
        || members[0];
      const memberIds = jamDeckCanvasFolderMemberSort(members, anchor.id).map((item) => String(item.id));
      result.push({
        ...group,
        anchor,
        members: jamDeckCanvasFolderMemberSort(members, anchor.id),
        memberIds,
        bounds: jamDeckCanvasFolderBounds(members),
        representativeIds: jamDeckCanvasFolderRepresentatives(members, anchor.id).map((item) => String(item.id)),
        anchorNodeId: String(anchor.id || group.anchorNodeId || group.anchorId || ""),
        representativeColumns: jamDeckCanvasFolderRepresentativeColumns(members),
      });
    }
    return result.sort((left, right) => left.id.localeCompare(right.id));
  }

  scheduleReconcile() {
    if (this.destroyed || this.reconcileFrame) return;
    const raf = jamDeckRequestFrame(this.ownerWindow);
    this.reconcileFrame = raf(() => {
      this.reconcileFrame = 0;
      this.reconcile();
    });
  }

  getFolderRuntime(id, group = null) {
    const key = String(id || "");
    if (!key) return null;
    let runtime = this.folderRuntimes.get(key);
    if (!runtime) {
      runtime = {
        id: key,
        state: group && group.collapsed ? "collapsed" : "expanded",
        transitionToken: 0,
        animations: new Set(),
        timer: 0,
        raf: 0,
        lastScreenRect: null,
        lastScreenRectFrame: -1,
        inline: new Map(),
        presentation: new Map(),
        // Screen-space node rects are captured before representative child
        // transforms are applied.  They anchor the collapsed shell without
        // feeding the transformed representative rect back into its bounds.
        nodeRects: new Map(),
        poses: new Map(),
        dragPose: new Map(),
        pendingFocus: false,
        expectedCollapsed: group && !!group.collapsed,
        memberSignature: group ? (group.memberIds || []).map(String).sort().join("|") : "",
      };
      this.folderRuntimes.set(key, runtime);
    }
    return runtime;
  }

  cancelFolderTransition(runtime, restore = true) {
    if (!runtime) return;
    runtime.transitionToken += 1;
    for (const animation of runtime.animations || []) {
      try { if (animation && typeof animation.cancel === "function") animation.cancel(); } catch (error) {}
    }
    if (runtime.animations) runtime.animations.clear();
    if (runtime.timer && this.ownerWindow) {
      try { this.ownerWindow.clearTimeout(runtime.timer); } catch (error) {}
      runtime.timer = 0;
    }
    if (runtime.raf && this.ownerWindow) {
      try {
        if (typeof this.ownerWindow.cancelAnimationFrame === "function") this.ownerWindow.cancelAnimationFrame(runtime.raf);
        else if (typeof this.ownerWindow.clearTimeout === "function") this.ownerWindow.clearTimeout(runtime.raf);
      } catch (error) {}
      runtime.raf = 0;
    }
    if (restore) this.restoreFolderInline(runtime);
  }

  captureFolderInline(runtime, group) {
    if (!runtime || !group) return;
    runtime.inline = runtime.inline || new Map();
    for (const member of group.members || []) {
      const nodeEl = member && member.node && member.node.nodeEl;
      if (!nodeEl || runtime.inline.has(String(member.id))) continue;
      const container = nodeEl.querySelector && nodeEl.querySelector(":scope > .canvas-node-container");
      runtime.inline.set(String(member.id), {
        node: nodeEl,
        container,
        transform: container && container.style ? container.style.getPropertyValue("transform") : "",
        transformOrigin: container && container.style ? container.style.getPropertyValue("transform-origin") : "",
        opacity: container && container.style ? container.style.getPropertyValue("opacity") : "",
        visibility: nodeEl.style ? nodeEl.style.getPropertyValue("visibility") : "",
        pointerEvents: nodeEl.style ? nodeEl.style.getPropertyValue("pointer-events") : "",
      });
    }
  }

  restoreFolderInline(runtime) {
    if (!runtime || !runtime.inline) return;
    for (const snapshot of runtime.inline.values()) {
      const nodeEl = snapshot && snapshot.node;
      const container = snapshot && snapshot.container;
      if (!nodeEl || !nodeEl.style) continue;
      if (container && container.style) {
        if (snapshot.transform) container.style.setProperty("transform", snapshot.transform);
        else container.style.removeProperty("transform");
        if (snapshot.transformOrigin) container.style.setProperty("transform-origin", snapshot.transformOrigin);
        else container.style.removeProperty("transform-origin");
        if (snapshot.opacity) container.style.setProperty("opacity", snapshot.opacity);
        else container.style.removeProperty("opacity");
      }
      if (snapshot.visibility) nodeEl.style.setProperty("visibility", snapshot.visibility);
      else nodeEl.style.removeProperty("visibility");
      if (snapshot.pointerEvents) nodeEl.style.setProperty("pointer-events", snapshot.pointerEvents);
      else nodeEl.style.removeProperty("pointer-events");
    }
    runtime.inline.clear();
  }

  prefersReducedMotion() {
    try {
      return !!(this.root && this.root.closest && this.root.closest(".jam-deck-root.jam-deck-no-motion"));
    } catch (error) { return false; }
  }

  nodeContainer(node) {
    const nodeEl = node && node.nodeEl;
    if (!nodeEl || !nodeEl.querySelector) return null;
    return nodeEl.querySelector(":scope > .canvas-node-container") || nodeEl.querySelector(".canvas-node-container");
  }

  readTransformMatrix(container) {
    const win = this.ownerWindow;
    let value = "none";
    try {
      value = container && container.style && container.style.transform
        ? container.style.transform
        : win && win.getComputedStyle && win.getComputedStyle(container).transform;
    } catch (error) {}
    if (!value || value === "none") return null;
    const Matrix = win && (win.DOMMatrix || win.WebKitCSSMatrix);
    if (typeof Matrix !== "function") return null;
    try { return new Matrix(value); } catch (error) { return null; }
  }

  transformWithDelta(container, dx = 0, dy = 0, sx = 1, sy = sx) {
    const Matrix = this.ownerWindow && (this.ownerWindow.DOMMatrix || this.ownerWindow.WebKitCSSMatrix);
    const base = this.readTransformMatrix(container);
    if (!Matrix || !base) {
      const tx = Number.isFinite(Number(dx)) ? Number(dx) : 0;
      const ty = Number.isFinite(Number(dy)) ? Number(dy) : 0;
      const scaleX = Number.isFinite(Number(sx)) ? Number(sx) : 1;
      const scaleY = Number.isFinite(Number(sy)) ? Number(sy) : scaleX;
      return `translate(${tx}px, ${ty}px) scale(${scaleX}, ${scaleY})`;
    }
    try {
      const delta = new Matrix().translate(Number(dx) || 0, Number(dy) || 0).scale(Number(sx) || 1, Number(sy) || Number(sx) || 1);
      const result = typeof base.multiply === "function" ? base.multiply(delta) : delta;
      if (typeof result.toString === "function") return result.toString();
    } catch (error) {}
    return `translate(${Number(dx) || 0}px, ${Number(dy) || 0}px) scale(${Number(sx) || 1}, ${Number(sy) || Number(sx) || 1})`;
  }

  transformWithPose(container, pose = {}, baseValue = "") {
    const dx = Number(pose.dx) || 0;
    const dy = Number(pose.dy) || 0;
    const sx = Number.isFinite(Number(pose.sx)) ? Number(pose.sx) : 1;
    const sy = Number.isFinite(Number(pose.sy)) ? Number(pose.sy) : sx;
    const rotate = Number(pose.rotate) || 0;
    const Matrix = this.ownerWindow && (this.ownerWindow.DOMMatrix || this.ownerWindow.WebKitCSSMatrix);
    if (typeof Matrix === "function") {
      try {
        let base = null;
        if (baseValue && baseValue !== "none") base = new Matrix(baseValue);
        if (!base) base = new Matrix();
        let delta = new Matrix().translate(dx, dy).scale(sx, sy);
        if (rotate && typeof delta.rotate === "function") delta = delta.rotate(rotate);
        const result = typeof base.multiply === "function" ? base.multiply(delta) : delta;
        if (result && typeof result.toString === "function") return result.toString();
      } catch (error) {}
    }
    const base = baseValue && baseValue !== "none" ? `${baseValue} ` : "";
    return `${base}translate(${dx}px, ${dy}px) scale(${sx}, ${sy}) rotate(${rotate}deg)`;
  }

  captureFolderPresentation(runtime, group) {
    if (!runtime || !group) return;
    runtime.presentation = runtime.presentation || new Map();
    runtime.nodeRects = runtime.nodeRects || new Map();
    for (const member of group.members || []) {
      const nodeEl = member && member.node && member.node.nodeEl;
      if (!nodeEl) continue;
      let nodeRect = null;
      try {
        const rect = typeof nodeEl.getBoundingClientRect === "function" ? nodeEl.getBoundingClientRect() : null;
        if (rect && rect.width > 0 && rect.height > 0) {
          nodeRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        }
      } catch (error) {}
      // A stable collapsed folder tracks viewport moves, while opening and
      // closing transitions keep their first rect as the FLIP anchor.
      if (nodeRect && (runtime.state === "collapsed" || !runtime.nodeRects.has(String(member.id)))) {
        runtime.nodeRects.set(String(member.id), nodeRect);
      }
      const container = this.nodeContainer(member.node);
      if (!container) continue;
      const existing = runtime.presentation.get(String(member.id));
      if (existing && existing.container === container) {
        if (nodeRect && runtime.state === "collapsed") existing.nodeRect = nodeRect;
        continue;
      }
      let computedTransform = "";
      try {
        computedTransform = this.ownerWindow && this.ownerWindow.getComputedStyle
          ? this.ownerWindow.getComputedStyle(container).transform
          : "";
      } catch (error) {}
      runtime.presentation.set(String(member.id), {
        node: nodeEl,
        container,
        nodeRect,
        transform: container.style ? container.style.getPropertyValue("transform") : "",
        baseTransform: computedTransform && computedTransform !== "none" ? computedTransform : "",
        transformOrigin: container.style ? container.style.getPropertyValue("transform-origin") : "",
        opacity: container.style ? container.style.getPropertyValue("opacity") : "",
        visibility: nodeEl.style ? nodeEl.style.getPropertyValue("visibility") : "",
        pointerEvents: nodeEl.style ? nodeEl.style.getPropertyValue("pointer-events") : "",
      });
    }
  }

  restoreFolderPresentation(runtime) {
    if (!runtime || !runtime.presentation) return;
    for (const snapshot of runtime.presentation.values()) {
      const container = snapshot && snapshot.container;
      if (!container || !container.style) continue;
      if (snapshot.transform) container.style.setProperty("transform", snapshot.transform);
      else container.style.removeProperty("transform");
      if (snapshot.transformOrigin) container.style.setProperty("transform-origin", snapshot.transformOrigin);
      else container.style.removeProperty("transform-origin");
      if (snapshot.opacity) container.style.setProperty("opacity", snapshot.opacity);
      else container.style.removeProperty("opacity");
      if (snapshot.node && snapshot.node.style) {
        if (snapshot.visibility) snapshot.node.style.setProperty("visibility", snapshot.visibility);
        else snapshot.node.style.removeProperty("visibility");
        if (snapshot.pointerEvents) snapshot.node.style.setProperty("pointer-events", snapshot.pointerEvents);
        else snapshot.node.style.removeProperty("pointer-events");
      }
    }
    runtime.presentation.clear();
    if (runtime.nodeRects) runtime.nodeRects.clear();
    if (runtime.poses) runtime.poses.clear();
    if (runtime.dragPose) runtime.dragPose.clear();
  }

  applyFolderPresentation(runtime, memberId) {
    if (!runtime || !runtime.presentation || !runtime.poses) return;
    const key = String(memberId || "");
    const snapshot = runtime.presentation.get(key);
    const pose = runtime.poses.get(key);
    if (!snapshot || !snapshot.container || !pose) return;
    const drag = runtime.dragPose && runtime.dragPose.get(key);
    const composed = {
      dx: pose.dx + (drag ? drag.dx : 0),
      dy: pose.dy + (drag ? drag.dy : 0),
      sx: pose.sx,
      sy: pose.sy,
      rotate: pose.rotate,
    };
    snapshot.container.style.transform = this.transformWithPose(snapshot.container, composed, snapshot.transform || snapshot.baseTransform || "");
    snapshot.container.style.transformOrigin = "50% 50%";
  }

  applyFolderRuntimeNodes(group, runtime) {
    if (!group || !runtime) return;
    // v4 folders never mutate native member transforms/z-index. The shell
    // owns sanitized proxy thumbnails; native nodes are hidden by one scoped
    // class whose dataset token makes cleanup ownership explicit.
    if (runtime.presentation && runtime.presentation.size) this.restoreFolderPresentation(runtime);
    // 折叠隐藏完全由 group.collapsed 驱动。toolbar 层级验证（view.safe）只
    // 影响壳体自身的可交互性，缩放/平移引起的瞬时验证失败不得让成员露出。
    const hide = !!group.collapsed;
    for (const member of group.members || []) {
      const nodeEl = member && member.node && member.node.nodeEl;
      if (!nodeEl) continue;
      nodeEl.addClass("is-jam-deck-folder-member");
      nodeEl.addClass(member.id === group.anchor.id ? "is-jam-deck-folder-anchor" : "is-jam-deck-folder-member");
      nodeEl.classList.toggle("is-jam-deck-folder-collapsed", hide);
      nodeEl.classList.toggle("is-jam-deck-folder-expanded", !hide);
      nodeEl.removeClass("is-jam-deck-folder-representative");
      nodeEl.removeClass("is-jam-deck-folder-hidden-member");
      if (hide) {
        nodeEl.dataset.jamDeckFolderOwner = String(group.id);
        nodeEl.addClass("is-jam-deck-folder-proxy-hidden");
      } else if (!nodeEl.dataset || nodeEl.dataset.jamDeckFolderOwner === String(group.id)) {
        nodeEl.removeClass("is-jam-deck-folder-proxy-hidden");
        if (nodeEl.dataset) delete nodeEl.dataset.jamDeckFolderOwner;
      }
    }
  }

  restoreFolderOwnedNodes(groupOrId, members = null) {
    const id = String(groupOrId && groupOrId.id || groupOrId || "");
    const source = members || (groupOrId && groupOrId.members) || this.getItems();
    for (const member of source || []) {
      const nodeEl = member && member.node && member.node.nodeEl;
      if (!nodeEl) continue;
      if (!id || !nodeEl.dataset || nodeEl.dataset.jamDeckFolderOwner === id) {
        nodeEl.removeClass("is-jam-deck-folder-proxy-hidden");
        if (nodeEl.dataset) delete nodeEl.dataset.jamDeckFolderOwner;
      }
    }
  }

  finishFolderTransition(runtime, group, opening, token) {
    if (!runtime || token !== runtime.transitionToken || this.destroyed) return;
    this.cancelFolderTransition(runtime, false);
    runtime.state = opening ? "expanded" : "collapsed";
    this.restoreFolderInline(runtime);
    this.applyFolderRuntimeNodes(group, runtime);
    this.renderFolderLayer();
    if (runtime.pendingFocus || (this.focusRequestToken && this.focusRequestToken.id === runtime.id)) {
      runtime.pendingFocus = false;
      this.consumeFocusRequest(runtime.id);
    }
  }

  animateFolderTransition(group, opening, snapshot = null) {
    const runtime = this.getFolderRuntime(group && group.id, group);
    if (!runtime) return;
    this.cancelFolderTransition(runtime);
    runtime.state = opening ? "opening" : "closing";
    const token = ++runtime.transitionToken;
    this.captureFolderInline(runtime, group);
    this.applyFolderRuntimeNodes(group, runtime);
    this.renderFolderLayer();
    if (this.ownerWindow) {
      const raf = jamDeckRequestFrame(this.ownerWindow);
      runtime.raf = raf(() => {
        runtime.raf = 0;
        if (token === runtime.transitionToken) this.renderFolderLayer();
      });
    }
    if (this.prefersReducedMotion()) {
      this.finishFolderTransition(runtime, group, opening, token);
      return;
    }
    const matrixCtor = this.ownerWindow && (this.ownerWindow.DOMMatrix || this.ownerWindow.WebKitCSSMatrix);
    if (typeof matrixCtor !== "function") {
      this.finishFolderTransition(runtime, group, opening, token);
      return;
    }
    const canAnimate = group.members.some((member) => {
      const container = this.nodeContainer(member.node);
      return container && typeof container.animate === "function";
    });
    if (!canAnimate) {
      this.finishFolderTransition(runtime, group, opening, token);
      return;
    }
    runtime.timer = this.ownerWindow && typeof this.ownerWindow.setTimeout === "function"
      ? this.ownerWindow.setTimeout(() => this.finishFolderTransition(runtime, group, opening, token), opening ? 420 : 380)
      : 0;
    const currentById = new Map();
    for (const member of group.members || []) {
      const nodeEl = member && member.node && member.node.nodeEl;
      const container = this.nodeContainer(member.node);
      if (!nodeEl || !container || typeof nodeEl.getBoundingClientRect !== "function") continue;
      const rect = nodeEl.getBoundingClientRect();
      currentById.set(String(member.id), rect);
      const old = snapshot && snapshot.get(String(member.id));
      let dx = 0;
      let dy = 0;
      let sx = 1;
      let sy = 1;
      let fromOpacity = 1;
      let toOpacity = 1;
      if (opening) {
        if (old && old.width > 0 && old.height > 0) {
          const oldCenterX = old.left + old.width / 2;
          const oldCenterY = old.top + old.height / 2;
          dx = (oldCenterX - (rect.left + rect.width / 2)) / Math.max(0.04, jamDeckCanvasStackScreenScale(member));
          dy = (oldCenterY - (rect.top + rect.height / 2)) / Math.max(0.04, jamDeckCanvasStackScreenScale(member));
          sx = old.width / Math.max(1, rect.width);
          sy = old.height / Math.max(1, rect.height);
        } else {
          const center = this.groupScreenBounds(group);
          const cx = center ? center.left + center.width / 2 : rect.left + rect.width / 2;
          const cy = center ? center.top + center.height / 2 : rect.top + rect.height / 2;
          dx = (cx - (rect.left + rect.width / 2)) / Math.max(0.04, jamDeckCanvasStackScreenScale(member));
          dy = (cy - (rect.top + rect.height / 2)) / Math.max(0.04, jamDeckCanvasStackScreenScale(member));
          sx = sy = 0.82;
          fromOpacity = 0.18;
        }
      } else {
        const bounds = this.groupScreenBounds(group);
        const index = (group.representativeIds || []).indexOf(String(member.id));
        const repCount = Math.min(JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES, (group.representativeIds || []).length);
        const slot = index >= 0 && bounds ? this.folderRepresentativeSlot(bounds, repCount, index) : null;
        if (slot) {
          const rootRect = this.root && this.root.getBoundingClientRect ? this.root.getBoundingClientRect() : { left: 0, top: 0 };
           dx = (rootRect.left + slot.centerX - (rect.left + rect.width / 2)) / Math.max(0.04, jamDeckCanvasStackScreenScale(member));
           dy = (rootRect.top + slot.centerY - (rect.top + rect.height / 2)) / Math.max(0.04, jamDeckCanvasStackScreenScale(member));
           sx = slot.contentWidth / Math.max(1, rect.width);
           sy = slot.contentHeight / Math.max(1, rect.height);
          toOpacity = 0.72;
        } else {
          toOpacity = 0;
        }
      }
      const delay = opening ? Math.min(72, (group.members.indexOf(member) || 0) * 18) : Math.min(72, ((group.members.length - 1 - group.members.indexOf(member)) || 0) * 18);
      const fromTransform = opening ? this.transformWithDelta(container, dx, dy, sx, sy) : this.transformWithDelta(container, 0, 0, 1, 1);
      const toTransform = opening ? this.transformWithDelta(container, 0, 0, 1, 1) : this.transformWithDelta(container, dx, dy, sx, sy);
      try {
        const animation = container.animate([
          { transform: fromTransform, opacity: fromOpacity },
          { transform: toTransform, opacity: toOpacity },
        ], { duration: opening ? 300 : 260, delay, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" });
        runtime.animations.add(animation);
        Promise.resolve(animation.finished).catch(() => {}).then(() => {
          runtime.animations.delete(animation);
          if (!runtime.animations.size) this.finishFolderTransition(runtime, group, opening, token);
        });
      } catch (error) {}
    }
    if (!runtime.animations.size) {
      this.finishFolderTransition(runtime, group, opening, token);
    }
  }

  onDocumentKeydown(event) {
    if (this.destroyed || !event) return;
    if (jamDeckIsModalEvent(event) || jamDeckIsTypingTarget(event.target)) return;
    if (event.key === "Escape" && this.activePopover) {
      const trigger = this.activePopover.trigger;
      this.closeFolderColorPopover(true);
      if (trigger && typeof trigger.focus === "function") {
        try { trigger.focus(); } catch (error) {}
      }
      return;
    }
    // Preview fan-outs (native packed folders included) close via the close
    // button or Escape; clicking elsewhere never collapses them.
    if (event.key === "Escape" && !this.drag && !this.shellDrag) {
      if (this.stack && this.stack.previewClusterId && typeof this.stack.collapsePreview === "function") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.stack.collapsePreview();
      }
    }
  }

  reconcile() {
    if (this.destroyed) return;
    this.currentFrame += 1;
    this.reconcileGeneration += 1;
    const nextGroups = new Map(this.collectGroups().map((group) => [group.id, group]));
    for (const [id, runtime] of this.folderRuntimes.entries()) {
      const group = nextGroups.get(id);
      if (!group) {
        this.cancelFolderTransition(runtime);
        this.restoreFolderPresentation(runtime);
        this.folderRuntimes.delete(id);
        if (this.focusRequestToken && this.focusRequestToken.id === id) this.focusRequestToken = null;
      }
    }
    this.groups = nextGroups;
    this.nodeToGroup.clear();
    const seenNodes = new Set();
    for (const group of nextGroups.values()) {
      const runtime = this.getFolderRuntime(group.id, group);
      const stableState = group.collapsed ? "collapsed" : "expanded";
      const memberSignature = (group.memberIds || []).map(String).sort().join("|");
      if (
        runtime.state === "opening" || runtime.state === "closing"
      ) {
        const expected = runtime.expectedCollapsed;
        if ((expected !== undefined && expected !== !!group.collapsed) || (runtime.memberSignature && runtime.memberSignature !== memberSignature)) {
          this.cancelFolderTransition(runtime);
          runtime.state = stableState;
          runtime.pendingFocus = false;
          if (this.focusRequestToken && this.focusRequestToken.id === group.id) this.focusRequestToken = null;
        }
      }
      if (runtime.state !== "opening" && runtime.state !== "closing") runtime.state = stableState;
      runtime.expectedCollapsed = !!group.collapsed;
      runtime.memberSignature = memberSignature;
      if (runtime.state === "collapsed") this.captureFolderPresentation(runtime, group);
      this.applyFolderRuntimeNodes(group, runtime);
      for (const member of group.members || []) {
        this.nodeToGroup.set(String(member.id), group);
        seenNodes.add(String(member.id));
        const nodeEl = member.node && member.node.nodeEl;
        if (!nodeEl) continue;
        const index = group.representativeIds.indexOf(String(member.id));
        nodeEl.style.setProperty("--jd-folder-representative-columns", String(group.representativeColumns || 1));
        nodeEl.style.setProperty("--jd-folder-representative-index", String(Math.max(0, index)));
        nodeEl.style.setProperty("--jd-folder-member-visibility", index >= 0 ? "visible" : "hidden");
      }
    }
    for (const item of this.getItems()) {
      if (seenNodes.has(String(item.id))) continue;
      const nodeEl = item.node && item.node.nodeEl;
      if (!nodeEl || !nodeEl.style) continue;
      nodeEl.removeClass("is-jam-deck-folder-member");
      nodeEl.removeClass("is-jam-deck-folder-anchor");
      nodeEl.removeClass("is-jam-deck-folder-collapsed");
      nodeEl.removeClass("is-jam-deck-folder-expanded");
      nodeEl.removeClass("is-jam-deck-folder-representative");
      nodeEl.removeClass("is-jam-deck-folder-hidden-member");
      nodeEl.removeClass("is-opening");
      nodeEl.removeClass("is-closing");
      nodeEl.removeClass("is-transitioning");
      nodeEl.removeClass("is-jam-deck-folder-transitioning");
      nodeEl.style.removeProperty("--jd-folder-color");
      nodeEl.style.removeProperty("--jd-folder-id");
      nodeEl.style.removeProperty("--jd-folder-representative-index");
      nodeEl.style.removeProperty("--jd-folder-representative-columns");
      nodeEl.style.removeProperty("--jd-folder-member-visibility");
      nodeEl.style.removeProperty("visibility");
      nodeEl.style.removeProperty("pointer-events");
    }
    this.renderFolderLayer();
    this.syncToolbar();
  }

  getToolbarMenu() {
    const candidates = [
      this.canvas && this.canvas.menu && this.canvas.menu.menuEl,
      this.root && this.root.querySelector(".canvas-menu"),
    ];
    for (const menu of candidates) {
      if (!menu || !menu.isConnected || !this.root.contains(menu)) continue;
      if (menu.closest && menu.closest(".canvas-card-menu")) continue;
      return menu;
    }
    return null;
  }

  ensureToolbarButton(menu, id, label, icon, callback) {
    if (!menu) return null;
    const previous = this.toolbarButtons.get(id);
    if (previous && previous.isConnected && previous.parentElement === menu) return previous;
    if (previous) previous.remove();
    const existing = menu.querySelector(`.jam-deck-canvas-folder-toolbar[data-folder-action="${id}"]`);
    if (existing) existing.remove();
    const button = this.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "clickable-icon jam-deck-canvas-folder-toolbar";
    button.dataset.folderAction = id;
    button.setAttribute("aria-label", label);
    setIcon(button, icon);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      callback();
    }, true);
    menu.appendChild(button);
    this.toolbarButtons.set(id, button);
    this.toolbarMenu = menu;
    return button;
  }

  scheduleToolbarSync() {
    if (this.destroyed || this.toolbarFrame) return;
    const raf = jamDeckRequestFrame(this.ownerWindow);
    this.toolbarFrame = raf(() => {
      this.toolbarFrame = 0;
      this.syncToolbar();
    });
  }

  syncToolbar() {
    if (this.destroyed) return;
    const menu = this.getToolbarMenu();
    if (!menu) {
      for (const button of this.toolbarButtons.values()) button.hidden = true;
      return;
    }
    const selected = this.getSelectedItems();
    const stackBlocked = !!(this.stack && (this.stack.previewWrapper || this.stack.imageFocus || this.stack.drag));
    const available = !stackBlocked && selected.length >= 2 && selected.every((item) => item && item.kind);
    const stackButton = this.ensureToolbarButton(menu, "stack", "堆叠编组", "layers", () => this.performToolbarAction("stack"));
    const gridButton = this.ensureToolbarButton(menu, "grid", "网格排列", "layout-grid", () => this.performToolbarAction("grid"));
    for (const button of [stackButton, gridButton]) {
      if (!button) continue;
      button.hidden = !available;
      button.disabled = !!(this.canvas && this.canvas.readonly);
    }
  }

  performToolbarAction(action) {
    const selected = this.getSelectedItems();
    if (selected.length < 2 || selected.some((item) => !item.kind)) return;
    try {
      if (action === "grid") this.layoutSelectionGrid(selected);
      else this.createFolder(selected);
    } catch (error) {
      console.error("jam-deck Canvas folder toolbar action failed", error);
      new Notice(`Jam Deck：${error.message || "文件夹操作失败"}`);
    }
  }

  folderStackCluster(group) {
    if (!group) return null;
    const sourceMembers = Array.isArray(group.members) ? group.members : [];
    if (sourceMembers.length < 2) return null;
    const liveById = new Map();
    try {
      for (const item of this.getItems()) if (item && item.id) liveById.set(String(item.id), item);
    } catch (error) {}
    const members = sourceMembers
      .map((member) => liveById.get(String(member && member.id || "")) || member)
      .filter((member) => member && member.id && member.node && member.data && jamDeckCanvasStackRect(member.rect));
    if (members.length < 2) return null;
    const anchorId = String(group.anchor && group.anchor.id || group.anchorId || members[0].id);
    const anchor = members.find((member) => String(member.id) === anchorId) || members[0];
    return {
      id: `folder:${String(group.id || anchorId)}`,
      folderId: String(group.id || anchorId),
      members,
      anchor,
      sourceRects: this.folderPreviewSourceRects(group),
    };
  }

  toggleFolderPreview(group) {
    const latest = group && group.id ? (this.groupFromId(group.id) || group) : group;
    if (!latest) return false;
    // Native folders stay packed (members buried at the anchor); the preview
    // is the same read-only card fan-out as legacy folders, so expansion
    // never un-buries real nodes and never re-enables their interactions.
    const cluster = this.folderStackCluster(latest);
    if (!cluster || !this.stack || typeof this.stack.togglePreview !== "function") return false;
    this.stack.togglePreview(cluster);
    return true;
  }

  folderPreviewId(cluster) {
    if (!cluster) return "";
    if (cluster.folderId) return String(cluster.folderId);
    const id = String(cluster.id || "");
    return id.startsWith("folder:") ? id.slice("folder:".length) : "";
  }

  setFolderPreviewShellState(view, state) {
    const shell = view && view.shell;
    if (!shell) return;
    const classList = shell.classList;
    if (classList && typeof classList.toggle === "function") {
      classList.toggle("is-preview-opening", state === "opening");
      classList.toggle("is-preview-open", state === "open");
      classList.toggle("is-preview-closing", state === "closing");
      classList.toggle("is-preview-closing-flap", state === "closing-flap");
    }
    if (shell.dataset) shell.dataset.previewState = state;
  }

  clearFolderPreviewRuntime(id, resetFront = true) {
    const key = String(id || "");
    if (!key) return;
    const runtime = this.folderPreviewRuntimes.get(key);
    if (runtime) {
      if (runtime.timer && this.ownerWindow && typeof this.ownerWindow.clearTimeout === "function") {
        try { this.ownerWindow.clearTimeout(runtime.timer); } catch (error) {}
      }
      runtime.timer = 0;
      if (runtime.animation && typeof runtime.animation.cancel === "function") {
        try { runtime.animation.cancel(); } catch (error) {}
      }
      runtime.animation = null;
      runtime.token = (runtime.token || 0) + 1;
    }
    const view = this.folderViews.get(key);
    if (view) {
      this.setFolderPreviewShellState(view, "closed");
      if (resetFront && view.front && view.front.style) {
        view.front.style.removeProperty("transform");
        view.front.style.removeProperty("opacity");
        view.front.style.removeProperty("visibility");
      }
    }
    this.folderPreviewRuntimes.delete(key);
  }

  animateFolderPreviewFront(id, open, immediate = false) {
    const key = String(id || "");
    const runtime = this.folderPreviewRuntimes.get(key);
    const view = this.folderViews.get(key);
    const front = view && view.front;
    if (!runtime || !front) return false;
    const token = runtime.token;
    if (runtime.animation && typeof runtime.animation.cancel === "function") {
      try { runtime.animation.cancel(); } catch (error) {}
      runtime.animation = null;
    }
    const startTransform = "perspective(260px) rotateX(0deg)";
    const openTransform = "perspective(260px) rotateX(-48deg)";
    const start = open ? { transform: startTransform, opacity: 1 } : { transform: openTransform, opacity: 0 };
    const end = open ? { transform: openTransform, opacity: 0 } : { transform: startTransform, opacity: 1 };
    const finish = () => {
      if (this.destroyed || !this.folderPreviewRuntimes.has(key)) return;
      const latest = this.folderPreviewRuntimes.get(key);
      if (!latest || latest.token !== token) return;
      // Cancel the fill:"both" WAAPI animation so its persisted end state stops
      // overriding the CSS transform. Without this, one preview open/close cycle
      // leaves front pinned at perspective(260px) rotateX(0deg) and the CSS
      // :hover/:focus-within flap motion can never re-apply rotateX(-18deg).
      if (latest.animation && typeof latest.animation.cancel === "function") {
        try { latest.animation.cancel(); } catch (error) {}
      }
      latest.animation = null;
      latest.state = open ? "open" : "closed";
      if (open) {
        this.setFolderPreviewShellState(view, "open");
      } else {
        this.setFolderPreviewShellState(view, "closed");
        if (front.style) {
          front.style.removeProperty("transform");
          front.style.removeProperty("opacity");
          front.style.removeProperty("visibility");
        }
        this.folderPreviewRuntimes.delete(key);
      }
    };
    if (
      immediate
      || this.prefersReducedMotion()
      || typeof front.animate !== "function"
    ) {
      if (front.style) {
        front.style.transform = end.transform;
        front.style.opacity = String(end.opacity);
        front.style.visibility = "visible";
      }
      finish();
      return true;
    }
    try {
      const animation = front.animate([start, end], {
        duration: open ? JAM_DECK_CANVAS_FOLDER_PREVIEW_OPEN_MS : JAM_DECK_CANVAS_FOLDER_PREVIEW_CLOSE_MS,
        easing: "cubic-bezier(.2, 1.15, .45, 1)",
        fill: "both",
      });
      runtime.animation = animation;
      Promise.resolve(animation.finished).catch(() => {}).then(finish);
      return true;
    } catch (error) {
      if (front.style) {
        front.style.transform = end.transform;
        front.style.opacity = String(end.opacity);
        front.style.visibility = "visible";
      }
      finish();
      return false;
    }
  }

  onStackPreviewState(cluster, state = "closed", options = {}) {
    if (this.destroyed) return;
    const id = this.folderPreviewId(cluster);
    if (!id) return;
    let runtime = this.folderPreviewRuntimes.get(id);
    if (!runtime) {
      runtime = { id, state: "closed", token: 0, timer: 0, animation: null };
      this.folderPreviewRuntimes.set(id, runtime);
    }
    if (runtime.timer && this.ownerWindow && typeof this.ownerWindow.clearTimeout === "function") {
      try { this.ownerWindow.clearTimeout(runtime.timer); } catch (error) {}
      runtime.timer = 0;
    }
    if (runtime.animation && typeof runtime.animation.cancel === "function") {
      try { runtime.animation.cancel(); } catch (error) {}
      runtime.animation = null;
    }
    runtime.token += 1;
    const view = this.folderViews.get(id);
    if (state === "opening") {
      runtime.state = "opening";
      this.setFolderPreviewShellState(view, "opening");
      this.animateFolderPreviewFront(id, true, !!options.immediate);
      return;
    }
    if (state === "closing") {
      runtime.state = "closing";
      this.setFolderPreviewShellState(view, "closing");
      const reduced = this.prefersReducedMotion();
      const immediate = !!options.immediate || reduced;
      const delay = immediate
        ? 0
        : Math.max(0, Number(options.delay) || JAM_DECK_CANVAS_FOLDER_PREVIEW_CARD_RETURN_MS);
      const token = runtime.token;
      const close = () => {
        const latest = this.folderPreviewRuntimes.get(id);
        if (!latest || latest.token !== token || this.destroyed) return;
        latest.timer = 0;
        if (view) this.setFolderPreviewShellState(view, "closing-flap");
        this.animateFolderPreviewFront(id, false, immediate);
      };
      if (delay && this.ownerWindow && typeof this.ownerWindow.setTimeout === "function") runtime.timer = this.ownerWindow.setTimeout(close, delay);
      else close();
      return;
    }
    runtime.state = "closed";
    this.clearFolderPreviewRuntime(id, true);
  }

  cloneData(data) {
    return data && typeof data === "object" ? { ...data, jamdeck: data.jamdeck ? { ...data.jamdeck, folder: data.jamdeck.folder ? { ...data.jamdeck.folder } : undefined } : undefined } : data;
  }

  cloneCanvasData(data) {
    if (data === undefined) return undefined;
    if (typeof structuredClone === "function") {
      try { return structuredClone(data); } catch (error) {}
    }
    return JSON.parse(JSON.stringify(data));
  }

  getAtomicFolderCapability() {
    const canvas = this.canvas;
    const history = canvas && canvas.history;
    const debounce = canvas && canvas.requestPushHistory;
    const view = canvas && canvas.view;
    if (
      !canvas || typeof canvas.getData !== "function" || typeof canvas.setData !== "function"
      || typeof canvas.importData !== "function" || !history || !Array.isArray(history.data)
      || typeof history.push !== "function" || !Number.isInteger(Number(history.current))
      || !debounce || typeof debounce.run !== "function" || typeof debounce.cancel !== "function"
      || !view || typeof view.requestSave !== "function"
    ) return null;
    // Obsidian 1.12.7's aggregate setter is the transaction boundary: one
    // import followed by one synchronous history push.  Unknown Canvas builds
    // fail closed instead of degrading to partial per-node writes.
    let setterSource = "";
    try { setterSource = Function.prototype.toString.call(canvas.setData); } catch (error) {}
    if (!setterSource.includes("importData") || !setterSource.includes("pushHistory")) return null;
    return { canvas, history, debounce, view };
  }

  mutateNodes(changes, edgeChanges = null) {
    const entries = [...(changes instanceof Map ? changes.entries() : [])].filter(([, data]) => data && typeof data === "object");
    if (!entries.length && !edgeChanges) throw new Error("Canvas 节点变更为空");
    const capability = this.getAtomicFolderCapability();
    if (!capability) throw new Error("当前 Obsidian 版本不具备安全的 Canvas 整图事务能力");
    const { canvas, history, debounce, view } = capability;
    // Finish an older native gesture before taking our baseline so Jam Deck's
    // transaction never absorbs or discards unrelated user history.
    debounce.run();
    const baseline = this.cloneCanvasData(canvas.getData());
    const baselineHistory = history.data.slice();
    const baselineCurrent = Number(history.current);
    if (!baseline || !Array.isArray(baseline.nodes)) throw new Error("Canvas 整图数据不可用");
    const requested = new Map(entries.map(([id, data]) => [String(id), this.cloneCanvasData(data)]));
    if (requested.size !== entries.length) throw new Error("Canvas 节点变更包含重复 ID");
    const seen = new Set();
    const next = this.cloneCanvasData(baseline);
    next.nodes = next.nodes.map((data) => {
      const id = String(data && data.id || "");
      if (!requested.has(id)) return data;
      seen.add(id);
      return requested.get(id);
    });
    if (seen.size !== requested.size) throw new Error("Canvas 节点在事务提交前已发生变化");
    // Edge mutations ride the same atomic transaction: native folders remove
    // member edges on collapse (hiddenEdges) and restore them on expand.
    if (edgeChanges) {
      const removeIds = new Set((edgeChanges.remove || []).map(String));
      next.edges = (Array.isArray(next.edges) ? next.edges : []).filter((edge) => !removeIds.has(String(edge && edge.id || "")));
      if (Array.isArray(edgeChanges.add) && edgeChanges.add.length) next.edges = [...next.edges, ...edgeChanges.add];
    }
    this.atomicFolderMutation = { generation: ++this.reconcileGeneration, phase: "committing" };
    let committed = false;
    try {
      canvas.setData(next);
      view.requestSave();
      committed = true;
      return true;
    } catch (error) {
      try { debounce.cancel(); } catch (cancelError) {}
      try { canvas.importData(this.cloneCanvasData(baseline), true); } catch (rollbackError) {}
      canvas.data = this.cloneCanvasData(baseline);
      history.data.splice(0, history.data.length, ...baselineHistory);
      history.current = baselineCurrent;
      try { if (typeof canvas.updateHistoryUI === "function") canvas.updateHistoryUI(); } catch (historyError) {}
      try { view.requestSave(); } catch (saveError) {}
      throw error;
    } finally {
      this.atomicFolderMutation = null;
      if (this.ownerWindow) this.scheduleReconcile();
      if (!committed) this.renderFolderLayer();
    }
  }

  withFolderPayload(data, folderId, folder) {
    const next = this.cloneData(data);
    next.jamdeck = { ...(next.jamdeck || {}) };
    if (folderId) next.jamdeck.folderId = String(folderId);
    else delete next.jamdeck.folderId;
    if (folder) next.jamdeck.folder = folder;
    else delete next.jamdeck.folder;
    if (!Object.keys(next.jamdeck).length) delete next.jamdeck;
    return next;
  }

  folderRecord(group, members, overrides = {}) {
    const ids = jamDeckCanvasFolderMemberSort(members, group && group.anchor ? group.anchor.id : overrides.anchorId).map((item) => String(item.id));
    const anchorId = String(overrides.anchorId || (group && group.anchor && group.anchor.id) || ids[0] || "");
    return {
      version: JAM_DECK_CANVAS_FOLDER_SCHEMA_VERSION,
      id: String((group && group.id) || overrides.id || jamDeckCanvasFolderStableId(ids)),
      anchorId,
      memberIds: ids,
      collapsed: overrides.collapsed !== undefined ? !!overrides.collapsed : group ? !!group.collapsed : true,
      color: jamDeckCanvasFolderNormalizeColor(overrides.color || (group && group.color)),
      layoutMode: overrides.layoutMode === "grid" || (group && group.layoutMode === "grid") ? "grid" : "stack",
      native: !!overrides.native || !!(group && group.native),
      label: String(overrides.label || (group && group.label) || "文件夹").trim() || "文件夹",
      nativeGroupId: String(overrides.nativeGroupId || (group && group.nativeGroupId) || "").trim(),
      positions: overrides.positions !== undefined ? overrides.positions : (group && group.positions) || null,
      stacked: overrides.stacked !== undefined ? overrides.stacked : (group && group.stacked) || null,
      hiddenEdges: overrides.hiddenEdges !== undefined ? overrides.hiddenEdges : (group && group.hiddenEdges) || null,
      representativeIds: jamDeckCanvasFolderRepresentatives(members, anchorId).map((item) => String(item.id)),
      representativeColumns: Math.max(1, Math.min(2, overrides.representativeColumns !== undefined ? Number(overrides.representativeColumns) : jamDeckCanvasFolderRepresentativeColumns(members))),
    };
  }

  // Native folder frames default to the label 文件夹.  Repeated grouping
  // tests can leave orphan group nodes behind when a folder is dissolved
  // without an ungroup round-trip; purge those on install.
  purgeStaleNativeGroupNodes() {
    if (!this.canvas || typeof this.canvas.removeNode !== "function" || !this.canvas.nodes || typeof this.canvas.nodes.values !== "function") return 0;
    const activeIds = new Set();
    for (const group of this.collectGroups()) {
      if (this.isNativeFolder(group) && group.nativeGroupId) activeIds.add(String(group.nativeGroupId));
    }
    let removed = 0;
    for (const node of [...this.canvas.nodes.values()]) {
      if (!node) continue;
      let data = null;
      try { data = node.getData(); } catch (error) {}
      if (!data || data.type !== "group") continue;
      if (String(data.label || "") !== "文件夹") continue;
      if (activeIds.has(String(node.id))) continue;
      try {
        this.canvas.removeNode(node);
        removed += 1;
      } catch (error) {}
    }
    if (removed && this.canvas.view && typeof this.canvas.view.requestSave === "function") {
      try { this.canvas.view.requestSave(); } catch (error) {}
    }
    return removed;
  }

  getNativeGroupCapability() {
    const canvas = this.canvas;
    if (!canvas || typeof canvas.createGroupNode !== "function" || typeof canvas.removeNode !== "function") return null;
    return { canvas };
  }

  isNativeFolder(group) {
    return !!(group && group.native);
  }

  nativeGroupNode(group) {
    const gid = group && group.nativeGroupId;
    if (!gid || !this.canvas || !this.canvas.nodes || typeof this.canvas.nodes.values !== "function") return null;
    for (const node of this.canvas.nodes.values()) {
      if (!node || String(node.id || "") !== String(gid)) continue;
      // Obsidian 1.13 minifies GroupNode: nodeType is not "group" (the ctor
      // is a single letter).  Match the stable id and confirm through the
      // serialized type instead.
      let data = null;
      try { data = node.getData(); } catch (error) {}
      if (data && data.type === "group") return node;
    }
    return null;
  }

  nativeFolderBounds(group, rects) {
    const list = (Array.isArray(rects) ? rects : []).filter(Boolean);
    if (!list.length) return null;
    const left = Math.min(...list.map((rect) => rect.x));
    const top = Math.min(...list.map((rect) => rect.y));
    const right = Math.max(...list.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...list.map((rect) => rect.y + rect.height));
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  }

  // The collapsed native group must hug the authored shell, not the union of
  // stacked member rectangles (members can keep large authored sizes and
  // would otherwise make the group frame dwarf the folder visual).  The frame
  // is slightly taller (200×180) and stays invisible in Jam Deck.
  nativeFolderShellBounds(group) {
    const anchor = group && group.anchor;
    const stacked = group && group.stacked;
    const anchorStacked = anchor && stacked && stacked[String(anchor.id)];
    let centerX = 0;
    let centerY = 0;
    if (anchorStacked) {
      centerX = anchorStacked.x + anchorStacked.width / 2;
      centerY = anchorStacked.y + anchorStacked.height / 2;
    } else if (anchor && anchor.data) {
      centerX = Number(anchor.data.x) + Number(anchor.data.width) / 2;
      centerY = Number(anchor.data.y) + Number(anchor.data.height) / 2;
    } else {
      return null;
    }
    return {
      x: jamDeckRoundCanvasStackValue(centerX - JAM_DECK_CANVAS_FOLDER_BASE_WIDTH / 2),
      y: jamDeckRoundCanvasStackValue(centerY - JAM_DECK_NATIVE_GROUP_BASE_HEIGHT / 2),
      width: JAM_DECK_CANVAS_FOLDER_BASE_WIDTH,
      height: JAM_DECK_NATIVE_GROUP_BASE_HEIGHT,
    };
  }

  // The native group is a node with type "group" in Obsidian 1.13+.
  nativeFolderGroupNodeData(group, bounds) {
    if (!bounds) return null;
    return {
      id: String(group.nativeGroupId || ""),
      x: jamDeckRoundCanvasStackValue(bounds.x),
      y: jamDeckRoundCanvasStackValue(bounds.y),
      width: jamDeckRoundCanvasStackValue(bounds.width),
      height: jamDeckRoundCanvasStackValue(bounds.height),
      type: "group",
      label: group.label || "文件夹",
      // Self-describing marker so folder-owned detection (interaction-layer
      // patch, purge sweep) works without waiting for a reconcile pass.
      jamdeck: { folderGroupId: String(group.id || "") },
    };
  }

  nativeFolderRecord(group, collapsed, positions, stacked) {
    return this.folderRecord(group, group.members, {
      collapsed,
      native: true,
      label: group.label,
      nativeGroupId: group.nativeGroupId,
      positions,
      stacked,
    });
  }

  captureNativeMemberScreenRects(group) {
    const out = new Map();
    for (const member of group.members || []) {
      const nodeEl = member.node && member.node.nodeEl;
      if (!nodeEl || typeof nodeEl.getBoundingClientRect !== "function") continue;
      try {
        const rect = nodeEl.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) out.set(String(member.id), { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      } catch (error) {}
    }
    return out.size ? out : null;
  }

  // FLIP transition on the real Canvas nodes: mutateNodes lands the target
  // geometry, then a WAAPI pass animates from the previous screen pose to the
  // landed CSS transform (fill defaults to none so the element returns to the
  // Obsidian-owned transform when the animation finishes).
  animateNativeFolderTransition(group, oldRects) {
    const runtime = this.getFolderRuntime(group.id, group);
    if (!runtime || !this.ownerWindow) return;
    const scale = Math.max(0.04, Number(this.canvas && this.canvas.scale) || 1);
    const animations = new Set();
    const raf = jamDeckRequestFrame(this.ownerWindow);
    runtime.raf = raf(() => {
      runtime.raf = 0;
      for (const member of group.members || []) {
        const nodeEl = member.node && member.node.nodeEl;
        const container = this.nodeContainer(member.node);
        const old = oldRects.get(String(member.id));
        if (!nodeEl || !container || !old || typeof container.animate !== "function") continue;
        nodeEl.addClass("is-jam-deck-folder-transitioning");
        let rect = null;
        try { rect = nodeEl.getBoundingClientRect(); } catch (error) {}
        if (!rect || rect.width < 1 || rect.height < 1) continue;
        const dx = (old.left + old.width / 2 - (rect.left + rect.width / 2)) / scale;
        const dy = (old.top + old.height / 2 - (rect.top + rect.height / 2)) / scale;
        const sx = old.width / Math.max(1, rect.width);
        const sy = old.height / Math.max(1, rect.height);
        const from = this.transformWithDelta(container, dx, dy, sx, sy);
        const to = this.transformWithDelta(container, 0, 0, 1, 1);
        try {
          const animation = container.animate(
            [{ transform: from, opacity: 1 }, { transform: to, opacity: 1 }],
            { duration: 300, easing: "cubic-bezier(.22,1,.36,1)" },
          );
          animations.add(animation);
          Promise.resolve(animation.finished).catch(() => {}).then(() => {
            animations.delete(animation);
            if (!animations.size) for (const item of group.members) {
              const el = item.node && item.node.nodeEl;
              if (el) el.removeClass("is-jam-deck-folder-transitioning");
            }
          });
        } catch (error) {
          nodeEl.removeClass("is-jam-deck-folder-transitioning");
        }
      }
    });
  }

  renameNativeFolder(group, label) {
    const latest = this.groupFromId(group && group.id) || group;
    if (!this.isNativeFolder(latest)) return false;
    const nextLabel = String(label || "").trim() || "文件夹";
    if (nextLabel === latest.label) return false;
    const record = this.nativeFolderRecord(latest, latest.collapsed, latest.positions, latest.stacked);
    record.label = nextLabel;
    const g = this.nativeGroupNode(latest);
    const changes = new Map();
    changes.set(String(latest.anchor.id), this.withFolderPayload(latest.anchor.data, latest.id, record));
    if (g) {
      const bounds = latest.collapsed
        ? (this.nativeFolderShellBounds(latest) || this.nativeFolderBounds(latest, latest.stacked ? Object.values(latest.stacked) : []))
        : this.nativeFolderBounds(latest, (latest.positions ? Object.values(latest.positions) : []));
      const groupData = this.nativeFolderGroupNodeData({ ...latest, label: nextLabel }, bounds);
      if (groupData) changes.set(String(latest.nativeGroupId), groupData);
    }
    try {
      this.mutateNodes(changes);
    } catch (error) {
      console.error("jam-deck native folder rename failed", error);
      new Notice(`Jam Deck：${error.message || "文件夹重命名失败"}`);
      return false;
    }
    this.scheduleReconcile();
    return true;
  }

  createFolder(items) {
    const selected = (Array.isArray(items) ? items : []).filter((item) => item && item.node && item.data);
    if (selected.length < 2) throw new Error("至少选择两个支持的节点");
    const existing = new Set(selected.map((item) => {
      const schema = jamDeckCanvasFolderSchema(item.data);
      return schema && schema.id;
    }).filter(Boolean));
    if (existing.size > 1) throw new Error("不会自动合并两个文件夹");
    if (existing.size === 1) return false;
    const anchor = jamDeckCanvasStackAnchor(selected) || selected[0];
    const id = jamDeckCanvasFolderStableId(selected.map((item) => item.id));
    // Native folders record each member's authored rectangle as the expanded
    // destination before any stack geometry is applied.
    const native = !!this.getNativeGroupCapability();
    const positions = {};
    for (const item of selected) positions[String(item.id)] = { x: item.data.x, y: item.data.y, width: item.data.width, height: item.data.height };
    const changes = new Map();
    // Use the same normalization/snap path as a hand-drag stack.  The anchor
    // is centered on the selected bounds, then each member receives a
    // distinct overlapping slot (>50% of the smaller node area).
    const selectedBounds = jamDeckCanvasFolderBounds(selected);
    const selectedCenter = selectedBounds
      ? { x: selectedBounds.x + selectedBounds.width / 2, y: selectedBounds.y + selectedBounds.height / 2 }
      : { x: anchor.rect.x + anchor.rect.width / 2, y: anchor.rect.y + anchor.rect.height / 2 };
    const anchorRect = {
      x: jamDeckRoundCanvasStackValue(selectedCenter.x - anchor.rect.width / 2),
      y: jamDeckRoundCanvasStackValue(selectedCenter.y - anchor.rect.height / 2),
      width: anchor.rect.width,
      height: anchor.rect.height,
    };
    const placedAnchor = { ...anchor, rect: anchorRect };
    const placed = [placedAnchor];
    const zoom = jamDeckCanvasStackScreenScale(anchor);
    const normalizations = new Map();
    if (anchor.kind === "image" || anchor.kind === "text") {
      const key = jamDeckCanvasStackNormalizationKey(anchor.kind);
      const existingNormalization = jamDeckCanvasStackNormalization(anchor.data, anchor.kind);
      normalizations.set(anchor.id, {
        key,
        value: {
          version: JAM_DECK_STACK_NORMALIZATION_VERSION,
          originalCanvasSize: existingNormalization
            ? { ...existingNormalization.originalCanvasSize }
            : { width: anchor.rect.width, height: anchor.rect.height },
          normalizedCanvasSize: { width: anchorRect.width, height: anchorRect.height },
          anchorNodeIds: selected.map((member) => String(member.id)).sort(),
        },
      });
    }
    for (const item of jamDeckCanvasFolderMemberSort(selected.filter((candidate) => candidate.id !== anchor.id), anchor.id)) {
      let candidate = { ...item, rect: { ...item.rect } };
      const canNormalize = item.kind === "image" || item.kind === "text";
      const existingNormalization = canNormalize ? jamDeckCanvasStackNormalization(item.data, item.kind) : null;
      if (canNormalize) {
        const normalized = jamDeckNormalizeCanvasStackImage(candidate, placed);
        if (!normalized) throw new Error("无法规范化文件夹成员尺寸");
        candidate = { ...candidate, rect: normalized.changed ? normalized : candidate.rect };
      }
      const snap = jamDeckComputeCanvasStackSnap(candidate, { anchor: placedAnchor, members: placed }, { zoom, screenStep: 7 });
      if (!snap) throw new Error("无法将文件夹成员集中到锚点");
      candidate = { ...candidate, rect: snap };
      placed.push(candidate);
      if (canNormalize) {
        const normalizationKey = jamDeckCanvasStackNormalizationKey(item.kind);
        normalizations.set(item.id, {
          key: normalizationKey,
          value: {
            version: JAM_DECK_STACK_NORMALIZATION_VERSION,
            originalCanvasSize: existingNormalization
              ? { ...existingNormalization.originalCanvasSize }
              : { width: item.rect.width, height: item.rect.height },
            normalizedCanvasSize: { width: snap.width, height: snap.height },
            anchorNodeIds: [anchor.id].concat(placed.slice(1).map((member) => String(member.id))).sort(),
          },
        });
      }
    }
    // Native folders also own a real Canvas group node covering the stacked
    // area; it is created first so the atomic transaction below can persist
    // it together with the member move.  The bbox hugs the 200×150 shell
    // (centred on the anchor slot) instead of the member union.
    const stacked = {};
    for (const item of placed) stacked[String(item.id)] = { x: item.rect.x, y: item.rect.y, width: item.rect.width, height: item.rect.height };
    const shellBounds = this.nativeFolderShellBounds({ anchor, stacked }) || this.nativeFolderBounds({ native: true }, Object.values(stacked));
    let nativeGroupId = "";
    if (native && shellBounds && this.canvas) {
      try {
        const groupNode = this.canvas.createGroupNode({
          pos: { x: shellBounds.x, y: shellBounds.y },
          size: { width: shellBounds.width, height: shellBounds.height },
          label: "文件夹",
          save: false,
        });
        nativeGroupId = String((groupNode && groupNode.id) || "");
      } catch (error) {
        nativeGroupId = "";
      }
    }
    // Real packing from the start: member edges leave data.edges at grouping
    // time and are parked in the payload until ungroup, so the folded folder
    // never shows phantom connectors around its members.
    const nativeMemberIds = new Set(selected.map((item) => String(item.id)));
    const allEdges = native && this.canvas && typeof this.canvas.getData === "function"
      ? (this.canvas.getData().edges || [])
      : [];
    const hiddenEdges = native
      ? allEdges.filter((edge) => edge && (nativeMemberIds.has(String(edge.fromNode)) || nativeMemberIds.has(String(edge.toNode))))
      : [];
    const folder = this.folderRecord({ id, anchor }, selected, {
      id,
      anchorId: anchor.id,
      collapsed: true,
      layoutMode: "stack",
      native: !!nativeGroupId,
      label: "文件夹",
      nativeGroupId,
      positions,
      stacked,
    });
    if (hiddenEdges.length) folder.hiddenEdges = hiddenEdges;
    const placedById = new Map(placed.map((item) => [String(item.id), item]));
    for (const item of selected) {
      const geometry = placedById.get(String(item.id));
      const next = {
        ...item.data,
        x: geometry.rect.x,
        y: geometry.rect.y,
        width: geometry.rect.width,
        height: geometry.rect.height,
      };
      const normalization = normalizations.get(item.id);
      if (normalization && normalization.key) next.jamdeck = { ...(next.jamdeck || {}), [normalization.key]: normalization.value };
      changes.set(item.id, this.withFolderPayload(next, id, item.id === anchor.id ? folder : null));
    }
    if (nativeGroupId && shellBounds) {
      changes.set(nativeGroupId, this.nativeFolderGroupNodeData({ native: true, nativeGroupId, label: "文件夹" }, shellBounds));
    }
    this.mutateNodes(changes, hiddenEdges.length ? { remove: hiddenEdges.map((edge) => edge.id) } : null);
    return true;
  }

  updateGroupMembership(group, source, targetGroup = null) {
    if (!group || !source) return false;
    if (targetGroup && targetGroup.id === group.id && group.memberIds.includes(source.id)) return false;
    const itemsById = new Map(this.getItems().map((item) => [item.id, item]));
    const sourceMembers = group.members.filter((item) => item.id !== source.id);
    const changes = new Map();
    const oldFolder = sourceMembers.length >= 2
      ? this.folderRecord(group, sourceMembers, { id: group.id, anchorId: source.id === group.anchor.id ? (sourceMembers[0] && sourceMembers[0].id) : group.anchor.id })
      : null;
    for (const member of group.members) {
      if (member.id === source.id) continue;
      const data = itemsById.get(member.id) && itemsById.get(member.id).data;
      if (data) changes.set(member.id, this.withFolderPayload(data, oldFolder ? group.id : null, oldFolder && member.id === oldFolder.anchorId ? oldFolder : null));
    }
    if (!targetGroup) {
      const sourceData = itemsById.get(source.id) && itemsById.get(source.id).data;
      if (sourceData) changes.set(source.id, this.withFolderPayload(sourceData, null, null));
      this.mutateNodes(changes);
      return true;
    }
    const targetMembers = targetGroup.members.concat(source);
    // Native membership: the joined member needs authored stacked/expanded
    // rectangles too.  Folded targets pull it onto the anchor slot; expanded
    // targets keep it where the user dropped it.
    let targetOverrides = { id: targetGroup.id, anchorId: targetGroup.anchor.id };
    let sourceFoldedRect = null;
    if (this.isNativeFolder(targetGroup)) {
      const anchorStacked = targetGroup.stacked && targetGroup.stacked[String(targetGroup.anchor.id)];
      const sourcePosition = { x: source.data.x, y: source.data.y, width: source.data.width, height: source.data.height };
      const stacked = { ...(targetGroup.stacked || {}) };
      const positions = { ...(targetGroup.positions || {}) };
      stacked[String(source.id)] = anchorStacked ? { ...anchorStacked } : { ...sourcePosition };
      positions[String(source.id)] = { ...sourcePosition };
      targetOverrides = { ...targetOverrides, stacked, positions };
      if (targetGroup.collapsed && anchorStacked) {
        // Fold the member onto the anchor slot WITHOUT stealing the anchor's
        // dimensions: the member's authored width/height stay intact so the
        // preview card keeps its real aspect (a wide/short texture must not
        // be squeezed into the anchor rect and look cropped).
        const width = Number(sourcePosition.width) > 0 ? Number(sourcePosition.width) : Number(anchorStacked.width) || 1;
        const height = Number(sourcePosition.height) > 0 ? Number(sourcePosition.height) : Number(anchorStacked.height) || 1;
        sourceFoldedRect = {
          x: jamDeckRoundCanvasStackValue(anchorStacked.x + (anchorStacked.width - width) / 2),
          y: jamDeckRoundCanvasStackValue(anchorStacked.y + (anchorStacked.height - height) / 2),
          width,
          height,
        };
        stacked[String(source.id)] = { ...sourceFoldedRect };
      }
    }
    const targetFolder = this.folderRecord(targetGroup, targetMembers, targetOverrides);
    for (const member of targetMembers) {
      const data = itemsById.get(member.id) && itemsById.get(member.id).data;
      if (!data) continue;
      if (member.id === source.id && sourceFoldedRect) {
        changes.set(member.id, this.withFolderPayload({ ...data, x: sourceFoldedRect.x, y: sourceFoldedRect.y, width: sourceFoldedRect.width, height: sourceFoldedRect.height }, targetGroup.id, member.id === targetFolder.anchorId ? targetFolder : null));
      } else {
        changes.set(member.id, this.withFolderPayload(data, targetGroup.id, member.id === targetFolder.anchorId ? targetFolder : null));
      }
    }
    this.mutateNodes(changes);
    return true;
  }

  groupFromId(id) {
    return id ? this.groups.get(String(id)) || this.collectGroups().find((group) => group.id === String(id)) : null;
  }

  folderShellPointerHit(group, pointer) {
    if (!pointer || !group) return false;
    const view = this.folderViews.get(String(group.id));
    const shellEl = view && view.shell;
    if (!shellEl || typeof shellEl.getBoundingClientRect !== "function") return false;
    try {
      return jamDeckClientPointInRect(pointer.x, pointer.y, shellEl.getBoundingClientRect());
    } catch (error) {
      return false;
    }
  }

  findDropTarget(source, groups, pointer = null) {
    if (!source || !source.rect) return null;
    const scored = [];
    for (const group of groups) {
      if (group.memberIds.includes(source.id)) continue;
      let ratio;
      if (this.isNativeFolder(group) && group.collapsed) {
        // A collapsed native folder buries its members at the anchor stack;
        // judge drops against the visible 200×180 shell, not the buried
        // (and larger) stacked member rectangles.
        if (this.folderShellPointerHit(group, pointer)) {
          ratio = 1;
        } else {
          const shellBounds = this.nativeFolderShellBounds(group);
          ratio = shellBounds ? jamDeckCanvasFolderShellDropRatio(source.rect, shellBounds) : 0;
        }
      } else {
        const boundsRatio = group.bounds ? jamDeckCanvasStackOverlapRatio(source.rect, group.bounds) : 0;
        const memberRatio = Math.max(...group.members.map((member) => jamDeckCanvasStackOverlapRatio(source.rect, member.rect)), 0);
        ratio = Math.max(boundsRatio, memberRatio);
      }
      if (ratio > JAM_DECK_STACK_OVERLAP_THRESHOLD) scored.push({ group, ratio });
    }
    scored.sort((left, right) => right.ratio - left.ratio || left.group.id.localeCompare(right.group.id));
    return scored[0] || null;
  }

  finishDrop(drag) {
    if (this.destroyed || !drag || !drag.node) return;
    const source = this.findItem(drag.node);
    if (!source || !source.rect) return;
    const pointer = Number.isFinite(drag.lastClientX) && Number.isFinite(drag.lastClientY)
      ? { x: drag.lastClientX, y: drag.lastClientY }
      : null;
    const groups = this.collectGroups();
    const before = jamDeckCanvasStackRect(drag.beforeRect);
    const current = jamDeckCanvasStackRect(source.rect);
    const moved = !!(before && current && (before.x !== current.x || before.y !== current.y || before.width !== current.width || before.height !== current.height));
    const sourceGroup = drag.beforeFolderId ? groups.find((group) => group.id === drag.beforeFolderId) : null;
    const target = this.findDropTarget(source, groups, pointer);
    // Stale Canvas data still reports the pre-drag rectangle.  World overlap
    // against that rect is not a drop; only a live pointer hit on the shell is.
    if (!moved && !(target && this.folderShellPointerHit(target.group, pointer))) return;
    try {
      if (sourceGroup) {
        // A member may be rearranged inside its own expanded folder.  Only a
        // drop that clears every other member's strict overlap threshold is an
        // explicit drag-out; otherwise preserve the existing membership.
        if (!target && sourceGroup.members.some((member) => member.id !== source.id && jamDeckCanvasStackOverlapRatio(source.rect, member.rect) > JAM_DECK_STACK_OVERLAP_THRESHOLD)) return;
        if (target && target.group && target.group.id !== sourceGroup.id) {
          new Notice("Jam Deck：两个文件夹不会自动合并");
          return;
        }
        this.updateGroupMembership(sourceGroup, source, target && target.group && target.group.id !== sourceGroup.id ? target.group : null);
      } else if (target) {
        this.updateGroupMembership(target.group, source, target.group);
      } else {
        const groupedIds = new Set(groups.flatMap((group) => group.memberIds));
        const candidate = this.getItems()
          .filter((item) => item.id !== source.id && !groupedIds.has(item.id))
          .map((item) => ({ item, ratio: jamDeckCanvasStackOverlapRatio(source.rect, item.rect) }))
          .filter((entry) => entry.ratio > JAM_DECK_STACK_OVERLAP_THRESHOLD)
          .sort((left, right) => right.ratio - left.ratio)[0];
        if (candidate) this.createFolder([source, candidate.item]);
      }
    } catch (error) {
      console.error("jam-deck Canvas folder drop failed", error);
      new Notice(`Jam Deck：${error.message || "文件夹拖拽失败"}`);
    }
  }

  folderGridLayoutForExpand(group) {
    if (!group || !Array.isArray(group.members) || group.members.length < 2) return null;
    const members = group.members.slice();
    const columns = jamDeckCanvasFolderExpansionColumns(members);
    const scale = Math.max(0.04, Number(this.canvas && this.canvas.scale) || 1);
    const gap = Math.max(8, 18 / scale);
    const maxWidth = Math.max(...members.map((member) => Number(member.rect && member.rect.width) || 1));
    const maxHeight = Math.max(...members.map((member) => Number(member.rect && member.rect.height) || 1));
    const rows = Math.ceil(members.length / columns);
    const width = columns * maxWidth + Math.max(0, columns - 1) * gap;
    const height = rows * maxHeight + Math.max(0, rows - 1) * gap;
    const bounds = jamDeckCanvasFolderBounds(members) || { x: 0, y: 0, width, height };
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const left = centerX - width / 2;
    const top = centerY - height / 2;
    const positions = members.map((member, index) => {
      const rect = jamDeckCanvasStackRect(member.rect) || { width: maxWidth, height: maxHeight };
      const column = index % columns;
      const row = Math.floor(index / columns);
      return {
        x: jamDeckRoundCanvasStackValue(left + column * (maxWidth + gap) + (maxWidth - rect.width) / 2),
        y: jamDeckRoundCanvasStackValue(top + row * (maxHeight + gap) + (maxHeight - rect.height) / 2),
        width: rect.width,
        height: rect.height,
      };
    });
    return { members, positions, columns, rows, gap, x: left, y: top, width, height };
  }

  captureFolderScreenRects(group) {
    const snapshot = new Map();
    for (const member of group && group.members || []) {
      const nodeEl = member && member.node && member.node.nodeEl;
      if (!nodeEl || typeof nodeEl.getBoundingClientRect !== "function") continue;
      try {
        const rect = nodeEl.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) snapshot.set(String(member.id), { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      } catch (error) {}
    }
    return snapshot;
  }

  updateFolder(folder, overrides = {}) {
    const group = typeof folder === "string" ? this.groupFromId(folder) : folder;
    if (!group) return false;
    if (Object.prototype.hasOwnProperty.call(overrides, "collapsed")) {
      // Folder opening is presentation-only in v4. Persisted expansion used
      // to compete with the click preview and is intentionally retired.
      return this.toggleFolderPreview(group);
    }
    const latest = this.groupFromId(group.id) || group;
    const nextCollapsed = overrides.collapsed !== undefined ? !!overrides.collapsed : !!latest.collapsed;
    const opening = !!latest.collapsed && !nextCollapsed;
    const closing = !latest.collapsed && nextCollapsed;
    const transitionSnapshot = (opening || closing) ? this.captureFolderScreenRects(latest) : null;
    const runtime = this.getFolderRuntime(latest.id, latest);
    if (opening || closing) this.cancelFolderTransition(runtime);
    let geometry = null;
    const recordOverrides = { ...overrides, collapsed: nextCollapsed };
    if (opening && latest.layoutMode !== "grid") {
      geometry = this.folderGridLayoutForExpand(latest);
      if (!geometry) return false;
      recordOverrides.layoutMode = "grid";
    }
    const record = this.folderRecord(latest, latest.members, recordOverrides);
    const changes = new Map();
    const positions = geometry ? new Map(geometry.members.map((member, index) => [String(member.id), geometry.positions[index]])) : null;
    for (const member of latest.members) {
      let data = member.data;
      if (positions && positions.has(String(member.id))) {
        const position = positions.get(String(member.id));
        data = { ...data, x: position.x, y: position.y, width: position.width, height: position.height };
      }
      changes.set(member.id, this.withFolderPayload(data, latest.id, member.id === record.anchorId ? record : null));
    }
    if (!changes.size) return false;
    try {
      this.mutateNodes(changes);
    } catch (error) {
      if (runtime) this.cancelFolderTransition(runtime);
      throw error;
    }
    if (runtime && (opening || closing)) {
      runtime.pendingFocus = runtime.pendingFocus || !!(this.focusRequestToken && this.focusRequestToken.id === latest.id);
      runtime.expectedCollapsed = nextCollapsed;
      runtime.memberSignature = latest.memberIds.map(String).sort().join("|");
      runtime.state = opening ? "opening" : "closing";
      this.reconcile();
      this.animateFolderTransition(this.groups.get(latest.id) || latest, opening, transitionSnapshot);
    } else {
      this.reconcile();
    }
    return true;
  }

  folderUngroupLayout(group) {
    if (!group || !group.anchor || !Array.isArray(group.members) || group.members.length < 2) return null;
    const members = jamDeckCanvasFolderMemberSort(group.members, group.anchor.id);
    const columns = Math.max(2, Math.min(3, jamDeckCanvasFolderExpansionColumns(members.length)));
    const rows = Math.ceil(members.length / columns);
    const gap = 28;
    const columnWidths = Array(columns).fill(0);
    const rowHeights = Array(rows).fill(0);
    members.forEach((member, index) => {
      const rect = jamDeckCanvasStackRect(member.rect || member.data);
      if (!rect) return;
      const column = index % columns;
      const row = Math.floor(index / columns);
      columnWidths[column] = Math.max(columnWidths[column], rect.width);
      rowHeights[row] = Math.max(rowHeights[row], rect.height);
    });
    if (columnWidths.some((value) => !(value > 0)) || rowHeights.some((value) => !(value > 0))) return null;
    const totalWidth = columnWidths.reduce((sum, value) => sum + value, 0) + gap * (columns - 1);
    const totalHeight = rowHeights.reduce((sum, value) => sum + value, 0) + gap * (rows - 1);
    const anchorRect = jamDeckCanvasStackRect(group.anchor.rect || group.anchor.data);
    if (!anchorRect) return null;
    const startX = anchorRect.x + anchorRect.width / 2 - totalWidth / 2;
    const startY = anchorRect.y + anchorRect.height / 2 - totalHeight / 2;
    const xOffsets = [];
    const yOffsets = [];
    for (let column = 0, cursor = startX; column < columns; column += 1) { xOffsets[column] = cursor; cursor += columnWidths[column] + gap; }
    for (let row = 0, cursor = startY; row < rows; row += 1) { yOffsets[row] = cursor; cursor += rowHeights[row] + gap; }
    const positions = members.map((member, index) => {
      const rect = jamDeckCanvasStackRect(member.rect || member.data);
      const column = index % columns;
      const row = Math.floor(index / columns);
      return {
        id: String(member.id),
        x: jamDeckRoundCanvasStackValue(xOffsets[column] + (columnWidths[column] - rect.width) / 2),
        y: jamDeckRoundCanvasStackValue(yOffsets[row] + (rowHeights[row] - rect.height) / 2),
        width: rect.width,
        height: rect.height,
      };
    });
    for (let left = 0; left < positions.length; left += 1) {
      const a = positions[left];
      if (![a.x, a.y, a.width, a.height].every(Number.isFinite)) return null;
      for (let right = left + 1; right < positions.length; right += 1) {
        const b = positions[right];
        const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        if (overlap) return null;
      }
    }
    return { members, positions, columns };
  }

  ungroup(folder) {
    const group = typeof folder === "string" ? this.groupFromId(folder) : folder;
    const latest = group && this.groupFromId(group.id) || group;
    if (!latest) return false;
    const native = this.isNativeFolder(latest);
    const layout = native ? null : this.folderUngroupLayout(latest);
    if (!native && !layout) throw new Error("无法生成安全的取消编组布局");
    const view = this.folderViews.get(String(latest.id));
    if (view) view.generation += 1;
    if (this.focusRequestToken && this.focusRequestToken.id === latest.id) this.focusRequestToken = null;
    const runtime = this.getFolderRuntime(latest.id, latest);
    if (runtime) this.cancelFolderTransition(runtime);
    const changes = new Map();
    if (native) {
      // Native ungroup restores each member to its authored expanded
      // rectangle, drops the folder payload and removes the group node.  Any
      // edges parked while the folder was folded come back too.
      const positions = latest.positions || {};
      for (const member of latest.members) {
        const pos = positions[String(member.id)] || { x: member.data.x, y: member.data.y, width: member.data.width, height: member.data.height };
        const data = this.withFolderPayload(member.data, null, null);
        changes.set(member.id, { ...data, x: pos.x, y: pos.y, width: pos.width, height: pos.height });
      }
    } else {
      const positions = new Map(layout.positions.map((position) => [position.id, position]));
      for (const member of layout.members) {
        const position = positions.get(String(member.id));
        const data = this.withFolderPayload(member.data, null, null);
        changes.set(member.id, { ...data, x: position.x, y: position.y, width: position.width, height: position.height });
      }
    }
    const ungroupHiddenEdges = native && Array.isArray(latest.hiddenEdges) ? latest.hiddenEdges : [];
    try {
      this.mutateNodes(changes, ungroupHiddenEdges.length ? { add: ungroupHiddenEdges } : null);
    } catch (error) {
      if (view) view.generation += 1;
      this.scheduleReconcile();
      throw error;
    }
    if (native) {
      const g = this.nativeGroupNode(latest);
      if (g && this.canvas && typeof this.canvas.removeNode === "function") {
        try {
          this.canvas.removeNode(g);
          if (this.canvas.view && typeof this.canvas.view.requestSave === "function") this.canvas.view.requestSave();
        } catch (error) {
          console.error("jam-deck native folder ungroup remove failed", error);
        }
      }
      // Also purge any orphan group frames left behind so no invisible group
      // boxes linger after the folder is dissolved.
      this.purgeStaleNativeGroupNodes();
    }
    try {
      if (this.activePopover && this.activePopover.group && String(this.activePopover.group.id) === String(latest.id)) this.closeFolderColorPopover(false);
      if (this.stack && this.stack.previewClusterId === `folder:${latest.id}`) this.stack.collapsePreview(true);
      this.clearFolderPreviewRuntime(latest.id, true);
      this.restoreFolderOwnedNodes(latest);
      const activeView = this.folderViews.get(String(latest.id));
      if (activeView && typeof activeView.dispose === "function") activeView.dispose();
      this.folderViews.delete(String(latest.id));
      this.folderRuntimes.delete(String(latest.id));
      this.groups.delete(String(latest.id));
    } finally {
      this.restoreFolderOwnedNodes(latest);
      this.scheduleReconcile();
    }
    return true;
  }

  detachPreviewMember(folderId, nodeId, finalRect, options = {}) {
    const group = this.groupFromId(folderId);
    const rect = jamDeckCanvasStackRect(finalRect);
    const id = String(nodeId || "");
    if (!group || !rect || !id) return false;
    const dragged = (group.members || []).find((member) => String(member.id) === id);
    if (!dragged) return false;
    const remaining = (group.members || []).filter((member) => String(member.id) !== id);
    const changes = new Map();
    let draggedData = this.withFolderPayload(dragged.data, null, null);
    draggedData = { ...draggedData, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    const normalizationKey = jamDeckCanvasStackNormalizationKey(options.normalizationKind);
    if (options.removeNormalization && normalizationKey && draggedData.jamdeck && Object.prototype.hasOwnProperty.call(draggedData.jamdeck, normalizationKey)) {
      draggedData.jamdeck = { ...draggedData.jamdeck };
      delete draggedData.jamdeck[normalizationKey];
      if (!Object.keys(draggedData.jamdeck).length) delete draggedData.jamdeck;
    }
    changes.set(id, draggedData);
    if (remaining.length >= 2) {
      const nextAnchor = remaining.some((member) => String(member.id) === String(group.anchor.id))
        ? remaining.find((member) => String(member.id) === String(group.anchor.id))
        : jamDeckCanvasFolderMemberSort(remaining)[0];
      const record = this.folderRecord(group, remaining, { anchorId: nextAnchor.id, collapsed: true });
      for (const member of remaining) changes.set(member.id, this.withFolderPayload(member.data, group.id, String(member.id) === String(nextAnchor.id) ? record : null));
    } else {
      for (const member of remaining) changes.set(member.id, this.withFolderPayload(member.data, null, null));
    }
    this.mutateNodes(changes);
    // Restore member presentation immediately: a detached node keeps the
    // folded container transform (stacked pose) if we leave runtime.presentation
    // for the next reconcile frame, which makes it look hidden until a zoom.
    const runtime = this.getFolderRuntime(group.id, group);
    if (runtime) this.restoreFolderPresentation(runtime);
    const draggedEl = dragged.node && dragged.node.nodeEl;
    if (draggedEl) {
      for (const cls of ["is-jam-deck-folder-member", "is-jam-deck-folder-anchor", "is-jam-deck-folder-collapsed", "is-jam-deck-folder-expanded", "is-jam-deck-folder-representative", "is-jam-deck-folder-hidden-member", "is-jam-deck-folder-proxy-hidden", "is-jam-deck-folder-transitioning"]) {
        if (draggedEl.removeClass) draggedEl.removeClass(cls);
      }
      if (draggedEl.dataset) delete draggedEl.dataset.jamDeckFolderOwner;
      if (draggedEl.style) {
        draggedEl.style.removeProperty("visibility");
        draggedEl.style.removeProperty("pointer-events");
      }
    }
    this.clearFolderPreviewRuntime(group.id, true);
    this.scheduleReconcile();
    return true;
  }

  focusFolder(group) {
    if (!group || !group.members.length) return false;
    return this.toggleFolderPreview(group);
  }

  consumeFocusRequest(folderId) {
    const token = this.focusRequestToken;
    if (!token || token.id !== String(folderId || "")) return false;
    try {
      const group = this.collectGroups().find((candidate) => candidate.id === token.id);
      const valid = group ? group.members.filter((member) => {
        const schema = jamDeckCanvasFolderSchema(member.data);
        return schema && schema.id === token.id && member.node;
      }) : [];
      if (!valid.length) return false;
      if (typeof this.canvas.deselectAll === "function") this.canvas.deselectAll();
      for (const member of valid) if (typeof this.canvas.select === "function") this.canvas.select(member.node);
      if (typeof this.canvas.zoomToSelection === "function") this.canvas.zoomToSelection();
      else if (typeof this.canvas.zoomToFit === "function") this.canvas.zoomToFit(valid.map((member) => member.node));
      return true;
    } catch (error) {
      const view = this.folderViews.get(String(folderId));
      if (view && view.shell) {
        view.shell.classList.add("is-focus-failed");
        if (this.ownerWindow) this.ownerWindow.setTimeout(() => view.shell && view.shell.classList.remove("is-focus-failed"), 900);
      }
      new Notice("聚焦文件夹失败");
      return false;
    } finally {
      if (this.focusRequestToken === token) this.focusRequestToken = null;
    }
  }

  layoutSelectionGrid(selected) {
    const items = (Array.isArray(selected) ? selected : []).slice();
    if (items.length < 2) return false;
    const bounds = jamDeckCanvasFolderBounds(items);
    const layout = jamDeckCanvasFolderGridLayout(items, bounds, { gap: 16, columns: jamDeckCanvasFolderExpansionColumns(items) });
    if (!layout) throw new Error("无法计算网格排列");
    const selectedIds = new Set(items.map((item) => item.id));
    const sameGroup = this.collectGroups().find((group) => group.members.length === items.length && group.members.every((member) => selectedIds.has(member.id)));
    const changes = new Map();
    items.forEach((item, index) => {
      const position = layout.positions[index];
      changes.set(item.id, {
        ...item.data,
        x: position.x,
        y: position.y,
        width: position.width,
        height: position.height,
      });
    });
    if (sameGroup) {
      const record = this.folderRecord(sameGroup, items, { id: sameGroup.id, anchorId: sameGroup.anchor.id, layoutMode: "grid", representativeColumns: jamDeckCanvasFolderRepresentativeColumns(items) });
      for (const item of items) changes.set(item.id, this.withFolderPayload(changes.get(item.id), sameGroup.id, item.id === record.anchorId ? record : null));
    }
    this.mutateNodes(changes);
    return true;
  }

  groupScreenBounds(group) {
    if (!group || !this.root) return null;
    const rootRect = this.root.getBoundingClientRect();
    const runtime = this.getFolderRuntime(group.id, group);
    const anchorId = String(group.anchorNodeId || group.anchorId || (group.anchor && group.anchor.id) || "");
    const anchor = (group.members || []).find((member) => String(member.id) === anchorId)
      || group.anchor
      || (group.members || [])[0];
    if ((runtime && (runtime.state === "collapsed" || runtime.state === "opening" || runtime.state === "closing")) && anchor) {
      // The collapsed shell is a stable 200×150 Figma surface.  Native Canvas
      // members may have arbitrary aspect ratios, so use the anchor only for
      // the shell centre and scale the design baseline with the live viewport.
      const scale = Math.max(0.04, Number(this.canvas && this.canvas.scale) || 1);
      const folderWidth = Math.max(1, JAM_DECK_CANVAS_FOLDER_BASE_WIDTH * scale);
      const folderHeight = Math.max(1, JAM_DECK_CANVAS_FOLDER_BASE_HEIGHT * scale);
      const centeredBounds = (centerX, centerY) => ({
        left: centerX - folderWidth / 2,
        top: centerY - folderHeight / 2,
        width: folderWidth,
        height: folderHeight,
      });
      const screenCenteredBounds = (rect) => {
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
        return centeredBounds(
          rect.left + rect.width / 2 - (Number(rootRect.left) || 0),
          rect.top + rect.height / 2 - (Number(rootRect.top) || 0),
        );
      };
      const anchorEl = anchor.node && anchor.node.nodeEl;
      const captured = runtime.nodeRects && runtime.nodeRects.get(String(anchor.id));
      if (captured && captured.width > 0 && captured.height > 0) {
        runtime.lastScreenRect = { left: captured.left, top: captured.top, width: captured.width, height: captured.height };
        runtime.lastScreenRectFrame = this.currentFrame;
        return screenCenteredBounds(captured);
      }
      let anchorRect = null;
      try {
        if (anchorEl && typeof anchorEl.getBoundingClientRect === "function") {
          const candidate = anchorEl.getBoundingClientRect();
          if (candidate && candidate.width > 0 && candidate.height > 0) anchorRect = candidate;
        }
      } catch (error) {}
      if (anchorRect) {
        if (runtime) {
          runtime.lastScreenRect = { left: anchorRect.left, top: anchorRect.top, width: anchorRect.width, height: anchorRect.height };
          runtime.lastScreenRectFrame = this.currentFrame;
        }
        return screenCenteredBounds(anchorRect);
      }
      if (runtime && runtime.lastScreenRect && runtime.lastScreenRectFrame >= this.currentFrame - 1) {
        const cached = runtime.lastScreenRect;
        return screenCenteredBounds(cached);
      }
      // An expanded folder can safely wait for the next viewport frame when
      // no node rect is available.  A collapsed folder keeps a deterministic
      // world-space fallback rather than jumping to a union of members.
      if (runtime && runtime.state !== "expanded") {
        const fallback = anchor && anchor.rect ? jamDeckCanvasStackRect(anchor.rect) : null;
        if (fallback) {
          return centeredBounds(
            (fallback.x + fallback.width / 2) * scale,
            (fallback.y + fallback.height / 2) * scale,
          );
        }
      }
      return null;
    }
    const rects = group.members.map((member) => member.node && member.node.nodeEl && member.node.nodeEl.getBoundingClientRect()).filter((rect) => rect && rect.width > 0 && rect.height > 0);
    if (!rects.length) return null;
    const left = Math.min(...rects.map((rect) => rect.left)) - rootRect.left;
    const top = Math.min(...rects.map((rect) => rect.top)) - rootRect.top;
    const right = Math.max(...rects.map((rect) => rect.right)) - rootRect.left;
    const bottom = Math.max(...rects.map((rect) => rect.bottom)) - rootRect.top;
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  }

  folderRepresentativeSlot(bounds, count, index) {
    return jamDeckCanvasFolderRepresentativeSlot(bounds, count, index);
  }

  clearFolderRepresentativeDrag(group) {
    if (!group) return;
    const runtime = this.getFolderRuntime(group.id, group);
    const representativeIds = new Set((group.representativeIds || []).slice(0, JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES));
    for (const member of group.members || []) {
      if (!member || !representativeIds.has(String(member.id))) continue;
      const nodeEl = member.node && member.node.nodeEl;
      if (!nodeEl) continue;
      nodeEl.removeClass("is-jam-deck-folder-representative-dragging");
      nodeEl.style.removeProperty("--jd-folder-representative-drag-x");
      nodeEl.style.removeProperty("--jd-folder-representative-drag-y");
      if (runtime && runtime.dragPose) runtime.dragPose.delete(String(member.id));
      if (runtime) this.applyFolderPresentation(runtime, member.id);
    }
  }

  setFolderRepresentativeDrag(group, dx, dy, scale = 1) {
    if (!group) return;
    const runtime = this.getFolderRuntime(group.id, group);
    const representativeIds = new Set((group.representativeIds || []).slice(0, JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES));
    const safeScale = Math.max(0.01, Number(scale) || 1);
    for (const member of group.members || []) {
      if (!member || !representativeIds.has(String(member.id))) continue;
      const nodeEl = member.node && member.node.nodeEl;
      if (!nodeEl) continue;
      nodeEl.addClass("is-jam-deck-folder-representative-dragging");
      if (runtime) {
        runtime.dragPose.set(String(member.id), {
          dx: Number(dx || 0) / safeScale,
          dy: Number(dy || 0) / safeScale,
        });
        this.applyFolderPresentation(runtime, member.id);
      }
      nodeEl.style.removeProperty("--jd-folder-representative-drag-x");
      nodeEl.style.removeProperty("--jd-folder-representative-drag-y");
    }
  }

  layoutFolderRepresentatives(group, bounds) {
    const runtime = group && this.getFolderRuntime(group.id, group);
    if (!group || !(group.collapsed || (runtime && runtime.state === "collapsed")) || !this.root || !bounds) return;
    if (runtime) this.captureFolderPresentation(runtime, group);
    const rootRect = this.root.getBoundingClientRect();
    const memberById = new Map((group.members || []).map((member) => [String(member.id), member]));
    const representativeIds = (group.representativeIds || []).slice(0, JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES);
    const count = representativeIds.length;
    if (!count) return;
    representativeIds.forEach((memberId, index) => {
      const member = memberById.get(String(memberId));
      const nodeEl = member && member.node && member.node.nodeEl;
      if (!member || !nodeEl || typeof nodeEl.getBoundingClientRect !== "function") return;
      const current = nodeEl.getBoundingClientRect();
      const slot = this.folderRepresentativeSlot(bounds, count, index);
      if (!current || current.width < 1 || current.height < 1 || !slot) return;
      // `slot.width/height` are the authored visual bounds.  The
      // contentWidth/contentHeight fields keep the native Canvas node size
      // separate so rotation does not inflate the authored card.
      // scaling the real Canvas node to the content bounds keeps rotation from
      // inflating the authored 91 x 60 / 102.363 x 67.852 cards.
      const scale = Math.min(4, Math.max(0.04, Math.min(slot.contentWidth / current.width, slot.contentHeight / current.height)));
      const targetCenterX = rootRect.left + slot.centerX;
      const targetCenterY = rootRect.top + slot.centerY;
      const currentCenterX = current.left + current.width / 2;
      const currentCenterY = current.top + current.height / 2;
      const screenScale = Math.max(0.04, jamDeckCanvasStackScreenScale(member));
      const translateX = (targetCenterX - currentCenterX) / screenScale;
      const translateY = (targetCenterY - currentCenterY) / screenScale;
       if (runtime) {
        runtime.poses.set(String(member.id), {
          dx: jamDeckRoundCanvasStackValue(translateX),
          dy: jamDeckRoundCanvasStackValue(translateY),
          sx: Math.round(scale * 10000) / 10000,
          sy: Math.round(scale * 10000) / 10000,
           rotate: Number(slot.rotate) || 0,
        });
        this.applyFolderPresentation(runtime, member.id);
      }
      nodeEl.style.removeProperty("--jd-folder-representative-x");
      nodeEl.style.removeProperty("--jd-folder-representative-y");
      nodeEl.style.removeProperty("--jd-folder-representative-scale");
      nodeEl.style.removeProperty("--jd-folder-representative-rotate");
    });
  }

  startFolderShellDrag(event, group, shell) {
    if (
      this.destroyed || !group || !group.collapsed || !event.isPrimary || event.button !== 0
      || (event.target && event.target.closest && event.target.closest(".jam-deck-canvas-folder-control, .jam-deck-canvas-folder-popover, .jam-deck-drawing-palette"))
      || this.canvas.readonly
    ) return;
    const pointerType = event.pointerType || "mouse";
    if (pointerType !== "touch") event.preventDefault();
    event.stopPropagation();
    const scale = Math.max(0.01, Number(this.canvas.scale) || 1);
    const view = this.folderViews.get(String(group.id));
    const world = this.folderWorldShellRect(group);
    const drag = {
      pointerId: event.pointerId,
      pointerType,
      group,
      view,
      shell,
      startClientX: event.clientX,
      startClientY: event.clientY,
      scale,
      baseLeft: shell && shell.style ? Number.parseFloat(shell.style.left) || (world && world.x) || 0 : 0,
      baseTop: shell && shell.style ? Number.parseFloat(shell.style.top) || (world && world.y) || 0 : 0,
      generation: view ? view.generation : 0,
      moved: false,
      move: null,
      up: null,
      cancel: null,
    };
    this.shellDrag = drag;
    try { if (shell && typeof shell.setPointerCapture === "function") shell.setPointerCapture(event.pointerId); } catch (error) {}
    drag.move = (next) => {
      if (this.shellDrag !== drag || next.pointerId !== drag.pointerId) return;
      const dx = next.clientX - drag.startClientX;
      const dy = next.clientY - drag.startClientY;
      const threshold = drag.pointerType === "touch" ? 10 : 5;
      if (!drag.moved && Math.hypot(dx, dy) >= threshold) drag.moved = true;
      if (!drag.moved || !shell) return;
      if (typeof next.preventDefault === "function") next.preventDefault();
      shell.classList && shell.classList.add("is-shell-dragging");
      shell.style.left = `${drag.baseLeft + dx / drag.scale}px`;
      shell.style.top = `${drag.baseTop + dy / drag.scale}px`;
    };
    drag.up = (next) => {
      if (this.shellDrag !== drag || next.pointerId !== drag.pointerId) return;
      this.finishFolderShellDrag(drag, next, false);
    };
    drag.cancel = (next) => {
      if (this.shellDrag !== drag || next.pointerId !== drag.pointerId) return;
      this.finishFolderShellDrag(drag, next, true);
    };
    this.ownerWindow.addEventListener("pointermove", drag.move, true);
    this.ownerWindow.addEventListener("pointerup", drag.up, true);
    this.ownerWindow.addEventListener("pointercancel", drag.cancel, true);
  }

  finishFolderShellDrag(drag, event, cancelled) {
    if (!drag || this.shellDrag !== drag) return;
    this.ownerWindow.removeEventListener("pointermove", drag.move, true);
    this.ownerWindow.removeEventListener("pointerup", drag.up, true);
    this.ownerWindow.removeEventListener("pointercancel", drag.cancel, true);
    this.shellDrag = null;
    if (drag.shell) {
      try { if (typeof drag.shell.releasePointerCapture === "function") drag.shell.releasePointerCapture(drag.pointerId); } catch (error) {}
      drag.shell.classList && drag.shell.classList.remove("is-shell-dragging");
      drag.shell.style.left = `${drag.baseLeft}px`;
      drag.shell.style.top = `${drag.baseTop}px`;
    }
    if (cancelled) return;
    const view = drag.view || this.folderViews.get(String(drag.group && drag.group.id || ""));
    if (view && view.generation === drag.generation) view.suppressClickUntil = Date.now() + 300;
    if (!drag.moved) {
      // Pointerdown is prevented to keep Canvas from selecting the shell, so
      // use the no-motion pointerup as the primary click activation. The
      // native click that may follow is suppressed to avoid toggling twice.
      this.toggleFolderPreview(drag.group);
      return;
    }
    const dx = (Number(event.clientX) - drag.startClientX) / drag.scale;
    const dy = (Number(event.clientY) - drag.startClientY) / drag.scale;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01)) return;
    const latest = this.groupFromId(drag.group.id) || drag.group;
    const changes = new Map();
    for (const member of latest.members) {
      changes.set(member.id, {
        ...member.data,
        x: jamDeckRoundCanvasStackValue(Number(member.data.x) + dx),
        y: jamDeckRoundCanvasStackValue(Number(member.data.y) + dy),
      });
    }
    // Native folders move their group node together with the members so the
    // observed grouping keeps covering the folded stack.
    if (this.isNativeFolder(latest)) {
      const g = this.nativeGroupNode(latest);
      if (g) {
        changes.set(String(latest.nativeGroupId), {
          id: String(latest.nativeGroupId),
          x: jamDeckRoundCanvasStackValue(Number(g.x) + dx),
          y: jamDeckRoundCanvasStackValue(Number(g.y) + dy),
          width: Number(g.width) || 0,
          height: Number(g.height) || 0,
          type: "group",
          label: latest.label || "文件夹",
        });
      }
    }
    try { this.mutateNodes(changes); } catch (error) {
      console.error("jam-deck Canvas folder shell move failed", error);
      new Notice(`Jam Deck：${error.message || "文件夹移动失败"}`);
    }
  }

  createFolderControl(className, label, icon, callback) {
    const button = this.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `clickable-icon jam-deck-canvas-folder-control ${className}`;
    button.setAttribute("aria-label", label);
    button.style.pointerEvents = "auto";
    setIcon(button, icon);
    button.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); }, true);
    button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); callback(button, event); }, true);
    return button;
  }

  folderSceneForGroup(group) {
    const members = group && Array.isArray(group.members) ? group.members : [];
    if (!members.length) return null;
    // Canvas virtualizes nodes outside the viewport. At max zoom a collapsed
    // member can therefore lose its DOM parent even though its canonical node
    // data (and the folder) still exists. The transformed scene itself is the
    // stable mount point; never invalidate a persisted folder from temporary
    // node hydration state.
    return this.canvas && this.canvas.canvasEl || null;
  }

  folderWorldShellRect(group) {
    const anchor = group && group.anchor;
    const rect = anchor && jamDeckCanvasStackRect(anchor.rect || anchor.data);
    if (!rect) return null;
    return {
      x: jamDeckRoundCanvasStackValue(rect.x + rect.width / 2 - 100),
      y: jamDeckRoundCanvasStackValue(rect.y + rect.height / 2 - 75),
      width: 200,
      height: 150,
    };
  }

  folderShellIsHighZoom(shell) {
    const scale = Math.max(0.04, Number(this.canvas && this.canvas.scale) || 1);
    let cssMax = JAM_DECK_CANVAS_FOLDER_BASE_WIDTH * scale;
    try {
      const box = shell && typeof shell.getBoundingClientRect === "function" ? shell.getBoundingClientRect() : null;
      if (box && box.width > 1 && box.height > 1) cssMax = Math.max(Number(box.width) || 0, Number(box.height) || 0);
    } catch (error) {}
    // Obsidian Canvas clamps tZoom to 1, so max scale is 2. Flatten before
    // that so isolation + backdrop-filter cannot drop the 400px shell.
    return scale >= 1.6 || cssMax >= 320;
  }

  createFolderProxySurface(member) {
    if (this.stack && typeof this.stack.createPreviewSurface === "function") {
      const surface = this.stack.createPreviewSurface(member);
      if (surface) {
        surface.classList && surface.classList.add("jam-deck-canvas-folder-proxy-surface");
        return surface;
      }
    }
    const nodeEl = member && member.node && member.node.nodeEl;
    const content = nodeEl && nodeEl.querySelector && nodeEl.querySelector(".canvas-node-content");
    let surface = content && typeof content.cloneNode === "function" ? content.cloneNode(true) : null;
    if (!surface && this.ownerDocument) {
      surface = this.ownerDocument.createElement("div");
      surface.textContent = member && member.kind === "text" ? "文本" : "图片";
    }
    if (!surface) return null;
    const descendants = surface.querySelectorAll ? [...surface.querySelectorAll("*")] : [];
    if (surface.querySelectorAll) {
      surface.querySelectorAll("script, iframe, object, embed, form, button, input, textarea, select, video, audio, source").forEach((element) => element.remove());
    }
    for (const element of [surface, ...descendants]) {
      if (!element || !element.attributes) continue;
      for (const attribute of [...element.attributes]) {
        const name = String(attribute.name || "").toLowerCase();
        if (name.startsWith("on") || ["id", "name", "for", "srcdoc", "tabindex", "contenteditable"].includes(name)) element.removeAttribute(attribute.name);
      }
      if (typeof element.setAttribute === "function") {
        element.setAttribute("aria-hidden", "true");
        element.setAttribute("draggable", "false");
      }
    }
    surface.classList && surface.classList.add("jam-deck-canvas-folder-proxy-surface");
    return surface;
  }

  renderFolderRepresentatives(view, group) {
    if (!view || !view.representatives || !group) return;
    const ids = (group.representativeIds || []).slice(0, JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES).map(String);
    const signature = ids.map((id) => {
      const member = (group.members || []).find((candidate) => String(candidate.id) === id);
      return `${id}:${member && member.data && (member.data.file || member.data.text || member.data.url || member.data.type) || ""}`;
    }).join("|");
    if (view.proxySignature === signature) return;
    view.proxySignature = signature;
    if (typeof view.representatives.replaceChildren === "function") view.representatives.replaceChildren();
    else while (view.representatives.children && view.representatives.children.length) view.representatives.children[0].remove();
    const byId = new Map((group.members || []).map((member) => [String(member.id), member]));
    ids.forEach((id, index) => {
      const member = byId.get(id);
      if (!member || !this.ownerDocument) return;
      const proxy = this.ownerDocument.createElement("div");
      proxy.className = "jam-deck-canvas-folder-proxy";
      proxy.dataset.memberId = id;
      proxy.dataset.proxyIndex = String(index);
      proxy.setAttribute("aria-hidden", "true");
      proxy.style.pointerEvents = "none";
      proxy.style.setProperty("--jd-folder-proxy-index", String(index));
      proxy.style.setProperty("--jd-folder-proxy-count", String(ids.length));
      const surface = this.createFolderProxySurface(member);
      if (surface) proxy.appendChild(surface);
      view.representatives.appendChild(proxy);
    });
  }

  folderPreviewSourceRects(group) {
    const sourceRects = new Map();
    const view = group && this.folderViews.get(String(group.id));
    const shell = view && view.shell;
    if (!shell || typeof shell.getBoundingClientRect !== "function") return sourceRects;
    const shellRect = shell.getBoundingClientRect();
    const proxies = view.representatives && view.representatives.querySelectorAll
      ? [...view.representatives.querySelectorAll(".jam-deck-canvas-folder-proxy")]
      : (view.representatives && view.representatives.children ? [...view.representatives.children] : []);
    for (const proxy of proxies) {
      const id = proxy && proxy.dataset && proxy.dataset.memberId;
      const rect = proxy && typeof proxy.getBoundingClientRect === "function" ? proxy.getBoundingClientRect() : null;
      if (id && rect && rect.width > 0 && rect.height > 0) sourceRects.set(String(id), { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }
    const fallbackWidth = Math.max(40, shellRect.width * JAM_DECK_FOLDER_FALLBACK_WIDTH_RATIO);
    const fallbackHeight = Math.max(30, shellRect.height * JAM_DECK_FOLDER_FALLBACK_HEIGHT_RATIO);
    (group.members || []).forEach((member, index) => {
      const id = String(member.id);
      if (sourceRects.has(id)) return;
      const offset = Math.min(18, index * 2.5);
      sourceRects.set(id, {
        left: shellRect.left + shellRect.width * 0.5 - fallbackWidth * 0.5 + offset,
        top: shellRect.top + shellRect.height * 0.12 - offset * 0.35,
        width: fallbackWidth,
        height: fallbackHeight,
      });
    });
    return sourceRects;
  }

  validateFolderToolbarLayer(view) {
    if (!view || !view.shell || !view.sceneParent || !this.root) return false;
    const tools = this.root.querySelectorAll
      ? [...this.root.querySelectorAll(".canvas-controls, .canvas-card-menu, .canvas-menu, .jam-deck-drawing-palette")]
      : [];
    for (const tool of tools) {
      if (!tool || tool.isConnected === false || (view.sceneParent.contains && view.sceneParent.contains(tool))) return false;
      if (typeof tool.getBoundingClientRect !== "function" || typeof view.shell.getBoundingClientRect !== "function") continue;
      const a = tool.getBoundingClientRect();
      const b = view.shell.getBoundingClientRect();
      const left = Math.max(a.left, b.left);
      const right = Math.min(a.right, b.right);
      const top = Math.max(a.top, b.top);
      const bottom = Math.min(a.bottom, b.bottom);
      if (right <= left || bottom <= top || !this.ownerDocument || typeof this.ownerDocument.elementsFromPoint !== "function") continue;
      const stack = this.ownerDocument.elementsFromPoint((left + right) / 2, (top + bottom) / 2);
      const toolIndex = stack.findIndex((element) => element === tool || (tool.contains && tool.contains(element)));
      const shellIndex = stack.findIndex((element) => element === view.shell || (view.shell.contains && view.shell.contains(element)));
      if (toolIndex < 0 || shellIndex < 0 || toolIndex > shellIndex) return false;
    }
    return true;
  }

  // Active keyed renderer: the shell owns sanitized read-only proxies. Real
  // Canvas nodes remain in the scene and are hidden only by an owned class.
  createFolderView(group) {
    if (!this.ownerDocument) return null;
    const sceneParent = this.folderSceneForGroup(group) || this.layer;
    if (!sceneParent) return null;
    const view = {
      id: String(group.id),
      group,
      sceneParent,
      generation: 1,
      suppressClickUntil: 0,
      proxySignature: "",
      safe: true,
      shell: null,
      backboard: null,
      backboardSvg: null,
      representatives: null,
      header: null,
      meta: null,
      controls: null,
      front: null,
      slots: [],
      toggle: null,
      color: null,
      focus: null,
      ungroup: null,
    };
    const shell = this.ownerDocument.createElement("div");
    shell.className = "jam-deck-canvas-folder";
    shell.dataset.folderId = view.id;
    shell.setAttribute("role", "group");
    shell.tabIndex = 0;
    view.shell = shell;
    const onPointerDown = (event) => {
      if (event.target && event.target.closest && event.target.closest(".jam-deck-canvas-folder-control, .jam-deck-canvas-folder-popover")) return;
      this.startFolderShellDrag(event, view.group, view.shell);
    };
    const onClick = (event) => {
      const latest = view.group;
      if (!latest || Date.now() < view.suppressClickUntil) return;
      // An expanded native folder only closes via its close button; a click
      // on the control bar background must not fold it back.
      if (this.isNativeFolder(latest) && !latest.collapsed) return;
      if (event.target !== view.shell && event.target.closest && event.target.closest(".jam-deck-canvas-folder-control, .jam-deck-canvas-folder-popover")) return;
      event.preventDefault();
      event.stopPropagation();
      this.toggleFolderPreview(latest);
    };
    const onKeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target && event.target.closest && event.target.closest(".jam-deck-canvas-folder-control, .jam-deck-canvas-folder-popover")) return;
      const latest = view.group;
      if (!latest) return;
      event.preventDefault();
      event.stopPropagation();
      this.toggleFolderPreview(latest);
    };
    shell.addEventListener("pointerdown", onPointerDown, true);
    shell.addEventListener("click", onClick, true);
    shell.addEventListener("keydown", onKeydown, true);
    view.dispose = () => {
      view.generation += 1;
      this.clearFolderPreviewRuntime(view.id, true);
      shell.removeEventListener("pointerdown", onPointerDown, true);
      shell.removeEventListener("click", onClick, true);
      shell.removeEventListener("keydown", onKeydown, true);
      shell.remove();
    };
    // Figma's authored surfaces remain explicit DOM layers.  The native
    // Canvas representatives stay in Obsidian's Canvas tree; this transparent
    // layer is only a z-index reference and never contains a clone.
    this.createFolderBackboard(view);
    this.createFolderLayers(view);
    this.createFolderHeader(view);
    shell.append(view.backboard, view.representatives, view.front, view.header);
    const anchorEl = group && group.anchor && group.anchor.node && group.anchor.node.nodeEl;
    if (anchorEl && anchorEl.parentElement === sceneParent && typeof sceneParent.insertBefore === "function") sceneParent.insertBefore(shell, anchorEl.nextSibling || null);
    else sceneParent.appendChild(shell);
    return view;
  }

  createFolderBackboard(view) {
    const backboard = this.ownerDocument.createElement("div");
    backboard.className = "jam-deck-canvas-folder-backboard";
    backboard.dataset.layer = "backboard";
    backboard.dataset.asset = "assets/jam-deck-folder-shell.svg";
    backboard.setAttribute("aria-hidden", "true");
    backboard.style.pointerEvents = "none";
    view.backboard = backboard;
    const svgNamespace = "http://www.w3.org/2000/svg";
    const createSvgElement = (tagName) => this.ownerDocument.createElementNS
      ? this.ownerDocument.createElementNS(svgNamespace, tagName)
      : this.ownerDocument.createElement(tagName);
    const backboardSvg = createSvgElement("svg");
    backboardSvg.setAttribute("class", "jam-deck-canvas-folder-backboard-svg");
    backboardSvg.setAttribute("viewBox", "0 0 240 181.79");
    backboardSvg.setAttribute("preserveAspectRatio", "none");
    backboardSvg.setAttribute("aria-hidden", "true");
    backboardSvg.style.pointerEvents = "none";
    const backboardPath = createSvgElement("path");
    backboardPath.setAttribute(
      "d",
      "M97.3066 32.0191C98.9497 35.5397 102.483 37.7896 106.368 37.7896H210C215.523 37.7896 220 42.2668 220 47.7896V147.79C220 153.312 215.523 157.79 210 157.79H30C24.4772 157.79 20 153.312 20 147.79V29.2077C20 23.9174 24.1203 19.5424 29.4011 19.2256L82.8629 16.018C86.9583 15.7723 90.7882 18.053 92.5234 21.7708L97.3066 32.0191Z",
    );
    backboardPath.setAttribute("fill", "currentColor");
    backboardSvg.appendChild(backboardPath);
    backboard.appendChild(backboardSvg);
    view.backboardSvg = backboardSvg;
  }

  createFolderLayers(view) {
    const representatives = this.ownerDocument.createElement("div");
    representatives.className = "jam-deck-canvas-folder-representatives";
    representatives.dataset.layer = "representatives";
    representatives.setAttribute("aria-hidden", "true");
    representatives.style.pointerEvents = "none";
    view.representatives = representatives;
    const front = this.ownerDocument.createElement("div");
    front.className = "jam-deck-canvas-folder-front";
    front.dataset.layer = "front";
    front.setAttribute("aria-hidden", "true");
    front.style.pointerEvents = "none";
    view.front = front;
    const primarySlot = this.ownerDocument.createElement("span");
    primarySlot.className = "jam-deck-canvas-folder-slot jam-deck-canvas-folder-slot-primary";
    primarySlot.dataset.slot = "primary";
    primarySlot.setAttribute("aria-hidden", "true");
    primarySlot.style.pointerEvents = "none";
    const secondarySlot = this.ownerDocument.createElement("span");
    secondarySlot.className = "jam-deck-canvas-folder-slot jam-deck-canvas-folder-slot-secondary";
    secondarySlot.dataset.slot = "secondary";
    secondarySlot.setAttribute("aria-hidden", "true");
    secondarySlot.style.pointerEvents = "none";
    view.slots = [primarySlot, secondarySlot];
    front.append(primarySlot, secondarySlot);
  }

  createFolderHeader(view) {
    const header = this.ownerDocument.createElement("div");
    header.className = "jam-deck-canvas-folder-header";
    const meta = this.ownerDocument.createElement("div");
    meta.className = "jam-deck-canvas-folder-meta";
    const count = this.ownerDocument.createElement("span");
    count.className = "jam-deck-canvas-folder-count";
    const label = this.ownerDocument.createElement("span");
    label.className = "jam-deck-canvas-folder-label";
    label.textContent = "编组";
    meta.append(count, label);
    view.label = label;
    const controls = this.ownerDocument.createElement("div");
    controls.className = "jam-deck-canvas-folder-controls";
    controls.style.pointerEvents = "auto";
    view.header = header;
    view.meta = meta;
    view.controls = controls;
    view.color = this.createFolderControl("jam-deck-canvas-folder-color", "更改文件夹颜色", "palette", (button) => {
      const latest = view.group;
      if (latest) this.openFolderColorPopover(latest, button);
    });
    view.ungroup = this.createFolderControl("jam-deck-canvas-folder-ungroup", "取消编组并展开成员", "ungroup", () => {
      const latest = view.group;
      if (!latest) return;
      try { this.ungroup(latest); } catch (error) {
        console.error("jam-deck Canvas folder ungroup failed", error);
        new Notice(`Jam Deck：${error.message || "取消编组失败"}`);
      }
    });
    view.rename = this.createFolderControl("jam-deck-canvas-folder-rename", "重命名文件夹", "pencil", () => {
      const latest = view.group;
      if (!latest || !this.isNativeFolder(latest)) return;
      // Obsidian 内嵌 canvas 的受限 window 里 window.prompt 会静默失败，
      // 必须用 Obsidian 标准 Modal（nativeModalEl）承载输入。
      const app = this.entry && this.entry.leaf && this.entry.leaf.view && this.entry.leaf.view.app;
      if (!app) return;
      const modal = new FolderRenameModal(app, latest.label || "文件夹", (value) => {
        try { this.renameNativeFolder(latest, value); } catch (error) {
          new Notice(`Jam Deck：${error.message || "文件夹重命名失败"}`);
        }
      });
      modal.open();
    });
    controls.append(view.color, view.ungroup, view.rename);
    header.append(meta, controls);
  }

  updateFolderView(view, group) {
    if (!view || !view.shell || !group) return false;
    const sceneParent = this.folderSceneForGroup(group) || this.layer;
    if (!sceneParent || sceneParent !== view.sceneParent || view.shell.isConnected === false) return false;
    view.group = group;
    const runtime = this.getFolderRuntime(group.id, group);
    const state = group.collapsed ? "collapsed" : "expanded";
    if (runtime) runtime.state = state;
    if (state === "collapsed" && this.canvas && this.canvas.selection && typeof this.canvas.deselectAll === "function") {
      const hasSelectedMember = (group.members || []).some((member) => member && member.node && this.canvas.selection.has(member.node));
      if (hasSelectedMember) this.canvas.deselectAll();
    }
    view.shell.classList.toggle("is-collapsed", state === "collapsed");
    view.shell.classList.toggle("is-expanded", state === "expanded");
    view.shell.classList.toggle("is-native-folder", this.isNativeFolder(group));
    view.shell.classList.remove("is-opening", "is-closing");
    const previewRuntime = this.folderPreviewRuntimes.get(view.id);
    if (previewRuntime) this.setFolderPreviewShellState(view, previewRuntime.state);
    else if (view.shell.dataset && view.shell.dataset.previewState) this.setFolderPreviewShellState(view, "closed");
    view.shell.classList.toggle("is-double-column", Number(group.representativeColumns) > 1);
    view.shell.classList.toggle("is-triple-column", Number(group.representativeColumns) > 2);
    view.shell.classList.toggle("is-single-column", Number(group.representativeColumns) <= 1);
    view.shell.setAttribute("aria-expanded", String(state === "expanded" || state === "opening"));
    view.shell.setAttribute("aria-label", this.isNativeFolder(group)
      ? `文件夹，${group.members.length} 个成员；单击展开，悬浮按钮可换色/取消编组/重命名`
      : `文件夹，${group.members.length} 个成员；单击展开预览`);
    view.shell.style.pointerEvents = state === "expanded" ? "none" : "auto";
    // Legacy persisted presets resolve to their NZS4 Figma equivalents so the
    // CSS var always carries a current solid.
    const resolvedColor = jamDeckCanvasFolderNormalizeColor(group.color);
    view.shell.style.setProperty("--jd-folder-color", resolvedColor);
    view.shell.style.setProperty(
      "--jd-folder-front-tint",
      JAM_DECK_CANVAS_FOLDER_FRONT_TINTS.get(resolvedColor) || "#E7E7E7",
    );
    view.shell.style.setProperty(
      "--jd-folder-tint-strength",
      // NZS4 Figma board solids are used verbatim; only the neutral stays
      // un-tinted so 纸灰 keeps its gray identity.
      jamDeckCanvasFolderNormalizeColor(group.color) === "#C1C1C1" ? "0%" : "100%",
    );
    view.shell.style.setProperty("--jd-folder-member-count", String(group.members.length));
    view.shell.style.setProperty("--jd-folder-representative-columns", String(group.representativeColumns || 1));
    const representativeCount = Math.min(JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES, (group.representativeIds || []).length);
    view.shell.dataset.representativeCount = String(representativeCount);
    if (view.representatives) view.representatives.dataset.representativeCount = String(representativeCount);
    const world = this.folderWorldShellRect(group);
    if (!world) return false;
    view.shell.style.transform = "";
    view.shell.style.transformOrigin = "";
    view.shell.style.left = `${world.x}px`;
    view.shell.style.top = `${world.y}px`;
    view.shell.style.width = `${world.width}px`;
    view.shell.style.height = `${world.height}px`;
    let z = 0;
    const anchorEl = group.anchor && group.anchor.node && group.anchor.node.nodeEl;
    try {
      const raw = anchorEl && anchorEl.style && anchorEl.style.zIndex
        ? anchorEl.style.zIndex
        : this.ownerWindow && this.ownerWindow.getComputedStyle && anchorEl
          ? this.ownerWindow.getComputedStyle(anchorEl).zIndex
          : "0";
      if (Number.isFinite(Number(raw))) z = Number(raw);
    } catch (error) {}
    view.shell.style.zIndex = String(z);
    view.shell.dataset.paintOrder = `${String(z).padStart(8, "0")}:${String(group.id)}`;
    this.renderFolderRepresentatives(view, group);
    view.safe = this.validateFolderToolbarLayer(view);
    // 折叠壳体必须始终可见（成员隐藏后它是唯一打开入口）；safe 仅作告警。
    view.shell.hidden = state === "expanded";
    view.shell.classList.toggle("is-layer-unsafe", !view.safe);
    view.shell.classList.toggle("is-high-zoom", this.folderShellIsHighZoom(view.shell));
    const count = view.meta && view.meta.querySelector(".jam-deck-canvas-folder-count");
    if (count) count.textContent = `${group.members.length} 个节点`;
    if (view.label) {
      view.label.textContent = this.isNativeFolder(group) ? (group.label || "文件夹") : "编组";
      view.label.title = this.isNativeFolder(group) ? "单击展开 · 悬浮按钮可重命名" : "";
    }
    if (view.toggle) {
      view.toggle.setAttribute("aria-label", state === "expanded" ? "折叠文件夹" : "展开文件夹");
      view.toggle.setAttribute("aria-expanded", String(state === "expanded" || state === "opening"));
      setIcon(view.toggle, state === "expanded" ? "chevron-up" : "chevron-down");
    }
    if (view.color) {
      view.color.setAttribute("aria-haspopup", "menu");
      view.color.setAttribute("aria-expanded", String(!!(this.activePopover && this.activePopover.trigger === view.color)));
      if (this.activePopover && this.activePopover.trigger === view.color) view.color.setAttribute("aria-controls", this.activePopover.menu.id);
      else view.color.removeAttribute("aria-controls");
    }
    const writable = !!this.getAtomicFolderCapability() && !(this.canvas && this.canvas.readonly);
    if (view.color) view.color.disabled = !writable;
    if (view.ungroup) view.ungroup.disabled = !writable;
    return true;
  }

  closeFolderColorPopover(returnFocus = false) {
    const active = this.activePopover;
    if (!active) return;
    if (active.outside) this.ownerDocument.removeEventListener("pointerdown", active.outside, true);
    if (active.focusout) this.ownerDocument.removeEventListener("focusout", active.focusout, true);
    if (active.menu && active.menu.parentNode) active.menu.parentNode.removeChild(active.menu);
    this.activePopover = null;
    if (active.trigger) {
      active.trigger.setAttribute("aria-expanded", "false");
      active.trigger.removeAttribute("aria-controls");
      if (returnFocus && typeof active.trigger.focus === "function") {
        try { active.trigger.focus(); } catch (error) {}
      }
    }
  }

  positionFolderColorPopover(menu, trigger) {
    if (!menu || !trigger || !this.root) return;
    const rootRect = this.root.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.max(168, menu.offsetWidth || 168);
    const height = Math.max(42, menu.offsetHeight || 42);
    let left = triggerRect.left - rootRect.left;
    let top = triggerRect.bottom - rootRect.top + 6;
    left = Math.max(4, Math.min(Math.max(4, rootRect.width - width - 4), left));
    if (top + height > rootRect.height - 4) top = Math.max(4, triggerRect.top - rootRect.top - height - 6);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  openFolderColorPopover(group, trigger) {
    if (!group || !trigger || !this.ownerDocument || !this.root) return;
    if (this.activePopover && this.activePopover.trigger === trigger) {
      this.closeFolderColorPopover();
      return;
    }
    this.closeFolderColorPopover();
    if (!this.popoverLayer) {
      this.popoverLayer = this.ownerDocument.createElement("div");
      this.popoverLayer.className = "jam-deck-canvas-folder-popover-layer";
      this.popoverLayer.style.pointerEvents = "none";
      this.root.appendChild(this.popoverLayer);
    }
    const menu = this.ownerDocument.createElement("div");
    menu.className = "jam-deck-canvas-folder-popover jam-deck-canvas-folder-color-menu";
    menu.id = `jam-deck-folder-color-${String(group.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    menu.setAttribute("role", "radiogroup");
    menu.setAttribute("aria-label", "文件夹颜色");
    menu.style.pointerEvents = "auto";
    menu.addEventListener("pointerdown", (event) => event.stopPropagation(), true);
    const colors = JAM_DECK_CANVAS_FOLDER_COLORS.slice();
    const normalized = jamDeckCanvasFolderNormalizeColor(group.color);
    const radios = [];
    const setRoving = (index) => radios.forEach((radio, radioIndex) => { radio.tabIndex = radioIndex === index ? 0 : -1; });
    colors.forEach((color, index) => {
      const radio = this.ownerDocument.createElement("button");
      radio.type = "button";
      radio.className = "jam-deck-canvas-folder-color-swatch";
      radio.dataset.folderColor = color;
      radio.setAttribute("role", "radio");
      radio.setAttribute("aria-label", color);
      radio.setAttribute("aria-checked", String(color === normalized));
      radio.tabIndex = color === normalized ? 0 : -1;
      radio.style.setProperty("--jd-folder-swatch-color", color);
      radio.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (color !== jamDeckCanvasFolderNormalizeColor(group.color)) this.updateFolder(group, { color });
        this.closeFolderColorPopover(true);
      }, true);
      radio.addEventListener("keydown", (event) => {
        let next = index;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + colors.length - 1) % colors.length;
        else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % colors.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = colors.length - 1;
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); radio.click(); return; }
        else if (event.key === "Escape") { event.preventDefault(); this.closeFolderColorPopover(true); return; }
        else return;
        event.preventDefault();
        setRoving(next);
        try { radios[next].focus(); } catch (error) {}
      }, true);
      radios.push(radio);
      menu.appendChild(radio);
    });
    this.popoverLayer.appendChild(menu);
    const outside = (event) => {
      if (!menu.contains(event.target) && event.target !== trigger) this.closeFolderColorPopover(false);
    };
    const focusout = (event) => {
      const next = event.relatedTarget;
      if (next && (menu.contains(next) || next === trigger)) return;
      this.closeFolderColorPopover(false);
    };
    this.ownerDocument.addEventListener("pointerdown", outside, true);
    this.ownerDocument.addEventListener("focusout", focusout, true);
    this.activePopover = { menu, trigger, group, outside, focusout };
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", menu.id);
    this.positionFolderColorPopover(menu, trigger);
    const selectedIndex = Math.max(0, colors.indexOf(normalized));
    setRoving(selectedIndex);
    try { radios[selectedIndex].focus(); } catch (error) {}
  }

  renderFolderLayer() {
    if (this.destroyed) return;
    for (const [id, view] of this.folderViews.entries()) {
      if (this.groups.has(id)) continue;
      if (this.activePopover && this.activePopover.group && this.activePopover.group.id === id) this.closeFolderColorPopover(false);
      if (view && typeof view.dispose === "function") view.dispose();
      this.folderViews.delete(id);
    }
    for (const group of this.groups.values()) {
      let view = this.folderViews.get(String(group.id));
      if (!view) {
        view = this.createFolderView(group);
        if (!view) continue;
        this.folderViews.set(String(group.id), view);
      }
      if (!this.updateFolderView(view, group)) {
        try { if (view && typeof view.dispose === "function") view.dispose(); } catch (error) {}
        this.folderViews.delete(String(group.id));
        view = this.createFolderView(group);
        if (!view) continue;
        this.folderViews.set(String(group.id), view);
        if (!this.updateFolderView(view, group)) {
          try { view.dispose(); } catch (error) {}
          this.folderViews.delete(String(group.id));
        }
      }
    }
  }

  reportFolderSafetyOnce(key, message) {
    this.folderSafetyNotices = this.folderSafetyNotices || new Set();
    const token = String(key || message || "folder-safety");
    if (this.folderSafetyNotices.has(token)) return;
    this.folderSafetyNotices.add(token);
    try { new Notice(`Jam Deck：${message}`); } catch (error) {}
  }

  validateFolderGroup(group, claimed) {
    if (!group || !group.anchor || !Array.isArray(group.members) || group.members.length < 2) return { ok: false, reason: "文件夹成员不足" };
    const scene = this.folderSceneForGroup(group);
    if (!scene) return { ok: false, reason: "文件夹成员不在同一个 Canvas 场景" };
    let anchors = 0;
    for (const member of group.members) {
      const id = String(member.id);
      const prior = claimed.get(id);
      if (prior && prior !== String(group.id)) return { ok: false, reason: "同一节点被多个文件夹声明" };
      const payload = member.data && member.data.jamdeck && member.data.jamdeck.folder;
      if (payload) {
        anchors += 1;
        if (String(member.id) !== String(group.anchor.id) || String(payload.id || "") !== String(group.id)) return { ok: false, reason: "检测到嵌套或重复文件夹锚点" };
      }
    }
    if (anchors !== 1) return { ok: false, reason: "文件夹锚点记录不唯一" };
    for (const member of group.members) claimed.set(String(member.id), String(group.id));
    return { ok: true, scene };
  }

  // Active v4 reconcile. It validates ownership before hiding any native
  // node, then mounts the proxy shell and applies class-only presentation.
  reconcile() {
    if (this.destroyed) return;
    if (this.atomicFolderMutation) {
      this.pendingAtomicFolderReconcile = true;
      return;
    }
    this.pendingAtomicFolderReconcile = false;
    this.currentFrame += 1;
    this.reconcileGeneration += 1;
    const claimed = new Map();
    const valid = new Map();
    const collected = this.collectGroups();
    for (const collectedGroup of collected) {
      // 折叠是唯一的持久状态，展开只是临时预览（preview 卡片，不还原真节点）。
      const group = { ...collectedGroup, collapsed: true };
      const verdict = this.validateFolderGroup(group, claimed);
      if (!verdict.ok) {
        this.restoreFolderOwnedNodes(group);
        this.reportFolderSafetyOnce(`invalid:${group.id}:${verdict.reason}`, verdict.reason);
        continue;
      }
      valid.set(String(group.id), group);
    }
    for (const [id, runtime] of this.folderRuntimes.entries()) {
      if (valid.has(id)) continue;
      this.cancelFolderTransition(runtime);
      this.restoreFolderPresentation(runtime);
      this.restoreFolderOwnedNodes(id);
      this.folderRuntimes.delete(id);
      this.clearFolderPreviewRuntime(id, true);
    }
    this.groups = valid;
    this.nodeToGroup.clear();
    this.renderFolderLayer();
    const seen = new Set();
    for (const group of valid.values()) {
      const runtime = this.getFolderRuntime(group.id, group);
      runtime.state = group.collapsed ? "collapsed" : "expanded";
      runtime.expectedCollapsed = !!group.collapsed;
      runtime.memberSignature = (group.memberIds || []).map(String).sort().join("|");
      this.applyFolderRuntimeNodes(group, runtime);
      const view = this.folderViews.get(String(group.id));
      if (view && !view.safe) {
        // 不再撤销折叠隐藏：缩放/平移时工具栏层级验证瞬时失败不应露出成员，
        // 折叠状态由 group.collapsed 保证，safe 只影响壳体自身交互。
        this.reportFolderSafetyOnce(`layer:${group.id}`, "文件夹壳体与 Canvas 工具栏层级无法安全比较，壳体交互可能受限");
      }
      for (const member of group.members) {
        const id = String(member.id);
        seen.add(id);
        this.nodeToGroup.set(id, group);
      }
    }
    for (const item of this.getItems()) {
      if (seen.has(String(item.id))) continue;
      const nodeEl = item.node && item.node.nodeEl;
      if (!nodeEl) continue;
      if (!nodeEl.dataset || !nodeEl.dataset.jamDeckFolderOwner) nodeEl.removeClass("is-jam-deck-folder-proxy-hidden");
      nodeEl.removeClass("is-jam-deck-folder-member");
      nodeEl.removeClass("is-jam-deck-folder-anchor");
      nodeEl.removeClass("is-jam-deck-folder-collapsed");
      nodeEl.removeClass("is-jam-deck-folder-expanded");
      nodeEl.removeClass("is-jam-deck-folder-representative");
      nodeEl.removeClass("is-jam-deck-folder-hidden-member");
    }
    this.syncToolbar();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.drag = null;
    if (this.shellDrag) this.finishFolderShellDrag(this.shellDrag, { clientX: 0, clientY: 0 }, true);
    if (this.observer) this.observer.disconnect();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.reconcileFrame && this.ownerWindow) {
      try { this.ownerWindow.cancelAnimationFrame(this.reconcileFrame); } catch (error) {}
      this.reconcileFrame = 0;
    }
    if (this.toolbarFrame && this.ownerWindow) {
      try { this.ownerWindow.cancelAnimationFrame(this.toolbarFrame); } catch (error) {}
      this.toolbarFrame = 0;
    }
    for (const dispose of this.disposers) { try { dispose(); } catch (error) {} }
    this.disposers = [];
    if (this.ownerDocument && this.boundKeydown) this.ownerDocument.removeEventListener("keydown", this.boundKeydown, true);
    this.closeFolderColorPopover(false);
    for (const runtime of this.folderRuntimes.values()) {
      runtime.state = "destroyed";
      this.cancelFolderTransition(runtime);
      this.restoreFolderPresentation(runtime);
    }
    this.folderRuntimes.clear();
    for (const id of [...this.folderPreviewRuntimes.keys()]) this.clearFolderPreviewRuntime(id, true);
    this.focusRequestToken = null;
    for (const view of this.folderViews.values()) {
      try { if (view && typeof view.dispose === "function") view.dispose(); } catch (error) {}
    }
    this.folderViews.clear();
    for (const item of this.getItems()) {
      const nodeEl = item.node && item.node.nodeEl;
      if (!nodeEl) continue;
      nodeEl.removeClass("is-jam-deck-folder-member");
      nodeEl.removeClass("is-jam-deck-folder-anchor");
      nodeEl.removeClass("is-jam-deck-folder-collapsed");
      nodeEl.removeClass("is-jam-deck-folder-expanded");
      nodeEl.removeClass("is-jam-deck-folder-representative");
      nodeEl.removeClass("is-jam-deck-folder-representative-dragging");
      nodeEl.removeClass("is-jam-deck-folder-hidden-member");
      nodeEl.removeClass("is-jam-deck-folder-proxy-hidden");
      if (nodeEl.dataset) delete nodeEl.dataset.jamDeckFolderOwner;
      nodeEl.removeClass("is-opening");
      nodeEl.removeClass("is-closing");
      nodeEl.removeClass("is-transitioning");
      nodeEl.removeClass("is-jam-deck-folder-transitioning");
      nodeEl.style.removeProperty("--jd-folder-color");
      nodeEl.style.removeProperty("--jd-folder-id");
      nodeEl.style.removeProperty("--jd-folder-representative-index");
      nodeEl.style.removeProperty("--jd-folder-representative-columns");
      nodeEl.style.removeProperty("--jd-folder-representative-x");
      nodeEl.style.removeProperty("--jd-folder-representative-y");
      nodeEl.style.removeProperty("--jd-folder-representative-scale");
      nodeEl.style.removeProperty("--jd-folder-representative-rotate");
      nodeEl.style.removeProperty("--jd-folder-representative-drag-x");
      nodeEl.style.removeProperty("--jd-folder-representative-drag-y");
      nodeEl.style.removeProperty("--jd-folder-member-visibility");
    }
    for (const button of this.toolbarButtons.values()) { try { button.remove(); } catch (error) {} }
    this.toolbarButtons.clear();
    if (this.layer) this.layer.remove();
    if (this.popoverLayer) this.popoverLayer.remove();
    this.popoverLayer = null;
    if (this.root) this.root.removeClass("has-jam-deck-canvas-folders");
    this.groups.clear();
    this.nodeToGroup.clear();
  }
}

function jamDeckSelectedCanvasNodes(canvas) {
  if (!canvas || !canvas.selection || typeof canvas.selection.values !== "function") return { image: null, text: null };
  const selected = Array.from(canvas.selection.values());
  if (selected.length !== 1) return { image: null, text: null };
  const node = selected[0];
  let data = null;
  try { data = node && typeof node.getData === "function" ? node.getData() : null; } catch (error) { data = null; }
  const kind = data ? jamDeckCanvasStackKind(data) : null;
  return {
    image: kind === "image" ? node : null,
    text: kind === "text" || kind === "markdown-note" || data && (data.type === "link" || data.type === "file") ? node : null,
  };
}

function jamDeckIsNativeCanvasFocusButton(button) {
  if (!button || !button.getAttribute) return false;
  if (button.classList && (
    button.classList.contains("jam-deck-canvas-ai-toolbar")
    || button.classList.contains("jam-deck-canvas-export-toolbar")
    || button.classList.contains("jam-deck-canvas-folder-toolbar")
  )) return false;
  const label = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`;
  if (/聚焦|缩放到所选|zoom to selection|\bfocus\b/i.test(label)) return true;
  const svg = typeof button.querySelector === "function" ? button.querySelector("svg") : null;
  const svgClass = svg && (svg.getAttribute("class") || svg.className) || "";
  return /\blucide-scan\b/.test(String(svgClass));
}

class CanvasSelectionToolbarController {
  constructor(runtime, entry) {
    this.runtime = runtime;
    this.entry = entry;
    this.canvas = entry.leaf && entry.leaf.view && entry.leaf.view.canvas;
    this.root = entry.leaf && entry.leaf.containerEl;
    this.ownerWindow = entry.ownerDocument && entry.ownerDocument.defaultView;
    this.disposers = [];
    this.aiToolbarButton = null;
    this.exportToolbarButton = null;
    this.aiPressedNode = null;
    this.exportPressedFiles = null;
    this.selectedAiNode = null;
    this.toolbarFrame = 0;
    this.toolbarObserver = null;
    this.suppressSync = false;
    this.destroyed = false;
  }

  install() {
    if (!this.canvas || !this.root || !this.ownerWindow || this.destroyed) return false;
    const sync = () => this.scheduleToolbarSync();
    // 按下（平移/拖拽）期间暂停同步，松手恢复并补一次——避免 pointermove
    // 高频触发两次全量节点遍历导致大图量画布平移卡顿。
    const press = (event) => {
      if (event.target && event.target.closest && event.target.closest(".canvas-menu, .canvas-card-menu, .canvas-controls, .jam-deck-drawing-palette")) return;
      this.suppressSync = true;
      this.scheduleToolbarSync();
    };
    const release = () => {
      if (!this.suppressSync) return;
      this.suppressSync = false;
      this.scheduleToolbarSync();
    };
    const keydown = (event) => this.onFocusHotkey(event);
    this.root.addEventListener("pointerdown", press, true);
    this.ownerWindow.addEventListener("pointerup", release, true);
    this.ownerWindow.addEventListener("pointercancel", release, true);
    this.ownerWindow.addEventListener("keydown", keydown, true);
    this.disposers.push(() => this.root.removeEventListener("pointerdown", press, true));
    this.disposers.push(() => this.ownerWindow.removeEventListener("pointerup", release, true));
    this.disposers.push(() => this.ownerWindow.removeEventListener("pointercancel", release, true));
    this.disposers.push(() => this.ownerWindow.removeEventListener("keydown", keydown, true));
    const MutationObserverCtor = this.ownerWindow.MutationObserver;
    if (typeof MutationObserverCtor === "function") {
      this.toolbarObserver = new MutationObserverCtor(() => this.scheduleToolbarSync());
      this.toolbarObserver.observe(this.root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    }
    this.syncToolbar();
    return true;
  }

  scheduleToolbarSync() {
    if (this.destroyed || this.suppressSync || !this.ownerWindow || this.toolbarFrame) return;
    this.toolbarFrame = this.ownerWindow.requestAnimationFrame(() => {
      this.toolbarFrame = 0;
      this.syncToolbar();
    });
  }

  findSelectedNodes() {
    return jamDeckSelectedCanvasNodes(this.canvas);
  }

  getToolbarMenu() {
    // Obsidian exposes two different horizontal menus:
    // - `cardMenuEl` / `.canvas-card-menu`: the bottom "create a node" palette;
    // - `menu.menuEl` / `.canvas-menu`: the popup above the current selection.
    // The AI action belongs to the latter so it stays attached to the current
    // selection instead of polluting the persistent bottom palette.
    const candidates = [
      this.canvas && this.canvas.menu && this.canvas.menu.menuEl,
      this.root && this.root.querySelector(".canvas-menu"),
    ];
    for (const menu of candidates) {
      if (!menu || !menu.isConnected || !this.root.contains(menu)) continue;
      if (menu.closest && menu.closest(".canvas-card-menu")) continue;
      return menu;
    }
    return null;
  }

  ensureAiToolbarButton(menu) {
    if (!menu) return null;
    if (this.aiToolbarButton && this.aiToolbarButton.isConnected && this.aiToolbarButton.parentElement === menu) return this.aiToolbarButton;
    if (this.aiToolbarButton) this.aiToolbarButton.remove();
    const existing = menu.querySelector(".jam-deck-canvas-ai-toolbar");
    if (existing) existing.remove();
    const button = this.entry.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "clickable-icon jam-deck-canvas-ai-toolbar";
    button.setAttribute("aria-label", "将选中节点发送给 AI");
    setIcon(button, "message-circle");
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const selected = this.findSelectedNodes();
      this.aiPressedNode = selected.image || selected.text || null;
    }, true);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const selected = this.findSelectedNodes();
      const node = this.aiPressedNode || selected.image || selected.text || null;
      this.aiPressedNode = null;
      const deckView = this.runtime && this.runtime.deckView;
      if (!node || !deckView) {
        new Notice("Jam Deck：没有可发送的当前节点");
        return;
      }
      let data = null;
      try { data = typeof node.getData === "function" ? node.getData() : null; } catch (error) { data = null; }
      if (jamDeckCanvasStackKind(data) === "image" && typeof deckView.openAiChatWithCanvasImage === "function") {
        void deckView.openAiChatWithCanvasImage(node, this.canvas);
      } else if (typeof deckView.openAiChatWithCanvasText === "function") {
        void deckView.openAiChatWithCanvasText(node, this.canvas);
      }
    }, true);
    menu.appendChild(button);
    this.aiToolbarButton = button;
    return button;
  }

  collectExportableFiles() {
    const plugin = this.runtime && this.runtime.deckView && this.runtime.deckView.plugin;
    const vault = plugin && plugin.app && plugin.app.vault;
    return jamDeckSelectedExportableCanvasFiles(this.canvas, vault);
  }

  ensureExportToolbarButton(menu) {
    if (!menu) return null;
    if (this.exportToolbarButton && this.exportToolbarButton.isConnected && this.exportToolbarButton.parentElement === menu) return this.exportToolbarButton;
    if (this.exportToolbarButton) this.exportToolbarButton.remove();
    const existing = menu.querySelector(".jam-deck-canvas-export-toolbar");
    if (existing) existing.remove();
    const button = this.entry.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "clickable-icon jam-deck-canvas-export-toolbar";
    button.setAttribute("aria-label", "导出选中附件");
    setIcon(button, "download");
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.exportPressedFiles = this.collectExportableFiles();
    }, true);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const files = (this.exportPressedFiles && this.exportPressedFiles.length)
        ? this.exportPressedFiles
        : this.collectExportableFiles();
      this.exportPressedFiles = null;
      const plugin = this.runtime && this.runtime.deckView && this.runtime.deckView.plugin;
      if (!files.length || !plugin || typeof plugin.exportCanvasMediaFiles !== "function") {
        new Notice("Jam Deck：没有可导出的图片或视频");
        return;
      }
      void plugin.exportCanvasMediaFiles(files);
    }, true);
    menu.appendChild(button);
    this.exportToolbarButton = button;
    return button;
  }

  getSingleSelectedNode() {
    if (!this.canvas || !this.canvas.selection || typeof this.canvas.selection.values !== "function") return null;
    const selected = Array.from(this.canvas.selection.values()).filter(Boolean);
    return selected.length === 1 ? selected[0] : null;
  }

  isToolbarArmed() {
    if (!this.getSingleSelectedNode()) return false;
    const menu = this.getToolbarMenu();
    if (!menu) return false;
    try {
      const style = this.ownerWindow && typeof this.ownerWindow.getComputedStyle === "function"
        ? this.ownerWindow.getComputedStyle(menu)
        : null;
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
      const rect = typeof menu.getBoundingClientRect === "function" ? menu.getBoundingClientRect() : null;
      if (rect && (rect.width < 8 || rect.height < 8)) return false;
    } catch (error) {}
    return true;
  }

  hijackNativeFocusButton(menu) {
    if (!menu || typeof menu.querySelectorAll !== "function") return;
    const buttons = menu.querySelectorAll("button");
    for (const button of buttons) {
      if (!jamDeckIsNativeCanvasFocusButton(button)) continue;
      if (button.dataset && button.dataset.jamDeckFocusHijack === "1") continue;
      if (button.dataset) button.dataset.jamDeckFocusHijack = "1";
      button.setAttribute("aria-label", "放映");
      button.setAttribute("title", "放映");
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!this.openSelectedNodeFocus()) this.invokeNativeZoomToSelection();
      }, true);
    }
  }

  onFocusHotkey(event) {
    if (this.destroyed || !event || event.repeat) return;
    const key = String(event.key || "");
    const isF = key === "f" || key === "F" || String(event.code || "") === "KeyF";
    if (!isF) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const stack = this.entry && this.entry.imageStackController;
    if (stack && stack.imageFocus) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stack.closeImageFocus();
      return;
    }
    if (event.target && event.target.closest && event.target.closest("input, textarea, [contenteditable='true']")) return;
    if (stack && (stack.previewWrapper || stack.drag)) return;
    if (!this.isToolbarArmed()) return;
    if (!this.openSelectedNodeFocus()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  openSelectedNodeFocus() {
    const node = this.getSingleSelectedNode();
    const stack = this.entry && this.entry.imageStackController;
    if (!node || !stack || typeof stack.openNodeFocus !== "function") return false;
    return stack.openNodeFocus(node);
  }

  invokeNativeZoomToSelection() {
    if (!this.canvas || typeof this.canvas.zoomToSelection !== "function") return false;
    try { this.canvas.zoomToSelection(); } catch (error) { return false; }
    return true;
  }

  syncToolbar() {
    if (this.destroyed) return;
    const menu = this.getToolbarMenu();
    if (!menu) {
      if (this.aiToolbarButton) this.aiToolbarButton.style.display = "none";
      if (this.exportToolbarButton) this.exportToolbarButton.style.display = "none";
      this.selectedAiNode = null;
      return;
    }
    this.hijackNativeFocusButton(menu);
    const aiButton = this.ensureAiToolbarButton(menu);
    const exportButton = this.ensureExportToolbarButton(menu);
    const stack = this.entry.imageStackController;
    const blocked = !!(stack && (stack.previewWrapper || stack.imageFocus || stack.drag));
    const selected = this.findSelectedNodes();
    this.selectedAiNode = blocked ? null : (selected.text || selected.image);
    if (aiButton) {
      aiButton.style.display = this.selectedAiNode ? "" : "none";
    }
    const exportable = blocked ? [] : this.collectExportableFiles();
    if (exportButton) {
      exportButton.style.display = exportable.length ? "" : "none";
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.toolbarFrame && this.ownerWindow) {
      try { this.ownerWindow.cancelAnimationFrame(this.toolbarFrame); } catch (error) {}
      this.toolbarFrame = 0;
    }
    if (this.toolbarObserver) {
      try { this.toolbarObserver.disconnect(); } catch (error) {}
      this.toolbarObserver = null;
    }
    for (const dispose of this.disposers) {
      try { dispose(); } catch (error) {}
    }
    this.disposers = [];
    if (this.aiToolbarButton) {
      try { this.aiToolbarButton.remove(); } catch (error) {}
      this.aiToolbarButton = null;
    }
    if (this.exportToolbarButton) {
      try { this.exportToolbarButton.remove(); } catch (error) {}
      this.exportToolbarButton = null;
    }
    this.aiPressedNode = null;
    this.exportPressedFiles = null;
    this.selectedAiNode = null;
    this.canvas = null;
    this.root = null;
  }
}

class CanvasStageController {
  constructor(runtime, entry) {
    this.runtime = runtime;
    this.entry = entry;
    this.app = runtime.app;
    this.canvas = entry.leaf && entry.leaf.view && entry.leaf.view.canvas;
    this.root = entry.leaf && entry.leaf.containerEl;
    this.ownerWindow = entry.ownerDocument && entry.ownerDocument.defaultView;
    this.button = null;
    this.groupEl = null;
    this.active = false;
    this.splitSnapshot = null;
    this.widgetEl = null;
    this.deckRoot = null;
    this.body = null;
    this.resizeTimer = 0;
    this.ensureFrame = 0;
    this.controlsObserver = null;
    this.placeholder = null;
    this.frameSnapshot = null;
    this.disposers = [];
    this.destroyed = false;
  }

  install() {
    if (!this.root || !this.ownerWindow || this.destroyed) return false;
    const keydown = (event) => this.onKeydown(event);
    this.ownerWindow.addEventListener("keydown", keydown, false);
    this.disposers.push(() => this.ownerWindow.removeEventListener("keydown", keydown, false));
    const MutationObserverCtor = this.ownerWindow.MutationObserver;
    if (typeof MutationObserverCtor === "function") {
      this.controlsObserver = new MutationObserverCtor(() => this.scheduleEnsureButton());
      this.controlsObserver.observe(this.root, { childList: true, subtree: true });
    }
    this.ensureButton();
    return true;
  }

  scheduleEnsureButton() {
    if (this.destroyed || !this.ownerWindow || this.ensureFrame) return;
    this.ensureFrame = this.ownerWindow.requestAnimationFrame(() => {
      this.ensureFrame = 0;
      this.ensureButton();
    });
  }

  getControlsEl() {
    if (!this.root) return null;
    const controls = this.root.querySelector(".canvas-controls");
    if (!controls || !controls.isConnected || !this.root.contains(controls)) return null;
    return controls;
  }

  getDeckRoot() {
    const view = this.runtime && this.runtime.deckView;
    if (view && view.contentEl) return view.contentEl;
    const host = this.entry.hostEl;
    return host && host.closest ? host.closest(".jam-deck-root") : null;
  }

  getWidgetEl() {
    const host = this.entry.hostEl;
    if (host && host.closest) {
      const widget = host.closest(".jam-deck-widget");
      if (widget) return widget;
    }
    const deckRoot = this.getDeckRoot();
    const widgetId = this.entry.widgetId;
    if (!deckRoot || !widgetId) return null;
    return deckRoot.querySelector(`.jam-deck-widget[data-widget-id="${widgetId}"]`);
  }

  ensureButton() {
    if (this.destroyed) return null;
    const controls = this.getControlsEl();
    if (!controls) return null;
    // Native Canvas mutates this leaf constantly. setIcon() also rewrites the
    // button SVG, which would retrigger the observer and freeze the workbench.
    if (this.button && this.button.isConnected && this.groupEl && this.groupEl.parentElement === controls) {
      return this.button;
    }
    if (this.groupEl) {
      try { this.groupEl.remove(); } catch (error) {}
      this.groupEl = null;
      this.button = null;
    }
    const existing = controls.querySelector(".jam-deck-canvas-stage-group");
    if (existing) existing.remove();
    const document = this.entry.ownerDocument;
    const group = document.createElement("div");
    group.className = "canvas-control-group jam-deck-canvas-stage-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clickable-icon canvas-control-item jam-deck-canvas-stage-toggle";
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
    });
    group.appendChild(button);
    controls.insertBefore(group, controls.firstChild);
    this.groupEl = group;
    this.button = button;
    this.syncButton();
    return button;
  }

  syncButton() {
    if (!this.button) return;
    this.button.setAttribute("aria-pressed", String(this.active));
    this.button.setAttribute("aria-label", this.active ? "退出全屏" : "全屏");
    setIcon(this.button, this.active ? "minimize-2" : "maximize-2");
  }

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  snapshotSplits() {
    const workspace = this.app && this.app.workspace;
    return {
      left: !!(workspace && workspace.leftSplit && workspace.leftSplit.collapsed),
      right: !!(workspace && workspace.rightSplit && workspace.rightSplit.collapsed),
    };
  }

  setSplitCollapsed(split, collapsed) {
    if (!split) return;
    try {
      if (collapsed) {
        if (typeof split.collapse === "function" && !split.collapsed) split.collapse();
      } else if (typeof split.expand === "function" && split.collapsed) {
        split.expand();
      }
    } catch (error) {}
  }

  getBrowserWindow() {
    try {
      const electron = require("electron");
      if (electron.remote && typeof electron.remote.getCurrentWindow === "function") return electron.remote.getCurrentWindow();
      if (typeof electron.getCurrentWindow === "function") return electron.getCurrentWindow();
      if (electron.BrowserWindow && typeof electron.BrowserWindow.getFocusedWindow === "function") {
        return electron.BrowserWindow.getFocusedWindow();
      }
    } catch (error) {}
    try {
      const remote = require("@electron/remote");
      if (remote && typeof remote.getCurrentWindow === "function") return remote.getCurrentWindow();
    } catch (error) {}
    return null;
  }

  isAppFullScreen() {
    try {
      if (this.app && typeof this.app.isFullScreen === "function") return !!this.app.isFullScreen();
    } catch (error) {}
    const body = (this.body || (this.entry.ownerDocument && this.entry.ownerDocument.body));
    return !!(body && body.classList.contains("is-fullscreen"));
  }

  toggleAppFullScreen() {
    try {
      if (this.app && this.app.commands && typeof this.app.commands.executeCommandById === "function") {
        this.app.commands.executeCommandById("app:toggle-fullscreen");
      }
    } catch (error) {}
  }

  setNativeChromeHidden(hidden) {
    const win = this.getBrowserWindow();
    if (hidden) {
      const snapshot = { menu: true, fullScreen: false, usedCommand: false };
      try {
        if (win && typeof win.isMenuBarVisible === "function") snapshot.menu = win.isMenuBarVisible();
        if (win && typeof win.isFullScreen === "function") snapshot.fullScreen = win.isFullScreen();
        else snapshot.fullScreen = this.isAppFullScreen();
        if (win && typeof win.setMenuBarVisibility === "function") win.setMenuBarVisibility(false);
        if (win && typeof win.setFullScreen === "function") {
          if (!snapshot.fullScreen) win.setFullScreen(true);
        } else if (!snapshot.fullScreen) {
          snapshot.usedCommand = true;
          this.toggleAppFullScreen();
        }
      } catch (error) {}
      this.frameSnapshot = snapshot;
      return;
    }
    const snapshot = this.frameSnapshot || {};
    try {
      if (win && typeof win.setFullScreen === "function") {
        if (snapshot.fullScreen !== true) win.setFullScreen(false);
      } else if (snapshot.usedCommand && this.isAppFullScreen()) {
        this.toggleAppFullScreen();
      }
      if (win && typeof win.setMenuBarVisibility === "function") win.setMenuBarVisibility(snapshot.menu !== false);
    } catch (error) {}
    this.frameSnapshot = null;
  }

  relocateRoot(toBody) {
    const root = this.deckRoot || this.getDeckRoot();
    const body = this.body || (this.entry.ownerDocument && this.entry.ownerDocument.body);
    if (!root || !body) return;
    if (toBody) {
      if (root.parentElement === body) return;
      if (!this.placeholder) this.placeholder = root.ownerDocument.createComment("jam-deck-canvas-stage-anchor");
      if (root.parentNode) root.parentNode.insertBefore(this.placeholder, root);
      body.appendChild(root);
      return;
    }
    if (this.placeholder && this.placeholder.parentNode) {
      this.placeholder.parentNode.insertBefore(root, this.placeholder);
      this.placeholder.remove();
    }
    this.placeholder = null;
  }

  enter() {
    if (this.active || this.destroyed) return false;
    const widgetEl = this.getWidgetEl();
    const deckRoot = this.getDeckRoot();
    const body = this.entry.ownerDocument && this.entry.ownerDocument.body;
    if (!widgetEl || !deckRoot || !body) return false;
    const current = this.runtime && this.runtime.activeStage;
    if (current && current !== this) current.exit();
    this.splitSnapshot = this.snapshotSplits();
    const workspace = this.app && this.app.workspace;
    if (workspace) {
      this.setSplitCollapsed(workspace.leftSplit, true);
      this.setSplitCollapsed(workspace.rightSplit, true);
    }
    this.widgetEl = widgetEl;
    this.deckRoot = deckRoot;
    this.body = body;
    this.relocateRoot(true);
    this.setNativeChromeHidden(true);
    body.addClass("is-jam-deck-canvas-stage");
    deckRoot.addClass("is-jam-deck-canvas-stage");
    widgetEl.addClass("is-jam-deck-canvas-stage");
    this.active = true;
    if (this.runtime) this.runtime.activeStage = this;
    this.syncButton();
    this.scheduleResize();
    return true;
  }

  exit() {
    if (!this.active) return false;
    this.active = false;
    this.relocateRoot(false);
    this.setNativeChromeHidden(false);
    if (this.body) {
      try { this.body.removeClass("is-jam-deck-canvas-stage"); } catch (error) {
        try { this.body.classList.remove("is-jam-deck-canvas-stage"); } catch (removeError) {}
      }
    }
    if (this.deckRoot) {
      try { this.deckRoot.removeClass("is-jam-deck-canvas-stage"); } catch (error) {
        try { this.deckRoot.classList.remove("is-jam-deck-canvas-stage"); } catch (removeError) {}
      }
    }
    if (this.widgetEl) {
      try { this.widgetEl.removeClass("is-jam-deck-canvas-stage"); } catch (error) {
        try { this.widgetEl.classList.remove("is-jam-deck-canvas-stage"); } catch (removeError) {}
      }
    }
    const workspace = this.app && this.app.workspace;
    const snapshot = this.splitSnapshot || {};
    if (workspace) {
      this.setSplitCollapsed(workspace.leftSplit, snapshot.left === true);
      this.setSplitCollapsed(workspace.rightSplit, snapshot.right === true);
    }
    if (this.runtime && this.runtime.activeStage === this) this.runtime.activeStage = null;
    this.splitSnapshot = null;
    this.widgetEl = null;
    this.deckRoot = null;
    this.body = null;
    this.syncButton();
    this.scheduleResize();
    return true;
  }

  scheduleResize() {
    const leaf = this.entry && this.entry.leaf;
    const run = () => {
      try { if (leaf && typeof leaf.onResize === "function") leaf.onResize(); } catch (error) {}
    };
    run();
    if (!this.ownerWindow) return;
    try { this.ownerWindow.requestAnimationFrame(() => {
      run();
      this.ownerWindow.requestAnimationFrame(run);
    }); } catch (error) {}
    try {
      if (this.resizeTimer) this.ownerWindow.clearTimeout(this.resizeTimer);
      this.resizeTimer = this.ownerWindow.setTimeout(() => {
        this.resizeTimer = 0;
        run();
      }, 220);
    } catch (error) {}
  }

  onKeydown(event) {
    if (this.destroyed || !this.active || !event || event.key !== "Escape") return;
    if (event.defaultPrevented) return;
    const deckRoot = this.deckRoot || this.getDeckRoot();
    if (deckRoot && deckRoot.classList.contains("is-jam-deck-presenting")) return;
    const stack = this.entry.imageStackController;
    if (stack && (stack.imageFocus || stack.previewWrapper || stack.drag)) return;
    const folder = this.entry.folderController;
    if (folder && folder.activePopover) return;
    const target = event.target;
    if (target && target.closest && target.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
    this.exit();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.exit();
    if (this.ensureFrame && this.ownerWindow) {
      try { this.ownerWindow.cancelAnimationFrame(this.ensureFrame); } catch (error) {}
      this.ensureFrame = 0;
    }
    if (this.resizeTimer && this.ownerWindow) {
      try { this.ownerWindow.clearTimeout(this.resizeTimer); } catch (error) {}
      this.resizeTimer = 0;
    }
    if (this.controlsObserver) {
      try { this.controlsObserver.disconnect(); } catch (error) {}
      this.controlsObserver = null;
    }
    for (const dispose of this.disposers) {
      try { dispose(); } catch (error) {}
    }
    this.disposers = [];
    if (this.groupEl) {
      try { this.groupEl.remove(); } catch (error) {}
    }
    this.groupEl = null;
    this.button = null;
    this.canvas = null;
    this.root = null;
  }
}

class CanvasRuntimeAdapter {
  constructor(deckView) {
    this.deckView = deckView;
    this.app = deckView.app;
    this.entries = new Map();
    this.destroyPromises = new Map();
    this.nativeConflictSuspendedIds = new Set();
    this.returnCoordinators = new Map();
    this.generation = 0;
    this.activeStage = null;
  }

  normalizeCanvasPath(path) {
    const value = typeof path === "string" ? path.trim() : "";
    if (!value) return "";
    // Canvas paths are vault-relative and should compare the same way on
    // Windows and in Obsidian's slash-normalized workspace APIs.  Keep this
    // key local to duplicate detection; the widget's persisted path remains
    // untouched so a user rename never gets rewritten as a side effect.
    return jamDeckInkNormalizePath(value).replace(/^\.\//, "").toLocaleLowerCase("en-US");
  }

  isAttachedWorkspaceLeaf(leaf) {
    // getLeavesOfType() already returns workspace-owned leaves, including
    // background tabs whose DOM is not currently connected. The only leaves
    // that must be excluded are the detached leaves explicitly created by Jam
    // Deck itself; do not infer attachment from parent.children because recent
    // Obsidian versions expose that collection in more than one shape.
    return !!(leaf && !(leaf.containerEl && leaf.containerEl.dataset && leaf.containerEl.dataset.jamDeckCanvasOwner));
  }

  getCanvasViewPath(leaf) {
    const file = leaf && leaf.view && leaf.view.file;
    if (file && typeof file.path === "string") return this.normalizeCanvasPath(file.path);
    try {
      const state = leaf && typeof leaf.getViewState === "function" ? leaf.getViewState() : null;
      const fallback = state && state.state && state.state.file;
      return typeof fallback === "string" ? this.normalizeCanvasPath(fallback) : "";
    } catch (error) {
      return "";
    }
  }

  getNativeCanvasPaths() {
    const paths = new Set();
    if (!this.app || !this.app.workspace || typeof this.app.workspace.getLeavesOfType !== "function") return paths;
    for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
      if (!this.isAttachedWorkspaceLeaf(leaf)) continue;
      const path = this.getCanvasViewPath(leaf);
      if (path) paths.add(path);
    }
    return paths;
  }

  hasNativeCanvasDuplicate(filePath, ownedLeaf = null) {
    const key = this.normalizeCanvasPath(filePath);
    if (!key || !this.app || !this.app.workspace || typeof this.app.workspace.getLeavesOfType !== "function") return false;
    for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
      if (leaf === ownedLeaf || !this.isAttachedWorkspaceLeaf(leaf)) continue;
      if (this.getCanvasViewPath(leaf) === key) return true;
    }
    return false;
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

  exitAllStages() {
    for (const entry of this.entries.values()) {
      if (entry.stageController && typeof entry.stageController.exit === "function") {
        try { entry.stageController.exit(); } catch (error) {}
      }
    }
    this.activeStage = null;
  }

  parkAll() {
    this.exitAllStages();
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
    entry.nativeConflictSuspended = false;
    this.nativeConflictSuspendedIds.delete(entry.widgetId);
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

  async suspendForNativeConflict(widgetId) {
    this.nativeConflictSuspendedIds.add(widgetId);
    const entry = this.entries.get(widgetId);
    if (!entry || entry.closing) {
      const pending = this.destroyPromises.get(widgetId);
      if (pending) await pending;
      return true;
    }
    // Quiet teardown is intentionally limited to the owned detached leaf.
    // It removes our controllers and unloads the leaf without invoking the
    // Canvas view's save/close APIs, which can write the file or emit layout
    // events while Obsidian is reconciling a native competitor.
    if (entry.nativeConflictSuspended) {
      const pending = this.destroyPromises.get(widgetId);
      if (pending) await pending;
      return true;
    }
    entry.nativeConflictSuspended = true;
    if (entry.returnCoordinator) entry.returnCoordinator.invalidateEntry(entry, true);
    else {
      entry.returnEpoch = (Number(entry.returnEpoch) || 0) + 1;
      entry.returnParked = true;
    }
    await this.destroy(widgetId, { quiet: true, nativeConflict: true });
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
    const pointerdown = () => activate();
    const keydown = (event) => {
      activate();
      const stackController = entry.imageStackController;
      if (stackController && stackController.imageFocus) {
        if (typeof stackController.onPresentKeydown === "function") stackController.onPresentKeydown(event);
        else {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.key === "Escape") stackController.closeImageFocus();
        }
        return;
      }
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
    return { item, canvas, items: [item] };
  }

  getCanvasExternalImageDrop(entry, transfer) {
    if (!entry || entry.closing || this.entries.get(entry.widgetId) !== entry || !transfer) return null;
    const canvas = entry.leaf && entry.leaf.view && entry.leaf.view.canvas;
    if (!canvas || canvas.readonly || typeof canvas.posFromEvt !== "function" || typeof canvas.createFileNode !== "function" || typeof canvas.requestSave !== "function") return null;
    const types = Array.from(transfer.types || []);
    if (!types.includes("Files") && !types.includes("text/uri-list")) return null;
    const imageExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"]);
    const sources = [];
    const seen = new Set();
    const files = Array.from(transfer.files || []);
    for (const candidate of files) {
      if (!candidate) continue;
      const name = String(candidate.name || "");
      const ext = name.toLowerCase().split(".").pop();
      const isImage = (typeof candidate.type === "string" && candidate.type.startsWith("image/")) || imageExtensions.has(ext);
      if (!isImage) continue;
      const path = typeof candidate.path === "string" ? candidate.path : null;
      const key = path || name;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        canvas,
        file: typeof candidate.arrayBuffer === "function" ? candidate : null,
        path,
        name,
        size: Number(candidate.size) || 0,
      });
    }
    // 补充纯 file:// uri（拖拽文件常同时出现在 files 与 uri-list，按 path 去重）
    let uriList = "";
    try { uriList = transfer.getData("text/uri-list"); } catch (error) {}
    const uris = String(uriList || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && /^file:\/\//i.test(line));
    for (const uri of uris) {
      const filePath = this.deckView.plugin.externalFilePathFromUrl(uri);
      if (!filePath) continue;
      if (seen.has(filePath)) continue;
      const name = filePath.split(/[\\/]/).pop() || "image.png";
      const ext = name.toLowerCase().split(".").pop();
      if (!imageExtensions.has(ext)) continue;
      seen.add(filePath);
      sources.push({ canvas, file: null, path: filePath, name, size: 0 });
    }
    return sources.length ? sources : null;
  }

  getCanvasImageDrop(entry, transfer) {
    const clipboard = this.getClipboardCanvasDrop(entry, transfer);
    if (clipboard) return { kind: "clipboard", canvas: clipboard.canvas, items: clipboard.items };
    const external = this.getCanvasExternalImageDrop(entry, transfer);
    return external ? { kind: "external", canvas: external[0].canvas, sources: external } : null;
  }

  installClipboardCanvasDrop(entry) {
    if (!entry || entry.dropInstalled || !entry.leaf || !entry.leaf.containerEl) return;
    const target = entry.leaf.containerEl;
    const dragover = (event) => {
      const context = this.getCanvasImageDrop(entry, event.dataTransfer);
      if (!context) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.dataTransfer.dropEffect = "copy";
    };
    const drop = (event) => {
      const context = this.getCanvasImageDrop(entry, event.dataTransfer);
      if (!context) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      let pos;
      try {
        const raw = context.canvas.posFromEvt(event);
        pos = { x: raw.x, y: raw.y };
      } catch (error) {
        console.error("jam-deck canvas drop position failed", error);
        new Notice("Jam Deck：无法确定图片在 Canvas 中的位置");
        return;
      }
      const items = context.kind === "clipboard" ? (context.items || []) : (context.sources || []);
      if (!items.length) return;
      // 本次拖入批次从鼠标位置重新开始排布
      entry.dropCursorRect = null;
      const jobs = [];
      for (let index = 0; index < items.length; index += 1) {
        const source = items[index];
        const operation = {
          id: `canvas-drop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          entryToken: entry.token,
          controller: new AbortController(),
          inserted: false,
          committed: false,
          node: null,
          createdPath: null,
          createdFile: null,
          dropIndex: index,
        };
        entry.dropOperations.set(operation.id, operation);
        const commit = context.kind === "clipboard"
          ? () => this.commitClipboardImageDrop(entry, context.canvas, source, pos, operation)
          : () => this.commitExternalImageDrop(entry, context.canvas, source, pos, operation);
        jobs.push({ operation, commit });
      }
      this.enqueueCanvasDrop(entry, jobs);
    };
    target.addEventListener("dragover", dragover, true);
    target.addEventListener("drop", drop, true);
    entry.dropDisposers.push(() => target.removeEventListener("dragover", dragover, true));
    entry.dropDisposers.push(() => target.removeEventListener("drop", drop, true));
    entry.dropInstalled = true;
  }

  enqueueCanvasDrop(entry, jobs) {
    if (!entry || entry.closing || !Array.isArray(jobs) || !jobs.length) return;
    if (!Array.isArray(entry.dropQueue)) entry.dropQueue = [];
    for (const job of jobs) entry.dropQueue.push(job);
    void this.drainCanvasDropQueue(entry);
  }

  async drainCanvasDropQueue(entry) {
    if (!entry || !Array.isArray(entry.dropQueue)) entry.dropQueue = [];
    if (entry.dropQueueRunning) return;
    entry.dropQueueRunning = true;
    let okCount = 0;
    let failCount = 0;
    try {
      while (entry.dropQueue.length) {
        const job = entry.dropQueue.shift();
        if (!job || !job.operation) continue;
        entry.activeDropOperation = job.operation;
        job.operation.batchTail = entry.dropQueue.length === 0;
        job.operation.promise = Promise.resolve(job.commit()).catch((error) => {
          // commit 内部已处理 rollback 与失败提示，这里只做计数
          failCount += 1;
          return null;
        });
        await job.operation.promise;
        if (job.operation.committed) okCount += 1;
        entry.activeDropOperation = null;
      }
    } finally {
      entry.dropQueueRunning = false;
      if (okCount > 0 || failCount > 0) {
        const parts = [];
        if (okCount) parts.push(`成功 ${okCount} 张`);
        if (failCount) parts.push(`失败 ${failCount} 张`);
        new Notice(`Jam Deck：图片写入 Canvas 完成 · ${parts.join("，")}`);
      }
    }
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
    const cancelled = operation.controller.signal.aborted || entry.closing || entry.nativeConflictSuspended;
    try {
      if (typeof canvas.removeNode !== "function") return false;
      canvas.removeNode(operation.node);
      operation.node = null;
      operation.inserted = false;
      if (cancelled) return true;
      canvas.requestSave();
      const view = entry.leaf && entry.leaf.view;
      if (view && typeof view.saveImmediately === "function") await Promise.resolve(view.saveImmediately());
      return true;
    } catch (error) {
      console.error("jam-deck canvas node rollback failed; attachment retained", error);
      return false;
    }
  }

  async commitCanvasImageDrop(entry, canvas, createAttachment, pos, operation) {
    try {
      const created = await createAttachment(operation.controller.signal);
      operation.createdPath = created.path;
      operation.createdFile = created.file;
      if (operation.controller.signal.aborted || entry.closing || entry.nativeConflictSuspended || entry.token !== operation.entryToken || this.entries.get(entry.widgetId) !== entry) {
        await this.removeOwnedCanvasAttachment(operation, canvas);
        return;
      }
      operation.node = canvas.createFileNode({ pos, position: "center", file: created.file });
      if (!operation.node) throw new Error("Canvas did not create an image node");
      operation.inserted = true;
      // 多图拖入自动排布：第 2 张起横排到上一张右侧（同宽高、世界坐标 + 间距）
      if (operation.dropIndex > 0 && entry.dropCursorRect) {
        const prev = entry.dropCursorRect;
        try {
          const nextData = typeof operation.node.getData === "function" ? operation.node.getData() : null;
          if (nextData && typeof operation.node.setData === "function") {
            operation.node.setData({
              ...nextData,
              x: prev.x + prev.width + CANVAS_DROP_AUTO_GAP,
              y: prev.y,
              width: prev.width,
              height: prev.height,
            });
            if (typeof canvas.markMoved === "function") canvas.markMoved(operation.node);
            if (typeof operation.node.render === "function") operation.node.render();
          }
        } catch (error) {}
      }
      try {
        const placedData = typeof operation.node.getData === "function" ? operation.node.getData() : null;
        if (placedData) {
          entry.dropCursorRect = {
            x: Number(placedData.x) || 0,
            y: Number(placedData.y) || 0,
            width: Math.max(1, Number(placedData.width) || 1),
            height: Math.max(1, Number(placedData.height) || 1),
          };
        }
      } catch (error) {}
      if (operation.controller.signal.aborted || entry.closing || entry.nativeConflictSuspended || this.entries.get(entry.widgetId) !== entry) {
        try { if (typeof canvas.removeNode === "function") canvas.removeNode(operation.node); } catch (error) {}
        operation.node = null;
        operation.inserted = false;
        await this.removeOwnedCanvasAttachment(operation, canvas);
        return;
      }
      canvas.requestSave();
      // 批量拖入时只对队列尾强制同步落盘（Obsidian 会合并中间 requestSave），
      // 避免连续多张时反复全量序列化保存造成卡顿。
      if (operation.batchTail) {
        const view = entry.leaf && entry.leaf.view;
        if (view && typeof view.saveImmediately === "function") {
          if (operation.controller.signal.aborted || entry.closing || entry.nativeConflictSuspended) return;
          operation.savePromise = Promise.resolve(view.saveImmediately());
          await operation.savePromise;
          if (operation.controller.signal.aborted || entry.closing || entry.nativeConflictSuspended) return;
        }
      }
      operation.committed = true;
      if (operation.controller.signal.aborted || entry.closing || entry.nativeConflictSuspended) return;
      if (operation.batchTail) {
        try {
          if (typeof canvas.deselectAll === "function") canvas.deselectAll();
          if (typeof canvas.select === "function") canvas.select(operation.node);
          if (canvas.wrapperEl && typeof canvas.wrapperEl.focus === "function") canvas.wrapperEl.focus();
        } catch (error) {}
      }
    } catch (error) {
      const rolledBack = await this.rollbackCanvasDropNode(entry, canvas, operation);
      if (!operation.inserted && rolledBack) await this.removeOwnedCanvasAttachment(operation, canvas);
      if (operation.controller.signal.aborted || entry.closing || entry.nativeConflictSuspended) return;
      console.error("jam-deck persistent canvas image drop failed", error);
      new Notice(`Jam Deck：图片加入 Canvas 失败 · ${error.message || "未知错误"}`);
    } finally {
      entry.dropOperations.delete(operation.id);
      if (entry.activeDropOperation === operation) entry.activeDropOperation = null;
    }
  }

  async commitClipboardImageDrop(entry, canvas, item, pos, operation) {
    return this.commitCanvasImageDrop(
      entry,
      canvas,
      (signal) => this.deckView.plugin.createCanvasAttachmentFromClipboard(item, entry.filePath, signal),
      pos,
      operation,
    );
  }

  async commitExternalImageDrop(entry, canvas, source, pos, operation) {
    return this.commitCanvasImageDrop(
      entry,
      canvas,
      (signal) => this.deckView.plugin.createCanvasAttachmentFromExternal(source, entry.filePath, signal),
      pos,
      operation,
    );
  }

  async mount(widget, hostEl, file, onError) {
    if (file && file.stat && Number(file.stat.size) === 0) {
      const empty = new Error("Canvas 文件为空，已暂停渲染");
      empty.code = "JAM_DECK_CANVAS_EMPTY";
      if (typeof onError === "function") onError(empty);
      return null;
    }
    const existing = this.entries.get(widget.id);
    if (this.hasNativeCanvasDuplicate(file.path, existing && existing.leaf)) {
      if (existing) await this.suspendForNativeConflict(widget.id);
      const conflict = new Error("同一 Canvas 正在 Obsidian 原生页面打开");
      conflict.code = "JAM_DECK_CANVAS_CONFLICT";
      if (typeof onError === "function") onError(conflict);
      return null;
    }
    if (existing && this.normalizeCanvasPath(existing.filePath) === this.normalizeCanvasPath(file.path) && this.attach(existing, hostEl)) return existing;
    if (existing) await this.destroy(widget.id);
    this.nativeConflictSuspendedIds.delete(widget.id);
    if (this.hasNativeCanvasDuplicate(file.path)) {
      const conflict = new Error("同一 Canvas 正在 Obsidian 原生页面打开");
      conflict.code = "JAM_DECK_CANVAS_CONFLICT";
      if (typeof onError === "function") onError(conflict);
      return null;
    }

    const token = ++this.generation;
    let context;
    let leaf;
    let entry;
    try {
      context = this.probe(hostEl);
      leaf = new WorkspaceLeaf(this.app);
      this.assertTreeInvariant(context, leaf);
      leaf.parent = context.root;
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
        dropQueue: [],
        dropQueueRunning: false,
        dropInstalled: false,
        interactionInstalled: false,
        returnCoordinator: null,
        returnEpoch: 0,
        returnParked: false,
        imageStackController: null,
        folderController: null,
        linkNavigationBridge: null,
        selectionToolbarController: null,
        stageController: null,
        nativeConflictSuspended: false,
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

      // A native tab may be opened while openFile() is awaiting Canvas
      // initialization. Re-check before installing any listeners so the two
      // views never become active competitors even during that narrow window.
      if (this.hasNativeCanvasDuplicate(file.path, leaf)) {
        await this.suspendForNativeConflict(widget.id);
        const conflict = new Error("同一 Canvas 正在 Obsidian 原生页面打开");
        conflict.code = "JAM_DECK_CANVAS_CONFLICT";
        if (typeof onError === "function") onError(conflict);
        return null;
      }

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
      entry.folderController = new CanvasFolderController(this, entry);
      entry.folderController.install();
      entry.selectionToolbarController = new CanvasSelectionToolbarController(this, entry);
      entry.selectionToolbarController.install();
      entry.stageController = new CanvasStageController(this, entry);
      entry.stageController.install();
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

  async closeOwnedLeaf(leaf, fallbackLeaf, options = {}) {
    if (!leaf) return;
    const view = leaf.view;
    const quiet = !!options.quiet;
    if (!quiet) {
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

  async destroyEntry(widgetId) {
    const options = arguments[1] || {};
    const entry = this.entries.get(widgetId);
    if (!entry || entry.closing) return;
    entry.closing = true;
    entry.token = ++this.generation;
    const dropOperations = Array.from((entry.dropOperations || new Map()).values());
    for (const operation of dropOperations) {
      try { if (operation.controller) operation.controller.abort(); } catch (error) {}
    }
    if (dropOperations.length) {
      await Promise.allSettled(dropOperations.map((operation) => operation.promise || Promise.resolve()));
    }
    if (entry.stageController) {
      try { entry.stageController.destroy(); } catch (error) { console.error("jam-deck canvas stage cleanup failed", error); }
      entry.stageController = null;
    }
    if (entry.linkNavigationBridge) {
      try { entry.linkNavigationBridge.destroy(); } catch (error) { console.error("jam-deck canvas link bridge cleanup failed", error); }
      entry.linkNavigationBridge = null;
    }
    if (entry.folderController) {
      try { entry.folderController.destroy(); } catch (error) { console.error("jam-deck canvas folder cleanup failed", error); }
      entry.folderController = null;
    }
    if (entry.imageStackController) {
      try { entry.imageStackController.destroy(); } catch (error) { console.error("jam-deck canvas stack cleanup failed", error); }
      entry.imageStackController = null;
    }
    if (entry.selectionToolbarController) {
      try { entry.selectionToolbarController.destroy(); } catch (error) { console.error("jam-deck canvas selection toolbar cleanup failed", error); }
      entry.selectionToolbarController = null;
    }
    if (entry.inkOverlay) {
      try { await entry.inkOverlay.destroy({ quiet: !!options.quiet }); } catch (error) { console.error("jam-deck canvas ink cleanup failed", error); }
      entry.inkOverlay = null;
    }
    for (const dispose of entry.dropDisposers || []) {
      try { dispose(); } catch (error) {}
    }
    entry.dropDisposers = [];
    try {
      if (entry.resizeObserver) entry.resizeObserver.disconnect();
    } catch (error) {}
    try {
      await this.closeOwnedLeaf(entry.leaf, this.deckView.leaf, options);
    } finally {
      if (entry.hostEl && !options.nativeConflict) {
        try { entry.hostEl.empty(); } catch (error) {}
      }
      if (this.entries.get(widgetId) === entry) this.entries.delete(widgetId);
      if (!options.nativeConflict) this.nativeConflictSuspendedIds.delete(widgetId);
    }
  }

  async destroy(widgetId, options = {}) {
    const inFlight = this.destroyPromises.get(widgetId);
    if (inFlight) return inFlight;
    const promise = this.destroyEntry(widgetId, options);
    this.destroyPromises.set(widgetId, promise);
    try {
      return await promise;
    } finally {
      if (this.destroyPromises.get(widgetId) === promise) this.destroyPromises.delete(widgetId);
    }
  }

  async destroyAll() {
    await Promise.all(Array.from(this.entries.keys()).map((id) => this.destroy(id)));
    this.nativeConflictSuspendedIds.clear();
    for (const coordinator of this.returnCoordinators.values()) coordinator.destroy();
    this.returnCoordinators.clear();
  }
}

const JAM_DECK_WIDGET_MIN_W = 2;
const JAM_DECK_WIDGET_MIN_H = 2;
// Roughly 90px wide / 58px tall on a 1920x1080 deck, so the seam stays easy to hit on the dense grid.
const JAM_DECK_SEAM_HIT = 2.5;

function jamDeckClampAiFabPosition(position, width, height, fabWidth = 52, fabHeight = fabWidth, inset = 20) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  const safeFabWidth = Math.max(1, Number(fabWidth) || 52);
  const safeFabHeight = Math.max(1, Number(fabHeight) || safeFabWidth);
  const edge = Math.max(0, Number(inset) || 0);
  if (!Number.isFinite(safeWidth) || !Number.isFinite(safeHeight) || safeWidth < safeFabWidth || safeHeight < safeFabHeight) return null;
  const maxX = Math.max(0, safeWidth - safeFabWidth);
  const maxY = Math.max(0, safeHeight - safeFabHeight);
  const fallbackX = Math.max(0, maxX - edge);
  const fallbackY = Math.max(0, maxY - edge);
  const requestedX = position && Number.isFinite(Number(position.x)) ? Number(position.x) : fallbackX;
  const requestedY = position && Number.isFinite(Number(position.y)) ? Number(position.y) : fallbackY;
  return {
    x: Math.min(maxX, Math.max(0, requestedX)),
    y: Math.min(maxY, Math.max(0, requestedY)),
  };
}

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

function jamDeckSnapshotWidgetLayout(widgets) {
  return (Array.isArray(widgets) ? widgets : [])
    .filter((item) => item && item.id && item.type)
    .map((item) => ({
      id: item.id,
      type: item.type,
      x: Number(item.x) || 1,
      y: Number(item.y) || 1,
      w: Number(item.w) || 1,
      h: Number(item.h) || 1,
    }));
}

function jamDeckLayoutPresets(savedLayout, defaults = DEFAULT_SETTINGS.widgets) {
  const saved = jamDeckSnapshotWidgetLayout(savedLayout);
  return saved.length ? saved : defaults;
}

function jamDeckRestoreDefaultWidgetLayout(widgets, defaults = DEFAULT_SETTINGS.widgets) {
  const current = Array.isArray(widgets) ? widgets.filter(Boolean) : [];
  const presets = Array.isArray(defaults) ? defaults : [];
  const used = new Set();
  const layout = [];
  for (const preset of presets) {
    const byId = preset && preset.id
      ? current.find((item) => item && item.id === preset.id && item.type === preset.type && !used.has(item.id))
      : null;
    const widget = byId || current.find((item) => item && item.type === preset.type && !used.has(item.id));
    if (!widget) continue;
    used.add(widget.id);
    layout.push({
      ...widget,
      x: preset.x,
      y: preset.y,
      w: preset.w,
      h: preset.h,
    });
  }
  return {
    layout,
    extras: current.filter((item) => !used.has(item.id)),
  };
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
  const cols = options.cols || GRID_COLS;
  const rows = options.rows || GRID_ROWS;
  const minW = options.minW || JAM_DECK_WIDGET_MIN_W;
  const minH = options.minH || JAM_DECK_WIDGET_MIN_H;
  const list = (Array.isArray(widgets) ? widgets : []).filter((item) => item && item.id);
  const vertical = new Map();
  const horizontal = new Map();
  const rightEdge = [];
  const bottomEdge = [];

  for (const item of list) {
    // A widget boundary is an edge when no other widget sits immediately past
    // it with overlapping orthogonal range. This covers both the global grid
    // right/bottom edge and inner widgets whose side butts up against empty
    // space — e.g. canvas-embed with no neighbor below row 20 had its
    // bottom-right corner ignored here, so the cross product could not emit a
    // (col 41, row 20) xy node and that corner became un-resizable.
    const hasRightNeighbor = list.some(
      (other) => other.x === item.x + item.w
        && Math.min(item.y + item.h, other.y + other.h) > Math.max(item.y, other.y)
    );
    if (!hasRightNeighbor) {
      rightEdge.push({
        line: item.x + item.w,
        start: item.y,
        end: item.y + item.h,
        beforeIds: [item.id],
        afterIds: [],
      });
    }
    const hasBottomNeighbor = list.some(
      (other) => other.y === item.y + item.h
        && Math.min(item.x + item.w, other.x + other.w) > Math.max(item.x, other.x)
    );
    if (!hasBottomNeighbor) {
      bottomEdge.push({
        line: item.y + item.h,
        start: item.x,
        end: item.x + item.w,
        beforeIds: [item.id],
        afterIds: [],
      });
    }
  }

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
  // Edge sashes live on each widget's own right/bottom boundary (which may
  // differ from the global grid rightLine/bottomLine), so group by line
  // before merging — different lines must not collapse into one.
  const rightEdgeByLine = new Map();
  for (const edge of rightEdge) {
    const bucket = rightEdgeByLine.get(edge.line) || [];
    bucket.push(edge);
    rightEdgeByLine.set(edge.line, bucket);
  }
  for (const [line, ranges] of rightEdgeByLine) {
    for (const range of jamDeckMergeSashRanges(ranges)) {
      sashes.push({
        id: `edge-x:${line}:${range.start}:${range.end}`,
        axis: "x",
        edge: "end",
        line,
        start: range.start,
        end: range.end,
        beforeIds: range.beforeIds,
        afterIds: [],
      });
    }
  }
  const bottomEdgeByLine = new Map();
  for (const edge of bottomEdge) {
    const bucket = bottomEdgeByLine.get(edge.line) || [];
    bucket.push(edge);
    bottomEdgeByLine.set(edge.line, bucket);
  }
  for (const [line, ranges] of bottomEdgeByLine) {
    for (const range of jamDeckMergeSashRanges(ranges)) {
      sashes.push({
        id: `edge-y:${line}:${range.start}:${range.end}`,
        axis: "y",
        edge: "end",
        line,
        start: range.start,
        end: range.end,
        beforeIds: range.beforeIds,
        afterIds: [],
      });
    }
  }
  return sashes.sort((left, right) => left.axis.localeCompare(right.axis) || left.line - right.line || left.start - right.start);
}

function jamDeckCollectLayoutNodes(widgets, options = {}) {
  const list = (Array.isArray(widgets) ? widgets : []).filter((item) => item && item.id);
  const sashes = jamDeckCollectLayoutSashes(widgets, options);
  const vertical = sashes.filter((sash) => sash.axis === "x");
  const horizontal = sashes.filter((sash) => sash.axis === "y");
  const nodes = [];

  for (const sashX of vertical) {
    for (const sashY of horizontal) {
      if (sashY.line < sashX.start || sashY.line > sashX.end) continue;
      if (sashX.line < sashY.start || sashX.line > sashY.end) continue;
      const node = {
        id: `xy:${sashX.line}:${sashY.line}`,
        axis: "xy",
        x: sashX.line,
        y: sashY.line,
        sashX: sashX.id,
        sashY: sashY.id,
      };
      if (sashX.edge === "end" || sashY.edge === "end") {
        const owners = list.filter((item) => item.x + item.w === node.x && item.y + item.h === node.y);
        if (owners.length === 1) node.widgetId = owners[0].id;
      }
      nodes.push(node);
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
  const endEdge = sash.edge === "end";
  if (!befores.length || (!afters.length && !endEdge)) return null;

  if (sash.axis === "x") {
    if (endEdge) {
      const maxShrink = befores.reduce((limit, item) => Math.min(limit, item.w - minW), Infinity);
      const maxGrow = Math.max(0, cols + 1 - sash.line);
      const step = Math.max(-maxShrink, Math.min(maxGrow, amount));
      if (!step) return null;
      for (const item of befores) item.w += step;
      if (!jamDeckWidgetLayoutCollisionFree(layout, cols, rows, minW, minH)) return null;
      return layout;
    }
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
    if (endEdge) {
      const maxShrink = befores.reduce((limit, item) => Math.min(limit, item.h - minH), Infinity);
      const maxGrow = Math.max(0, rows + 1 - sash.line);
      const step = Math.max(-maxShrink, Math.min(maxGrow, amount));
      if (!step) return null;
      for (const item of befores) item.h += step;
      if (!jamDeckWidgetLayoutCollisionFree(layout, cols, rows, minW, minH)) return null;
      return layout;
    }
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

function jamDeckResizeWidgetAtCorner(widgets, widgetId, deltaX, deltaY, options = {}) {
  const cols = options.cols || GRID_COLS;
  const rows = options.rows || GRID_ROWS;
  const minW = options.minW || JAM_DECK_WIDGET_MIN_W;
  const minH = options.minH || JAM_DECK_WIDGET_MIN_H;
  const layout = (Array.isArray(widgets) ? widgets : []).map((item) => ({ ...item }));
  const widget = layout.find((item) => item && item.id === widgetId);
  if (!widget) return null;
  widget.w = Math.max(minW, Math.min(cols - widget.x + 1, widget.w + Math.round(Number(deltaX) || 0)));
  widget.h = Math.max(minH, Math.min(rows - widget.y + 1, widget.h + Math.round(Number(deltaY) || 0)));
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

function jamDeckInsertWidgetByCompressingLargest(widgets, newWidget, options = {}) {
  const cols = options.cols || GRID_COLS;
  const rows = options.rows || GRID_ROWS;
  const minW = options.minW || JAM_DECK_WIDGET_MIN_W;
  const minH = options.minH || JAM_DECK_WIDGET_MIN_H;
  const source = (Array.isArray(widgets) ? widgets : []).filter((item) => item && item.id).map((item) => ({ ...item }));
  if (!newWidget || !newWidget.id || !jamDeckWidgetLayoutBoundsOk(newWidget, cols, rows, minW, minH)) return null;
  const victims = source.map((item, index) => ({ item, index }))
    .sort((left, right) => (right.item.w * right.item.h) - (left.item.w * left.item.h) || left.index - right.index || jamDeckCodeUnitCompare(left.item.id, right.item.id));

  for (const victimEntry of victims) {
    const victim = victimEntry.item;
    const candidates = [];
    if (victim.w >= newWidget.w + minW && victim.h >= newWidget.h) {
      const nextVictim = { ...victim, w: victim.w - newWidget.w };
      const inserted = { ...newWidget, x: victim.x + nextVictim.w, y: victim.y };
      candidates.push({ axis: "x", loss: newWidget.w * victim.h, nextVictim, inserted });
    }
    if (victim.h >= newWidget.h + minH && victim.w >= newWidget.w) {
      const nextVictim = { ...victim, h: victim.h - newWidget.h };
      const inserted = { ...newWidget, x: victim.x, y: victim.y + nextVictim.h };
      candidates.push({ axis: "y", loss: newWidget.h * victim.w, nextVictim, inserted });
    }
    candidates.sort((left, right) => left.loss - right.loss || left.axis.localeCompare(right.axis));
    for (const candidate of candidates) {
      const layout = source.map((item) => item.id === victim.id ? candidate.nextVictim : { ...item }).concat(candidate.inserted);
      if (!jamDeckWidgetLayoutCollisionFree(layout, cols, rows, minW, minH)) continue;
      return { layout, victimId: victim.id, axis: candidate.axis };
    }
  }
  return null;
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

  const placementX = Number(target && target.placementX);
  const placementY = Number(target && target.placementY);
  let direct = null;
  if (Number.isFinite(placementX) && Number.isFinite(placementY)) {
    const directX = Math.max(1, Math.min(cols - moving.w + 1, Math.round(placementX)));
    const directY = Math.max(1, Math.min(rows - moving.h + 1, Math.round(placementY)));
    const directLayout = (Array.isArray(widgets) ? widgets : []).map((item) => item && item.id === movingId
      ? { ...item, x: directX, y: directY }
      : { ...item });
    if (jamDeckWidgetLayoutCollisionFree(directLayout, cols, rows, minW, minH)) {
      direct = {
        ok: true,
        canCommit: true,
        mode: "direct",
        widgets: directLayout,
        ghost,
        slot: {
          axis: "free",
          x: directX,
          y: directY,
          w: moving.w,
          h: moving.h,
          beforeId: null,
          afterId: null,
        },
        seam: null,
        slots: [],
        solo: true,
        includeEdgeSlots,
      };
    }
  }

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

  // A free area that fits the selected widget wins over gap filling and seam pushing.
  // Holding Shift remains the explicit request to stretch into an edge fill slot.
  if (direct && !options.shiftKey) return direct;

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

  if (direct) return direct;

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
    this.canvasConflictReconcilePromise = null;
    this._aiLayoutResizeObserver = null;
    this._aiLayoutResizeFrame = 0;
    this._aiFabClampSavePending = false;
    this.aiActivePage = "assistant";
    this.aiLocalWebState = "idle";
    this.aiLocalWebGeneration = 0;
    this.aiLocalWebInitPromise = null;
    this.aiLocalWebFrame = null;
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
    this.cleanupAiFabLayout();
    this.cleanupAiLocalWeb();
    this.contentEl.removeEventListener("pointerdown", this.handleDeckActivation, true);
    this.contentEl.removeEventListener("focusin", this.handleDeckActivation, true);
    await this.canvasRuntime.destroyAll();
  }

  reconcileCanvasNativeConflicts() {
    if (this.canvasConflictReconcilePromise) return this.canvasConflictReconcilePromise;
    const promise = Promise.resolve().then(() => this._reconcileCanvasNativeConflicts());
    this.canvasConflictReconcilePromise = promise;
    return promise.finally(() => {
      if (this.canvasConflictReconcilePromise === promise) this.canvasConflictReconcilePromise = null;
    });
  }

  async _reconcileCanvasNativeConflicts() {
    const widgets = (this.plugin.settings.widgets || []).filter((widget) => widget && widget.type === "canvas-embed");
    if (!widgets.length) return;
    const widgetEls = Array.from(this.contentEl.querySelectorAll(".jam-deck-widget"));
    for (const widget of widgets) {
      const widgetEl = widgetEls.find((el) => el.dataset.widgetId === widget.id);
      const body = widgetEl && widgetEl.querySelector(":scope > .jam-deck-widget-body");
      if (!body || !widget.config || typeof widget.config.filePath !== "string") continue;
      const entry = this.canvasRuntime.entries.get(widget.id);
      const conflict = this.canvasRuntime.hasNativeCanvasDuplicate(widget.config.filePath, entry && entry.leaf);
      const conflictHost = body.querySelector(".jam-deck-canvas-embed-host[data-jam-deck-canvas-conflict='true']");
      if (conflict) {
        if (entry) await this.canvasRuntime.suspendForNativeConflict(widget.id);
        if (!body.querySelector(".jam-deck-canvas-embed-host[data-jam-deck-canvas-conflict='true']")) {
          body.empty();
          const host = body.createDiv({ cls: "jam-deck-canvas-embed-host" });
          host.dataset.jamDeckCanvasConflict = "true";
          this.showCanvasEmbedState(host, widget, "同一 Canvas 正在原生页面编辑，Jam Deck 已暂停渲染", false);
        }
        continue;
      }
      // The native Canvas was closed. Reuse the existing widget shell and
      // remount in place instead of rebuilding the whole Jam Deck view.
      if (conflictHost && (!entry || entry.nativeConflictSuspended)) {
        body.empty();
        this.renderCanvasEmbed(body, widget);
      }
    }
  }

  cleanupLayoutSashes() {
    if (this._sashMove) window.removeEventListener("pointermove", this._sashMove);
    if (this._sashUp) window.removeEventListener("pointerup", this._sashUp);
    if (this._sashGrid && this._sashProbe) {
      this._sashGrid.removeEventListener("pointermove", this._sashProbe);
      this._sashGrid.removeEventListener("pointerleave", this._sashLeave);
    }
    if (this._sashFrame) window.cancelAnimationFrame(this._sashFrame);
    if (this._sashRepositionFrame) window.cancelAnimationFrame(this._sashRepositionFrame);
    if (this._sashResizeObserver) {
      this._sashResizeObserver.disconnect();
      this._sashResizeObserver = null;
    }
    if (this._sashResizeHandler) {
      window.removeEventListener("resize", this._sashResizeHandler);
      this._sashResizeHandler = null;
    }
    this._sashMove = null;
    this._sashUp = null;
    this._sashProbe = null;
    this._sashLeave = null;
    this._sashGrid = null;
    this._sashFrame = 0;
    this._sashRepositionFrame = 0;
  }

  render() {
    const root = this.contentEl;
    this.cleanupLayoutSashes();
    this.cleanupAiFabLayout();
    this.cleanupAiLocalWeb();
    this.canvasRuntime.parkAll();
    root.empty();
    root.addClass("jam-deck-root");
    root.toggleClass("jam-deck-no-motion", !this.plugin.settings.animationsEnabled);

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
    if (this.plugin.settings.editMode) {
      this.makeToolbarButton(actions, "保存", "保存当前布局为默认", async () => {
        await this.plugin.saveDefaultLayout();
      });
    } else {
      this.makeToolbarButton(actions, "整理", "恢复默认布局", async () => {
        await this.plugin.autoArrange();
      });
    }

    const aiFab = root.createDiv({
      cls: "jam-deck-ai-fab",
      attr: { role: "button", tabindex: "0",  "aria-label": "AI 对话助手 AI 对话助手（DeepSeek / 千问）" },
    });
    aiFab.createSpan({ text: "AI", cls: "jam-deck-ai-fab-label" });
    let fabDrag = null;
    let fabMoved = false;
    const fabBase = () => {
      const rect = root.getBoundingClientRect();
      const pos = this.plugin.settings.aiFabPos;
      return {
        x: pos ? pos.x : rect.width - 52 - 20,
        y: pos ? pos.y : rect.height - 52 - 20,
      };
    };
    aiFab.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      const base = fabBase();
      fabDrag = { startX: event.clientX, startY: event.clientY, baseX: base.x, baseY: base.y };
      fabMoved = false;
      aiFab.setPointerCapture(event.pointerId);
      aiFab.addClass("is-dragging");
    });
    aiFab.addEventListener("pointermove", (event) => {
      if (!fabDrag) return;
      event.preventDefault();
      const dx = event.clientX - fabDrag.startX;
      const dy = event.clientY - fabDrag.startY;
      if (Math.hypot(dx, dy) > 5) fabMoved = true;
      this.updateAiFabPos(fabDrag.baseX + dx, fabDrag.baseY + dy);
    });
    aiFab.addEventListener("pointerup", () => {
      fabDrag = null;
      aiFab.removeClass("is-dragging");
      void this.plugin.saveSettings();
    });
    aiFab.addEventListener("click", () => {
      if (fabMoved) return;
      this.toggleAiChat();
    });
    aiFab.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.toggleAiChat();
      }
    });
    this.aiFab = aiFab;

    const aiChat = root.createDiv({ cls: "jam-deck-ai-chat" });
    aiChat.hidden = !this.aiChatOpen;
    this.aiChat = aiChat;
    this.renderAiChat(aiChat);
    this.layoutAiFabChat();
    this.installAiFabLayoutObserver(root);

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
    for (const id of Array.from(this.canvasRuntime.nativeConflictSuspendedIds || [])) {
      if (!liveCanvasIds.has(id)) this.canvasRuntime.nativeConflictSuspendedIds.delete(id);
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

  toggleAiProvider() {
    const next = this.plugin.settings.aiProvider === "qwen" ? "deepseek" : "qwen";
    this.plugin.settings.aiProvider = next;
    void this.plugin.saveSettings();
    const label = next === "qwen" ? "千问（可看图）" : "DeepSeek";
    new Notice(`Jam Deck：AI 已切换到 ${label}`);
    if (next === "deepseek" && this.aiCanvasContext && this.aiCanvasContext.kind === "image") {
      // 图片上下文只属于千问多模态：切到 DeepSeek 后降级为纯节点上下文，
      // 纯文本对话可以继续，避免“看图需要千问”误拦截。
      const ctx = this.aiCanvasContext;
      this.aiCanvasContext = { canvas: ctx.canvas || null, nodeId: ctx.nodeId || null, rect: ctx.rect || null };
      this.clearAiImageDock();
      this.addAiMessage("assistant", "已切换到 DeepSeek：图片上下文已移除，纯文本对话继续；需要再看图请重新对图片节点打开 AI 助手或把图片拖进对话框。");
    }
    this.refreshAiAssistantPage();
  }

  async archiveAiChat() {
    if (this.aiBusy) return;
    const messages = this.aiMessages || [];
    const pending = messages.slice(this.aiArchivedCount || 0);
    if (!pending.length) {
      new Notice("Jam Deck：本窗口对话已全部归档过，没有新增内容");
      return;
    }
    const dsKey = this.plugin.settings.aiApiKey || "";
    if (!dsKey) {
      new Notice("Jam Deck：未配置 DeepSeek API Key，无法归档");
      return;
    }
    const dsModel = this.plugin.settings.aiModel || "deepseek-v4-flash";
    const lines = [];
    for (const msg of pending) {
      if (msg.role === "user") {
        const img = msg.image && msg.image.alt ? `[图片:${msg.image.alt}]` : "";
        lines.push(`用户：${(img + (msg.text || "")).trim()}`);
      } else {
        lines.push(`助手：${msg.content || ""}`);
      }
    }
    const transcript = lines.join("\n");
    const system = "你是会话记录归档助手。把下面的对话压缩成精炼的会话纪要：保留关键事实、决定、待办或画布操作、图片涉及的内容主题；删去寒暄和过程噪音；用简体中文分点列出，150 字以内。只输出纪要正文，不要标题、不要解释。";
    let summary = "";
    try {
      const response = await requestUrl({
        url: "https://api.deepseek.com/chat/completions",
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${dsKey}` },
        body: JSON.stringify({
          model: dsModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content: `以下是要归档的对话（共 ${pending.length} 条）：\n${transcript}` },
          ],
          max_tokens: 1024,
          stream: false,
          temperature: 0.3,
        }),
        throw: false,
      });
      if (!response || response.status !== 200) {
        let detail = response ? `HTTP ${response.status}` : "无响应";
        try { detail = (response.json && response.json.error && response.json.error.message) || detail; } catch (e) {}
        throw new Error(detail);
      }
      summary = response.json && response.json.choices && response.json.choices[0] && response.json.choices[0].message
        ? response.json.choices[0].message.content
        : "";
      if (!summary) throw new Error("模型没有返回内容");
    } catch (error) {
      new Notice(`Jam Deck：归档压缩失败 · ${error.message || "未知错误"}`);
      return;
    }
    const now = new Date();
    const date = this.plugin.formatLocalDate(now);
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const filePath = `attachments/jam-deck-chatbot/${date}.md`;
    const block = `## ${time}\n\n> 来源：Jam Deck AI 助手 · 模型 ${dsModel} · 压缩 ${pending.length} 条对话\n\n${summary.trim()}\n\n`;
    try {
      const ok = await this.plugin.writeVaultFile(filePath, block, `# Jam Deck AI 会话归档 — ${date}`);
      if (!ok) throw new Error("写入校验失败");
    } catch (error) {
      new Notice(`Jam Deck：归档写入失败 · ${error.message || "未知错误"}`);
      return;
    }
    this.aiArchivedCount = messages.length;
    new Notice(`Jam Deck：已归档 ${pending.length} 条对话 → ${filePath}`);
  }

  clearAiChat() {
    if (this.aiBusy) return;
    this.aiMessages = [];
    this.aiArchivedCount = 0;
    this.aiInputValue = "";
    this.clearAiImageDock();
    if (this.aiChat) {
      const input = this.aiChat.querySelector("textarea");
      if (input) input.value = "";
      this.refreshAiAssistantPage();
    }
    new Notice("Jam Deck：已清空对话窗口（已归档记录不受影响）");
  }

  toggleAiChat() {
    this.aiChatOpen = !this.aiChatOpen;
    if (this.aiChat) {
      this.aiChat.hidden = !this.aiChatOpen;
      if (this.aiChatOpen) {
        this.layoutAiFabChat();
        if (this.aiActivePage === "assistant") {
          const input = this.aiAssistantPage && this.aiAssistantPage.querySelector("textarea");
          if (input) input.focus();
          this.scrollAiMessages();
        } else {
          void this.ensureAiLocalWeb();
        }
      } else if (this.aiLocalWebState === "loading") {
        this.cancelAiLocalWebInitialization();
      }
    }
  }

  updateAiFabPos(x, y) {
    const root = this.contentEl;
    const rect = root.getBoundingClientRect();
    const fabRect = this.aiFab && this.aiFab.getBoundingClientRect();
    const fabWidth = fabRect && fabRect.width > 0 ? Math.ceil(fabRect.width) : 52;
    const fabHeight = fabRect && fabRect.height > 0 ? Math.ceil(fabRect.height) : 52;
    const pos = jamDeckClampAiFabPosition({ x, y }, rect.width, rect.height, fabWidth, fabHeight, 0);
    if (!pos) return;
    this.plugin.settings.aiFabPos = pos;
    this.layoutAiFabChat();
  }

  cleanupAiFabLayout() {
    if (this._aiLayoutResizeObserver) {
      this._aiLayoutResizeObserver.disconnect();
      this._aiLayoutResizeObserver = null;
    }
    const ownerWindow = this.contentEl && this.contentEl.ownerDocument && this.contentEl.ownerDocument.defaultView;
    if (this._aiLayoutResizeFrame && ownerWindow) ownerWindow.cancelAnimationFrame(this._aiLayoutResizeFrame);
    this._aiLayoutResizeFrame = 0;
  }

  installAiFabLayoutObserver(root) {
    const ownerWindow = root && root.ownerDocument && root.ownerDocument.defaultView;
    const ResizeObserverCtor = ownerWindow && ownerWindow.ResizeObserver;
    if (!root || typeof ResizeObserverCtor !== "function") return;
    this._aiLayoutResizeObserver = new ResizeObserverCtor(() => {
      if (this._aiLayoutResizeFrame) ownerWindow.cancelAnimationFrame(this._aiLayoutResizeFrame);
      this._aiLayoutResizeFrame = ownerWindow.requestAnimationFrame(() => {
        this._aiLayoutResizeFrame = 0;
        this.layoutAiFabChat();
      });
    });
    this._aiLayoutResizeObserver.observe(root);
  }

  layoutAiFabChat() {
    const root = this.contentEl;
    const rect = root.getBoundingClientRect();
    const FAB_W = 52;
    const GAP = 8;
    const storedPos = this.plugin.settings.aiFabPos;
    const fabRect = this.aiFab && this.aiFab.getBoundingClientRect();
    const fabWidth = fabRect && fabRect.width > 0 ? Math.ceil(fabRect.width) : FAB_W;
    const fabHeight = fabRect && fabRect.height > 0 ? Math.ceil(fabRect.height) : FAB_W;
    const pos = jamDeckClampAiFabPosition(storedPos, rect.width, rect.height, fabWidth, fabHeight, 20);
    if (!pos) return;
    if (storedPos && (Number(storedPos.x) !== pos.x || Number(storedPos.y) !== pos.y)) {
      this.plugin.settings.aiFabPos = pos;
      if (!this._aiFabClampSavePending) {
        this._aiFabClampSavePending = true;
        Promise.resolve(this.plugin.saveSettings()).catch(() => {}).finally(() => {
          this._aiFabClampSavePending = false;
        });
      }
    }
    if (this.aiFab) {
      this.aiFab.style.left = `${pos.x}px`;
      this.aiFab.style.top = `${pos.y}px`;
      this.aiFab.style.right = "auto";
      this.aiFab.style.bottom = "auto";
    }
    if (this.aiChat && !this.aiChat.hidden) {
      const w = this.aiChat.offsetWidth || 680;
      const h = this.aiChat.offsetHeight || 780;
      let cx = pos.x + fabWidth + GAP;
      if (cx + w > rect.width - GAP) cx = pos.x - w - GAP;
      cx = Math.max(GAP, Math.min(cx, Math.max(GAP, rect.width - w - GAP)));
      let cy = pos.y;
      cy = Math.max(GAP, Math.min(cy, Math.max(GAP, rect.height - h - GAP)));
      this.aiChat.style.left = `${cx}px`;
      this.aiChat.style.top = `${cy}px`;
      this.aiChat.style.right = "auto";
      this.aiChat.style.bottom = "auto";
    }
  }

  async openAiChatWithCanvasText(node, canvas) {
    let data = null;
    try { data = typeof node.getData === "function" ? node.getData() : null; } catch (error) { data = null; }
    let text = data && typeof data.text === "string" ? data.text.trim()
      : data && data.type === "link" && typeof data.url === "string" ? data.url.trim()
        : data && data.type === "file" && typeof data.file === "string" ? data.file.trim()
          : "";
    if (data && data.type === "file" && typeof data.file === "string" && data.file.toLowerCase().endsWith(".md")) {
      try {
        const file = this.plugin.app.vault.getAbstractFileByPath(data.file);
        if (file) text = String(await this.plugin.app.vault.read(file) || "").trim() || data.file;
      } catch (error) {
        text = data.file;
      }
    }
    const nodeLabel = data && data.type === "link" ? "链接节点"
      : data && data.type === "file" ? "文件节点"
        : "文本节点";
    this.aiCanvasContext = {
      canvas: canvas || null,
      nodeId: node && node.id || null,
      text: text.slice(0, 8000),
      rect: data && Number.isFinite(Number(data.x))
        ? { x: Number(data.x), y: Number(data.y), width: Number(data.width), height: Number(data.height) }
        : null,
    };
    this.aiChatOpen = true;
    this.aiMessages = [];
    this.aiArchivedCount = 0;
    this.aiInputValue = "";
    this.aiQuickDone = !(data && data.type === "text");
    this.aiActivePage = "assistant";
    this.addAiMessage("user", text ? `[选中${nodeLabel}]\n${text}` : `[选中的${nodeLabel}]`);
    this.addAiMessage("assistant", `已载入${nodeLabel}。${data && data.type === "text" ? "点击下方语种可直接翻译；" : ""}也可以直接输入分析、整理或改写要求。`);
    if (this.aiChat) {
      this.aiChat.hidden = false;
      this.refreshAiAssistantPage();
      this.setAiActivePage("assistant", { focus: false });
      const input = this.aiAssistantPage && this.aiAssistantPage.querySelector("textarea");
      if (input) input.focus();
    }
  }

  async openAiChatWithCanvasImage(node, canvas) {
    let data = null;
    try { data = typeof node.getData === "function" ? node.getData() : null; } catch (error) { data = null; }
    const filePath = data && typeof data.file === "string" ? data.file : null;
    const app = this.plugin.app;
    if (!filePath || !app || !app.vault || !app.vault.getAbstractFileByPath) {
      this.addAiMessage("assistant", "无法读取图片节点。");
      return;
    }
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!file) {
      this.addAiMessage("assistant", `图片文件不存在：${filePath}`);
      return;
    }
    let buf = null;
    try { buf = await app.vault.readBinary(file); } catch (error) { buf = null; }
    if (!buf || !buf.byteLength) {
      this.addAiMessage("assistant", "图片读取失败。");
      return;
    }
    if (buf.byteLength > 15 * 1024 * 1024) {
      this.addAiMessage("assistant", "图片超过 15MB，无法发送（多模态模型限制）。");
      return;
    }
    const ext = String(filePath.toLowerCase().split(".").pop());
    const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", avif: "image/avif" })[ext] || "image/png";
    const base64 = Buffer.from(buf).toString("base64");
    // 压缩后再发送：原始 base64 body 过大（>10MB）会导致 fetch 上传超时（failed to fetch）。
    // canvas 缩放至最长边 2048px 并按类型转码，识别效果足够且 body 通常 <2MB。
    let sendMime = mime;
    let sendBase64 = base64;
    let displaySrc = `data:${mime};base64,${base64}`;
    try {
      const compressed = await this.plugin.compressImageDataUrl(`data:${mime};base64,${base64}`, mime);
      if (compressed && compressed.dataUrl && compressed.dataUrl.length < displaySrc.length) {
        sendMime = compressed.mime || mime;
        sendBase64 = compressed.dataUrl.slice(compressed.dataUrl.indexOf(",") + 1);
        displaySrc = compressed.dataUrl;
      }
    } catch (error) {}
    if (this.plugin.settings.aiProvider !== "qwen") {
      this.plugin.settings.aiProvider = "qwen";
      void this.plugin.saveSettings();
    }
    this.aiCanvasContext = {
      canvas: canvas || null,
      nodeId: node && node.id || null,
      kind: "image",
      image: { path: filePath, mime: sendMime, base64: sendBase64 },
      rect: data && Number.isFinite(Number(data.x))
        ? { x: Number(data.x), y: Number(data.y), width: Number(data.width), height: Number(data.height) }
        : null,
    };
    this.aiChatOpen = true;
    this.aiMessages = [];
    this.aiArchivedCount = 0;
    this.aiInputValue = "";
    this.aiQuickDone = true;
    this.aiActivePage = "assistant";
    this.aiMessages.push({
      role: "user",
      image: { src: displaySrc, alt: String(filePath.split("/").pop()) },
      text: "[图片]",
    });
    this.aiMessages.push({
      role: "assistant",
      content: "已载入图片（千问 · 多模态）。描述这张图，或问配色 / 构图 / 风格 / 内容相关问题。",
    });
    if (this.aiChat) {
      this.aiChat.hidden = false;
      this.refreshAiAssistantPage();
      this.setAiActivePage("assistant", { focus: false });
      const input = this.aiAssistantPage && this.aiAssistantPage.querySelector("textarea");
      if (input) input.focus();
    }
  }

  async setAiImageContext(buf, mime, path, name) {
    if (!buf || !buf.byteLength) {
      this.addAiMessage("assistant", "图片读取失败。");
      return false;
    }
    if (buf.byteLength > 15 * 1024 * 1024) {
      this.addAiMessage("assistant", "图片超过 15MB，无法发送（多模态模型限制）。");
      return false;
    }
    const base64 = Buffer.from(buf).toString("base64");
    let sendMime = mime;
    let sendBase64 = base64;
    let displaySrc = `data:${mime};base64,${base64}`;
    try {
      const compressed = await this.plugin.compressImageDataUrl(`data:${mime};base64,${base64}`, mime);
      if (compressed && compressed.dataUrl && compressed.dataUrl.length < displaySrc.length) {
        sendMime = compressed.mime || mime;
        sendBase64 = compressed.dataUrl.slice(compressed.dataUrl.indexOf(",") + 1);
        displaySrc = compressed.dataUrl;
      }
    } catch (error) {}
    if (this.plugin.settings.aiProvider !== "qwen") {
      this.plugin.settings.aiProvider = "qwen";
      void this.plugin.saveSettings();
    }
    this.aiCanvasContext = { canvas: null, nodeId: null, kind: "image", image: { path, mime: sendMime, base64: sendBase64 } };
    this.aiQuickDone = true;
    const displayName = name || String(path || "").split("/").pop() || "图片";
    this.aiMessages.push({ role: "user", image: { src: displaySrc, alt: displayName }, text: "[图片]" });
    this.aiMessages.push({ role: "assistant", content: "已载入图片（千问 · 多模态）。描述这张图，或问配色 / 构图 / 风格 / 内容相关问题。" });
    if (this.aiMessagesEl && this.aiChat && !this.aiChat.hidden) {
      this.renderAiMessage(this.aiMessagesEl, this.aiMessages[this.aiMessages.length - 2]);
      this.renderAiMessage(this.aiMessagesEl, this.aiMessages[this.aiMessages.length - 1]);
      this.scrollAiMessages();
    }
    this.updateAiImageDock(displaySrc, displayName);
    new Notice(`Jam Deck：已载入图片「${displayName}」`);
    return true;
  }

  async loadAiImageIntoChat(path, name) {
    const app = this.plugin.app;
    const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", avif: "image/avif" };
    const ext = String(path || "").toLowerCase().split(".").pop();
    if (!mimeMap[ext]) {
      this.addAiMessage("assistant", "不支持的图片格式：只能 PNG/JPG/WebP/GIF/BMP/AVIF。");
      return false;
    }
    const mime = mimeMap[ext];
    let buf = null;
    if (app && app.vault && app.vault.getAbstractFileByPath) {
      const vfile = app.vault.getAbstractFileByPath(path);
      if (vfile) {
        try { buf = await app.vault.readBinary(vfile); } catch (error) { buf = null; }
      }
    }
    if (!buf) {
      try {
        const fs = require("fs");
        const stat = await fs.promises.stat(path);
        if (!stat.isFile()) throw new Error("不是文件");
        buf = await fs.promises.readFile(path);
      } catch (error) {
        this.addAiMessage("assistant", `图片读取失败：${error.message || "未知错误"}`);
        return false;
      }
    }
    return this.setAiImageContext(buf, mime, path, name);
  }

  updateAiImageDock(displaySrc, name) {
    const dock = this.aiImageDockEl;
    if (!dock) return;
    dock.empty();
    dock.createEl("img", { attr: { src: displaySrc, alt: name || "图片" } });
    const label = dock.createSpan({ text: name || "图片", cls: "jam-deck-ai-image-dock-name" });
    label.title = name || "图片";
    const remove = dock.createEl("button", {
      text: "×",
      cls: "jam-deck-ai-image-dock-remove",
      attr: { type: "button",  "aria-label": "移除图片" },
    });
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      this.clearAiImageDock();
    });
    dock.hidden = false;
  }

  clearAiImageDock() {
    if (this.aiCanvasContext && this.aiCanvasContext.kind === "image") {
      this.aiCanvasContext = { canvas: null, nodeId: null };
    }
    if (this.aiImageDockEl) {
      this.aiImageDockEl.empty();
      this.aiImageDockEl.hidden = true;
    }
  }

  renderAiChat(chat) {
    chat.empty();
    const assistantPageId = `jam-deck-ai-page-assistant-${this.launcherViewId}`;
    const localWebPageId = `jam-deck-ai-page-local-web-${this.launcherViewId}`;
    const header = chat.createDiv({ cls: "jam-deck-ai-chat-header" });
    this.renderAiChatHeader(header, { assistantPageId, localWebPageId });
    const pages = chat.createDiv({ cls: "jam-deck-ai-pages" });
    this.aiAssistantPage = pages.createDiv({
      cls: "jam-deck-ai-page is-assistant",
      attr: { id: assistantPageId, role: "tabpanel" },
    });
    this.aiLocalWebPage = pages.createDiv({
      cls: "jam-deck-ai-page is-local-web",
      attr: { id: localWebPageId, role: "tabpanel" },
    });
    this.renderAiAssistantPage();
    this.renderAiLocalWebPanel();
    this.applyAiActivePage();
    if (this.aiChatOpen && this.aiActivePage === "local-web") void this.ensureAiLocalWeb();
  }

  renderAiAssistantPage() {
    if (!this.aiAssistantPage) return;
    this.aiAssistantPage.empty();
    this.renderAiChatBody(this.aiAssistantPage);
    this.renderAiChatInputRow(this.aiAssistantPage);
    // 重建窗口后恢复已载入图片的 dock
    if (this.aiCanvasContext && this.aiCanvasContext.kind === "image" && this.aiCanvasContext.image) {
      this.updateAiImageDock(
        `data:${this.aiCanvasContext.image.mime};base64,${this.aiCanvasContext.image.base64}`,
        String(this.aiCanvasContext.image.path || "").split("/").pop() || "图片",
      );
    }
    this.scrollAiMessages();
  }

  refreshAiAssistantPage() {
    if (this.aiProviderBtn) {
      const provider = this.plugin.settings.aiProvider === "qwen" ? "千问" : "DeepSeek";
      this.aiProviderBtn.textContent = provider;
      this.aiProviderBtn.title = provider === "千问"
        ? "当前：千问（多模态）· 点击切换到 DeepSeek"
        : "当前：DeepSeek · 点击切换到千问（可看图）";
    }
    this.renderAiAssistantPage();
  }

  renderAiLocalWebPanel() {
    if (!this.aiLocalWebPage) return;
    this.aiLocalWebPage.empty();
    if (this.aiHeaderContext) {
      this.aiHeaderContext.empty();
      const workspacePath = this.plugin.localWorkspacePath();
      const path = this.aiHeaderContext.createSpan({
        text: jamDeckWorkspaceFolderLabel(workspacePath),
        cls: "jam-deck-ai-local-path",
      });
      path.title = workspacePath
        ? `工作区：${workspacePath}。若网页未显示该工作区，请在网页侧栏手动选择。`
        : "请在设置中填写本地工作区路径，或使用当前 Vault。";
      this.aiLocalWebStatusEl = this.aiHeaderContext.createDiv({ cls: "jam-deck-ai-local-status" });
    }
    this.aiLocalWebHost = this.aiLocalWebPage.createDiv({ cls: "jam-deck-ai-local-host" });
    if (this.aiLocalWebFrame) this.aiLocalWebHost.appendChild(this.aiLocalWebFrame);
    this.renderAiLocalWebStatus();
  }

  renderAiLocalWebStatus(error) {
    if (!this.aiLocalWebStatusEl) return;
    this.aiLocalWebStatusEl.empty();
    this.aiLocalWebStatusEl.dataset.state = this.aiLocalWebState || "idle";
    if (this.aiLocalWebState === "loading") {
      this.aiLocalWebStatusEl.createSpan({ text: "连接中" });
      return;
    }
    if (this.aiLocalWebState === "error") {
      const message = this.aiLocalWebStatusEl.createSpan({ text: "未连接" });
      message.title = error || "请确认 127.0.0.1:3080 已启动";
      const retry = this.aiLocalWebStatusEl.createEl("button", { text: "重试", attr: { type: "button" } });
      retry.addEventListener("click", () => void this.ensureAiLocalWeb(true));
      return;
    }
    if (this.aiLocalWebState === "ready") {
      this.aiLocalWebStatusEl.createSpan({ text: "已连接" });
      return;
    }
    this.aiLocalWebStatusEl.createSpan({ text: "待连接" });
  }

  applyAiActivePage() {
    const local = this.aiActivePage === "local-web";
    if (this.aiAssistantTab) {
      this.aiAssistantTab.setAttribute("aria-selected", local ? "false" : "true");
      this.aiAssistantTab.tabIndex = local ? -1 : 0;
      this.aiAssistantTab.toggleClass("is-active", !local);
    }
    if (this.aiLocalWebTab) {
      this.aiLocalWebTab.setAttribute("aria-selected", local ? "true" : "false");
      this.aiLocalWebTab.tabIndex = local ? 0 : -1;
      this.aiLocalWebTab.toggleClass("is-active", local);
    }
    if (this.aiAssistantPage) this.aiAssistantPage.hidden = local;
    if (this.aiLocalWebPage) this.aiLocalWebPage.hidden = !local;
    if (this.aiChat) this.aiChat.toggleClass("is-local-web-page", local);
  }

  setAiActivePage(page, options = {}) {
    if (page !== "assistant" && page !== "local-web") return;
    this.aiActivePage = page;
    this.applyAiActivePage();
    const ownerWindow = this.contentEl && this.contentEl.ownerDocument && this.contentEl.ownerDocument.defaultView;
    if (ownerWindow) ownerWindow.requestAnimationFrame(() => this.layoutAiFabChat());
    if (page === "local-web") {
      if (this.aiChatOpen) void this.ensureAiLocalWeb();
      if (options.focus !== false && this.aiLocalWebTab) this.aiLocalWebTab.focus();
      return;
    }
    if (options.focus !== false) {
      const input = this.aiAssistantPage && this.aiAssistantPage.querySelector("textarea");
      if (input) input.focus();
    }
    this.scrollAiMessages();
  }

  cancelAiLocalWebInitialization() {
    this.aiLocalWebGeneration += 1;
    this.aiLocalWebInitPromise = null;
    if (this.aiLocalWebState === "loading") {
      this.aiLocalWebState = "idle";
      this.renderAiLocalWebStatus();
    }
  }

  cleanupAiLocalWeb() {
    this.cancelAiLocalWebInitialization();
    if (this.aiLocalWebFrame) {
      try { this.aiLocalWebFrame.src = "about:blank"; } catch (error) {}
      this.aiLocalWebFrame.remove();
    }
    this.aiLocalWebFrame = null;
    this.aiLocalWebHost = null;
    this.aiLocalWebStatusEl = null;
    this.aiLocalWebState = "idle";
  }

  async ensureAiLocalWeb(force = false) {
    if (this.aiLocalWebState === "ready" && this.aiLocalWebFrame && !force) return;
    if (this.aiLocalWebInitPromise && !force) return this.aiLocalWebInitPromise;
    const workspacePath = this.plugin.localWorkspacePath();
    const generation = this.aiLocalWebGeneration + 1;
    this.aiLocalWebGeneration = generation;
    if (!workspacePath) {
      this.aiLocalWebState = "error";
      this.renderAiLocalWebStatus("当前库没有可用的绝对路径。请在设置中填写本地工作区路径。");
      return;
    }
    this.aiLocalWebState = "loading";
    this.renderAiLocalWebStatus();
    const init = jamDeckPrepareDshWorkspace(jamDeckDshRpc, workspacePath).then(() => {
      if (generation !== this.aiLocalWebGeneration || !this.aiLocalWebHost) return;
      if (!this.aiLocalWebFrame) {
        this.aiLocalWebFrame = this.aiLocalWebHost.createEl("iframe", {
          cls: "jam-deck-ai-local-frame",
          attr: {
            src: AI_LOCAL_WEB_URL,
            title: "DeepSeek Harness · 本地工作区",
            sandbox: "allow-scripts allow-same-origin allow-forms",
          },
        });
      }
      this.aiLocalWebState = "ready";
      this.renderAiLocalWebStatus();
    }).catch((error) => {
      if (generation !== this.aiLocalWebGeneration) return;
      this.aiLocalWebState = "error";
      this.renderAiLocalWebStatus(error && error.message ? error.message : "未知错误");
    }).finally(() => {
      if (generation === this.aiLocalWebGeneration) this.aiLocalWebInitPromise = null;
    });
    this.aiLocalWebInitPromise = init;
    return init;
  }

  renderAiChatHeader(header, { assistantPageId, localWebPageId }) {
    const titleGroup = header.createDiv({ cls: "jam-deck-ai-chat-title-group" });
    titleGroup.createSpan({ text: "AI 助手", cls: "jam-deck-ai-chat-title" });
    const provider = this.plugin.settings.aiProvider === "qwen" ? "千问" : "DeepSeek";
    const providerBtn = titleGroup.createEl("button", {
      text: provider,
      cls: "jam-deck-ai-provider-btn",
      attr: { type: "button", title: provider === "千问" ? "当前：千问（多模态）· 点击切换到 DeepSeek" : "当前：DeepSeek · 点击切换到千问（可看图）" },
    });
    this.aiProviderBtn = providerBtn;
    providerBtn.addEventListener("click", () => this.toggleAiProvider());
    const tabs = header.createDiv({ cls: "jam-deck-ai-tabs", attr: { role: "tablist", "aria-label": "AI 助手页面" } });
    const makeTab = (page, text, controls) => {
      const tab = tabs.createEl("button", {
        text,
        cls: "jam-deck-ai-tab",
        attr: { type: "button", role: "tab", "aria-controls": controls },
      });
      tab.dataset.aiPage = page;
      tab.addEventListener("click", () => this.setAiActivePage(page));
      return tab;
    };
    this.aiAssistantTab = makeTab("assistant", "AI 助手", assistantPageId);
    this.aiLocalWebTab = makeTab("local-web", "本地工作区", localWebPageId);
    tabs.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      this.setAiActivePage(this.aiActivePage === "assistant" ? "local-web" : "assistant");
    });
    this.aiHeaderContext = header.createDiv({ cls: "jam-deck-ai-header-context" });
    const headerActions = header.createDiv({ cls: "jam-deck-ai-chat-actions" });
    const archive = headerActions.createEl("button", {
      text: "归档",
      cls: "jam-deck-ai-archive",
      attr: { type: "button", title: "把当前对话压缩整理存入 attachments/jam-deck-chatbot（按日期分档，已归档部分不重复记录）" },
    });
    archive.addEventListener("click", () => void this.archiveAiChat());
    const clear = headerActions.createEl("button", {
      text: "清理",
      cls: "jam-deck-ai-clear",
      attr: { type: "button", title: "清空当前对话窗口（不影响已归档的记录）" },
    });
    clear.addEventListener("click", () => this.clearAiChat());
    const close = headerActions.createEl("button", {
      text: "×",
      cls: "jam-deck-ai-chat-close",
      attr: { type: "button",  "aria-label": "关闭 AI 助手" },
    });
    close.addEventListener("click", () => this.toggleAiChat());
    // 拖动聊天窗口头部 → 同步移动悬浮按钮（两者共用 aiFabPos）
    let hdrDrag = null;
    header.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest("button")) return;
      event.preventDefault();
      const rect = this.contentEl.getBoundingClientRect();
      const pos = this.plugin.settings.aiFabPos || { x: rect.width - 52 - 20, y: rect.height - 52 - 20 };
      hdrDrag = { startX: event.clientX, startY: event.clientY, baseX: pos.x, baseY: pos.y };
      header.setPointerCapture(event.pointerId);
      header.addClass("is-dragging");
    });
    header.addEventListener("pointermove", (event) => {
      if (!hdrDrag) return;
      event.preventDefault();
      this.updateAiFabPos(hdrDrag.baseX + event.clientX - hdrDrag.startX, hdrDrag.baseY + event.clientY - hdrDrag.startY);
    });
    header.addEventListener("pointerup", () => {
      hdrDrag = null;
      header.removeClass("is-dragging");
      void this.plugin.saveSettings();
    });
  }

  renderAiChatBody(chat) {
    const messages = chat.createDiv({ cls: "jam-deck-ai-messages" });
    this.aiMessagesEl = messages;
    if (!this.aiMessages || !this.aiMessages.length) {
      const empty = messages.createDiv({ cls: "jam-deck-ai-empty" });
      empty.createDiv({ text: "今天想处理什么？", cls: "jam-deck-ai-empty-title" });
      empty.createDiv({ text: "直接用自然语言新增、完成或删除待办，也可以指定日期和分类。", cls: "jam-deck-ai-empty-copy" });
      empty.createDiv({ text: "例如：周一加一条「参考图集归档」，工作分类", cls: "jam-deck-ai-empty-example" });
    } else {
      for (const msg of this.aiMessages) this.renderAiMessage(messages, msg);
    }
    if (this.aiCanvasContext && this.aiCanvasContext.nodeId && !this.aiQuickDone) {
      this.renderAiQuickOptions(messages);
    }

    const dock = chat.createDiv({ cls: "jam-deck-ai-image-dock" });
    dock.hidden = true;
    this.aiImageDockEl = dock;
  }

  renderAiChatInputRow(chat) {
    const row = chat.createDiv({ cls: "jam-deck-ai-row" });
    const input = row.createEl("textarea", {
      cls: "jam-deck-ai-input",
      attr: {
        rows: 1,
        placeholder: "说人话改待办…（Enter 发送，Shift+Enter 换行）",
        "aria-label": "AI 对话输入",
      },
    });
    if (this.aiInputValue) {
      input.value = this.aiInputValue;
      this.growAiInput(input);
    }
    input.addEventListener("input", () => {
      this.aiInputValue = input.value;
      this.growAiInput(input);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.sendAiMessage();
      }
    });
    input.addEventListener("paste", (event) => {
      const files = Array.from((event.clipboardData && event.clipboardData.files) || []);
      const img = files.find((f) => f && typeof f.type === "string" && f.type.startsWith("image/"));
      if (!img) return;
      event.preventDefault();
      event.stopPropagation();
      const reader = new FileReader();
      reader.onload = async () => {
        const mime = img.type || "image/png";
        const base64 = String(reader.result || "").replace(/^data:[^;]+;base64,/, "");
        await this.setAiImageContext(Buffer.from(base64, "base64"), mime, img.name || "粘贴图片.png", img.name || "粘贴图片");
      };
      reader.readAsDataURL(img);
    });
    const send = row.createEl("button", { text: "发送", cls: "jam-deck-ai-send", attr: { type: "button" } });
    send.addEventListener("click", () => void this.sendAiMessage());
    this.aiSendBtn = send;
    this.aiInputEl = input;
    // 拖图进对话框：剪贴板条目 / 系统文件 / file uri
    const dropHasImage = (event) => {
      const transfer = event.dataTransfer;
      if (!transfer) return false;
      const types = Array.from(transfer.types || []);
      return types.includes(CLIPBOARD_DRAG_MIME) || types.includes("Files") || types.includes("text/uri-list");
    };
    const dropMark = (event) => {
      if (!dropHasImage(event)) return;
      event.preventDefault();
      event.stopPropagation();
      chat.addClass("is-jam-deck-ai-drop-target");
    };
    const dropLeave = (event) => {
      if (chat.contains(event.relatedTarget)) return;
      chat.removeClass("is-jam-deck-ai-drop-target");
    };
    chat.addEventListener("dragover", dropMark);
    chat.addEventListener("dragenter", dropMark);
    chat.addEventListener("dragleave", dropLeave);
    chat.addEventListener("drop", async (event) => {
      chat.removeClass("is-jam-deck-ai-drop-target");
      if (!dropHasImage(event)) return;
      const transfer = event.dataTransfer;
      const item = this.plugin.getClipboardItemFromTransfer(transfer) || this.plugin.activeClipboardDragItem;
      if (item && item.type === "image" && item.filename) {
        event.preventDefault();
        event.stopPropagation();
        await this.loadAiImageIntoChat(`${CLIPBOARD_DIR}/${item.filename}`, item.filename);
        return;
      }
      const files = Array.from((transfer && transfer.files) || []);
      for (const f of files) {
        if (!f) continue;
        const ext = String(f.name || "").toLowerCase().split(".").pop();
        if (!ext || !["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"].includes(ext)) continue;
        event.preventDefault();
        event.stopPropagation();
        const path = typeof f.path === "string" ? f.path : null;
        if (path) {
          await this.loadAiImageIntoChat(path, f.name);
        } else {
          const buf = Buffer.from(await f.arrayBuffer());
          const mime = (typeof f.type === "string" && f.type) || "image/png";
          await this.setAiImageContext(buf, mime, f.name || "图片.png", f.name || "图片");
        }
        break;
      }
    });
  }

  renderAiQuickOptions(list) {
    const row = list.createDiv({ cls: "jam-deck-ai-quick" });
    row.createSpan({ text: "翻译为：", cls: "jam-deck-ai-quick-label" });
    for (const lang of ["中文", "英文", "韩文", "日文"]) {
      const btn = row.createEl("button", {
        text: lang,
        cls: "jam-deck-ai-quick-btn",
        attr: { type: "button", title: `把选中文本翻译成${lang}` },
      });
      btn.addEventListener("click", () => void this.sendAiQuick(lang));
    }
  }

  async sendAiQuick(lang) {
    if (this.aiBusy) return;
    const ctx = this.aiCanvasContext;
    if (!ctx || !ctx.canvas || !ctx.nodeId || !ctx.text) {
      this.addAiMessage("assistant", "没有可翻译的选中文本，请先在 Canvas 里选中一个文本节点再点 AI。");
      return;
    }
    this.addAiMessage("user", `[翻译成${lang}]`);
    this.aiQuickDone = true;
    if (this.aiMessagesEl) {
      const quick = this.aiMessagesEl.querySelector(".jam-deck-ai-quick");
      if (quick) quick.remove();
    }
    this.aiBusy = true;
    if (this.aiSendBtn) {
      this.aiSendBtn.disabled = true;
      this.aiSendBtn.textContent = "…";
    }
    const bubble = this.aiChat && !this.aiChat.hidden ? this.renderAiMessage(this.aiMessagesEl, { role: "assistant", content: "翻译中…" }) : null;
    let full = "";
    try {
      const translated = await this.plugin.streamTranslate(ctx.text, lang, (chunk) => {
        full += chunk;
        if (bubble) {
          const span = bubble.querySelector(".jam-deck-ai-message-text");
          if (span) span.textContent = full;
          this.scrollAiMessages();
        }
      });
      const content = (translated || "").trim() || "（翻译结果为空）";
      const created = await this.plugin.createCanvasTextNode(ctx, content);
      const note = created ? `${content}\n\n（已贴到原文${ctx.rect ? "右侧" : "旁"}）` : `${content}\n\n（⚠ 节点创建失败，文本已在此处保留）`;
      if (this.aiMessages) this.aiMessages[this.aiMessages.length - 1] = { role: "assistant", content: note };
      if (bubble) {
        bubble.empty();
        bubble.createSpan({ text: note, cls: "jam-deck-ai-message-text" });
      }
      const config = this.plugin.getAiConfig();
      await this.plugin.appendAiLog("user", `[翻译成${lang}]${ctx.text ? `\n原文：${ctx.text.slice(0, 120)}` : ""}`, config.label);
      await this.plugin.appendAiLog("assistant", content, config.label);
    } catch (error) {
      const message = `翻译失败：${error.message || "未知错误"}`;
      if (this.aiMessages) this.aiMessages[this.aiMessages.length - 1] = { role: "assistant", content: message };
      if (bubble) {
        bubble.empty();
        bubble.createSpan({ text: message, cls: "jam-deck-ai-message-text" });
      }
    } finally {
      this.aiBusy = false;
      if (this.aiSendBtn) {
        this.aiSendBtn.disabled = false;
        this.aiSendBtn.textContent = "发送";
      }
      this.scrollAiMessages();
    }
  }

  renderAiMessage(list, msg) {
    const bubble = list.createDiv({ cls: `jam-deck-ai-message is-${msg.role === "user" ? "user" : "assistant"}` });
    const copyable = msg.image ? "" : (msg.content || "");
    if (copyable) {
      const copyBtn = bubble.createEl("button", {
        cls: "jam-deck-ai-copy",
        attr: { type: "button",  "aria-label": "复制这条消息" },
      });
      setIcon(copyBtn, "copy");
      copyBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.copyAiText(copyable);
      });
    }
    if (msg.image) {
      const img = bubble.createEl("img", {
        cls: "jam-deck-ai-message-image",
        attr: { src: msg.image.src || "", alt: msg.image.alt || "图片", title: msg.image.alt || "图片" },
      });
      if (msg.text) bubble.createSpan({ text: msg.text, cls: "jam-deck-ai-message-text" });
      return bubble;
    }
    bubble.createSpan({ text: msg.content, cls: "jam-deck-ai-message-text" });
    return bubble;
  }

  async copyAiText(text) {
    const content = String(text || "");
    if (!content) return;
    try {
      if (this.plugin.clipboard && typeof this.plugin.clipboard.writeText === "function") {
        this.plugin.clipboard.writeText(content);
      } else {
        await navigator.clipboard.writeText(content);
      }
      new Notice("Jam Deck：已复制到剪贴板");
    } catch (error) {
      new Notice("Jam Deck：复制失败");
    }
  }

  addAiMessage(role, content) {
    if (!this.aiMessages) this.aiMessages = [];
    this.aiMessages.push({ role, content });
    if (this.aiMessagesEl && this.aiChat && !this.aiChat.hidden) {
      this.renderAiMessage(this.aiMessagesEl, { role, content });
      this.scrollAiMessages();
    }
  }

  scrollAiMessages() {
    if (this.aiMessagesEl) this.aiMessagesEl.scrollTop = this.aiMessagesEl.scrollHeight;
  }

  growAiInput(input) {
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 30), 160)}px`;
  }

  buildAiSummary(reply, stats) {
    const parts = [];
    if (stats.added) parts.push(`新增 ${stats.added} 条`);
    if (stats.completed) parts.push(`完成 ${stats.completed} 条`);
    if (stats.removed) parts.push(`删除 ${stats.removed} 条`);
    if (stats.skipped) parts.push(`跳过 ${stats.skipped} 条`);
    const exec = parts.length ? `\n已执行：${parts.join(" · ")}` : "";
    return reply ? `${reply}${exec}` : (exec || "操作完成");
  }

  async sendAiMessage() {
    const input = this.aiInputEl || (this.aiChat && this.aiChat.querySelector("textarea"));
    const text = input ? input.value.trim() : "";
    const imageCtx = this.aiCanvasContext && this.aiCanvasContext.kind === "image" && this.aiCanvasContext.image
      ? this.aiCanvasContext
      : null;
    if ((!text && !imageCtx) || this.aiBusy) return;
    if (imageCtx) {
      if (this.plugin.settings.aiProvider !== "qwen") {
        this.addAiMessage("assistant", "看图需要千问（多模态）。请点击标题旁的模型按钮切换到千问。");
        return;
      }
      if (!this.plugin.settings.qwenApiKey) {
        this.addAiMessage("assistant", "还没配置千问 API Key：设置 → 第三方插件 → Jam Deck → 千问 API Key");
        return;
      }
    } else if (!this.plugin.settings.aiApiKey) {
      this.addAiMessage("assistant", "还没配置 API Key：设置 → 第三方插件 → Jam Deck → DeepSeek API Key");
      return;
    }
    this.addAiMessage("user", text || "（图片）");
    if (input) {
      input.value = "";
      this.aiInputValue = "";
      this.growAiInput(input);
    }
    this.aiBusy = true;
    if (this.aiSendBtn) {
      this.aiSendBtn.disabled = true;
      this.aiSendBtn.textContent = "…";
    }
    const providerLabel = this.plugin.settings.aiProvider === "qwen" ? "千问" : "DeepSeek";
    this.addAiMessage("assistant", `${providerLabel} 处理中…`);
    try {
      if (imageCtx) {
        const bubble = this.aiChat && !this.aiChat.hidden ? this.aiMessagesEl.lastElementChild : null;
        let full = "";
        const translated = await this.plugin.streamChatWithImage(imageCtx.image.base64, imageCtx.image.mime, text, (chunk) => {
          full += chunk;
          if (bubble) {
            const span = bubble.querySelector(".jam-deck-ai-message-text");
            if (span) span.textContent = full;
            this.scrollAiMessages();
          }
        });
        const content = (translated || "").trim() || "（没有返回内容）";
        if (this.aiMessages) this.aiMessages[this.aiMessages.length - 1] = { role: "assistant", content };
        if (bubble) {
          bubble.empty();
          bubble.createSpan({ text: content, cls: "jam-deck-ai-message-text" });
        }
        const qwenConfig = this.plugin.getAiConfig();
        await this.plugin.appendAiLog("user", `[图片：${imageCtx.image.path.split("/").pop()}] ${text}`, qwenConfig.label);
        await this.plugin.appendAiLog("assistant", content, qwenConfig.label);
      } else {
        const result = await this.plugin.askDeckAi(text, this.aiCanvasContext);
        const stats = await this.plugin.applyAiOperations(result.operations, this.aiCanvasContext);
        const summary = this.buildAiSummary(result.reply, stats);
        if (this.aiMessages) this.aiMessages[this.aiMessages.length - 1] = { role: "assistant", content: summary };
        this.aiLastResult = stats;
        if (this.aiMessagesEl && this.aiChat && !this.aiChat.hidden) {
          const last = this.aiMessagesEl.lastElementChild;
          if (last) {
            last.empty();
            last.createSpan({ text: summary, cls: "jam-deck-ai-message-text" });
          }
        }
        const dsConfig = this.plugin.getAiConfig();
        await this.plugin.appendAiLog("user", text, dsConfig.label);
        await this.plugin.appendAiLog("assistant", summary, dsConfig.label);
      }
    } catch (error) {
      const message = `出错了：${error.message || "未知错误"}`;
      if (this.aiMessages) this.aiMessages[this.aiMessages.length - 1] = { role: "assistant", content: message };
      if (this.aiMessagesEl && this.aiChat && !this.aiChat.hidden) {
        const last = this.aiMessagesEl.lastElementChild;
        if (last) {
          last.empty();
          last.createSpan({ text: message, cls: "jam-deck-ai-message-text" });
        }
      }
    } finally {
      this.aiBusy = false;
      if (this.aiSendBtn) {
        this.aiSendBtn.disabled = false;
        this.aiSendBtn.textContent = "发送";
      }
      this.scrollAiMessages();
    }
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
          "aria-label": `${item.type === "image" ? "剪贴板图片" : "剪贴板文字"}，${timeLabel}。可拖到待办、Canvas 或其他应用`,
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
      const copyBtn = toolbar.createEl("button", { cls: "jam-deck-clip-btn", attr: { type: "button",  "aria-label": "复制到剪贴板" } });
      setIcon(copyBtn, "copy");
      copyBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.plugin.copyClipboardItem(item);
        new Notice("Jam Deck：已复制");
      });
      const delBtn = toolbar.createEl("button", { cls: "jam-deck-clip-btn is-danger", attr: { type: "button",  "aria-label": "删除该条剪贴板记录 删除该条记录及附件" } });
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
        attr: { type: "button",  "aria-label": `打开待办详情：${task.text}` },
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
        const archive = taskActions.createEl("button", { text: "归档", cls: "jam-deck-task-archive", attr: { type: "button",  "aria-label": "按分类归档" } });
        archive.disabled = isArchiving;
        archive.addEventListener("click", async (event) => {
          event.stopPropagation();
          await this.plugin.archiveDeckTask(task.id);
        });
      }
      const remove = taskActions.createEl("button", { text: "×", cls: "jam-deck-task-delete", attr: { type: "button",  "aria-label": `删除待办：${task.text}` } });
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
      const dateButton = cell.createEl("button", { text: String(date.getDate()), cls: `jam-deck-calendar-date${completionLevel ? ` has-completed heat-${completionLevel}` : ""}`, attr: { type: "button",  "aria-label": `${dateKey} 新建待办${completionText} ${dateKey} · 新建截止待办${completionText}` } });
      dateButton.addEventListener("click", () => this.plugin.openNewTaskForDate(dateKey));
      if (activeTasks.length) {
        const markers = cell.createDiv({ cls: "jam-deck-calendar-markers" });
        for (const task of activeTasks.slice(0, 3)) {
          const overdue = dateKey < todayKey;
          const marker = markers.createEl("button", { cls: `jam-deck-calendar-task-marker is-${task.status}${overdue ? " is-overdue" : ""}`, attr: { type: "button",  "aria-label": `打开待办：${task.text}` } });
          marker.addEventListener("click", (event) => { event.stopPropagation(); this.plugin.openTaskDetail(task.id); });
        }
        if (activeTasks.length > 3) cell.createSpan({ text: `+${activeTasks.length - 3}`, cls: "jam-deck-calendar-more" });
      }
    }
    const overdueCount = dueTasks.filter((task) => task.status === "active" && task.dueDate < todayKey).length;
    body.createDiv({ text: `四周内截止 ${rangeTaskCount} 项${overdueCount ? ` · 已逾期 ${overdueCount}` : ""}`, cls: "jam-deck-calendar-foot" });
  }

  async createCanvasForWidget(widget) {
    const path = jamDeckNextCanvasFileName((candidate) => !!this.app.vault.getAbstractFileByPath(candidate));
    await this.app.vault.create(path, '{"nodes":[],"edges":[]}');
    widget.config = widget.config || {};
    widget.config.filePath = path;
    widget.config.schemaVersion = 1;
    await this.plugin.saveSettings();
    return path;
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
    // 新用户没有画布时，直接新建一个未命名 Canvas 并挂载。
    if (!widget.config || !widget.config.filePath) {
      const create = actions.createEl("button", { text: "新建 Canvas" });
      create.addEventListener("click", async () => {
        try {
          const path = await this.createCanvasForWidget(widget);
          const body = host.closest(".jam-deck-widget-body");
          if (body) {
            body.empty();
            this.renderCanvasEmbed(body, widget);
          }
          new Notice(`Jam Deck：已创建 ${path}`);
        } catch (error) {
          new Notice(`Jam Deck：创建 Canvas 失败：${error && error.message || "未知错误"}`);
        }
      });
    }
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
      const conflict = error && error.code === "JAM_DECK_CANVAS_CONFLICT";
      const empty = error && error.code === "JAM_DECK_CANVAS_EMPTY";
      if (conflict) host.dataset.jamDeckCanvasConflict = "true";
      this.showCanvasEmbedState(host, widget, conflict ? "同一 Canvas 正在原生页面编辑，Jam Deck 已暂停渲染" : empty ? "Canvas 文件为空，Jam Deck 已暂停渲染" : `Canvas 工作区启动失败${detail}`, !conflict && !empty);
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
          tabindex: "0",
          role: "button",
          draggable: "true",
          "aria-label": `${shortcut.name}，${isUrl ? "网页快捷方式" : shortcut.isFolder ? "文件夹快捷方式" : "本地快捷方式"}。Alt 加方向键可调整顺序。目标：${target}${isUrl ? "（域名名称与图标由 Jam Deck 本地生成）" : ""}`,
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
        const del = item.createEl("button", { text: "×", cls: "jam-deck-launcher-edit is-danger", attr: { type: "button",  "aria-label": `删除快捷方式：${shortcut.name}` } });
        del.addEventListener("click", async (event) => {
          event.stopPropagation();
          if (window.confirm(`删除快捷方式“${shortcut.name}”？\n\n只会从 Jam Deck 移除本地记录，不会删除原文件或文件夹。`)) await this.plugin.deleteShortcut(widget.id, shortcut.id);
        });
      }
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
    this.renderMusicHero(player, widget);
    this.renderMusicTransport(player, widget);
    this.updateMusicPlayerEl(player, widget);
    void this.plugin.ensureMusicMedia();
  }

  renderMusicHero(player, widget) {
    const sourceControl = player.createDiv({ cls: "jam-deck-music-source-control" });
    const sourceButton = sourceControl.createEl("button", {
      cls: "jam-deck-music-source-button",
      attr: {
        type: "button",
        
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

    cover.addEventListener("error", () => {
      cover.removeAttribute("src");
      player.removeClass("has-artwork");
    });
  }

  renderMusicTransport(player, widget) {
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
        attr: { type: "button", "data-role": role, "aria-label": label },
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
      if (sash && sash.edge === "end") {
        const rects = (sash.beforeIds || []).map((id) => widgetEls.get(id)?.getBoundingClientRect()).filter(Boolean);
        if (!rects.length) return null;
        const edgeX = Math.max(...rects.map((rect) => rect.right));
        const yRatio = (atY - 1) / Math.max(1, GRID_ROWS);
        return {
          x: edgeX - gridRect.left,
          y: gridRect.height * Math.min(1, Math.max(0, yRatio)),
        };
      }
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
      if (sash && sash.edge === "end") {
        const rects = (sash.beforeIds || []).map((id) => widgetEls.get(id)?.getBoundingClientRect()).filter(Boolean);
        if (!rects.length) return null;
        const edgeY = Math.max(...rects.map((rect) => rect.bottom));
        const xRatio = (atX - 1) / Math.max(1, GRID_COLS);
        return {
          x: gridRect.width * Math.min(1, Math.max(0, xRatio)),
          y: edgeY - gridRect.top,
        };
      }
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
          title: node.widgetId
            ? "拖动调整本组件大小"
            : node.axis === "xy"
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
      if (active.node.widgetId) {
        const next = jamDeckResizeWidgetAtCorner(layout, active.node.widgetId, dx, dy);
        if (next) layout = next;
      } else if ((active.node.axis === "x" || active.node.axis === "xy") && dx) {
        const sash = sashMap.get(active.node.sashX);
        const next = jamDeckApplySashDelta(layout, sash, dx);
        if (next) layout = next;
      }
      if (!active.node.widgetId && (active.node.axis === "y" || active.node.axis === "xy") && dy) {
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
        // 24px（不是默认 18）：canvas-embed 组件内部右下角被 Obsidian 原生
        // .canvas-controls（z-index 100）覆盖，sash 实际生效区仅在 widget 边界
        // 外侧 13px 一圈，18px 命中半径过紧会频繁脱靶。
        const near = Math.hypot(x - hx, y - hy) <= 24;
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
    // 布局变化（窗口/面板缩放、图片加载、canvas 挂载、compact 切换等）时
    // 圆点位置会过期，悬停失效。监听 grid 与每个 widget 的尺寸变化 + window resize，
    // rAF 防抖重算 handle 位置。
    const scheduleReposition = () => {
      if (this._sashRepositionFrame) return;
      this._sashRepositionFrame = window.requestAnimationFrame(() => {
        this._sashRepositionFrame = 0;
        if (!this._sashGrid) return;
        reposition();
      });
    };
    this._sashResizeHandler = scheduleReposition;
    window.addEventListener("resize", scheduleReposition);
    if (typeof ResizeObserver === "function") {
      this._sashResizeObserver = new ResizeObserver(scheduleReposition);
      this._sashResizeObserver.observe(grid);
      for (const el of widgetEls.values()) this._sashResizeObserver.observe(el);
    }
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
      const startCol = ((startClientX - rect.left) / Math.max(1, rect.width)) * GRID_COLS + 1;
      const startRow = ((startClientY - rect.top) / Math.max(1, rect.height)) * GRID_ROWS + 1;
      const grabOffsetX = startCol - widget.x;
      const grabOffsetY = startRow - widget.y;
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
          placementX: colFloat - grabOffsetX,
          placementY: rowFloat - grabOffsetY,
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
    this.applyAnimationSetting();
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
    this.canvasNativePaths = new Set();
    this.canvasNativeConflictTimer = null;
    this.canvasNativeConflictReconcilePromise = null;
    this.canvasNativeConflictReconcileQueued = false;
    this.canvasNativeConflictDisposed = false;
    await this.loadSettings();
    await this.ensureClipboardDir();
    this.clipboardBusy = false;
    this.canvasInkOwners = new Map();
    this.primeClipboard();

    this.registerView(VIEW_TYPE, (leaf) => new JamDeckView(leaf, this));
    this.addSettingTab(new JamDeckSettingTab(this.app, this));
    this.addRibbonIcon("layout-dashboard", "Open Jam Deck", () => this.openDeck());
    this.addCommand({ id: "open-jam-deck", name: "Open dashboard", callback: () => this.openDeck() });
    this.addCommand({ id: "toggle-edit-mode", name: "Toggle edit mode", callback: async () => {
      this.settings.editMode = !this.settings.editMode;
      await this.saveSettings();
      this.renderAllViews();
    }});
    this.addCommand({ id: "auto-arrange", name: "恢复默认布局", callback: () => this.autoArrange() });
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
    const reconcileCanvasConflicts = () => this.scheduleCanvasNativeConflictReconcile();
    this.registerEvent(this.app.workspace.on("layout-change", reconcileCanvasConflicts));
    this.registerEvent(this.app.workspace.on("active-leaf-change", reconcileCanvasConflicts));

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
    setTimeout(() => {
      this.ensureLocalShortcutRecords().catch((error) => console.error("jam-deck shortcut local records failed", error));
    }, 6000);
  }

  onunload() {
    this.canvasNativeConflictDisposed = true;
    this.canvasNativeConflictReconcileQueued = false;
    if (this.canvasNativeConflictTimer != null) {
      window.clearTimeout(this.canvasNativeConflictTimer);
      this.canvasNativeConflictTimer = null;
    }
    for (const owner of (this.canvasInkOwners || new Map()).values()) void owner.flush();
    void this.stopMusicMedia();
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => leaf.detach());
  }

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    this.settings.widgets = Array.isArray(this.settings.widgets) ? this.settings.widgets : DEFAULT_SETTINGS.widgets;
    this.settings.savedLayout = Array.isArray(this.settings.savedLayout) && this.settings.savedLayout.length
      ? jamDeckSnapshotWidgetLayout(this.settings.savedLayout)
      : null;
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
    this.settings.aiLocalWorkspacePath = typeof this.settings.aiLocalWorkspacePath === "string"
      ? this.settings.aiLocalWorkspacePath.trim()
      : "";
    this.settings.canvasExportDir = typeof this.settings.canvasExportDir === "string"
      ? this.settings.canvasExportDir.trim()
      : "";
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

  localWorkspacePath() {
    return jamDeckLocalWorkspacePath(
      this.settings.aiLocalWorkspacePath,
      jamDeckVaultBasePath(this.app),
    );
  }

  applyAnimationSetting() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const root = leaf && leaf.view && leaf.view.contentEl;
      if (root && typeof root.toggleClass === "function") {
        root.toggleClass("jam-deck-no-motion", !this.settings.animationsEnabled);
      }
    }
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

  async askDeckAi(userText, canvasContext) {
    const config = this.getAiConfig();
    const apiKey = config.apiKey;
    const model = config.model;
    const contextTasks = this.settings.deckTasks
      .filter((task) => task.status !== "archived")
      .map((task) => ({
        id: task.id,
        text: task.text,
        status: task.status,
        dueDate: task.dueDate || null,
        category: task.category || null,
        description: task.description || "",
      }));
    const system = [
      "你是 Jam Deck（Obsidian 待办工作台）的 AI 助手，用户用自然语言提出待办或 Canvas 文本操作。",
      `你运行在 ${config.label} 上，当前模型是 ${config.model}；用户问你是谁/什么模型时如实回答。`,
      "你必须只返回一个 JSON 对象，不要 Markdown 代码块、不要任何多余文字。格式：",
      '{"reply":"对用户指令的一句话中文总结（≤60字，说明你做了什么）","operations":[{"action":"addTask","text":"…","description":"…","dueDate":"YYYY-MM-DD 或 null","category":"work 或 life 或 null"}]}',
      "支持的 action：addTask 新增待办（text 必填且≤120字，description/dueDate/category 可选）；completeTask 完成待办（按 id，状态 active 才能完成）；deleteTask 删除待办（按 id）；addCanvasText 把文本作为新 Canvas 文本节点贴在目标节点旁（text 必填为最终文本，targetNodeId 必填=上下文 Canvas 目标节点的 id，position 为 right 或 down）。",
      "上下文 activeTasks 是当前进行中/已完成的待办，id 可直接引用；不要编造不存在的 id。",
      "dueDate 必须是 YYYY-MM-DD 格式，无法确定则为 null；分类只允许 work / life / null。",
      "一次最多输出 20 个操作；若用户只是提问没有可执行操作，reply 直接回答，operations 返回空数组 []。",
      "你的能力只限于操作 Jam Deck 的待办与 Canvas 文本节点。用户若要求开发/修改 Jam Deck 插件、写代码、跑命令等，不要编造，reply 说明：这是待办助手，改插件请用 WorkBuddy 会话完成，并可将需求简要转述为待办（如「开发 JamDeck：XXX」）加入列表。",
      "需要最新/实时信息（新闻、最新资料、实时数据）或用户明确要求搜索时，调用 web_search 工具获取结果后再回答；搜索完在 reply 里简要总结。",
    ].join("\n");
    const contextParts = [
      `今天是 ${this.formatLocalDate(new Date())}（本地时间）。`,
      `当前进行中/已完成待办：${JSON.stringify(contextTasks)}`,
    ];
    if (canvasContext && canvasContext.canvas && canvasContext.nodeId) {
      contextParts.push(`Canvas 目标节点（用户刚选中的文本节点）：${JSON.stringify({
        id: canvasContext.nodeId,
        type: "text",
        text: canvasContext.text,
        rect: canvasContext.rect,
      })}。若用户要求翻译/改写这段文本，用 addCanvasText 将结果贴在 targetNodeId 对应节点右或下方。`);
    }
    contextParts.push(`用户指令：${userText}`);
    const payload = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: contextParts.join("\n") },
      ],
      max_tokens: 8192,
      stream: false,
      temperature: 0.2,
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "联网搜索最新或实时信息（新闻、最新资料、实时数据、用户要求搜索的内容）。",
            parameters: {
              type: "object",
              properties: { query: { type: "string", description: "搜索关键词，尽量精简" } },
              required: ["query"],
            },
          },
        },
      ],
      tool_choice: "auto",
    };
    let response = await this.chatCompletion(payload);
    const firstMessage = response && response.json && response.json.choices && response.json.choices[0] && response.json.choices[0].message;
    if (firstMessage && Array.isArray(firstMessage.tool_calls) && firstMessage.tool_calls.length) {
      const call = firstMessage.tool_calls[0];
      payload.messages.push(firstMessage);
      let toolResult = "搜索失败：无可用搜索结果";
      if (call.function && call.function.name === "web_search") {
        try {
          const args = typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : {};
          toolResult = await this.webSearch(String(args.query || userText || "").slice(0, 100));
        } catch (error) {
          toolResult = `搜索失败：${error.message || "未知错误"}`;
        }
      }
      payload.messages.push({ role: "tool", tool_call_id: call.id, content: toolResult });
      response = await this.chatCompletion(payload);
    }
    const content = response && response.json && response.json.choices && response.json.choices[0] && response.json.choices[0].message
      ? response.json.choices[0].message.content
      : "";
    if (!content) throw new Error("模型没有返回内容");
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      const match = String(content).match(/\{[\s\S]*\}/);
      if (!match) throw new Error("模型返回无法解析");
      parsed = JSON.parse(match[0]);
    }
    return {
      reply: String(parsed && parsed.reply || "").trim(),
      operations: Array.isArray(parsed && parsed.operations) ? parsed.operations : [],
    };
  }

  getAiConfig() {
    if (this.settings.aiProvider === "qwen") {
      const key = this.settings.qwenApiKey || "";
      // Token Plan 个人版专属 key 以 sk-sp- 开头，必须配套专属 Base URL；
      // 通用按量付费 key 以 sk- 开头走 dashscope 端点。两者不可混用。
      const tokenPlan = key.startsWith("sk-sp-");
      return {
        baseUrl: tokenPlan
          ? "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
          : "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: key,
        model: this.settings.qwenModel || "qwen3.8-max",
        label: tokenPlan ? "千问(Token Plan)" : "千问",
      };
    }
    return {
      baseUrl: "https://api.deepseek.com",
      apiKey: this.settings.aiApiKey || "",
      model: this.settings.aiModel || "deepseek-v4-flash",
      label: "DeepSeek",
    };
  }

  async chatCompletion(payload) {
    const config = this.getAiConfig();
    const apiKey = config.apiKey;
    if (!apiKey) throw new Error(`未配置 ${config.label} API Key`);
    let response;
    try {
      response = await requestUrl({
        url: `${config.baseUrl}/chat/completions`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        throw: false,
      });
    } catch (error) {
      throw new Error(`网络请求失败：${error.message}`);
    }
    if (!response || response.status !== 200) {
      let detail = response ? `HTTP ${response.status}` : "无响应";
      try {
        const json = response.json;
        detail = (json && json.error && json.error.message) || detail;
      } catch (error) {}
      throw new Error(detail);
    }
    return response;
  }

  async webSearch(query) {
    const attempts = [
      { url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, bing: false },
      { url: `https://cn.bing.com/search?q=${encodeURIComponent(query)}`, bing: true },
    ];
    for (const attempt of attempts) {
      try {
        const res = await requestUrl({
          url: attempt.url,
          method: "GET",
          throw: false,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          },
        });
        if (!res || res.status !== 200 || typeof res.text !== "string" || !res.text.length) continue;
        const results = this.parseSearchHtml(res.text, attempt.bing);
        if (results.length) return results;
      } catch (error) {}
    }
    return `搜索「${query}」没有返回可用结果。`;
  }

  parseSearchHtml(html, bing) {
    const items = [];
    const add = (title, url, snippet) => {
      const clean = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const t = clean(title).slice(0, 80);
      if (!t) return;
      items.push(`${items.length + 1}. ${t}\n   来源：${String(url || "").slice(0, 120)}\n   摘要：${clean(snippet).slice(0, 160)}`);
    };
    const source = String(html);
    if (bing) {
      const blocks = source.split(/<li class="b_algo"/);
      for (const block of blocks.slice(1)) {
        const linkMatch = block.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/);
        const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
        const snipMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        add(titleMatch ? titleMatch[1] : "", linkMatch ? linkMatch[1] : "", snipMatch ? snipMatch[1] : "");
        if (items.length >= 5) break;
      }
    } else {
      const blocks = source.split(/class="result__a"/);
      for (const block of blocks.slice(1)) {
        const linkMatch = block.match(/href="([^"]+)"/);
        const titleMatch = block.match(/>(.*?)<\/a>/s);
        const snipMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
        add(titleMatch ? titleMatch[1] : "", linkMatch ? linkMatch[1] : "", snipMatch ? snipMatch[1] : "");
        if (items.length >= 5) break;
      }
    }
    return items.join("\n");
  }

  async applyAiOperations(operations, canvasContext) {
    const result = { added: 0, completed: 0, removed: 0, skipped: 0 };
    if (!Array.isArray(operations) || !operations.length) {
      await this.saveSettings();
      this.renderAllViews();
      return result;
    }
    for (const op of operations.slice(0, 20)) {
      if (!op || typeof op.action !== "string") {
        result.skipped++;
        continue;
      }
      try {
        if (op.action === "addTask") {
          const text = String(op.text || "").trim().slice(0, 120);
          if (!text) {
            result.skipped++;
            continue;
          }
          const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const task = this.makeDeckTask(id, text, String(op.description || "").trim(), [], {
            dueDate: this.isValidLocalDate(op.dueDate) ? op.dueDate : null,
            category: ["work", "life"].includes(op.category) ? op.category : null,
          });
          this.settings.deckTasks.unshift(task);
          result.added++;
        } else if (op.action === "completeTask" && op.id) {
          const task = this.settings.deckTasks.find((item) => item.id === op.id && item.status === "active");
          if (!task) {
            result.skipped++;
            continue;
          }
          task.status = "completed";
          task.completedAt = Date.now();
          result.completed++;
        } else if (op.action === "deleteTask" && op.id) {
          const task = this.settings.deckTasks.find((item) => item.id === op.id);
          if (!task) {
            result.skipped++;
            continue;
          }
          this.settings.deckTasks = this.settings.deckTasks.filter((item) => item.id !== op.id);
          result.removed++;
        } else if (op.action === "addCanvasText" && canvasContext && canvasContext.canvas && canvasContext.nodeId) {
          const created = await this.createCanvasTextNode(canvasContext, String(op.text || ""), op.position);
          if (created) result.added++;
          else result.skipped++;
        } else {
          result.skipped++;
        }
      } catch (error) {
        result.skipped++;
      }
    }
    await this.saveSettings();
    this.renderAllViews();
    return result;
  }

  findFreeCanvasRect(canvas, baseCenter, width, height, excludeId) {
    if (!canvas || !canvas.nodes || typeof canvas.nodes.values !== "function") {
      return { x: baseCenter.x, y: baseCenter.y };
    }
    const occupied = [];
    for (const node of canvas.nodes.values()) {
      if (!node || (excludeId && node.id === excludeId)) continue;
      let d = null;
      try { d = typeof node.getData === "function" ? node.getData() : null; } catch (error) { d = null; }
      if (!d || !Number.isFinite(Number(d.x)) || !Number.isFinite(Number(d.y))) continue;
      occupied.push({ x: Number(d.x), y: Number(d.y), w: Number(d.width) || 0, h: Number(d.height) || 0 });
    }
    if (!occupied.length) return { x: baseCenter.x, y: baseCenter.y };
    const pad = 24;
    const hit = (cx, cy) => {
      const left = cx - width / 2 - pad;
      const right = cx + width / 2 + pad;
      const top = cy - height / 2 - pad;
      const bottom = cy + height / 2 + pad;
      return occupied.some((o) => !(left > o.x + o.w || right < o.x || top > o.y + o.h || bottom < o.y));
    };
    if (!hit(baseCenter.x, baseCenter.y)) return { x: baseCenter.x, y: baseCenter.y };
    const stepX = width + 80;
    const stepY = height + 80;
    for (let row = 0; row < 4; row += 1) {
      const cy = baseCenter.y + row * stepY;
      for (let col = 1; col <= 8; col += 1) {
        const cx = baseCenter.x + col * stepX;
        if (!hit(cx, cy)) return { x: cx, y: cy };
      }
    }
    return { x: baseCenter.x, y: baseCenter.y };
  }

  async createCanvasTextNode(canvasContext, text, position) {
    const canvas = canvasContext && canvasContext.canvas;
    const content = String(text || "").trim();
    if (!canvas || !canvasContext.nodeId || !content || typeof canvas.createTextNode !== "function") return false;
    let target = null;
    try { target = typeof canvas.nodes.get === "function" ? canvas.nodes.get(canvasContext.nodeId) : null; } catch (error) { target = null; }
    let data = null;
    try { data = target && typeof target.getData === "function" ? target.getData() : null; } catch (error) { data = null; }
    if (!data || data.type !== "text" || !Number.isFinite(Number(data.x))) return false;
    const gap = 60;
    const lines = content.split(/\r?\n/).length;
    const width = Math.min(480, Math.max(200, Math.ceil(content.length * 14)));
    const height = Math.max(48, lines * 22 + 20);
    const down = position === "down";
    const basePos = down
      ? { x: Number(data.x) + width / 2, y: Number(data.y) + Number(data.height || 0) + gap + height / 2 }
      : { x: Number(data.x) + Number(data.width || 0) + gap + width / 2, y: Number(data.y) + height / 2 };
    // 目标位置被现有文本/图片节点占据时，自动向右下找空位，避免堆叠
    const pos = this.findFreeCanvasRect(canvas, basePos, width, height, canvasContext.nodeId);
    let created = null;
    try {
      created = canvas.createTextNode({
        pos,
        position: "center",
        size: { width, height },
        text: content,
        save: false,
      });
    } catch (error) { created = null; }
    if (!created) return false;
    let check = null;
    try { check = typeof created.getData === "function" ? created.getData() : null; } catch (error) { check = null; }
    const placed = check && Number.isFinite(Number(check.width)) && Number(check.width) > 0
      && Number.isFinite(Number(check.height)) && Number(check.height) > 0;
    if (!placed) {
      try {
        if (typeof canvas.nodes.delete === "function") canvas.nodes.delete(created.id);
        if (typeof created.destroy === "function") created.destroy();
      } catch (error) {}
      return false;
    }
    try {
      if (typeof canvas.requestSave === "function") await canvas.requestSave();
    } catch (error) {}
    // 自动聚焦到新节点：选中 + 视野拉过去
    try {
      if (typeof canvas.deselectAll === "function") canvas.deselectAll();
      if (typeof canvas.select === "function") canvas.select(created);
      if (typeof canvas.zoomToSelection === "function") canvas.zoomToSelection();
      else if (canvas.wrapperEl && typeof canvas.wrapperEl.focus === "function") canvas.wrapperEl.focus();
    } catch (error) {}
    return true;
  }

  async compressImageDataUrl(dataUrl, mime) {
    const image = typeof Image === "function" ? new Image() : null;
    if (!image) return { dataUrl, mime, width: null, height: null };
    const data = await new Promise((resolve) => {
      let settled = false;
      const done = (result) => { if (!settled) { settled = true; resolve(result); } };
      image.onload = () => {
        try {
          const MAX_EDGE = 2048;
          let w = image.naturalWidth;
          let h = image.naturalHeight;
          const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (mime === "image/png" || mime === "image/webp") {
            ctx.drawImage(image, 0, 0, w, h);
          } else {
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(image, 0, 0, w, h);
          }
          const outMime = mime === "image/png" ? "image/png" : mime === "image/webp" ? "image/webp" : "image/jpeg";
          done({ dataUrl: canvas.toDataURL(outMime, 0.85), mime: outMime, width: w, height: h });
        } catch (error) {
          done({ dataUrl, mime, width: null, height: null });
        }
      };
      image.onerror = () => done({ dataUrl, mime, width: null, height: null });
      image.src = dataUrl;
      if (image.complete) image.onload();
    });
    return data;
  }

  async appendAiLog(role, content, provider) {
    const path = "Work/AI对话记录.md";
    const now = new Date();
    const stamp = `${this.formatLocalDate(now)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const label = role === "user" ? "你" : `AI（${provider || "助手"}）`;
    const line = `- **${label}**（${stamp}）：${String(content || "").replace(/\n/g, " ").trim().slice(0, 400)}`;
    try {
      await this.writeVaultFile(path, `${line}\n`, "# AI 对话记录");
    } catch (error) {
      /* 记录失败不影响对话 */
    }
  }

  async streamChat(messages, options, onChunk) {
    const config = this.getAiConfig();
    const apiKey = config.apiKey;
    if (!apiKey) throw new Error(`未配置 ${config.label} API Key`);
    // Obsidian 渲染进程的 fetch 流式在部分环境不可用（CSP/网络栈），统一走
    // requestUrl（Obsidian 主进程网络栈，稳定可靠）。onChunk 一次回调全文，
    // 调用方保持"增量渲染"写法即可兼容。
    let response;
    try {
      response = await requestUrl({
        url: `${config.baseUrl}/chat/completions`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          temperature: options && options.temperature != null ? options.temperature : 0.3,
          max_tokens: options && options.maxTokens || 8192,
        }),
        throw: false,
      });
    } catch (error) {
      throw new Error(`网络请求失败：${error.message}`);
    }
    if (!response || response.status !== 200) {
      let detail = response ? `HTTP ${response.status}` : "无响应";
      try {
        const json = response.json;
        detail = (json && json.error && json.error.message) || detail;
      } catch (error) {}
      throw new Error(detail);
    }
    const content = response.json && response.json.choices && response.json.choices[0] && response.json.choices[0].message
      ? response.json.choices[0].message.content
      : "";
    if (!content) throw new Error("模型没有返回内容");
    if (typeof onChunk === "function") onChunk(content);
    return content;
  }

  async streamTranslate(text, lang, onChunk) {
    const system = [
      "你是翻译引擎。把用户提供的文本翻译成" + lang + "。",
      "只输出翻译结果本身：不要任何解释、不要 Markdown 代码块、不要 JSON、不要重复原文。",
    ].join("\n");
    return this.streamChat([
      { role: "system", content: system },
      { role: "user", content: String(text || "").slice(0, 8000) },
    ], { temperature: 0.3 }, onChunk);
  }

  async streamChatWithImage(imageBase64, mime, prompt, onChunk) {
    const config = this.getAiConfig();
    const system = `你是通义千问 ${config.model}（阿里云百炼多模态模型），运行在 Jam Deck 中。用户会发送图片并提出问题，请基于图片内容简洁、准确地回答；涉及配色/构图/风格时给出具体描述。`;
    return this.streamChat([
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mime || "image/png"};base64,${imageBase64}` } },
          { type: "text", text: String(prompt || "请描述这张图片") },
        ],
      },
    ], { temperature: 0.3 }, onChunk);
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

  async showElectronDirectoryPicker(defaultPath) {
    let dialog = null;
    let win = null;
    try {
      const electron = require("electron");
      if (electron.remote && electron.remote.dialog) {
        dialog = electron.remote.dialog;
        win = typeof electron.remote.getCurrentWindow === "function" ? electron.remote.getCurrentWindow() : null;
      } else if (electron.dialog && typeof electron.dialog.showOpenDialog === "function") {
        dialog = electron.dialog;
        win = electron.BrowserWindow && typeof electron.BrowserWindow.getFocusedWindow === "function"
          ? electron.BrowserWindow.getFocusedWindow()
          : null;
      }
    } catch (error) {}
    if (!dialog) {
      try {
        const remote = require("@electron/remote");
        if (remote && remote.dialog) {
          dialog = remote.dialog;
          win = typeof remote.getCurrentWindow === "function" ? remote.getCurrentWindow() : null;
        }
      } catch (error) {}
    }
    if (!dialog || typeof dialog.showOpenDialog !== "function") return undefined;
    const options = {
      title: "选择导出位置",
      properties: ["openDirectory", "createDirectory"],
    };
    if (defaultPath) options.defaultPath = defaultPath;
    try {
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (!result || result.canceled || !result.filePaths || !result.filePaths[0]) return null;
      return String(result.filePaths[0]);
    } catch (error) {
      console.error("jam-deck export directory dialog failed", error);
      return undefined;
    }
  }

  showPowerShellDirectoryPicker(defaultPath) {
    const { exec } = require("child_process");
    const safe = String(defaultPath || "").replace(/'/g, "''");
    const ps = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
[System.Windows.Forms.Application]::EnableVisualStyles()
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '选择导出位置'
$d.ShowNewFolderButton = $true
if ('${safe}') { try { $d.SelectedPath = '${safe}' } catch {} }
$r = $d.ShowDialog()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
  Write-Output $d.SelectedPath
}
`;
    const encoded = Buffer.from(ps, "utf16le").toString("base64");
    return new Promise((resolve) => {
      exec(`powershell -NoProfile -STA -EncodedCommand ${encoded}`, { timeout: 120000, windowsHide: true }, (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const line = String(stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "";
        resolve(line || null);
      });
    });
  }

  async pickCanvasExportDirectory() {
    const defaultPath = this.settings && this.settings.canvasExportDir || "";
    const electronPick = await this.showElectronDirectoryPicker(defaultPath);
    let picked = electronPick;
    if (picked === undefined) {
      picked = process.platform === "win32" ? await this.showPowerShellDirectoryPicker(defaultPath) : null;
      if (picked == null && process.platform !== "win32") {
        new Notice("Jam Deck：当前环境无法选择导出目录");
      }
    }
    if (!picked) return null;
    this.settings.canvasExportDir = picked;
    try { await this.saveSettings(); } catch (error) {}
    return picked;
  }

  async copyVaultFileToOsDir(file, dir) {
    const fs = require("fs");
    const pathApi = require("path");
    if (!file || !file.path || !dir) throw new Error("缺少导出文件或目录");
    const dest = jamDeckUniqueOsCopyPath(dir, pathApi.basename(file.path), (candidate) => fs.existsSync(candidate));
    if (!dest) throw new Error("无法生成导出路径");
    try {
      const src = this.absoluteFromVaultRel(file.path);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        return dest;
      }
    } catch (error) {}
    const data = await this.app.vault.readBinary(file);
    fs.writeFileSync(dest, Buffer.from(data));
    return dest;
  }

  async exportCanvasMediaFiles(files) {
    const list = Array.isArray(files) ? files.filter((file) => file && file.path && !Array.isArray(file.children)) : [];
    if (!list.length) {
      new Notice("Jam Deck：没有可导出的图片或视频");
      return false;
    }
    const dir = await this.pickCanvasExportDirectory();
    if (!dir) return false;
    let copied = 0;
    let skipped = 0;
    for (const file of list) {
      try {
        await this.copyVaultFileToOsDir(file, dir);
        copied += 1;
      } catch (error) {
        console.error("jam-deck canvas export failed", file && file.path, error);
        skipped += 1;
      }
    }
    if (copied && !skipped) {
      new Notice(copied === 1 ? "Jam Deck：已导出 1 个附件" : `Jam Deck：已导出 ${copied} 个附件`);
      return true;
    }
    if (copied && skipped) {
      new Notice(`Jam Deck：已导出 ${copied} 个附件，跳过 ${skipped} 个`);
      return true;
    }
    new Notice("Jam Deck：导出失败");
    return false;
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

  externalFilePathFromUrl(raw) {
    try {
      const url = new URL(String(raw || ""));
      if (url.protocol !== "file:") return null;
      let pathname = decodeURIComponent(url.pathname || "");
      if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
      return pathname.replace(/\//g, "\\");
    } catch (error) {
      return null;
    }
  }

  async writeCanvasAttachmentBuffer(buffer, sourceName, canvasFilePath, signal) {
    if (signal && signal.aborted) throw new Error("Canvas closed");
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
    if (!data.byteLength) throw new Error("Image data is empty");
    if (data.byteLength > CANVAS_EXTERNAL_IMAGE_MAX_BYTES) throw new Error("Image is too large; compress it before dropping");
    const safeName = this.sanitizeFilename(sourceName);
    let targetPath = "";
    if (this.app.fileManager && typeof this.app.fileManager.getAvailablePathForAttachment === "function") {
      targetPath = await this.app.fileManager.getAvailablePathForAttachment(safeName, canvasFilePath);
    }
    if (!targetPath || targetPath.startsWith(`${CLIPBOARD_DIR}/`) || targetPath.startsWith(`${CANVAS_ASSET_DIR}/`)) {
      targetPath = `${CANVAS_ASSET_DIR}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`;
    }
    if (signal && signal.aborted) throw new Error("Canvas closed");
    const folder = targetPath.includes("/") ? targetPath.slice(0, targetPath.lastIndexOf("/")) : "";
    if (folder) await this.ensureVaultFolder(folder);
    if (this.app.vault.getAbstractFileByPath(targetPath)) {
      targetPath = `${CANVAS_ASSET_DIR}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`;
      await this.ensureVaultFolder(CANVAS_ASSET_DIR);
    }
    await this.app.vault.createBinary(targetPath, data);
    const file = this.app.vault.getAbstractFileByPath(targetPath);
    if (!file) throw new Error("Canvas attachment creation failed");
    return { path: targetPath, file };
  }

  async readExternalCanvasImage(source, signal) {
    if (!source) throw new Error("External image is invalid");
    if (signal && signal.aborted) throw new Error("Canvas closed");
    if (source.file && typeof source.file.arrayBuffer === "function") {
      if (Number(source.file.size) > CANVAS_EXTERNAL_IMAGE_MAX_BYTES) throw new Error("Image is too large; compress it before dropping");
      return { data: new Uint8Array(await source.file.arrayBuffer()), name: source.name || source.file.name || "image.png" };
    }
    if (!source.path) throw new Error("External image path is unavailable");
    const fs = require("fs");
    const stat = await fs.promises.stat(source.path);
    if (!stat.isFile() || stat.size > CANVAS_EXTERNAL_IMAGE_MAX_BYTES) throw new Error("Image is too large; compress it before dropping");
    const bytes = await fs.promises.readFile(source.path);
    return { data: new Uint8Array(bytes), name: source.name || require("path").basename(source.path) || "image.png" };
  }

  async createCanvasAttachmentFromExternal(source, canvasFilePath, signal) {
    const operation = async () => {
      const image = await this.readExternalCanvasImage(source, signal);
      return this.writeCanvasAttachmentBuffer(image.data, image.name, canvasFilePath, signal);
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

  /* 通用落盘守卫：写文件前确保父目录存在（vault.create 不会自动建父目录） */
  async ensureVaultFileParent(filePath) {
    const path = String(filePath || "");
    const slash = path.lastIndexOf("/");
    if (slash > 0) await this.ensureVaultFolder(path.slice(0, slash));
  }

  /* 通用落盘：存在则追加，不存在则带标题创建；写前确保父目录 */
  async writeVaultFile(filePath, content, header) {
    await this.ensureVaultFileParent(filePath);
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file) {
      const text = await this.app.vault.read(file);
      await this.app.vault.modify(file, `${text.trimEnd()}\n${content}`);
    } else {
      await this.app.vault.create(filePath, header ? `${header}\n\n${content}` : content);
    }
    return this.app.vault.getAbstractFileByPath(filePath) != null;
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
        nextTask.archiveFormat = "simple-v1";
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
      current.archiveFormat = "simple-v1";
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
    return { date, weekday: weekdays[now.getDay()], path: this.getWorkArchiveTargetPath(date) };
  }

  // 归档路径解析（P1-1 + 0.30）：读设置，空值/未设置回退内置常量。
  getWorkArchiveMode() {
    const mode = this.settings && this.settings.workArchiveMode;
    return mode === "dir" ? "dir" : "file";
  }

  getLifeArchiveMode() {
    const mode = this.settings && this.settings.lifeArchiveMode;
    return mode === "dir" ? "dir" : "file";
  }

  getWorkArchiveFile() {
    const file = this.settings && this.settings.workArchiveFile;
    return typeof file === "string" && file.trim() ? file.trim() : "Work/工作.md";
  }

  getWorkArchiveDir() {
    const dir = this.settings && this.settings.workArchiveDir;
    return typeof dir === "string" && dir.trim() ? dir.trim() : WORK_JOURNAL_DIR;
  }

  getLifeArchivePath() {
    const path = this.settings && this.settings.lifeArchivePath;
    return typeof path === "string" && path.trim() ? path.trim() : LIFE_DAILY_PATH;
  }

  getLifeArchiveDir() {
    const dir = this.settings && this.settings.lifeArchiveDir;
    return typeof dir === "string" && dir.trim() ? dir.trim() : "Life/生活日记";
  }

  // 按当前模式解析归档目标路径：
  // - file 模式：单文件（固定）
  // - dir 模式：目录下按日期建 YYYY-MM-DD.md
  getWorkArchiveTargetPath(dateKey) {
    return this.getWorkArchiveMode() === "dir"
      ? `${this.getWorkArchiveDir()}/${dateKey}.md`
      : this.getWorkArchiveFile();
  }

  getLifeArchiveTargetPath(dateKey) {
    return this.getLifeArchiveMode() === "dir"
      ? `${this.getLifeArchiveDir()}/${dateKey}.md`
      : this.getLifeArchivePath();
  }

  buildArchiveRef(task, dateKey, category) {
    const resolved = category || this.resolveTaskCategory(task);
    return resolved === "work"
      ? { kind: "work-daily-v3", notePath: this.getWorkArchiveTargetPath(dateKey), dateKey, blockId: task.id }
      : { kind: "life-daily", notePath: this.getLifeArchiveTargetPath(dateKey), dateKey, blockId: task.id };
  }

  getTaskArchiveRef(task) {
    if (task && task.archiveRef && task.archiveRef.notePath && task.archiveRef.blockId) return task.archiveRef;
    const path = this.getTaskJournalPath(task);
    if (!path) return null;
    const dateKey = task.archiveDate || task.archiveTargetDate || (String(path).match(/(\d{4}-\d{2}-\d{2})\.md$/) || [])[1] || this.formatLocalDate(new Date(task.archivedAt || Date.now()));
    // 兜底判断（仅旧任务未持久化 archiveRef 时）：生活归档 = 单文件（file 模式）或生活目录内的日期文件；
    // 其余一律视为工作目录模式的历史路径。新任务都有持久化 archiveRef，不走此分支。
    const lifeFile = this.getLifeArchivePath();
    const lifeDir = this.getLifeArchiveDir();
    const isLifePath = path === lifeFile || path === LIFE_DAILY_PATH
      || (lifeDir && path.startsWith(`${lifeDir}/`));
    return isLifePath
      ? { kind: "life-daily", notePath: path, dateKey, blockId: task.id }
      : { kind: "work-daily-v2", notePath: path, dateKey, blockId: task.id };
  }

  formatLifeDateHeading(dateKey) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    return `# ${year}年${month}月${day}日`;
  }

  lifeTaskMarker(taskId, boundary, legacy = false) {
    const id = String(taskId).replace(/--/g, "-");
    // 新数据用 Obsidian 隐藏注释 %%...%%（预览/阅读模式均不显示）；
    // legacy=true 生成旧版 <!-- ... -->（0.30.2 及以前写入），读取兼容用。
    return legacy
      ? `<!-- jam-deck-life-task:${id}:${boundary}:v1 -->`
      : `%% jam-deck-life-task:${id}:${boundary}:v1 %%`;
  }

  findLifeTaskBlock(markdown, taskId, dateKey) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const startMarkers = [this.lifeTaskMarker(taskId, "start"), this.lifeTaskMarker(taskId, "start", true)];
    const endMarkers = [this.lifeTaskMarker(taskId, "end"), this.lifeTaskMarker(taskId, "end", true)];
    const starts = [];
    const ends = [];
    lines.forEach((line, index) => {
      if (startMarkers.includes(line)) starts.push(index);
      if (endMarkers.includes(line)) ends.push(index);
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
      `  - 分类：${this.resolveTaskCategory(task) === "work" ? "工作" : "生活"}`,
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

  async ensureArchiveFile(ref) {
    // work-daily-v2 = 旧四段式（仅读取历史数据）；life-daily / work-daily-v3 = 统一简单格式。
    if (ref.kind === "work-daily-v2") return this.ensureDailyJournalFile(ref.notePath);
    return this.ensureSimpleArchiveFile(ref.notePath, ref.dateKey);
  }

  async ensureSimpleArchiveFile(notePath, dateKey) {
    const parent = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
    if (parent) await this.ensureVaultFolder(parent);
    let file = this.app.vault.getAbstractFileByPath(notePath);
    if (file) return file;
    try { await this.app.vault.create(notePath, `${this.formatLifeDateHeading(dateKey)}\n\n`); }
    catch (error) {
      file = this.app.vault.getAbstractFileByPath(notePath);
      if (!file) throw error;
      return file;
    }
    file = this.app.vault.getAbstractFileByPath(notePath);
    if (!file) throw new Error(`无法创建归档文件：${notePath}`);
    return file;
  }

  async writeTaskToArchive(task, ref) {
    const file = await this.ensureArchiveFile(ref);
    if (ref.kind === "work-daily-v2") return this.writeTaskToDailyJournal(task, ref.notePath);
    await this.app.vault.process(file, (current) => this.upsertTaskInLifeDaily(current, task, ref.dateKey));
    return ref.notePath;
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

  // TODO(legacy-data-migration): 日记格式 v1→v2 迁移，仍在活跃写入路径
  //（ensureTaskV2Blocks 调用）。删除会放弃旧版日记的自动迁移。请在确认
  // 所有历史日记均已升级为 v2 块格式后，再移除本函数与 ensureTaskV2Blocks
  // 中的调用分支。
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
    // 旧四段式（work-daily-v2）历史数据专用：目录取持久化路径的父目录，不依赖当前 mode 设置。
    const dir = context.path.includes("/") ? context.path.slice(0, context.path.lastIndexOf("/")) : "";
    if (dir) await this.ensureVaultFolder(dir);
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
      ? { kind: "life-daily", notePath: this.getLifeArchiveTargetPath(oldRef.dateKey), dateKey: oldRef.dateKey, blockId: oldTask.id }
      : { kind: "work-daily-v3", notePath: this.getWorkArchiveTargetPath(oldRef.dateKey), dateKey: oldRef.dateKey, blockId: oldTask.id };
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
    if (ref.kind === "work-daily-v2") await this.app.vault.process(file, (current) => this.replaceTaskBlocksInJournal(current, oldTask, nextTask));
    else await this.app.vault.process(file, (current) => this.upsertTaskInLifeDaily(current, nextTask, ref.dateKey));
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
    if (ref.kind === "work-daily-v2") await this.app.vault.process(file, (current) => this.removeTaskFromJournal(current, { id: taskId }));
    else await this.app.vault.process(file, (current) => this.removeTaskFromLifeDaily(current, taskId, ref.dateKey));
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

  scheduleCanvasNativeConflictReconcile() {
    if (this.canvasNativeConflictDisposed) return;
    // Keep one debounce timer. Workspace emits several layout/active-leaf
    // events for a single native Canvas open/close; resetting the timer for
    // every event needlessly extends that churn and allows overlapping flushes.
    if (this.canvasNativeConflictReconcilePromise) {
      this.canvasNativeConflictReconcileQueued = true;
      return;
    }
    if (this.canvasNativeConflictTimer != null) return;
    this.canvasNativeConflictTimer = window.setTimeout(() => {
      this.canvasNativeConflictTimer = null;
      void this.flushCanvasNativeConflictReconcile();
    }, 120);
  }

  async flushCanvasNativeConflictReconcile() {
    if (this.canvasNativeConflictDisposed) return;
    if (this.canvasNativeConflictReconcilePromise) {
      this.canvasNativeConflictReconcileQueued = true;
      return this.canvasNativeConflictReconcilePromise;
    }
    const run = (async () => {
      if (this.canvasNativeConflictDisposed) return;
      const paths = new Set();
      const deckLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
      for (const leaf of deckLeaves) {
        const runtime = leaf.view && leaf.view.canvasRuntime;
        if (!runtime || typeof runtime.getNativeCanvasPaths !== "function") continue;
        for (const path of runtime.getNativeCanvasPaths()) {
          const normalized = typeof runtime.normalizeCanvasPath === "function"
            ? runtime.normalizeCanvasPath(path)
            : jamDeckInkNormalizePath(path).toLocaleLowerCase("en-US");
          if (normalized) paths.add(normalized);
        }
      }
      const embeddedPaths = new Set(((this.settings && this.settings.widgets) || [])
        .filter((widget) => widget && widget.type === "canvas-embed" && widget.config && typeof widget.config.filePath === "string")
        .map((widget) => jamDeckInkNormalizePath(widget.config.filePath).toLocaleLowerCase("en-US")));
      const previousPaths = this.canvasNativePaths instanceof Set ? this.canvasNativePaths : new Set();
      let changed = false;
      for (const path of embeddedPaths) {
        if (paths.has(path) !== previousPaths.has(path)) {
          changed = true;
          break;
        }
      }
      this.canvasNativePaths = paths;
      if (!changed || this.canvasNativeConflictDisposed) return;
      // Do not call renderAllViews() here. Rebuilding the entire Jam Deck while
      // Obsidian is opening/closing a native Canvas creates another Canvas view
      // during the workspace event and can recurse into a renderer/memory loop.
      // Reconcile only the affected embed shells in place, serially.
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (this.canvasNativeConflictDisposed) break;
        const view = leaf.view;
        if (view && typeof view.reconcileCanvasNativeConflicts === "function") {
          try { await Promise.resolve(view.reconcileCanvasNativeConflicts()); }
          catch (error) { console.error("jam-deck canvas conflict reconcile failed", error); }
        }
      }
    })();
    this.canvasNativeConflictReconcilePromise = run;
    try {
      return await run;
    } finally {
      if (this.canvasNativeConflictReconcilePromise === run) this.canvasNativeConflictReconcilePromise = null;
      if (this.canvasNativeConflictReconcileQueued && !this.canvasNativeConflictDisposed) {
        this.canvasNativeConflictReconcileQueued = false;
        this.scheduleCanvasNativeConflictReconcile();
      }
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
      // 确认轮询：仅在 pending 仍是本次请求时才 poll，避免提前确认后的幽灵回调。
      const confirmPoll = (delay) => {
        window.setTimeout(() => {
          if (!this.musicPending || this.musicPending.id !== pending.id) return;
          void this.pollMusicMedia(true);
        }, delay);
      };
      confirmPoll(220);
      confirmPoll(900);
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
    const id = `${type}-${Date.now()}`;
    const config = type === "browser" ? { url: "" }
      : type === "music" ? { mediaSourceId: "", musicSchemaVersion: 1 }
        : {};
    const minimum = jamDeckWidgetDisplayMinimum(type) || { w: JAM_DECK_WIDGET_MIN_W, h: JAM_DECK_WIDGET_MIN_H };
    const fullSpace = this.findSpace(this.settings.widgets, def.w, def.h, 1, 1);
    const minimumSpace = fullSpace ? null : this.findSpace(this.settings.widgets, minimum.w, minimum.h, 1, 1);
    let nextWidgets = null;
    let compressedVictim = null;
    if (fullSpace) {
      nextWidgets = this.settings.widgets.map((widget) => ({ ...widget })).concat({ id, type, ...fullSpace, config });
    } else if (minimumSpace) {
      nextWidgets = this.settings.widgets.map((widget) => ({ ...widget })).concat({ id, type, ...minimumSpace, config });
    } else {
      const inserted = jamDeckInsertWidgetByCompressingLargest(this.settings.widgets, {
        id,
        type,
        x: 1,
        y: 1,
        w: minimum.w,
        h: minimum.h,
        config,
      });
      if (inserted) {
        nextWidgets = inserted.layout;
        compressedVictim = inserted.victimId;
      }
    }
    if (!nextWidgets) {
      new Notice("Jam Deck：没有组件能在机械最小尺寸内继续让位，布局未更改");
      return;
    }
    const previous = this.settings.widgets;
    this.settings.widgets = nextWidgets;
    try {
      await this.saveSettings();
    } catch (error) {
      this.settings.widgets = previous;
      this.renderAllViews();
      new Notice("Jam Deck：添加组件保存失败，布局已恢复");
      return;
    }
    this.renderAllViews();
    if (compressedVictim) new Notice("Jam Deck：已压缩当前最大组件并插入新组件");
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

  async saveDefaultLayout() {
    if (!jamDeckWidgetLayoutCollisionFree(this.settings.widgets)) {
      new Notice("Jam Deck：当前布局有重叠，保存已取消");
      return;
    }
    this.settings.savedLayout = jamDeckSnapshotWidgetLayout(this.settings.widgets);
    await this.saveSettings();
    new Notice("Jam Deck：已保存为默认布局");
  }

  async autoArrange() {
    const restored = jamDeckRestoreDefaultWidgetLayout(
      this.settings.widgets,
      jamDeckLayoutPresets(this.settings.savedLayout),
    );
    let layout = restored.layout.map((item) => ({ ...item }));
    for (const extra of restored.extras) {
      const def = WIDGET_DEFS[extra.type];
      const minimum = jamDeckWidgetDisplayMinimum(extra.type) || { w: JAM_DECK_WIDGET_MIN_W, h: JAM_DECK_WIDGET_MIN_H };
      const width = Number(extra.w) >= minimum.w ? extra.w : (def && def.w) || minimum.w;
      const height = Number(extra.h) >= minimum.h ? extra.h : (def && def.h) || minimum.h;
      const fullSpace = this.findSpace(layout, width, height, 1, 1);
      const minimumSpace = fullSpace ? null : this.findSpace(layout, minimum.w, minimum.h, 1, 1);
      if (fullSpace) {
        layout.push({ ...extra, ...fullSpace });
        continue;
      }
      if (minimumSpace) {
        layout.push({ ...extra, ...minimumSpace });
        continue;
      }
      const inserted = jamDeckInsertWidgetByCompressingLargest(layout, {
        ...extra,
        x: 1,
        y: 1,
        w: minimum.w,
        h: minimum.h,
      });
      if (!inserted || !jamDeckWidgetLayoutCollisionFree(inserted.layout)) {
        new Notice("Jam Deck：额外组件无法放入默认布局，整理已取消");
        return;
      }
      layout = inserted.layout;
    }
    if (!jamDeckWidgetLayoutCollisionFree(layout)) {
      new Notice("Jam Deck：整理后布局无效，已取消");
      return;
    }
    this.settings.widgets = layout;
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

  localShortcutLinkRel(shortcutId) {
    if (!/^sc-[A-Za-z0-9_-]+$/.test(String(shortcutId || ""))) return null;
    return `${SHORTCUT_LINK_DIR}/${shortcutId}.lnk`;
  }

  absoluteFromVaultRel(rel) {
    const pathApi = require("path");
    const adapter = this.app && this.app.vault && this.app.vault.adapter;
    if (!adapter || typeof adapter.getBasePath !== "function") throw new Error("vault base path unavailable");
    return pathApi.resolve(adapter.getBasePath(), rel);
  }

  async ensureShortcutLinkDir() {
    const { vault } = this.app;
    if (!vault.getAbstractFileByPath(SHORTCUT_LINK_DIR)) {
      try { await vault.createFolder(SHORTCUT_LINK_DIR); } catch (error) {}
    }
  }

  createWindowsShortcutFile(destAbs, targetAbs) {
    const { exec } = require("child_process");
    const pathApi = require("path");
    const safeDest = String(destAbs).replace(/'/g, "''");
    const safeTarget = String(targetAbs).replace(/'/g, "''");
    let workDir = "";
    try { workDir = pathApi.dirname(targetAbs).replace(/'/g, "''"); } catch (error) {}
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${safeDest}'); $s.TargetPath='${safeTarget}'; if('${workDir}'){ $s.WorkingDirectory='${workDir}' }; $s.Save()`;
    const encoded = Buffer.from(ps, "utf16le").toString("base64");
    return new Promise((resolve) => {
      exec(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 15000 }, () => resolve());
    });
  }

  async persistLocalShortcutLink(absolutePath, shortcutId) {
    const rel = this.localShortcutLinkRel(shortcutId);
    if (!rel || !absolutePath) return null;
    const adapter = this.app && this.app.vault && this.app.vault.adapter;
    if (!adapter || typeof adapter.getBasePath !== "function") return null;
    let fs;
    let pathApi;
    try {
      fs = require("fs");
      pathApi = require("path");
    } catch (error) {
      return null;
    }
    try {
      await this.ensureShortcutLinkDir();
      const destAbs = this.absoluteFromVaultRel(rel);
      const destDir = pathApi.dirname(destAbs);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const source = pathApi.resolve(absolutePath);
      if (pathApi.extname(source).toLowerCase() === ".lnk") {
        if (source.replace(/[\\/]+/g, "\\").toLowerCase() !== destAbs.replace(/[\\/]+/g, "\\").toLowerCase()) fs.copyFileSync(source, destAbs);
      } else {
        await this.createWindowsShortcutFile(destAbs, source);
      }
      return fs.existsSync(destAbs) ? rel : null;
    } catch (error) {
      console.error("jam-deck local shortcut record failed", error);
      return null;
    }
  }

  resolveOpenableShortcutPath(shortcut) {
    if (this.isUrlShortcut(shortcut)) return this.getShortcutTarget(shortcut);
    let fs;
    try { fs = require("fs"); } catch (error) { return String(shortcut && shortcut.path || ""); }
    const original = String(shortcut && shortcut.path || "");
    const rel = this.normalizeShortcutIconPath(shortcut && shortcut.localPath);
    let localAbs = "";
    if (rel) {
      try { localAbs = this.absoluteFromVaultRel(rel); } catch (error) {}
    }
    const exists = (value) => {
      try { return !!(value && fs.existsSync(value)); } catch (error) { return false; }
    };
    if (exists(original)) return original;
    if (exists(localAbs)) return localAbs;
    return localAbs || original;
  }

  async ensureLocalShortcutRecords() {
    return this.enqueueShortcutMutation(async () => {
      let fs;
      try { fs = require("fs"); } catch (error) { return false; }
      let changed = false;
      for (const shortcut of this.getAllShortcuts()) {
        if (!shortcut || this.isUrlShortcut(shortcut) || shortcut.localPath || !shortcut.path) continue;
        try { if (!fs.existsSync(shortcut.path)) continue; } catch (error) { continue; }
        const localPath = await this.persistLocalShortcutLink(shortcut.path, shortcut.id);
        if (!localPath) continue;
        shortcut.localPath = localPath;
        changed = true;
      }
      if (!changed) return false;
      try {
        await this.saveSettings();
      } catch (error) {
        console.error("jam-deck shortcut local records save failed", error);
        return false;
      }
      return true;
    });
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
    const localPaths = [];
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
        const localPath = await this.persistLocalShortcutLink(absolutePath, id);
        if (localPath) localPaths.push(localPath);
        added.push({ id, name, path: absolutePath, isFolder, iconPath, localPath: localPath || null });
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
      await this.removeVaultFiles([...iconPaths, ...localPaths]);
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
        delete next.localPath;
        if (!existing) widget.config.shortcuts.push(next);
      } else {
        const isFolder = !/\.(exe|lnk|bat|cmd|app)$/i.test(path);
        let iconPath = existing ? this.resolveShortcutIconPath(existing) || existing.iconPath || null : null;
        if (!isFolder && (!existing || existing.path !== path || !iconPath)) iconPath = await this.extractExeIcon(path, id);
        let localPath = existing && existing.path === path ? existing.localPath || null : null;
        if (!localPath) localPath = await this.persistLocalShortcutLink(path, id);
        const next = existing || { id };
        Object.assign(next, { name, path, isFolder, iconPath, localPath: localPath || null });
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
      await this.cleanupManagedShortcutLink(shortcut);
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

  async cleanupManagedShortcutLink(shortcut) {
    const rel = this.normalizeShortcutIconPath(shortcut && shortcut.localPath) || this.localShortcutLinkRel(shortcut && shortcut.id);
    if (!rel || !shortcut || !/^sc-[A-Za-z0-9_-]+$/.test(String(shortcut.id || ""))) return false;
    const prefix = `${SHORTCUT_LINK_DIR}/`;
    if (!rel.toLowerCase().startsWith(prefix.toLowerCase())) return false;
    const relative = rel.slice(prefix.length);
    if (relative.includes("/") || relative.toLowerCase() !== `${String(shortcut.id).toLowerCase()}.lnk`) return false;
    const targetKey = rel.normalize("NFC").toLowerCase();
    const shared = this.getAllShortcuts().some((item) => {
      const exact = this.normalizeShortcutIconPath(item && item.localPath);
      return exact && exact.normalize("NFC").toLowerCase() === targetKey;
    });
    if (shared) return false;
    let fs;
    let pathApi;
    try {
      fs = require("fs");
      pathApi = require("path");
      const base = this.app.vault.adapter.getBasePath();
      const dirReal = fs.realpathSync(pathApi.resolve(base, SHORTCUT_LINK_DIR));
      const fileReal = fs.realpathSync(pathApi.resolve(base, rel));
      const realRelative = pathApi.relative(dirReal, fileReal);
      if (!realRelative || realRelative.startsWith("..") || pathApi.isAbsolute(realRelative) || realRelative.includes(pathApi.sep)) return false;
    } catch (error) {
      return false;
    }
    const file = this.app.vault.getAbstractFileByPath(rel);
    if (file) {
      try {
        if (this.app.fileManager && typeof this.app.fileManager.trashFile === "function") await this.app.fileManager.trashFile(file);
        else await this.app.vault.delete(file);
        return true;
      } catch (error) {
        console.error("jam-deck managed shortcut record cleanup failed", error);
        return false;
      }
    }
    try {
      fs.unlinkSync(pathApi.resolve(this.app.vault.adapter.getBasePath(), rel));
      return true;
    } catch (error) {
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
      const target = this.resolveOpenableShortcutPath(shortcut);
      if (!target) {
        new Notice("Jam Deck：无法打开，请检查路径");
        return false;
      }
      const error = await shell.openPath(target);
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
JamDeckPlugin.CanvasFolderController = CanvasFolderController;
JamDeckPlugin.CanvasSelectionToolbarController = CanvasSelectionToolbarController;
JamDeckPlugin.isNativeCanvasFocusButton = jamDeckIsNativeCanvasFocusButton;
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
  previewLogicalSize: jamDeckCanvasStackPreviewLogicalSize,
  presentEdgeHop: jamDeckCanvasPresentEdgeHop,
  bystanderShift: jamDeckCanvasStackBystanderShift,
};
JamDeckPlugin.canvasFolderGeometry = {
  schema: jamDeckCanvasFolderSchema,
  stableId: jamDeckCanvasFolderStableId,
  shellDropRatio: jamDeckCanvasFolderShellDropRatio,
  clientPointInRect: jamDeckClientPointInRect,
  memberSort: jamDeckCanvasFolderMemberSort,
  representatives: jamDeckCanvasFolderRepresentatives,
  representativeColumns: jamDeckCanvasFolderRepresentativeColumns,
  representativeSlot: jamDeckCanvasFolderRepresentativeSlot,
  representativeSlots: JAM_DECK_CANVAS_FOLDER_REPRESENTATIVE_SLOTS,
  expansionColumns: jamDeckCanvasFolderExpansionColumns,
  bounds: jamDeckCanvasFolderBounds,
  gridLayout: jamDeckCanvasFolderGridLayout,
  path: jamDeckCanvasFolderPath,
  pathEquivalent: jamDeckCanvasFolderPathEquivalent,
  dataKey: jamDeckCanvasFolderDataKey,
  colors: JAM_DECK_CANVAS_FOLDER_COLORS.slice(),
  schemaVersion: JAM_DECK_CANVAS_FOLDER_SCHEMA_VERSION,
  maxRepresentatives: JAM_DECK_CANVAS_FOLDER_MAX_REPRESENTATIVES,
};
JamDeckPlugin.widgetLayoutHelpers = {
  displayMinimum: jamDeckWidgetDisplayMinimum,
  isCompact: jamDeckWidgetIsCompact,
  resolveRestore: jamDeckResolveWidgetRestoreLayout,
  overlap: jamDeckWidgetRectsOverlap,
  boundsOk: jamDeckWidgetLayoutBoundsOk,
  collisionFree: jamDeckWidgetLayoutCollisionFree,
  restoreDefault: jamDeckRestoreDefaultWidgetLayout,
  snapshot: jamDeckSnapshotWidgetLayout,
  layoutPresets: jamDeckLayoutPresets,
  pointInRect: jamDeckPointInRect,
  collectSlots: jamDeckCollectFillSlots,
  pickSlot: jamDeckPickFillSlot,
  applySlot: jamDeckApplyFillSlot,
  insertByLargest: jamDeckInsertWidgetByCompressingLargest,
  findSeam: jamDeckFindPushSeam,
  applySeam: jamDeckApplyPushSeam,
  scaleColumns: jamDeckScaleWidgetColumns,
  collectSashes: jamDeckCollectLayoutSashes,
  collectNodes: jamDeckCollectLayoutNodes,
  applySash: jamDeckApplySashDelta,
  resizeCorner: jamDeckResizeWidgetAtCorner,
  preview: jamDeckPreviewWidgetLayout,
  minW: JAM_DECK_WIDGET_MIN_W,
  minH: JAM_DECK_WIDGET_MIN_H,
  cols: GRID_COLS,
  rows: GRID_ROWS,
};
JamDeckPlugin.clampAiFabPosition = jamDeckClampAiFabPosition;

class JamDeckSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Jam Deck" });
    containerEl.createEl("p", { text: "副屏工作台 · AI 对话助手（DeepSeek / 千问）", cls: "jam-deck-setting-hint" });

    new Setting(containerEl)
      .setName("动画效果")
      .setDesc("工作台与画布组件动效（展开/收起/悬浮/翻牌等）。默认开启，且不再跟随系统「减少动态效果」；关闭后停用全部动画。")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.animationsEnabled !== false).onChange(async (value) => {
          this.plugin.settings.animationsEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.applyAnimationSetting();
        });
      });

    containerEl.createEl("h3", { text: "DeepSeek（文本）", cls: "jam-deck-setting-h3" });

    new Setting(containerEl)
      .setName("DeepSeek API Key")
      .setDesc("用于 AI 对话（待办操作、翻译、问答）。在 platform.deepseek.com 创建（sk- 开头）；只保存在本地 data.json，不上传。")
      .addText((text) => {
        text.setPlaceholder("sk-…").setValue(this.plugin.settings.aiApiKey).onChange(async (value) => {
          this.plugin.settings.aiApiKey = value.trim();
          await this.plugin.saveSettings();
        });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("DeepSeek 模型")
      .setDesc("deepseek-v4-flash 快速便宜（推荐）；deepseek-v4-pro 推理更强。")
      .addDropdown((dropdown) => {
        dropdown.addOption("deepseek-v4-flash", "deepseek-v4-flash（推荐）");
        dropdown.addOption("deepseek-v4-pro", "deepseek-v4-pro");
        dropdown.setValue(this.plugin.settings.aiModel || "deepseek-v4-flash");
        dropdown.onChange(async (value) => {
          this.plugin.settings.aiModel = value;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("h3", { text: "千问（多模态，可看图）", cls: "jam-deck-setting-h3" });

    new Setting(containerEl)
      .setName("千问 API Key")
      .setDesc("Token Plan 用户：在 Token Plan 控制台「我的订阅」生成专属 key（sk-sp- 开头），插件自动走专属端点。按量付费用户：百炼 API-KEY 管理（sk- 开头）。只存本地 data.json，不上传。")
      .addText((text) => {
        text.setPlaceholder("sk-sp-… 或 sk-…").setValue(this.plugin.settings.qwenApiKey).onChange(async (value) => {
          this.plugin.settings.qwenApiKey = value.trim();
          await this.plugin.saveSettings();
        });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("千问模型")
      .setDesc("qwen3.8-max 旗舰（2026-08-03 发布，原生多模态，推荐）；qwen3.8-max-preview 预览名；qwen-vl-max 视觉稳定版。")
      .addDropdown((dropdown) => {
        dropdown.addOption("qwen3.8-max", "qwen3.8-max（推荐）");
        dropdown.addOption("qwen3.8-max-preview", "qwen3.8-max-preview");
        dropdown.addOption("qwen-vl-max", "qwen-vl-max");
        dropdown.addOption("qwen-vl-plus", "qwen-vl-plus");
        dropdown.addOption("qwen3-vl-plus", "qwen3-vl-plus");
        dropdown.setValue(this.plugin.settings.qwenModel || "qwen3.8-max");
        dropdown.onChange(async (value) => {
          this.plugin.settings.qwenModel = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("当前模型")
      .setDesc("AI 对话窗标题旁的按钮也可随时切换。DeepSeek 处理文本；千问可识别图片。")
      .addDropdown((dropdown) => {
        dropdown.addOption("deepseek", "DeepSeek（文本）");
        dropdown.addOption("qwen", "千问（多模态）");
        dropdown.setValue(this.plugin.settings.aiProvider || "deepseek");
        dropdown.onChange(async (value) => {
          this.plugin.settings.aiProvider = value;
          await this.plugin.saveSettings();
          new Notice(`Jam Deck：AI 默认模型已切换为 ${value === "qwen" ? "千问" : "DeepSeek"}`);
        });
      });

    containerEl.createEl("h3", { text: "本地工作区", cls: "jam-deck-setting-h3" });

    new Setting(containerEl)
      .setName("工作区路径")
      .setDesc("AI 弹窗「本地工作区」页交给 DeepSeek Harness 读写的目录。留空则使用当前 Vault。须为绝对路径。只存本地 data.json。")
      .addText((text) => {
        text.setPlaceholder("留空则使用当前 Vault")
          .setValue(this.plugin.settings.aiLocalWorkspacePath || "")
          .onChange(async (value) => {
            this.plugin.settings.aiLocalWorkspacePath = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.setAttr("spellcheck", "false");
      })
      .addButton((button) => {
        button.setButtonText("使用当前库").onClick(async () => {
          const path = jamDeckVaultBasePath(this.plugin.app);
          if (!jamDeckCanonicalWindowsPath(path)) {
            new Notice("Jam Deck：当前库没有可用的绝对路径");
            return;
          }
          this.plugin.settings.aiLocalWorkspacePath = path;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    containerEl.createEl("h3", { text: "归档路径", cls: "jam-deck-setting-h3" });

    const buildArchiveModeRow = (label, modeKey, fileKey, dirKey, defaultFile, defaultDir, filePlaceholder, dirPlaceholder) => {
      const row = new Setting(containerEl)
        .setName(label)
        .setDesc("文件 = 单个 Markdown 按日期分节；目录 = 每天一个 YYYY-MM-DD.md。")
        .addDropdown((dropdown) => {
          dropdown.addOption("file", "文件");
          dropdown.addOption("dir", "目录");
          dropdown.setValue(this.plugin.settings[modeKey] === "dir" ? "dir" : "file");
          dropdown.onChange(async (value) => {
            this.plugin.settings[modeKey] = value;
            await this.plugin.saveSettings();
            refreshArchiveRows();
          });
        });
      const fileRow = new Setting(containerEl)
        .setName(`${label} · 文件路径`)
        .setDesc("归档到单个 Markdown 文件，按日期标题分节。")
        .addText((text) => {
          text.setPlaceholder(filePlaceholder)
            .setValue(this.plugin.settings[fileKey] || defaultFile)
            .onChange(async (value) => {
              this.plugin.settings[fileKey] = value.trim();
              await this.plugin.saveSettings();
            });
        });
      const dirRow = new Setting(containerEl)
        .setName(`${label} · 目录路径`)
        .setDesc("归档到目录下按日期生成的 YYYY-MM-DD.md。")
        .addText((text) => {
          text.setPlaceholder(dirPlaceholder)
            .setValue(this.plugin.settings[dirKey] || defaultDir)
            .onChange(async (value) => {
              this.plugin.settings[dirKey] = value.trim();
              await this.plugin.saveSettings();
            });
        });
      return { row, fileRow, dirRow, modeKey };
    };

    const workRow = buildArchiveModeRow(
      "工作归档形式", "workArchiveMode", "workArchiveFile", "workArchiveDir",
      "Work/工作.md", WORK_JOURNAL_DIR, "Work/工作.md", "Work/工作日记"
    );
    const lifeRow = buildArchiveModeRow(
      "生活归档形式", "lifeArchiveMode", "lifeArchivePath", "lifeArchiveDir",
      LIFE_DAILY_PATH, "Life/生活日记", "Life/Daily.md", "Life/生活日记"
    );
    const refreshArchiveRows = () => {
      const workMode = this.plugin.settings.workArchiveMode === "dir" ? "dir" : "file";
      const lifeMode = this.plugin.settings.lifeArchiveMode === "dir" ? "dir" : "file";
      workRow.fileRow.settingEl.style.display = workMode === "file" ? "" : "none";
      workRow.dirRow.settingEl.style.display = workMode === "dir" ? "" : "none";
      lifeRow.fileRow.settingEl.style.display = lifeMode === "file" ? "" : "none";
      lifeRow.dirRow.settingEl.style.display = lifeMode === "dir" ? "" : "none";
    };
    refreshArchiveRows();
  }
}

JamDeckPlugin.nextCanvasFileName = jamDeckNextCanvasFileName;
JamDeckPlugin.canonicalWindowsPath = jamDeckCanonicalWindowsPath;
JamDeckPlugin.localWorkspacePath = jamDeckLocalWorkspacePath;
JamDeckPlugin.dshValue = jamDeckDshValue;
JamDeckPlugin.dshRpc = jamDeckDshRpc;
JamDeckPlugin.prepareDshWorkspace = jamDeckPrepareDshWorkspace;
JamDeckPlugin.AI_LOCAL_WEB_URL = AI_LOCAL_WEB_URL;
JamDeckPlugin.selectedCanvasNodes = jamDeckSelectedCanvasNodes;
JamDeckPlugin.canvasExportHelpers = {
  isMedia: jamDeckIsCanvasExportableMedia,
  files: jamDeckSelectedExportableCanvasFiles,
  uniquePath: jamDeckUniqueOsCopyPath,
  imageExtensions: JAM_DECK_CANVAS_IMAGE_EXTENSIONS,
  videoExtensions: JAM_DECK_CANVAS_VIDEO_EXTENSIONS,
};
module.exports = JamDeckPlugin;
