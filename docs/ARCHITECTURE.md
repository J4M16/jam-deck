# 架构说明

## 时钟倒计时

每个时钟组件在自己的 `widget.config` 中保存 `countdownDurationSec`、`countdownEnabled` 与绝对毫秒时间戳 `countdownEndsAt`。界面每秒依据 `Date.now()` 推导剩余秒数，不把逐秒变化写回 `data.json`，因此组件重绘与插件重载不会累计漂移或产生高频写入。

插件级时钟循环先扫描所有时钟组件，再更新可见视图；即使 Jam Deck 工作台没有打开，到期状态仍会被发现。完成事务以组件 ID 加锁并校验预期截止时间，先将停止状态持久化，再发送通知。

Windows 使用隐藏的非交互 PowerShell 子进程调用 Windows Runtime `ToastNotificationManager`，并以安装程序注册的 `md.obsidian` AppUserModelID 创建 Toast；这样不依赖 Renderer Web Notification 是否被 Electron 静默丢弃。非 Windows 平台继续使用 `window.Notification`，所有系统通道失败时回退为 Obsidian `Notice`。Obsidian 进程完全退出期间插件不驻留，下一次启动后的首轮检查会结算已过期计时。

## 双归档适配器与截止日期

任务新增可选 `category`、`dueDate`、`archiveRef`、`pendingJournalOp` 与 `tombstone`。新归档按显式分类或标题规则路由：工作使用原四节 v2 工作日记，生活使用 `Life/Daily.md` 日期 H1 内的稳定任务块。旧归档以已有路径为准，不按标题迁移。

Life 适配器只在唯一精确日期标题内更新唯一完整的 start/end 标记范围；重复日期、损坏标记或跨章节块都会停止同步。归档、编辑、分类移动、恢复和删除在任何日记写入前先持久化操作状态，启动后可按任务 ID 继续未完成步骤。

`dueDate` 是本地 `YYYY-MM-DD` 字符串，仅用于日历展示和创建，不决定归档日期。日历固定展示过去一周、本周与未来两周，共 4×7 天；完成或归档数量映射为日期按钮的五档品牌绿热度，进行中任务保留可点击状态点。周导航状态保存在组件配置中。

## 归档附件事务

待办图片最初保存在 `attachments/jam-deck-task-assets`。归档时先确保目标工作日记存在，再由 Obsidian 附件规则解析目标目录，以“复制校验 → 幂等更新日记块 → 保存 settings → 保守清理源文件”的顺序提交。任何中途失败都至少保留一份有效附件，不回滚或覆盖整篇工作日记。

归档、归档编辑和旧归档迁移共用任务 ID 互斥锁。旧归档迁移只处理具有明确 `journalPath`、稳定 v2 任务块和存在源文件的记录，并默认保留历史源文件。

## 工作台网格布局

编辑模式拖动时，被拖组件整块悬浮跟随指针，不参与碰撞。落位分两级：

1. `jamDeckCollectFillSlots` 收集等宽纵向空隙与等高横向空隙。有后邻时填满 B 到 C 的空隙；无后邻延伸到画布底边/右边的槽默认关闭，需按住 Shift（`includeEdgeSlots`）才启用。空隙须能容纳最小 2×2。命中后显示绿色渐变描边矩形，松手按矩形尺寸写入。
2. 未命中任何空隙时，`jamDeckFindPushSeam` 在命中带内检测间距不足最小尺寸的等宽纵缝或等高横缝，亮起两端渐变；`jamDeckApplyPushSeam` 以最小宽/高插入（交叉轴对齐邻居），并交给 `jamDeckReflowSeamChain` 重排缝后同列/同行组件：先按原间距平移，越界部分再从链首依次缩短（下限 2 格）。

拖动开始起 A 的悬浮预览即收缩为最小 2×2；Shift 可在拖动中即时切换边缝填充。两条路径都经 `commitWidgetLayout` 一次写入；都未命中则松手取消。缩放手柄仍使用原 `hasCollision` / `placeWidget` 空位逻辑。

## 运行模型

Jam Deck 是无构建的 Obsidian 桌面插件：`main.js`、`styles.css` 和 `manifest.json` 可直接部署。`data.json` 由 Obsidian 在运行目录维护，不属于源码。

