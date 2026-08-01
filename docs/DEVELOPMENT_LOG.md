# Jam Deck 开发日志

## 2026-08-01 — 0.16.0 GameDeck 分支启动：Three.js 草地世界

- Git：在 `GameDeck` 分支提交 Jam Deck 0.15.0 基线后开始分叉；3D 实验只在此分支推进。
- 新增 `game-deck/world.js`（Three.js + OrbitControls）：草地、可拾取音乐盒/日历/图片/文本占位；拖动移动，Alt+拖动缩放。
- `GameDeckWorldView` 注册为 `game-deck-world`，侧栏骰子与命令打开；`scripts/build-world.mjs` 打包出 `game-deck-world.js`，部署脚本允许首次追加该文件。
- 完整 `npm run verify`（含 build:world）通过。
- 处理模型签名：Cursor Grok 4.5（主代理）

## 2026-08-01 — 0.15.0 组件紧凑水印与面积优先自动让位

- 读取当前正式布局并把九类组件现有尺寸固化为各自的最小完整显示阈值；保留机械布局下限 2×2，不迁移个人布局数据。
- 宽或高低于阈值时只渲染主题表面与居中的标题图标水印；Canvas、浏览器、播放器等正文资源仅在最终提交后卸载，拖动预览不提前销毁。
- 点击水印恢复精确阈值尺寸；冲突时按组件占地面积、重叠面积、持久化数组顺序和稳定 ID 依次决胜，优先推挤最大组件并支持连锁让位。
- 自动让位使用确定性有界搜索，优先最少移动组件和最短总位移；无空间、搜索达到保护上限或保存失败均整次回滚，未进入碰撞链的组件保持原位。
- 完整 `npm run verify` 通过；部署过程继续排除个人 `data.json`。
- 处理模型签名：Codex / GPT-5（主代理）；gpt-5.6-sol（Planner）；gpt-5.6-terra（Advisor）

## 2026-08-01 — 0.14.0 非编辑态间距节点拖动

- 新增 `jamDeckCollectLayoutSashes` / `jamDeckCollectLayoutNodes` / `jamDeckApplySashDelta`：收集贴齐的竖缝与横缝，交点生成 `xy` 节点，长缝中点生成单轴节点。
- 非编辑态 `enableLayoutSashes` 在网格上挂透明命中层；鼠标靠近 18px 内才显示小圆点并接收拖动，松手经 `commitWidgetLayout` 写入。
- 同线连续贴齐缝合并，使左栏整列右缘可一次统一移动；拖动增量按最小 2×2 夹紧。
- 回归覆盖十字节点、音乐/快捷方式竖缝、整列 sash 位移与夹紧；完整 `npm run verify` 通过。
- 处理模型签名：Cursor Grok 4.5（主代理）

## 2026-08-01 — 0.13.9 拖动底部 Shift 填充提示

- 拖动时在 `jam-deck-root` 底部挂载 `jam-deck-layout-shift-hint`：白色向上渐变 + 说明文字「按住 Shift 可延伸填充到画布边缘」。
- `setLayoutShiftHintVisible` 与 preview 同步：未按 Shift 显示，按住 Shift 隐藏，pointerup 后收起；不拦截指针事件。
- 完整 `npm run verify` 通过。
- 处理模型签名：Cursor Grok 4.5（主代理）

## 2026-08-01 — 0.13.8 最小尺寸插入与 Shift 边缝填充

- `jamDeckCollectFillSlots` 增加 `includeEdgeSlots`：无后邻的画布边延伸槽默认关闭，仅当 `shiftKey`/`includeEdgeSlots` 为真时收集。
- 拖动悬停时 ghost 与 `jamDeckApplyPushSeam` 一律按 `minW`/`minH` 计算；`enableDrag` 同步把悬浮 DOM 收缩到 2×2，并监听 Shift 的 keydown/keyup 即时刷新预览。
- B/C 之间的空隙矩形填充与零缝两端渐变推挤保持不变；回归覆盖「无 Shift 不触发边缝 / 有 Shift 触发」以及推挤按最小尺寸让位。
- 完整 `npm run verify` 通过。
- 处理模型签名：Cursor Grok 4.5（主代理）

## 2026-08-01 — 0.13.7 网格调整为 40×36

- 按 Jam 指定改为 `GRID_COLS = 40`、`GRID_ROWS = 36`；1920×1080 下每格约 37×23px。不做坐标迁移，现有布局由 Jam 自行重排。
- `grid-template-rows` 的 `minmax` 下限由 28px 降到 12px，否则 36 行会超出工作台高度并压掉底部组件。
- 最小尺寸保持 2×2：现有布局里存在 h2/h3 组件，抬高下限会让 `jamDeckWidgetLayoutCollisionFree` 直接判非法而卡死整个拖放。
- `jamDeckWidgetLayoutBoundsOk` / `jamDeckWidgetLayoutCollisionFree` 增加 `minW`/`minH` 参数并在 fill/push 路径透传；缩放手柄改用最小尺寸常量。
- `JAM_DECK_SEAM_HIT` 由 1.5 调到 2.5 格，补偿格距缩小后的物理判定宽度。
- 回归夹具按各自网格显式传参；完整 `npm run verify` 通过。
- 处理模型签名：Cursor Opus 5（主代理）

