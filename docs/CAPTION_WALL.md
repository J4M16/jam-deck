# 字幕墙

在 Jam Deck「+ 添加」中选择「字幕墙」。一个纸面文本窗口，两种模式；较小尺寸只显示组件水印，点击可恢复。

## 转录

- 标题栏切换「转录 / 跟读」；圆形 ▶ / ⏸ 按钮开始或暂停采集。转录模式采集 Windows / macOS 默认播放设备的系统声音，耳机也可用。按句显示相对时间，临时识别文字为浅色，落句后变为正文。
- 「翻译」将当前已落句且未翻译的文字发给 DeepSeek，并原位换成中文。
- 开启旁边「自动」后，每段定稿即送翻译，翻译期间继续显示下一段实时字幕，完成后自动处理排队的新句。关闭后完成当前请求，不再启动后续自动请求。暂停采集仍处理最后一句；翻译失败保留原文并暂停自动翻译，可重新开启或手动重试。
- 自动翻译开关会保存；重新打开组件不会自行联网，点击开始采集后继续。全大写英文恢复句首大写，保留 I、AI、GPU 等常用缩写及原始识别文本。
- 「归档」把点击当时的完整可见文本保存为 `Work/字幕墙/字幕 <时间>-<随机标识>.md`，保留时间戳和当前译文，不清空窗口。
- 「复制」复制当前显示内容；「清空」停止采集并清空本组件草稿，旧音频回调与未完成的翻译不会写回。
- 手动向上滚动会暂停自动追尾，点击「跟随滚动」恢复。草稿通过插件的正常设置保存队列保存，热重载后恢复文字但不会自动开启录音。

## 跟读

- 选择 Vault 内的 Markdown、TXT、SRT 或 VTT。原笔记只读。
- 支持 `[MM:SS]`、`[HH:MM:SS]`、毫秒以及 SRT/VTT 时间行。「按时间播放」从当前进度计时，暂停后可继续；点击有时间戳的行可跳转。
- 「监听麦克风」启动同一个本地流式引擎；正文以细线和字重标出当前行，下方显示实际识别文字。
- 正常照稿读时使用本地字符对齐，容忍少量吞字和重复识别。临时结果从稳定锚点重算，落句才提交；较长的完整回读允许向前文重新定位。
- 偏离稿件时，间隔至少 4 秒、每次最多一个 DeepSeek 请求，做语义定位。低置信度不跳转；新本地匹配、手动选行、更换笔记和关闭组件会让旧定位结果失效。
- 有效语音定位暂停时间播放，避免两个滚动来源争抢。也可以只使用按时间播放。
- 18,000 字符内的笔记整篇参与语义定位；更长的笔记按当前位置和本地文本相似度挑选候选行。模型判断不是逐字校对，可能无法判断未涉及稿件的讲话。

## 首次安装

0.32.2 起采用基础包与可选字幕扩展分发。基础插件没有字幕扩展也可正常启动，不会下载模型。支持 Windows x64 与 macOS 14.2+（Apple Silicon / Intel）；Mac 目标机为 M5、最新系统，当前尚待真实设备验收。Windows 需要 Python 3.12 x64；Mac 需要对应芯片的 Python 3.12，Apple 芯片使用原生 arm64 环境。