## 快捷方式模型与事务

旧本地快捷方式继续使用 `{id, name, path, isFolder, iconPath}`；网页快捷方式显式使用 `{id, name, kind: "url", url}`，不会根据普通路径猜测或迁移类型。所有 URL 入口共用同一个 HTTP(S) 规范化函数，canonical URL 同时用于持久化、去重与打开。

网址创建和重排进入同一串行 mutation queue。每次操作以 ID 和锚点重新计算、先乐观渲染再保存；保存失败恢复操作前数组与焦点。网址 pending reservation 防止快速重复拖入产生重复项。

快捷方式图标解析先检查原路径；缺失 PNG/JPG/JPEG 时，仅在同一目录接受唯一同 stem WebP。该回退只影响运行时渲染，直接编辑保存才可写回。删除快捷方式先保存数据，再以逻辑路径、真实路径、受控文件名和全局引用四重条件判断是否清理 Jam Deck 自生成图标；无法证明时保留。

## 主要模块

- `JamDeckPlugin`：设置、剪贴板轮询、待办、归档、快捷方式和部署无关的业务逻辑。
- `JamDeckView`：固定 40×36 网格、组件渲染和布局交互。1920×1080 下每格约 37×23px；组件最小 2×2。12 列时代的布局在 `loadSettings` 里由 `jamDeckScaleWidgetColumns` 按 `GRID_COLS / 12` 迁移（`dataVersion` 4），此后网格调整不再迁移坐标。
- 非编辑态间距节点：`jamDeckCollectLayoutSashes` 合并贴齐竖/横缝，`jamDeckCollectLayoutNodes` 生成交点与中点手柄，`jamDeckApplySashDelta` 按增量重分配两侧宽高；`enableLayoutSashes` 仅在浏览态挂载。
- CanvasRuntimeAdapter：在 Jam Deck 内托管真实 WorkspaceLeaf Canvas 视图。
- CanvasImageStackController：识别图片、Canvas 文本与 Markdown 笔记，区分单击和单节点拖动，按世界坐标计算混合堆叠，管理图片/文本可逆尺寸归一化、原生历史和可交互点击展开预览。
- `CanvasInkOverlay`：挂载在内嵌 Canvas 上的 SVG 世界坐标绘图层，负责输入、工具面板和矢量渲染。
- `CanvasInkOwner`：按 Canvas 文件共享的笔迹文档所有者，负责单写入者、撤销/重做、校验保存与生命周期引用计数。

## Canvas 边界

Canvas 适配器使用 Obsidian 桌面端内部视图能力。它不把临时 leaf 插入工作区布局树，也不调用该 leaf 的 `detach()`。关闭时先保存 Canvas，再释放 owned leaf、observer 和监听器。

内嵌 Canvas 接收指针或焦点时始终保持可见的 Jam Deck 宿主 leaf 为工作区活动页，绝不把脱离布局树的 owned Canvas leaf 交给 `workspace.setActiveLeaf`，避免 Obsidian 回退聚焦到首个日记页。单选图片节点的 `Ctrl+C` 由 leaf-local 键盘桥直接读取原附件字节写入系统图片剪贴板，其他选择仍由 Canvas 原生复制处理。

跨域 iframe 内的事件不会冒泡到 Canvas leaf 宿主。`CanvasReturnCoordinator` 因此按 `ownerWindow` 观察宿主 document 的 iframe/webview 焦点归属与窗口 blur/focus：仅在离开前 Jam Deck 宿主已是活动页、网页元素属于当前 attached entry 时建立候选。返回任务使用下一宏任务与下一动画帧，让同轮用户输入先行；执行前再次验证窗口可见、生命周期 epoch、连接状态、blur token 与竞争输入序号。成功路径只强制一次 `setActiveLeaf(hostLeaf, {focus:false})`，不调用 iframe `focus()`、不刷新或重建网页。park、attach、destroy 与跨窗口迁移都会使旧 epoch 失效，并在最后一个 entry 移除共享监听。

宿主侧无法可靠区分“跨域 iframe 内点击外链”与“iframe 聚焦后直接 Alt+Tab”。因此从聚焦网页离开并返回时允许一次无视觉副作用的同 host 重申；它不改变 DOM 焦点或网页加载。返回后若出现鼠标、键盘或其他叶焦点竞争，则用户操作优先并取消恢复。