## 2026-08-01 — 0.13.6 网格加密到 24 列

- 1920×1080 实测：视图约 1642×962，gap 4px，12 列时每格约 133×50px（2.7:1），横向最小步进过大。
- `GRID_COLS` 改为 24 后每格约 65×50px，接近 1:1；行数维持 18，避免行高被压到 25px 以下。
- `jamDeckScaleWidgetColumns` 在 `loadSettings` 中按 `GRID_COLS / JAM_DECK_LEGACY_GRID_COLS` 迁移旧布局，`dataVersion` 3→4；`DEFAULT_SETTINGS.widgets` 与 `WIDGET_DEFS` 默认宽度同步 ×2。
- 回归夹具改为显式传 `{ cols: 12, rows: 18 }` 与网格常量解耦，另加迁移与 24 列缝插入用例；完整 `npm run verify` 通过。
- 处理模型签名：Cursor Opus 5（主代理）

## 2026-08-01 — 0.13.5 推挤让位改为先平移后缩短

- 实测 `clock(1,1,2,3)` + `launcher(3,1,10,3)` 贴到第 12 列，推挤时 launcher 右移越界导致校验失败并回退悬浮，交互看起来"没反应"。
- 新增 `jamDeckReflowSeamChain`：缝后链条先按原间距整体平移，仅把仍然溢出的量从链首依次吃掉尺寸（不低于最小 2 格），因此贴边邻居会缩短而不是阻断插入。
- 推挤链收敛为与缝交叉轴重叠的那一列/一行；`JAM_DECK_SEAM_HIT` 由 0.85 放宽到 1.5 格，改善命中手感。
- 回归新增贴边横向缩短与满高纵向缩短用例；完整 `npm run verify` 通过。
- 处理模型签名：Cursor Opus 5（主代理）

## 2026-08-01 — 0.13.4 空隙填充与无空隙推挤并存

- 0.13.3 只保留 fill 矩形，导致零缝无法插入。现在 `jamDeckPreviewWidgetLayout` 先尝试 fill slot，未命中时回退 `jamDeckFindPushSeam`。
- 推挤路径恢复 B/C 两端渐变提示，`jamDeckApplyPushSeam` 保持 A 轴向原尺寸、交叉轴对齐邻居，并整体平移缝后组件；拖动中通过 `applyNeighborLayoutPreview` 实时预览。
- 回归覆盖纵/横零缝推挤、fill 优先、无 C 延边与悬空取消；完整 `npm run verify` 通过。
- 处理模型签名：Cursor Opus 5（主代理）

## 2026-08-01 — 0.13.3 悬浮拖动与空隙填充矩形

- 拖动改为整块 `translate3d` 悬浮抬起，邻居保持不动且不做碰撞；仅当指针落入可填充空隙时显示 slot overlay。
- `jamDeckCollectFillSlots` 收集等宽下方空隙与等高右侧空隙（无 C 时延伸到画布底/右）；矩形须不小于最小 2×2，松手按矩形 `x/y/w/h` 提交。
- 回归覆盖纵/横填缝、无 C 延边、零缝不发光、悬空取消；完整 `npm run verify` 通过。
- 0.13.3 已完成受保护部署；`data.json` 保持 `613E9EFF…3F8131`（18672 bytes），备份为 `.obsidian/plugins/.jam-deck-backup-20260801-104836-252d4ba3`。部署时 Obsidian 未运行，已主动启动。
- 处理模型签名：Cursor Grok 4.5（主代理）

## 2026-08-01 — 0.13.2 宽缝直放与零缝推挤

- 仅当 B/C 间距不足以放下 A 原尺寸时才进入 forced seam：亮渐变并以推挤链让位；宽缝改走自由放置，禁止吸附重排。
- 零缝插入改为保持 A 原高度/宽度（交叉轴对齐 B/C），C/D/E 整体平移下移或右移，不再偷取尺寸导致拖不进去。
- 回归覆盖零缝纵/横推挤、宽缝不发光不吸附、越界失败与空白自由移动；完整 `npm run verify` 通过。
- 0.13.2 已完成受保护部署；`data.json` 保持 `38CD433E…E3A4A1`（18669 bytes），备份为 `.obsidian/plugins/.jam-deck-backup-20260801-103615-edefb2f1`。部署时 Obsidian 未运行，已主动启动。
- 处理模型签名：Cursor Grok 4.5（主代理）

## 2026-08-01 — 0.13.1 缝插入与次第缩短

- 按用户反馈重写编辑拖放：拖动幽灵保持原宽高并加悬浮阴影；命中等宽纵缝或等高横缝时，相邻边亮浅绿渐变。
- 松手插入改为定向让位：纵缝采用 B/C 宽度与最小高度，横缝采用 B/C 高度与最小宽度；从 C 起向 D/E 次第偷取尺寸并紧凑重排，取代 0.13.0 整带等分。
- 回归覆盖纵缝、横缝、C 已最小时的级联缩短、满行失败与空白自由移动；完整 `npm run verify` 通过。
- 0.13.1 已完成受保护部署；`data.json` 保持 `3D2EF661…6608F5`（18671 bytes），备份为 `.obsidian/plugins/.jam-deck-backup-20260801-102624-9d449103`。部署时 Obsidian 未运行，已主动启动。
- 处理模型签名：Cursor Grok 4.5（主代理）

