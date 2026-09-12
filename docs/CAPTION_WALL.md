# 字幕墙

在 Jam Deck「+ 添加」中选择「字幕墙」。一个纸面文本窗口，两种模式；较小尺寸只显示组件水印，点击可恢复。

## 转录

- 「开始转录」采集 Windows 默认播放设备的系统声音，耳机也可用。按句显示相对时间，临时识别文字为浅色，落句后变为正文。
- 「翻译」只将当前已落句且未翻译的文字发给 DeepSeek，并原位换成中文。翻译期间产生的新句保留，下一次点击再翻译。暂停会刷新最后一句。
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

Windows x64 / Python 3.12：

```powershell
npm run setup:captions
npm run verify
npm run deploy -- -TargetPluginDir <Jam Deck 插件目录>
```

安装器只在开发源 `.cache` 中创建独立 Python 环境，下载官方中英双语流式 Zipformer 模型；不会把数百 MB 模型装入 Vault。运行位置通过 `.cache/caption-runtime.json` 随部署脚本传入插件。移动开发源后重新运行安装与部署。模型包约 437 MiB（同时含浮点与量化文件）；实际引擎使用 INT8 encoder/joiner、CPU 两线程。

运行依赖固定为 Sherpa-ONNX 1.12.40、PyAudioWPatch 0.2.12.8、NumPy 2.2.6。音频仅驻留本机内存；只有主动翻译或跟读中的语义定位发送文本到 DeepSeek，复用 Jam Deck 已配置的 Key 和模型。使用 Windows 默认输入/输出设备，切换设备后暂停再启动。

远程桌面需要启用录音重定向并让 Windows 有默认麦克风；没有输入设备时界面会显示原因。不能用系统播放回环冒充麦克风。

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
- `scripts/caption-bridge.py`：独立本地识别进程，JSONL 输出，stdin stop/EOF 释放音频设备；超过关闭等待时间由宿主终止。
- `npm run verify` 包含字幕墙解析、匹配、持久化与竞态回归。`--wav` 可使用同一引擎对官方 PCM16 测试音频进行离线流式验证。

2026-09-13 实测：官方中英 WAV 的 partial/final、真实默认播放设备回环、正常退出、Obsidian 热重载、真实 DeepSeek 翻译与语义定位、归档及时间滚动均验证。当前 RDP 会话没有默认麦克风，真实麦克风说话跟读尚未完成实机验收；相应无设备错误已明确显示。