图片样式仅以 .jam-deck-canvas-leaf 为根并限定原生 .media-embed > img 节点：图片边到边填充、文件名隐藏，图片圆角复用 --jd-radius-sm，分组圆角使用 --jd-radius-md，选中轮廓保留。普通 Canvas 标签页和其他节点类型不进入该规则。

混合堆叠由 Canvas 世界坐标实时推导：图片、`type:"text"` 文本和解析成功的 `.md` 文件节点之间，交集面积严格大于较小节点面积的 50% 时连接，连通分量即为堆叠。链接、嵌套 Canvas、PDF、音视频、分组和未解析文件不参与。

### Canvas 文件夹编组

文件夹是 Canvas 节点 `jamdeck` 元数据中的显式关系，不写入插件 `data.json`，也不把 DOM 层的临时分组当成权威。每个成员节点带 `jamdeck.folderId`；锚点成员额外带 `jamdeck.folder` 记录。schema v1 的版本号用于迁移识别，除此之外固定八个可持久化字段：

```text
{
  version: 1,
  id,
  anchorId,
  memberIds,
  collapsed,
  color,
  layoutMode: "stack" | "grid",
  representativeIds,
  representativeColumns
}
```

`memberIds` 去重并稳定排序，`anchorId` 固定代表携带完整记录的成员；运行时 group 会提供同义的 `anchorNodeId`，但不会写回 schema。`collapsed` 新组默认为 `true`。折叠代表成员最多 4 个，由锚点优先、再按 ID 稳定排序；1 个代表居中，2–4 个使用双列。展开布局由不持久化的 `jamDeckCanvasFolderExpansionColumns` 独立计算：2–4 个为 2 列，5 个及以上为 3 列，6 个即 3×2，因此不会把展开列数混入 schema。`color` 只接受 6 个低饱和预设，未知值回退到第一色。读取时若只有旧式 `folderId`，会推导单成员兼容记录，但显式文件夹收集会要求实际成员至少两个。路径节点的 `file`/`subpath` 仅用于稳定识别和相等比较，不会把链接、嵌套 Canvas 等不支持类型加入文件夹。

`CanvasFolderController` 只挂载在 `jam-deck-canvas-leaf` 的 owned Canvas leaf：它复用混合堆叠的节点发现和 `>50%` 世界矩形命中规则，排除已有显式文件夹成员，处理手拖自动编组、选中工具栏的“堆叠编组”和“网格排列”，并重建轻量文件夹壳体。壳体按 folder ID 使用 keyed `folderViews` 复用；折叠态按 Figma `102:6` 显式建立 backboard、representatives、front、header 层，不建立独立 mask，其中真实代表节点位于完整 SVG 底板与磨砂前片之间，所有装饰层不命中 pointer。颜色圆钮通过 leaf 内 popover 提供六个 radio。点击壳体调用 `CanvasImageStackController` 的外部 `folder:*` cluster，保留旧预览、点击聚焦和拖出，不改变 `collapsed` 元数据，也不提供点击解散。

旧 stack preview 通过可选状态桥通知文件夹前片：打开时前片绕顶部翻至 -80°并淡出；普通关闭先等待卡片 260ms 返回，再执行 600ms 合拢。cleanup 不抢先取消合拢动画；drag-out、pointercancel、viewport 变化、Esc、空白点击、销毁和 reduced-motion 都会清理 timer、WAAPI 与外部 cluster。

展开/收拢使用原生节点容器的 WAAPI：展开 300ms、收拢 260ms，成员按 18ms 错峰并封顶 72ms，同时插值 `transform` 与 `opacity`。减少动态效果或容器不支持 WAAPI 时直接应用最终状态，生命周期仍维护 `collapsed → opening → expanded → closing → collapsed`，销毁时进入 `destroyed`。聚焦按钮才会创建 runtime-only `focusRequestToken`；展开完成后只消费一次，并按最新仍属于该 folder 的成员过滤，空集合不缩放也不修改节点，`reconcile()` 本身不会触发聚焦。