## 2026-08-01 — 0.13.0 工作台组件推挤自适应布局

- 编辑模式拖动从碰撞红框改为插入式磁贴重排：识别落点行带后整带等宽均分，其余冲突组件连锁下推，松手一次 `commitWidgetLayout` 持久化。
- 抽出 `jamDeckEqualSplitRow` / `jamDeckPushDownResolve` / `jamDeckPreviewWidgetLayout` 纯函数并导出 `widgetLayoutHelpers`；覆盖横缝等宽、下推无重叠、最小宽失败与越界失败回归。
- 拖动预览使用轻量插入细线与短过渡，遵循 `prefers-reduced-motion`；缩放手柄仍走原碰撞逻辑。完整 `npm run verify` 通过。
- 0.13.0 已完成受保护部署；`data.json` 保持 `7A376097…705F39`（21862 bytes），备份为 `.obsidian/plugins/.jam-deck-backup-20260801-101004-3f9ebc07`。部署时 Obsidian 未运行，已主动启动。
- 处理模型签名：Cursor Grok 4.5（主代理）

## 2026-08-01 — 部署启动与模型签名规范

- 更新项目级 `AGENTS.md`：新版本部署完成后，如果 Obsidian 尚未运行，执行代理必须主动启动 Obsidian；如果已经运行，则重载或重新启用 Jam Deck，确保实际加载新版本。
- 后续每条 `docs/DEVELOPMENT_LOG.md` 变更记录必须附带处理模型签名；多代理参与时同时列出角色与模型，模型版本不可见时不得猜测。
- 本次仅更新开发规范和开发日志，不涉及插件运行文件，因此不触发部署或启动 Obsidian。
- 处理模型签名：Codex / GPT-5（主代理）

## 2026-07-31 — 0.12.5 按截图重排歌曲信息

- 以用户截图为视觉目标：唱片位于左侧，歌名和歌手紧随其右、在主体中部垂直居中并左对齐。
- 移除歌曲信息的最右侧绝对锚定；宽组件唱片与文字使用 24px 间距，外侧安全边距、右上角音源和底部悬浮控制保持不变。
- 0.12.5 已通过完整验证并完成受保护部署；`data.json` 保持 `1E0F13B0…0D157F`（17760 bytes），备份为 `.obsidian/plugins/.jam-deck-backup-20260731-141659-9550f473`。

## 2026-07-31 — 0.12.4 歌曲信息右侧锚定

- 歌名与歌手改为相对主体区绝对锚定：右侧 12px、垂直居中，文本区为主体宽度 44% 且最大 360px。
- 窄组件按唱片后的实际剩余空间计算文本宽度，保留 8px 右侧安全边距，避免文字再次滑向唱片附近。
- 0.12.4 已通过完整验证并完成受保护部署；`data.json` 保持 `1E0F13B0…0D157F`（17760 bytes），备份为 `.obsidian/plugins/.jam-deck-backup-20260731-141304-5dc5c97a`。

## 2026-07-31 — 0.12.3 播放器主体安全边距

- 主体分栏增加响应式内边距：标准宽度为左右 12px、顶部 8px，窄组件为左右 8px、顶部 6px。
- 唱片与右对齐歌曲信息同时向组件内部收拢，保持左右视觉平衡；进度条和悬浮控制层不变。
- 0.12.3 已通过完整验证并完成受保护部署；`data.json` 保持 `B32F4C89…BE0A9E`（19273 bytes），备份为 `.obsidian/plugins/.jam-deck-backup-20260731-133445-ca2dad29`。

## 2026-07-31 — 0.12.2 播放器悬浮控制重排

- 音源按钮固定到播放器右上角，歌名与歌手移动到组件右侧并右对齐。
- 时间线下移并成为常态底部信息，不再为隐藏的三个控制键预留一整行空白。
- 三个控制键改为时间线同层覆盖：悬停或焦点进入时，以主题表面色的柔和底部渐变盖住进度条并浮出按钮，离开后恢复进度。
- 控制层保持在组件内部的固定覆盖区，避免小尺寸组件中出现底部裁切。
- 0.12.2 已通过完整验证并在 Obsidian 关闭状态下完成受保护部署；运行文件与项目源一致，`data.json` 保持 `CC1D89ED…FAE495`（19167 bytes），备份为 `.obsidian/plugins/.jam-deck-backup-20260731-133038-4dc78162`。

## 2026-07-31 — 0.12.1 轻量播放器、唱臂与安全启动