1. 从同一版本 GitHub Release 下载 `jam-deck-captions-<版本>.zip`，解压到 `.obsidian/plugins/jam-deck/`。它只包含字幕代码、安装脚本和说明，不含模型或个人路径。
2. 在该插件目录打开终端，按系统运行安装器。Windows PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-captions.ps1
```

Mac 终端（无需 Node.js、Xcode 或虚拟声卡）：

```bash
bash scripts/setup-captions.sh
```

Mac 已安装 Homebrew 的用户可以先用 `brew install python@3.12` 安装原生 Python。未使用 Homebrew 可从 [Python 官网](https://www.python.org/downloads/macos/)安装 3.12 的 macOS universal2 版本。Python 不在 PATH 时：

```bash
PYTHON="/绝对路径/python3.12" bash scripts/setup-captions.sh
```

3. 安装成功后在 Obsidian 关闭再启用 Jam Deck，添加「字幕墙」并点击播放。已有扩展用户升级时下载与基础插件相同版本的扩展 ZIP；引擎无需重复下载。

Windows 引擎默认安装到 `%LOCALAPPDATA%\JamDeck\captions`；Mac 安装到 `~/Library/Application Support/JamDeck/captions`。均放在 Vault 外，同一用户的多个库可复用。插件内仅生成 `.cache/caption-runtime-win32.json` 或 `.cache/caption-runtime-darwin.json` 路径记录，两个系统互不覆盖；不写入或覆盖 `data.json`。切换电脑后在那台电脑运行一次安装器，不复制另一台电脑的 Python 路径。0.32.2 升级用户也需重跑一次安装器登记新的路径文件，已校验的模型不会重复下载。Windows 可用 `-Python <python.exe绝对路径>`、`-InstallDir <目录>`；Mac 用 `--install-dir "<目录>"` 指定引擎位置。引擎缺失时字幕区提示安装，其余组件继续工作；未安装引擎也能阅读笔记和按时间滚动。

安装器从上游官方 Release 下载约 437 MiB 压缩包，校验固定 SHA-256，只提取实际使用的 tokens、INT8 encoder、浮点 decoder、INT8 joiner 四个文件（约 57.4 MiB），然后删除临时下载包。不会解出 64/96 重复模型或其他精度版本。Windows 实测 Python 环境约 109 MiB，完整引擎约 167 MiB；Mac 依赖大小不同，尚无实机体积测量。Python 本体若尚未安装需要另外安装。首次下载流量仍约 437 MiB 加 Python 依赖，不把它冒称成 57 MiB 下载。

开发者从源码安装与部署（以下部署命令用于 Windows 开发机；安装入口和 verify / package 会按系统选择 Python）：

```powershell
npm run setup:captions
npm run verify
npm run deploy -- -TargetPluginDir <Jam Deck 插件目录>
npm run package
```

本机已有引擎可运行 `npm run setup:captions -- -InstallDir <已有引擎父目录>` 重新验证并登记位置。源码目录的运行路径只供本机部署；公开 ZIP 使用严格文件白名单，排除 `.cache`、模型、Python、个人路径记录与 `data.json`。本地打包产物不等于正式 Release，发布仍需维护者确认。

公共识别依赖固定为 Sherpa-ONNX 1.12.40、NumPy 2.2.6；Windows 采集使用 PyAudioWPatch 0.2.12.8；Mac 麦克风使用 sounddevice 0.5.5（wheel 自带 PortAudio），系统声音使用 AudioTee 0.0.7 的 universal 二进制，安装器从作者的 npm 包按固定 SHA-256 校验提取，仅约 591 KiB。音频仅驻留本机内存；手动翻译、开启自动翻译后的定稿段落以及跟读中的语义定位会发送文本到 DeepSeek，复用 Jam Deck 已配置的 Key 和模型。使用当前系统的默认输入/输出设备，切换设备后暂停再启动。

远程桌面需要启用录音重定向并让 Windows 有默认麦克风；没有输入设备时界面会显示原因。不能用系统播放回环冒充麦克风。

## Mac 首次使用与验收

- 点击「转录」播放后，允许 Obsidian 采集系统声音；首次权限弹窗最长等待两分钟。若已拒绝或一直没有文字，到系统设置 → 隐私与安全性 → 屏幕与系统音频录制中检查 Obsidian，授权后完全退出并重开 Obsidian，再播放有声音的视频测试。不同系统版本可能显示「仅系统音频录制」。
- 「跟读」需要单独的麦克风权限：在隐私与安全性 → 麦克风中允许 Obsidian，并检查系统默认输入设备。终端测试获得的权限不等于 Obsidian 获得权限。
- 系统声音由 [AudioTee](https://github.com/makeusabrew/audiotee) 使用 Core Audio Taps 采集，要求 macOS 14.2+；不依赖屏幕画面、虚拟声卡或 NVIDIA。识别仍在本机 CPU 上运行，DeepSeek 翻译与 Windows 共用。
- M 系列使用原生 arm64 Python，安装器拒绝 Rosetta Python，避免在 M5 上意外装成 Intel 环境。用户无需编译 AudioTee；已核对所选发行二进制同时包含 arm64 和 x86_64，最低系统为 14.2。
- 尚未完成的实机验收：M5 首次系统音频授权、麦克风授权、播放耳机声音转录、自动翻译连续运行、暂停/热重载后录音释放。Windows 上的协议模拟和回归测试不能代替这几项。

## 方案依据

| GitHub 项目 | 审查结论 | 本组件采用的部分 |
| --- | --- | --- |
| [TMSpeech](https://github.com/jxlpzqc/TMSpeech) | 原引用任务最终推荐的 ONNX 流式路线 | 同底层 Sherpa-ONNX 和 WASAPI 回环，直接建立组件所需的本地音频桥，不依赖它的 GUI |
| [Storm Teleprompter+](https://github.com/html5syt/Storm-Teleprompter-Plus) | v1.6.8 / 648457d，Windows 包 24.2 MB，模型另装；MIT；有中文字符对齐和 ASR 回归测试 | 稳定锚点、临时游标、向前窗口、跳字容错和长句回读；本实现收紧置信度，再接 DeepSeek 语义定位 |
| [Obsidian Teleprompter Plus](https://github.com/JuracyAmerico/obsidian-teleprompter-plus) | 有现成 Obsidian 集成；审查时 `word-tokenizer.ts` 仅识别拉丁/西里尔字母和数字，汉字被当成分隔符 | 不直接复用中文匹配器 |
| [Meeting Teleprompter](https://github.com/pyzskw/meeting-teleprompter) | Windows / Electron / Sherpa-ONNX，MIT，有 v1.0.0 安装包；匹配代码较小 | 对照中文光标推进方案；没有把整个独立应用嵌进插件 |

主要源码依据：[Storm 对齐引擎](https://github.com/html5syt/Storm-Teleprompter-Plus/blob/648457d/lib/services/asr/alignment_engine.dart)、[PyAudioWPatch](https://github.com/s0d3s/PyAudioWPatch)、[官方中英流式模型说明](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html)。项目有发行包和测试不代表中文跟读已无误差，特别是相似重复句、同音词和远场拾音。

## 模块和验证

- `caption-wall.js`：流式进程客户端、会话状态、跟读匹配、时间轴及 DOM 视图。
- `caption-host.js`：Obsidian 笔记读写、选稿、剪贴板、DeepSeek 请求和实例管理。
- `scripts/caption-bridge.py`：独立本地识别进程，JSONL 输出，stdin stop/EOF 释放音频设备；超过关闭等待时间由宿主终止。Mac 的 Python 与采集子进程放在独立进程组，异常退出同样清理。
- `scripts/caption_audio_macos.py`：Mac 系统声音/麦克风采集；验证 PCM 元数据与分帧，队列有上限，停止释放设备。
- `scripts/setup-captions.sh` / `setup-captions-macos.py`：Mac 原生安装、下载校验、只提取必要文件及本机路径登记。
- `npm run verify` 包含字幕墙解析、匹配、持久化与竞态回归。`--wav` 可使用同一引擎对官方 PCM16 测试音频进行离线流式验证。

2026-09-13 实测：官方中英 WAV 的 partial/final、真实默认播放设备回环、正常退出、Obsidian 热重载、真实 DeepSeek 翻译与语义定位、归档及时间滚动均验证。当前 RDP 会话没有默认麦克风，真实麦克风说话跟读尚未完成实机验收；相应无设备错误已明确显示。