文件夹写入共用一个 `mutateNodes(changes)` 事务：先为全部成员 fresh-read 数据快照，再逐个 `setData`、`markMoved`、`render`，最后只调用一次 `requestPushHistory.run()` 和一次 `requestSave()`。任一节点失败时逐个恢复原快照并执行一次安全保存，错误继续上抛给通知层；因此编组、整组移动、网格重排、颜色/折叠状态和取消编组不会留下半组或多条撤销记录。

没有采用 Obsidian 原生 Canvas group 作为权威：在 Obsidian 1.12.7 中原生 group 数据不提供可靠的 `memberIds`，移动行为只按包围盒包含关系推断成员，无法表达锚点、代表预览、显式取消编组或跨形状网格布局。原生选择/缩放能力仍可被文件夹的“聚焦”动作调用，但成员关系与可逆持久化完全由上述 `jamdeck` schema 管理。

若拖入图片或文本相对目标组明显过大，控制器在 pointer-up 快照中排除候选自身，计算目标现有成员当前 Canvas 宽高的算术平均并按原宽高比例缩小，绝不放大或调整已有成员。首次缩小分别写入 `jamdeck.stackImageNormalization` 或 `jamdeck.stackTextNormalization` v1；安全拖出时围绕最终落点中心恢复原尺寸。位置、尺寸和元数据以一次 fresh `getData` → full-data `setData` → `markMoved` → `requestSave` 提交，Obsidian 1.12.7 实测可由一次原生撤销/重做完整处理。

单击展开会克隆清理过的图片、Canvas 文本或 Markdown 笔记渲染表面；载入失败使用无交互占位。缩小图片与文本都以保存的首次原 Canvas 尺寸作为逻辑预览尺寸，整个组合只在超出安全视口时统一做临时显示缩放。每张 FLIP 卡从对应源节点精确屏幕矩形出发，收起时返回最新源矩形；纯展开/收起不改变真实节点世界坐标和持久尺寸。

展开卡片在捕获阶段记录单一主指针：鼠标/笔移动不足 6px、触控不足 10px 时判定为单击；文本调用 Obsidian 1.12.7 已验证的 `node.startEditing()` 进入真实节点编辑，图片显示在 90% 视口约束的独立预览层，Markdown 笔记在新标签页打开。越过阈值后改为 DOM-only 拖拽副本，并永久抑制本次单击动作；松手时仅用 `canvas.posFromEvt(start/end)` 的世界坐标差计算最终落点，fresh-read 节点数据后一次性提交位置、恢复尺寸与元数据删除。画布缩放、平移、尺寸变化、节点身份或几何变化会取消提交。

文本预览不沿用克隆节点中的 Canvas 变焦字号。控制器以 16px 为最终屏幕目标，并按每张卡片的 `targetScale` 写入反向字号 `16 / targetScale`；卡片完成 FLIP 缩放后视觉字号恒为 16px。拖出 portal 移除卡片 transform 时将变量复位为 16px。

文本预览的内边距使用同样的反向缩放得到最终 16px 屏幕距离。克隆后的 `.markdown-embed-content`、`.markdown-preview-view`、`.markdown-preview-sizer` 与 `.markdown-preview-section` 会被限定为 100% 宽度并清除 auto margin、阅读宽度和重复 padding，避免窄列居中。展开卡片本身不设置圆角。

聚焦布局生成后，控制器枚举 `canvas.nodes` 中所有具有有效几何与 DOM 表面的节点，而不是复用仅识别图片扩展名的堆叠集合。选中堆叠成员按 ID 排除；其余图片、文本、文件笔记、嵌套 Canvas 和链接/浏览器节点，只要进入布局矩形及 64px 影响区便计算屏幕位移：相交节点移动到焦点区外并保留 20px 间距，邻近节点向外移动 24px。屏幕位移按节点 DOM/world 比例换算并以 CSS individual `translate` 作用于完整 `.canvas-node`，与 Obsidian 原生定位 transform 并存；收起时反向归零并清除 class 与变量，不调用 `moveTo`、`requestSave` 或历史接口。