- 删除歌词占位、来源播放状态和本地收藏；CD 与右侧歌名/歌手保持主视觉，音源改为 20px 的可访问菜单按钮。
- 新增白色唱臂，以权威 GSMTC `playing` 状态落针，暂停/停止/无会话抬起；浅色主题补充描边阴影，减少动态效果时取消过渡。
- 三个播放控制保留布局空间但默认隐藏，组件悬停、`focus-within` 或触摸聚焦时浮现，不造成内容跳动。
- 进度改为原生 Range Slider。Bridge 增加 `IsPlaybackPositionEnabled`、`TryChangePlaybackPositionAsync`、generation/track 校验和同源唯一性拒绝；拖动期间保留本地预览，松手发送一次，失败或超时回滚。
- 上次成功连接的受支持 Provider 以枚举持久化；仅唯一且可控的真实会话会写入一次。无会话点击播放时，Bridge 通过固定规则筛选 `Get-StartApps`、`shell:AppsFolder.ParseName` 验证并以显式 `open` 激活注册项，不接收路径、AppID、参数、命令或 URL。
- 启动请求去重；常规低频轮询不变，只在用户启动后的 12 秒内启用 500ms 临时探测，成功/失败/超时/组件卸载即清理。浏览器等其他 GSMTC 会话会被过滤。
- 当前电脑实测 QQ 音乐与 Chrome 同时存在时仍选择 QQ 音乐；当前 QQ 曲目明确返回 `canSeek=false`，无效 Seek 被 Bridge 以 `CAPABILITY_UNAVAILABLE` 拒绝。
- 0.12.1 已通过语法检查与完整 fixture 回归，并完成受保护部署；项目源与运行副本哈希一致，`data.json` 保持 `9DCB54D3…CFDE1E`（18962 bytes），备份为 `.obsidian/plugins/.jam-deck-backup-20260731-132117-a2945468`。

## 2026-07-31 — 0.12.0 Windows 音乐播放器

- 新增音乐播放器组件，采用旋转 CD、标题/歌手、歌词状态、播放进度、真实音源选择和四个紧凑控制按钮；遵循 Jam Deck 4px 间距、4px 控件圆角、明暗主题与减少动态效果规则。
- 通过一个插件级持久 PowerShell 桥接 Windows GSMTC。脚本固定并以 UTF-16LE `EncodedCommand` 启动，不使用 `ExecutionPolicy Bypass`；动态音源与控制只通过有版本号、请求 ID 和大小限制的 JSONL 标准输入传递。
- 封面只接收 GSMTC 缩略图流，限制为 768 KiB 和常见图片 MIME；插件使用短生命周期 Blob URL、最多 6 张/4 MiB 缓存并在卸载时释放。
- 播放器按钮按 GSMTC 能力启用；控制请求成功只视为“已接受”，随后轮询确认真实状态，超时会提示而不会伪造成功。
- 爱心定义为 Jam Deck 本地收藏，仅保存由音源、标题、歌手、专辑和时长生成的 SHA-256 摘要，不冒充外部播放器收藏。
- 当前电脑实测发现 `QQMusic.exe`，成功读取《他还是不懂》、S.H.E、《奇幻旅程》、254533ms 时长及上一首/下一首/播放能力；停止状态封面流为空时正确回退。网易云音乐与汽水音乐保留同一 GSMTC 兼容路径，未在本机实测。
- 补充媒体来源识别、时间格式、进度推演、收藏身份、固定桥脚本、安全边界、响应式 CD 和减少动态效果回归；完整验证通过。
- 0.12.0 已完成受保护部署，三个运行文件与项目 SHA-256 一致；`data.json` 保持 `5A2431F0…44897A1`（18613 bytes），最终备份位于 `.obsidian/plugins/.jam-deck-backup-20260731-122008-db5654ea`。

## 2026-07-30 — 0.11.4 Canvas 浏览器返回恢复

- 复现 `Study/灵感感念.canvas` 的即梦 link node 点击后打开 Chrome；关闭/返回时 detached Canvas leaf 仍存活，但 iframe 内事件不冒泡，原交互桥无法再次重申宿主 leaf。
- 新增 `CanvasReturnCoordinator`：按窗口共享监听，通过宿主 document 的 iframe/webview 焦点和 window blur/focus 建立一次性恢复，返回后强制 `focus:false` 重申可见 Jam Deck leaf。
- 不调用 iframe focus、reload、src 改写、leaf 重建或文件打开；返回后的竞争输入会取消恢复，park/attach/destroy 通过 epoch 使陈旧任务失效。
- 自动回归覆盖真实离开恢复、内部假 blur 过滤、用户输入取消、单次激活和监听移除；完整 `npm run verify` 通过。

## 2026-07-30 — 0.11.3 三段输入与双主题翻牌

- 未运行状态改为时、分、秒三个两位输入格，分别支持选中编辑、数字过滤、两位限制与保存后规范化。
- 运行状态固定使用 `HH:MM:SS` 六位翻牌；高度由 30–40px 压缩至 26–30px，字号和阴影同步收敛。
- 倒计时行补充 4px 左右、5px 底部安全留白，并增加 300px 以下容器的紧凑间距规则。
- 新增浅色纸灰与暗色炭灰两套牌面、输入、边界、中线和阴影 token；完整 `npm run verify` 通过。

## 2026-07-30 — 0.11.2 翻牌倒计时

- 运行中的剩余时间拆为独立数字牌面，补充中线、上下明暗、深色圆角与柔和双层阴影；变化数字使用 280ms 翻页反馈。
- 未运行时保留原时间输入，勾选后切换到 `role="timer"` 的翻牌结构；读屏标签每秒同步剩余时间。
- 日期字号由 11px 调至 12px，倒计时标签由 10px 调至 12px，输入由 12px 调至 14px。
- 补充翻牌 DOM、动画样式与减少动态效果回归；完整 `npm run verify` 通过。

## 2026-07-29 — 0.11.1 Windows 原生通知修复