聚焦 wrapper 使用 `pointer-events: auto` 并位于原生 Canvas 控件之上；根捕获阶段消费蒙版内 pointer、wheel、contextmenu 和 keydown。leaf-local 图片复制桥在执行 `Ctrl/Cmd+C` 前检查 stack preview 状态，确保更早注册的监听器也不能穿透。蒙版关闭动画完成前持续隔离，点击任意蒙版区域或按 Esc 触发收起。

剪贴板图片 drop 在 owned Canvas host 的 capture 阶段处理：同步记录 Canvas 坐标，复制为持久附件，创建图片节点并立即保存。未提交失败只清理本操作创建且未被引用的附件；已经插入节点后不会盲删文件。

同路径原生 Canvas 冲突由纯路径集合驱动：扫描明确排除带 ownership 标记的 detached leaf，高频 workspace 事件只保留一个 timer 并串行 reconcile。冲突时 `CanvasRuntimeAdapter` 先标记 entry closing，停止控制器并 abort/等待图片 drop 等在途任务，再 quiet 卸载 Jam Deck 自有 leaf；该路径不调用原生 Canvas 的 `saveImmediately`、`view.close`、workspace active-leaf 或 layout API。最后一个原生 leaf 关闭后才 fresh mount 一次。节点选择工具栏由 `CanvasSelectionToolbarController` 独立管理，负责当前节点发送给 AI，并把原生聚焦按钮改成全屏预览（复用堆叠大图全屏层）。entry 销毁时同步释放按钮、observer、rAF 与监听器。

标注层使用 Pointer Events，鼠标与数位笔都只记录 Canvas 世界坐标 `[x, y]`，并以用户选择的固定粗细渲染；不读取压力、倾角或合并采样。旧笔迹中的扩展点字段会在读取时忽略。画笔模式只拦截主按钮鼠标或笔输入，`Space` 临时让出平移，右键、滚轮和触控保持原生行为。

笔迹文档采用 `<canvas路径>.jam-deck.json` 伴随文件，schema 当前为 v1。保存使用临时文件写入、读取校验、旧正式文件备份和正式替换；同一 Canvas 的多个内嵌实例共享 owner，只有持有写入租约的实例可编辑。正式文件损坏时只读恢复，不自动覆盖；Canvas 重命名时同步迁移伴随文件，删除时仅通过 Obsidian 废纸篓接口处理正式、临时和备份文件。原生 `.canvas` 与插件 `data.json` 永不参与笔迹写入。

## Windows 音乐桥

音乐组件共享一个插件级 PowerShell 进程。完整脚本经固定 Gzip 压缩后装入 UTF-16LE `EncodedCommand`，动态音源、Provider 和控制参数只走有版本号、请求 ID 与大小上限的 JSONL 标准输入；脚本不使用 `ExecutionPolicy Bypass`。Snapshot 按 `SourceAppUserModelId` 分组，同源多会话标记为歧义并拒绝控制。Renderer 只保留 QQ 音乐、网易云音乐和汽水音乐三类会话，浏览器等其他系统媒体不会成为当前音乐音源。

Seek 只在 `IsPlaybackPositionEnabled` 为真时开放。Slider 拖动期间不发送 IPC，松手后携带 bridge generation、source、track token 和整数毫秒发送一次 `TryChangePlaybackPositionAsync`；`accepted=true` 后仍等待同曲新 Snapshot 在容差内确认，失败、换曲或超时回滚。

应用启动协议只接受 `qqmusic / netease / qishui` 枚举。Bridge 用固定规则筛选 `Get-StartApps`，要求唯一匹配，并通过 `shell:AppsFolder.ParseName` 校验注册项后以显式 `open` 激活；调用方不能提供路径、AppID、参数、命令、URI 或 URL。用户点击启动后只临时以 500ms、最长 12 秒寻找目标会话，常规低频轮询不变。

## 数据目录

- `attachments/jam-deck-clipboard`：短期剪贴板图片，可清理。
- `attachments/jam-deck-canvas-assets`：附件设置无法提供安全目标时的 Canvas 持久图片。
- `attachments/jam-deck-task-assets`：待办图片。
- `attachments/jam-deck-icons`：快捷方式图标。

## 开发与部署

项目根是唯一开发源。部署脚本显式白名单三个插件文件，并在目标同盘 staging、备份和校验。个人运行数据永远不参与部署。