- 复核发现 Renderer `window.Notification` 只能证明通知对象创建成功，Windows 仍可能静默丢弃，旧实现因此错误返回成功而没有触发回退。
- 确认本机开始菜单中 Obsidian 的 AppUserModelID 为 `md.obsidian`，并用该身份通过 Windows Runtime Toast API 成功派发原生测试通知。
- 插件改用隐藏、非交互的 PowerShell 子进程发送 Toast；原生路径失败后仍保留 Web Notification 与 Obsidian `Notice` 两级回退。
- 补充 AppUserModelID、Toast 模板和隐藏原生命令桥回归；完整 `npm run verify` 通过。

## 2026-07-29 — 0.11.0 时钟倒计时与 Windows 通知

- 在时间组件日期下方增加轻量倒计时行，支持分钟、`MM:SS`、`HH:MM:SS` 输入；勾选开始，取消勾选停止。
- 使用绝对截止时间持久化，插件级循环独立于 Jam Deck 可见视图检查到期；完成保存加锁并校验截止时间，防止重复通知。
- 到期优先使用 `window.Notification` 进入 Windows 通知中心，失败时回退 Obsidian `Notice`。
- 补充解析、格式化、重启状态推导、完成持久化与通知构造回归；完整 `npm run verify` 通过。

## 2026-07-28 — 0.10.3 文本预览边距与矩形展开

- 修复文本克隆仍受 Obsidian 阅读宽度、auto margin 和多层 padding 影响，正文被压成居中窄列的问题。
- 文本内边距改用 `16 / targetScale`，最终保持 16px 屏幕距离；内部 Markdown 容器恢复 100% 可用宽度。
- 展开卡片统一圆角设为 0，保留阴影和 FLIP 动效但取消共同的大圆角外壳；完整 fixture 回归通过。

## 2026-07-28 — 0.10.2 固定文本预览字号

- 修复展开文本同时继承 Canvas 变焦补偿和卡片 FLIP 缩放，导致视口越小文字越大的问题。
- 以 16px 为最终屏幕字号，并通过 `16 / targetScale` 反向抵消预览卡片缩放；卡片排版仍自适应，文字视觉尺寸保持稳定。
- 拖出 portal 去掉 transform 后将文本变量复位为 16px；语法检查与完整 fixture 回归通过。

## 2026-07-28 — 0.10.1 可交互混合堆叠

- 文本节点接入与图片平行的 `stackTextNormalization` v1：大文本进入堆叠时按目标平均尺寸缩小，安全拖出时恢复首次原始宽高。
- 展开卡片补充单击语义：文本通过 Obsidian 1.12.7 已验证的 `node.startEditing()` 回到真实节点编辑，图片进入 90% 视口约束预览，Markdown 笔记在新标签页打开。
- 鼠标/笔使用 6px、触控使用 10px 的点击—拖拽阈值；拖动采用临时 portal 与柔和抬升阴影，松手才按 `canvas.posFromEvt` 世界坐标提交。
- 临时 Canvas 实测通过：大文本从 620×360 归一化为 231×134；文本原生输入与 `Ctrl+Z` 正常；图片预览、图片拖出、文本拖出及两类拖出的单步撤销/重做均正常。

## 2026-07-28 — 0.10.0 混合素材堆叠与大图归一化

- 堆叠成员从纯图片扩展为图片、Canvas 文本和 Markdown 笔记；链接、嵌套 Canvas、PDF、媒体、分组及未解析文件保持排除。
- 仅对明显过大的拖入图片按目标现有成员平均 Canvas 尺寸等比缩小；现有节点不被连带调整。
- 新增可逆尺寸元数据，安全拖出围绕最终落点中心恢复；混合展开预览支持文本和笔记表面。
- 自动化验证通过；Obsidian 1.12.7 隔离测试验证拖入与拖出均为单步原生撤销/重做。测试后恢复 `Work/NZM/4.3天赋.canvas` 并移除临时文件。
- 在 Obsidian 关闭状态完成 0.10.0 受保护部署；`data.json` 保持 `005260BC…A4D8`（15810 bytes），源码与运行副本哈希一致。回滚备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260728-125043-5175ada0`。

## 2026-07-28 — 0.9.8 全类型 Canvas 节点推挤

- 修复聚焦让位只复用 `getImageItems()`、因此文本、Markdown 文件、嵌套 Canvas 和网页链接节点不移动的问题。
- 新增通用 `getCanvasItems()`，从原生 `canvas.nodes` 读取所有具备有效 `x/y/width/height` 与 `nodeEl` 的节点；选中图片堆叠按 ID 排除。
- 临时位移从图片 `.canvas-node-container` 提升为完整 `.canvas-node` 的 CSS individual translate，使内容、标签和完整节点表面一起移动，同时不覆盖原生定位 transform。
- 静态断言覆盖全节点枚举和外层节点位移；语法检查与完整 fixture 回归通过。
- 在 Obsidian 关闭状态下完成 0.9.8 受保护部署，部署时 `data.json` 保持 `005260BC…A4D8`（15810 bytes）；回滚备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260728-121939-4a2d6b4e`。

## 2026-07-28 — 0.9.7 聚焦推挤与蒙版隔离

- 按 Spatial 视频第二秒的空间反馈扩展聚焦模式：自适应排版矩形及 64px 影响区内的其他图片会在半透明蒙版下向外让位，收起时回到原视觉位置。
- 与焦点区相交的图片按最近主轴移出并保留 20px 间距，邻近图片沿远离焦点方向移动 24px；位移按 Canvas 缩放换算为节点容器 CSS translate，不改写世界坐标、Canvas JSON 或历史。
- 聚焦 wrapper 改为真实 pointer 隔离层并提升到原生 Canvas 控件之上；pointer、wheel、contextmenu 和 keydown 均在捕获阶段消费，点击蒙版或 Esc 只收起预览。
- 修复更早注册的图片复制桥可在蒙版打开时响应 `Ctrl/Cmd+C` 的事件顺序问题；桥入口直接检查 stack controller 预览状态。
- 减少动态效果模式保留最终推挤位置但取消过渡。新增推挤几何、远距不移动、蒙版层级、复制隔离和 reduced-motion 静态断言；语法检查与完整 fixture 回归通过。
- 在 Obsidian 关闭状态下完成 0.9.7 受保护部署，部署时 `data.json` 保持 `450D1FA6…E140`（15141 bytes）；回滚备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260728-121202-c6e127e9`。

## 2026-07-28 — 0.9.6 堆叠逐层展开与收回

- 修复预览 class 在浏览器提交起始布局前进入终态、造成部分图片直接跳到排版位置而缺少移动过程的问题。
- 每个图片副本以对应真实节点的精确屏幕矩形和 `scale(1)` 挂载；强制读取布局后跨两个 animation frame 启动 FLIP，确保所有层都从堆叠原位散开。
- 动画期间真实堆叠节点立即完全隐藏，收回错峰与 transition 完成后才恢复；视觉上不再残留静止的底层图片。
- 延迟展开回调增加 wrapper 身份、连接状态和 closing 状态校验，快速点击收起不会被旧帧重新打开。语法检查与完整 fixture 回归通过。
- 在 Obsidian 关闭状态下完成 0.9.6 受保护部署，部署时 `data.json` 保持 `6FFB4D9C…5A61`（15008 bytes）；回滚备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260728-115934-906761c4`。

## 2026-07-28 — 0.9.5 Canvas 焦点与点击展开

- 修复 owned Canvas leaf 脱离布局树却被传入 `workspace.setActiveLeaf` 后，Obsidian 回退聚焦到前方首篇日记的问题；Canvas 内交互现在保持 Jam Deck 宿主 leaf 活动。
- 堆叠展开由 hover 改为完整单击手势：再次单击同组或单击空白收起，滚轮、右键和 Esc 保留收起能力。
- 复用 5px 拖动阈值隔离点击与拖拽；达到阈值立即收起预览，拖动松开只进入原生移动与自动吸附，不切换预览。
- 删除 pointermove hover 调度、110ms 意图计时、100ms 离开计时与交互走廊；语法检查和完整 fixture 回归通过。
- 在 Obsidian 关闭状态下完成 0.9.5 受保护部署，`data.json` 保持 `2DF0C0E1…8FDA`（13139 bytes）；回滚备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260728-114213-b96985d1`。

## 2026-07-28 — 0.9.4 Spatial 堆叠动效与多层轮廓

- 逐帧复核用户提供的 Spatial 参考视频，提取“低对比幽灵纸面 → 图片从原位展开 → 源中心附近自适应构图 → 原路径回收”的核心节奏。
- 自动吸附改用缩放校正后的 5–9 屏幕像素候选槽，并排除已占用中心；修复第三张与第二张重合、层数不可辨的问题。
- 堆叠静止态、选中态与拖动态补齐明暗主题多层柔和阴影；拖动使用轻微上浮和放大，落位后短促收稳。
- 悬停预览改为完整图片表面的短生命周期 FLIP 副本：110ms 意图、300ms 展开、18ms 错峰、100ms 离开宽限、260ms 收拢，并加入源节点—展开卡片安全走廊和容器变化清理。
- 自适应布局枚举连续分行，在安全边距与 Canvas 控件保留区内统一缩放，保持每张图片比例并以源位置为构图中心；1–16 张混合比例 fixture 均无越界和重叠。
- 自动吸附落位后的渲染校验改为只读且加入 generation 竞争保护；预览克隆移除脚本、嵌入内容、表单、媒体交互、事件属性和身份属性。语法检查与完整 fixture 回归通过。
- 在 Obsidian 关闭状态下完成 0.9.4 受保护部署，`data.json` 保持 `2DF0C0E1…8FDA`（13139 bytes）；回滚备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260728-113057-70d81aa6`。

## 2026-07-28 — 0.9.3 Canvas 图片圆角与几何堆叠

- 图片圆角与快捷方式图标统一为 10px，分组提升为 14px；图片继续边到边铺满并隐藏文件名，所有规则限定在 Jam Deck 内嵌 Canvas。
- 单图鼠标拖动增加抬升反馈；松开时按 Canvas 世界坐标计算，重叠严格超过较小图片面积 50% 即吸附，连通重叠自动组成同一堆叠。
- 堆叠悬停使用无指针命中的屏幕预览层自动排开，离开即销毁；真实节点位置、缩放和原生 Canvas JSON 不因预览改变。
- 自动吸附复用 Obsidian 1.12.7 原生 moveTo、
equestSave 与防抖历史机制，并以运行时能力探测和时间窗口安全降级。
- 语法检查与完整 fixture 回归通过；Obsidian 1.12.7 深色主题实机验证了 10px 图片圆角、两图吸附成组、悬停展开，以及单次撤销从最终吸附位置直接回到拖动前、单次重做恢复吸附位置。临时测试 Canvas 已删除。
- 在 Obsidian 关闭状态下完成 0.9.3 受保护部署，三个程序文件与项目 SHA-256 一致，`data.json` 保持 `73DAD4BE…4E10`（12126 bytes）。回滚备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260728-104450-66781133`。

## 2026-07-28 — 0.9.2 日历完成量热度

- 移除已完成/已归档截止待办的灰色点阵与 `+N`，改为仅填充日期按钮本身的 7px 圆角品牌绿底板。
- 完成量按 1/2/3/4/5+ 项映射为 20%/40%/60%/80%/100% 五档；今天的细描边与热度可同时显示。
- 进行中与逾期待办继续使用可点击状态点，日期点击创建待办的原交互不变；视觉规范同步加入本规则。
- 语法检查与完整 fixture 回归通过；在 Obsidian 关闭状态下完成 0.9.2 受保护部署，三个程序文件与项目 SHA-256 一致，`data.json` 保持 `B083156B…6F3F`（16603 bytes）。回滚备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260728-094255-79130739`。

## 2026-07-23 — 0.9.1 固定线宽标注与悬停操作

- 根据实际使用反馈移除 Canvas 压感、倾角、合并采样、可变轮廓和每点扩展字段，笔画精简为二维世界坐标与固定线宽 SVG 描边。
- 旧压感 sidecar 继续可读，扩展字段被忽略；画笔、荧光笔、整笔擦除、颜色、三档粗细、撤销/重做和导航快捷键继续保留。
- 剪贴板复制/删除工具条移除 `any-pointer: coarse` 常驻规则，解决 Windows 因触控屏或数位板存在而始终显示按钮的问题；悬停与键盘聚焦仍可访问。
- 语法检查与完整 fixture 回归通过；在 Obsidian 关闭状态下完成 0.9.1 受保护部署，三个程序文件与项目 SHA-256 一致，`data.json` 保持 `3E94B79A…4238BD`（31665 bytes）。回滚备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260723-170550-79e8c2d5`。

## 2026-07-22 — 0.9.0 WebP、网页快捷方式与排序

- 为失效的 PNG/JPG/JPEG 图标路径加入同目录唯一同名 WebP 回退；渲染零写盘，直接编辑保存时才写回已验证路径。
- 剪贴板完整网页链接、浏览器 URI list 与标准纯文本 URL 可拖入快捷方式区，按 canonical URL 去重，自动使用域名名称和本地域名图标，不访问网页或生成 favicon 附件。
- 网页快捷方式通过系统浏览器打开；本地文件、应用与文件夹继续使用原有路径打开和拖入流程。
- 同组件快捷方式加入鼠标与键盘重排、低对比插入线、焦点恢复和 `aria-live` 播报；保存失败按快照恢复。
- 收紧图标删除边界，只清理可证明由插件生成、位于受管目录且无引用的文件；部署继续保护 `data.json`。
- 语法检查与完整 fixture 回归通过；在 Obsidian 关闭状态下部署 0.9.0，三个运行文件与项目 SHA-256 一致，`data.json` 保持 `BA086060…0AD041`（10630 bytes）。回滚备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260722-222642-b62ca366`。
- Obsidian 1.12.7 深色主题实机启动正常，快捷方式组件与既有 Canvas 均可渲染，检查后关闭应用且 `data.json` 哈希未变化。现有四个应用图标的受管目录实际为空，仅在 `.trash` 找到原 PNG，Vault 中没有同名 WebP；因此本版回退逻辑可兼容真实转换文件，但不能凭空恢复已移入废纸篓的图标。

## 2026-07-22 — 0.8.0 Canvas Spatial 工具栏与压感画笔

- 将 Canvas 底部卡片菜单整理为 18px 大圆角底板、46px 操作区与柔和双层阴影，明暗主题均沿用 Spatial 的低对比漂浮纸面语言。
- 新增 SVG 矢量标注层和浮动工具面板，包含画笔、荧光笔、整笔擦除、颜色、粗细、撤销/重做与完成；数位笔读取 Pointer Events 压力和合并采样，鼠标固定宽度。
- 笔迹保存在 `.canvas.jam-deck.json` 伴随文件中，加入单写入租约、引用计数、延迟保存、临时文件校验、备份、损坏只读恢复、重命名迁移及废纸篓删除。
- 所有 Canvas 内部样式严格限定在 `.jam-deck-canvas-leaf`，原生 `.canvas` 与个人 `data.json` 不被改写。
- 语法检查、78 项既有回归以及新增 Canvas 画笔静态检查通过。
- 已在 Obsidian 关闭状态下完成受保护部署；源文件与运行副本哈希一致，`data.json` SHA-256 保持 `7B95845E…9391D89`，回滚备份为 `D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260722-182948-9f28dcdf`。
- 在 Obsidian 1.12.7 深色主题中完成实际界面冒烟检查：原生底部菜单、画笔入口和完整浮动工具面板均正常显示；未在正式 Canvas 留下测试笔迹，检查后的应用缩放与 Canvas 缩放已恢复。

## 2026-07-22 — 0.7.4 Canvas 图片无框显示

- 仅在 `.jam-deck-canvas-leaf` 内将图片文件节点改为边到边 `cover`，移除节点容器的内距、圆角、底色与阴影。
- 隐藏内嵌 Canvas 图片文件名，保留贴边选中轮廓与节点交互。
- 普通 Canvas 标签页和非图片节点不受这些选择器影响。

## 2026-07-22 — 0.7.3 Canvas 图片复制

- 为独立托管的 Canvas leaf 增加活动视图同步，点击/聚焦画布后原生快捷键上下文可用。
- 单选图片文件节点时拦截 `Ctrl+C`，读取 Vault 原图并写入 Electron 系统剪贴板；其他选择保留原生复制路径。
- 点击 Canvas 外的 Jam Deck 区域时恢复宿主 leaf，防止快捷键继续落到隐藏或失焦的画布。
- 语法检查与 78 项回归测试通过。

## 2026-07-22 — 0.7.2 四周日历密度调整

- 日历视野收敛为过去一周、本周、未来两周，共 4 周；不再保留冗余的历史周。
- 今天改为绿色圆角矩形，保留日期点击与截止任务小圆点。
- 待办标题、分类、截止日期字体分别适度放大。
- 本次仅为视觉设计优化，按 Jam 要求未运行测试套件。

## 2026-07-22 — 0.7.1 Spatial 轻量日历修正

- 移除日期格和待办行的厚重卡片外观，恢复一个模块一个主表面的 Spatial 层级。
- 日期保持可点击，但默认无框无阴影；今天用细环，截止任务用绿色小圆点，逾期只改变点色。
- 工作/生活分类移到标题前，以低对比文字前缀表达；截止日期放在同行末尾。
- 将“功能新增前先复核视觉规范”写入 `AGENTS.md` 和 `docs/VISUAL_DESIGN.md`。
- 78 项测试通过并完成离线部署；`data.json` 哈希未变化。备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260722-110059-de641e18`。

## 2026-07-22 — 0.7.0 分类、Life Daily 与截止日历

- 详情新增分类、截止日期、图片粘贴、归档、恢复和删除。
- 自动分类规则：完整 `【…】` 标题归工作，其余归生活；显式分类优先。
- 新增 `Life/Daily.md` 严格日期章节归档，不触碰原有自由正文。
- 日历升级为可导航的 6×7 月视图，显示截止与逾期任务，点击日期创建纯内存草稿。
- 移除待办顶部直接新增输入，保留拖入创建。
- 增加持久化日记操作状态和删除 tombstone；75 项回归测试覆盖双归档、日期和草稿创建。
- 已在 Obsidian 关闭状态完成 0.7.0 离线部署，项目源与运行副本一致，`data.json` 部署前后哈希不变。
- 部署备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260722-105124-8fb21c74`。

## 2026-07-21 — 0.6.0 工作日记附件归位

- 待办归档图片改为进入对应工作日记的 Obsidian 附件目录，待办数据和日记引用同步更新。
- 使用幂等复制、内容校验、任务锁和提交后清理，避免失败或重试造成断链、覆盖和重复日记块。
- 已归档详情新增图片沿用同一规则；恢复不回迁，删除不清理日记附件。
- 增加旧 v2 归档的启动迁移，历史源文件保守保留。
- 55 项回归测试通过并完成离线部署；`data.json` 部署前后哈希一致。
- 0.6.0 部署备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260721-212657-f16ab8c6`。

本文件是项目本地开发日志；对应的 Obsidian 记录位于 `Work/Jam Deck.md` 和 Vault 根目录 `log.md`。

## 2026-07-21 — 迁移为独立项目

- 将开发源迁移到 `D:\Project\JamDeck`。
- Vault 插件目录降级为部署目标，不再直接开发。
- 建立相对路径测试、npm 验证脚本和带 staging/备份/失败恢复的部署脚本。
- 排除个人 `data.json`，仅保留脱敏示例。
- 当前版本：0.5.1；测试基线：44 项。
- 已执行一次受保护部署，项目源与运行目录的 `main.js`、`styles.css`、`manifest.json` 哈希一致。
- 本次运行目录备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260721-145157-2713d87e`。
- 部署后再次通过语法检查与 44 项测试；运行目录中的个人 `data.json` 不在部署白名单内。
- Obsidian 关闭后再次完成离线部署；部署前后 `data.json` 的 SHA-256 完全一致，三个运行文件与项目源哈希一致。
- 离线部署备份：`D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260721-145959-b23be7b2`。

## 2026-07-21 — Canvas 附件持久化

- 修复剪贴板图片拖入 Canvas 后因清空临时附件而失效。
- drop 时按 Obsidian 附件规则复制持久文件，再创建并保存 Canvas 节点。

## 2026-07-21 — Spatial 视觉升级

- 工作台统一为低对比白板、漂浮纸张和柔和阴影。
- 剪贴板升级为窄栏单列、加宽多列的 Polaroid 素材墙。
- 增加暗色 token、键盘焦点和粗指针操作入口。

## 2026-07-20 至 2026-07-21 — 功能基线

- 待办详情支持说明、链接和图片。
- 归档与工作日记实现可编辑、同步删除及幂等重试。
- 快捷方式支持文件/文件夹拖入与悬停删除。
- 剪贴板内容支持拖向待办、Canvas 和外部应用。
- 引入真实可编辑的 Obsidian Canvas 工作区。
