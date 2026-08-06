# Jam Deck 开发日志

## 2026-08-06 — 0.30.0 归档形式可配置 + 统一简单格式（发布计划 P1 体验完善）

- Jam 反馈：工作归档按目录、生活按文件是私人设置，不适合大家；希望设置里自定义「目录 or 文件」选项卡、默认都是文件；并问归档格式是什么、别人会不会有自己的格式文档——体验要完善，做好再发布。
- **决策（Jam 拍板）**：统一简单格式（工作/生活同构）；旧数据只保留读取兼容，不迁移不动 Jam 自己的数据。
- **设置字段**：`workArchiveMode`/`lifeArchiveMode`（"file"|"dir" 默认 file）+ `workArchiveFile`（默认 `Work/工作.md`）+ `lifeArchiveDir`（默认 `Life/生活日记`）；`workArchiveDir`/`lifeArchivePath` 保留为目录/文件模式路径。getter 拆为 `getWorkArchiveTargetPath(dateKey)`/`getLifeArchiveTargetPath(dateKey)`（file 固定单文件，dir 拼 `dir/dateKey.md`）。
- **格式统一**：新 kind `work-daily-v3`，工作归档复用生活简单块逻辑（`renderLifeTaskBlock` 分类行改为动态：工作/生活）；`ensureArchiveFile`/`writeTaskToArchive`/`replaceArchivedTaskInJournal`/`removeTaskFromArchiveRef` 按 kind 分发——`work-daily-v2` 走旧四段式（仅历史数据），其余走 `ensureSimpleArchiveFile` + `upsertTaskInLifeDaily`；删除过时的 `ensureLifeDailyFile`；`ensureDailyJournalFile` 目录取持久化路径父目录（不依赖当前 mode）。
- **archiveFormat 语义**：新归档写 `simple-v1`，旧数据保留 `section-v2` 标记。
- **设置面板**：归档路径段重构为「工作/生活归档形式」下拉（文件/目录）+ 各自路径输入，切换自动显隐对应输入行。
- **README**：新增「归档格式」章节（两种模式产物 + 任务块标记格式），「待办、分类与日历」「待办归档附件」段同步改写。
- **测试**：工作归档断言改统一简单块（file 单文件 + dir 日期文件），`archiveRef.kind === work-daily-v3`；新增 dir 模式集成断言、mode/path getter 断言；旧四段式历史数据（section-v2）迁移断言保留。`npm run verify` 全绿。
- 版本 0.30.0（manifest/package/CHANGELOG 同步）。**未发布**，等 Jam 验收后指示。
- 处理模型签名：MiniMax-M3（WorkBuddy 主对话）

## 2026-08-06 — 0.29.5 归档路径可配置（发布计划 P1-1）

- 背景：发布计划 `docs/RELEASE_PLAN.md` P1-1——工作/生活归档路径写死 `Work/工作日记` 与 `Life/Daily.md`，别人的 vault 语义不通。
- 实现：
  - `DEFAULT_SETTINGS` 新增 `workArchiveDir: WORK_JOURNAL_DIR`、`lifeArchivePath: LIFE_DAILY_PATH`（内置常量作默认）。
  - `JamDeckPlugin` 新增 `getWorkArchiveDir()` / `getLifeArchivePath()`：读 settings，空串/未设回退常量。
  - 归档使用点全部改走 getter：`getLocalDayContext`、`buildArchiveRef`、`getTaskArchiveRef`（`path === getLifeArchivePath()` 判定 life）、`ensureLifeDailyFile`（父目录从 lifePath 推导，不再硬编码 "Life"）、`ensureDailyJournalFile`、`updateArchivedTaskJournal`。
  - 设置面板「归档路径」段：工作归档目录 + 生活归档文件两个文本框，placeholder 显示默认值。
- 测试：fixture 补断言——空设置回退内置常量、自定义值被 `getWorkArchiveDir`/`getLifeArchivePath`/`buildArchiveRef` 正确使用。`npm run verify` 全绿。
- 版本 0.29.5（manifest/package/CHANGELOG 同步）。
- 处理模型签名：MiniMax-M3（WorkBuddy 主对话）

## 2026-08-06 — 0.29.4 仓库重组：Game Deck 剥离独立

- 纯维护版本，无功能变化。Game Deck（id `game-deck`）剥离为独立仓库 `D:\Project\GameDeck`：经 git filter-repo `--subdirectory-filter` 提取 game-deck/ 子目录历史（5 commits）并提至仓库根，分支 master；`scripts/build-game-deck.mjs` → `scripts/build.mjs`、`scripts/deploy-game-deck.ps1` → `scripts/deploy.ps1`（sourceDir 改仓库根）、`tests/game-deck-test.mjs` import 路径适配。
- 本仓库清理：git rm `game-deck/`、`docs/GAME_DECK.md`、`tests/game-deck-test.mjs`、`scripts/build-game-deck.mjs`、`scripts/deploy-game-deck.ps1`；package.json 移除 three/esbuild 与全部 `*:game-deck` scripts（verify 简化为 check + test）；README 删 Game Deck 段；.gitignore 加 `.workbuddy/`、`debug-backups/`。
- **事故记录**：并行会话的另一 agent 在剥离时误删本仓库 `docs/`、`scripts/`、`tests/` 目录（含 deploy.ps1、回归测试，未提交），经 `git restore` 从 HEAD（7014bf6）全数恢复，无损失。教训：多 agent 共用一个工作目录时，未提交窗口是唯一会互踩的时刻——必须唯一写者 + 勤 commit。
- Windows 坑记录：`git subtree split` 在 Git Bash 下处理到 18/33 提交时静默失败（无报错退出），改用 git filter-repo 完成提取。
- 处理模型签名：Deepseek-V4-Flash（WorkBuddy 主对话，plan/整合/执行）

## 2026-08-06 — 0.29.3 修边缘 widget 角点无 sash handle

- Jam 反馈：0.29.1 修 sash 半径 18→24px 后实测仍触发不了 canvas 组件右下角拉伸（鼠标放红箭头处没出现小绿点）。
- **诊断**：用 Obsidian.com eval 实地 dump `.jam-deck-sash-handle` 元素，grid 内 9 个 handle 中**没有** canvas-embed 右下角 (col 41, row 20) 的——说明问题不是半径，而是根本没生成这个角点的 sash。回溯 `jamDeckCollectLayoutSashes`：原版 8998-9005 行只把 `x+w === rightLine` 或 `y+h === bottomLine`（即全局 grid 右/下边界）的 widget 入 edge 队列。canvas-embed `y+h=20` 在 col 8-40 下方确实无邻居，但 20 ≠ 37 (bottomLine)，被漏掉。于是 vertical/horizontal 集合里没有 line=20 的 horizontal edge-y sash，cross product 不会产 (41, 20) xy node，widgetId 角点 handle 缺失。这是个**老 bug**（非 0.29.1 引入，也非 0.29.0 引入），0.29.1 改半径只是治标。
- **修复**：改为 per-widget 检测"右/下边界是否有 y/x overlap 邻居"（minH 1 行 overlap 视为有邻居，无 overlap 视为 edge）。edge sashes 按 line 分组（Map）传入 `jamDeckMergeSashRanges`，保留各自 line 字段。改 main.js 8993-9083 行（移除 `rightLine`/`bottomLine` 全局变量，新增 per-widget 检测 + 按 line 分组合并）。
- **测试**：`npm run verify` 全绿。手动验算：canvas-embed `(x=8, y=9, w=33, h=11)` — 下方无 y overlap 邻居，bottomEdge 入列 line=20 range 8-41；右方无 x overlap 邻居，rightEdge 入列 line=41 range 9-20。cross product `edge-x:41 × edge-y:20` → (41, 20)，owners `x+w=41 ∧ y+h=20` = [canvas-embed]，length===1 → widgetId 关联 → handle 出现。
- **并发协调**：0.29.2 已被另一会话的"文件夹提亮"占用，本次修复升 0.29.3。manifest/package/CHANGELOG 同步。
- 版本 0.29.3。修复已部署。
- 处理模型签名：MiniMax-M3（WorkBuddy 主对话）

## 2026-08-06 — 0.29.2 文件夹背叶/前叶提亮

- Jam 反馈：现在文件夹的颜色，背叶可以增加 15% 的明度，前叶增加 10% 的明度。
- **实现解读**：「明度 +15%」按混入 15% 白实现（保色相）。若按 HSL 明度 +15 点，樱粉/月黄/浅红/天蓝（HSL L 已 >80%）会漂成近白、色相全丢。混白是亮度实打实上去又不丢色的做法。
- **消费点核实**（改前必查，别切错变量）：背叶 backboard 消费 `--jd-folder-backboard-color`（SVG 壳体 color）；前叶磨砂前片消费 `--jd-folder-front-tint` 渐变（start/end）；`--jd-folder-panel` 只喂展开态控制条与前片兜底背景（被渐变覆盖），不喂两片叶子。
- **改动**（styles.css）：
  - `--jd-folder-backboard-color` → `color-mix(in srgb, var(--jd-folder-color, var(--jd-folder-neutral)) 85%, #fff 15%)`。
  - `--jd-folder-front-start/end` → `color-mix(in srgb, var(--jd-folder-front-tint) 90%, #fff 10%)`。
  - 色板圆钮 `.jam-deck-canvas-folder-color-swatch` background 同步 85%/15% 提亮（原 `background: var(--jd-folder-swatch-color...)` 残留行已删，避免后定义覆盖）。
- 回归：断言锁结构不锁色值，`npm run verify` 全绿。版本 0.29.2（0.29.1 是另一会话的 sash 命中半径改动）。待部署与实机过目。
- 处理模型签名：Qwen3.8-Max（主代理，WorkBuddy）

## 2026-08-06 — 0.29.1 修 canvas 组件右下角拉伸手柄命中过紧

- Jam 反馈：canvas 组件右下角触发不了拉伸窗口；与此同时 AI 助手按钮也不见了。
- **诊断**：
  - 拉伸：`enableLayoutSashes` 的 probe 用 `Math.hypot(x - hx, y - hy) <= 18` 判定 is-hot。sash 元素 `width:26; height:26; margin:-13 0 0 -13`，中心在 widget 角点，命中区是 widget 边界外侧 13px + 中心区 5px 共 18px。但 `canvas-embed` 组件内右下角被 Obsidian 原生 `.canvas-controls`（z-index 100，覆盖 +/-/100%/fit 按钮）占住，鼠标在 widget 内部右下角时事件被 canvas 吃了，grid 的 pointermove probe 永远检测不到 hover，sash 永远不会激活——表现为"触发不了"。
  - AI 助手：data.json 持久化 `aiFabPos = {x: 2375, y: 608}`，x=2375 超出当前视口宽度（截图约 1280px），按钮其实在 DOM 里但被定位到视口外。原因是早期拖 FAB 时持久化位置过大或窗口后续缩小导致脱壳。
- **修复**：
  - 拉伸：sash hover 半径 18→24px（多 6px 缓冲覆盖 canvas-controls 遮挡的边界）。改 main.js 11858 行的 probe 半径，加注释说明 canvas-controls 遮挡的根因。
  - AI 助手：通过 Obsidian.com eval 在运行时重置 `settings.aiFabPos = null` + `saveSettings()` + `renderAllViews()`，下次渲染时回退到默认右下角（`rect.width - 52 - 20, rect.height - 52 - 20`），不直接改 data.json。
- **测试**：`node --check main.js` 通过；`tests/jam-deck-test.js` 命中半径无显式断言，不破坏既有测试。
- 版本 0.29.1（manifest/package/CHANGELOG 同步）。修复已部署。
- 处理模型签名：MiniMax-M3（WorkBuddy 主对话）

## 2026-08-06 — 0.29.0 文件夹外观还原 NZS4 Figma「文件夹样式」

- Jam 反馈：测试 canvas 里打组的文件夹，文字和颜色都不够满意；新样式做在 Figma NZS4「文件夹样式」frame（node 134:143），要还原外观颜色和字体属性。
- **取数**：Figma Desktop Bridge 已连 NZS4。`figma_get_file_data` 对变体返回空 children（REST 视图缺运行时子树），改 `figma_execute` 走 `getNodeByIdAsync` 递归 dump，拿到全部精确属性：
  - 六变体底板实色（BOOLEAN_OPERATION）：纸灰 #C1C1C1 / 浅红 #F7BDB1 / 樱粉 #F0C5DA / 月黄 #EDD0AE / 草绿 #BBE0AF / 天蓝 #AFD0E0，圆角 10，阴影 DROP_SHADOW 0 4 blur20 黑@0.10。
  - 封面（前片）：200×100 @y=50，GRADIENT_LINEAR，每变体独立 tint（#E7E7E7/#FAC0C0/#F8CECE/#FBE2BB/#CCF2C0/#BEE1F3），stop0 a=0.5 → stop1 a=1；BACKDROP blur 20。
  - 文字：编组 Inter Regular 16 黑@0.5 @(12,124)；N个节点 Inter Regular 10 黑@0.3 @(12,110)。
  - 双凹槽 12×4 @x=188,y=129/137（现有 slot 已吻合，不动）。
- **渐变方向裁决**：API gradientTransform 矩阵换算与截图视觉一度矛盾（矩阵说 stop0 在底）。尝试 exportAsync 像素采样时桥已掉线；最终以截图为真——代表图在前片顶部透出、底部实色 → 定案「顶 50% 透明 → 底实色」。
- **实现**：
  - main.js：`JAM_DECK_CANVAS_FOLDER_COLORS` 换六色；`JAM_DECK_CANVAS_FOLDER_LEGACY_COLORS` 由 Set 改 Map（旧值语义迁移：#8EAFCC→#F7BDB1、#DDDCDC→#C1C1C1、#9BC287→#BBE0AF、#CC96BA→#F0C5DA、#E9B85C→#EDD0AE、#E3846A→#F7BDB1、#5E9BD6→#AFD0E0），`normalizeColor` 返回迁移值；新增 `JAM_DECK_CANVAS_FOLDER_FRONT_TINTS`，`updateFolderView` 注入 `--jd-folder-color`（迁移后）与 `--jd-folder-front-tint`；tint-strength 判定改 `#C1C1C1 ? 0% : 100%`。
  - styles.css：`--jd-folder-panel` = 实色、`--jd-folder-panel-edge` 透明、`--jd-folder-shadow` = 0 4px 20px 黑@0.10；front 背景改单层 tint 渐变（`front-start 50% transparent → front-end`），删白色 screen 层与 inset 高光；label/count 生效规则（2925–2977 行块）改 Inter 栈 + 16/10px + top 82.67%/73.33%（Figma y=124/110）；基础 label/count 规则同步 16/10 与 Inter。
- **测试**：默认色断言 #DDDCDC→#C1C1C1；legacy-blue 断言改期望 #F7BDB1（迁移）+ 新增 legacy-0286→#C1C1C1；tint 断言改 `#C1C1C1 ? 0% : 100%`；新增六色 deepStrictEqual、front tint 注入、渐变 50%、Inter 栈断言；旧 frosted 材质与旧定位断言更新为 NZS4 值。`npm run verify` 全绿。
- 版本 0.29.0（manifest/package/CHANGELOG 同步）。待部署与实机视觉核对。
- 处理模型签名：Qwen3.8-Max（主代理，WorkBuddy）

## 2026-08-05 — 0.28.9 追加：矮图拖不进文件夹（旧堆叠隔离 + 中心点命中）

- Jam 反馈：拖高度较矮的图到文件夹，没进文件夹，反而变小叠在上面。
- **根因 ①（旧堆叠没隔离）**：`attemptAutoSnap`（旧图片堆叠自动吸附）候选用 `getStackItems()`（默认 `includeExplicitFolders=true`）——埋在锚点、互相重叠的文件夹成员被 `jamDeckChooseCanvasStackTarget` 认成旧堆叠集群，触发 normalize（缩小）+ snap（叠上）。修复：候选改 `getStackItems(false)`，旧堆叠永不触碰文件夹成员。reconcile 的集群构建本就用 `getStackItems(false)`，此次补齐 auto-snap 这个漏网入口。
- **根因 ②（矮图特有）**：`findDropTarget` 折叠文件夹判定 =  dragged∩shell ÷ min（面积）。壳体 200×180；宽矮图（如 400×60，面积 24000 < 36000）交集最多 200×60=12000，ratio 卡死 0.5，`> JAM_DECK_STACK_OVERLAP_THRESHOLD(0.5)` 永远 false → `findDropTarget` 返回 null → 不加入 → 之后旧 auto-snap 接手缩小叠上。修复：加图标式拖放语义——拖拽中心点落进壳体即 ratio=1。
- 时序补充：folder controller `finishDrop`（setTimeout 0）先于 stack controller `awaitStableDragRect`（3 稳定帧）执行，所以 join 成功后 auto-snap 会因 folderId 检查跳过——两条修复任一条都能消除表象，①是治本（隔离），②是修矮图阈值。
- 断言 +2：`pluginSource` 含 `getStackItems(false).filter(...)`（auto-snap 排除文件夹成员）；`folderControllerSource` 含 `centerInside`。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-05 — 0.28.9 hover 翻动动画修复（fill:both 残留锁死）

- Jam 反馈：hover 态文件夹翻动动画没了。
- 运行时取证（focus 触发 `:focus-within` + 读 computed）：front 的 computed transform 是 `matrix3d(...,0,0,1,-0.00384615,...)` = `perspective(260px)` 纯投影，CSS hover 规则（3263 行 `rotateX(-30deg)`，specificity 更高）完全没生效。
- **根因**：`animateFolderPreviewFront`（main.js）的 WAAPI `front.animate([...], {fill:"both"})` 动画结束后**从不 cancel**——fill:"both" 的持久效果优先级高于 CSS 规则，把 front 锁死在关闭动画终点 `perspective(260px) rotateX(0deg)`。preview 打开又关闭一次后，hover 翻动永久失效。`clearFolderPreviewRuntime` 有 cancel 但正常 finish 路径没走它。
- 修复：`finish()` 里先 `latest.animation.cancel()`（对已完成的动画 cancel 无害）再置空，front 回到 CSS 值，hover 规则重新可应用。+1 断言（previewFrontSource 含 `fill: "both"` + `latest.animation.cancel`；注意切片长度 1700 不够覆盖 finish，用 2600）。
- 版本 0.28.9，deploy + plugin:reload 生效。⚠️ 验证注意：plugin reload 会 detach 插件视图，Jam 需重新打开工作台；工作台画布组件为空时无 folder 可验，端到端 hover 需 Jam 在真实画布确认。
- **追加（11:40，Jam 反馈"堆叠文件后文件夹周围有个分组，区域比文件夹视觉大太多、不贴靠"）**：原生 group node 的 bbox 此前 = 成员堆叠矩形的并集（成员可保留大尺寸 → 分组框巨大，看起来"为什么有分组"）。新增 `nativeFolderShellBounds()`：anchor 堆叠中心 ±100/75 的 200×150 设计基准（与壳体 world rect 同源，含 fallback）。编组创建 / `collapseNativeFolder` / `renameNativeFolder` 折叠态三处 group bbox 统一用它；`expandNativeFolder` 保持原位成员包围盒（展开态囊括全部可见成员，合理的大框）。已 deploy + reload（备份 `.jam-deck-backup-20260805-113923-6baf8fcc`）。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-05 — 0.28.8 文件夹：缩放露出修复 + 原生 Canvas 分组接入

- Jam 三个反馈：(1) 重置缩放后折叠内容自己露出来（没点文件夹）；(2) 折叠成员连线端点仍可交互（0.28.6 修了选中范围但漏了 connection points）；(3) 期望新编组 = 原生 canvas 分组，折叠时无连接点/选中交互，点开释放，必须通过关闭按钮退出。
- 侦察：Obsidian 1.13.4。原生 group = `nodes` 里的 `type:'group'` 条目（不是顶层 `groups` 数组）；`canvas.createGroupNode({pos,size,label,save:false})` 创建后 `canvas.getData()` 即包含该条目（`canvas.nodes` Map 暂不含但 `getData` 序列化已含），所以 `mutateNodes` 一次原子事务可一并提交成员 + group；`canvas.removeNode(group)` + `view.requestSave()` 删除。`getNativeGroupCapability()` 运行时 gate（缺能力时自动回退老 preview）。
- 问题 1 修复：`applyFolderRuntimeNodes` 的 `hide` 去掉 `view.safe` 与 `view.shell.hidden` 依赖 → 折叠完全由 `group.collapsed` 驱动；`updateFolderView` 的 `shell.hidden` 只随 `state==="expanded"` 翻转；reconcile 里 `!view.safe` 不再执行 `restoreFolderOwnedNodes`，仅一次性告警。`styles.css` 给 `.canvas-node.is-jam-deck-folder-member:is(.is-jam-deck-folder-collapsed, .is-opening, .is-closing, .is-transitioning, .is-jam-deck-folder-transitioning) .canvas-node-connection-point` 加 `pointer-events:none !important; opacity:0 !important`（问题 2）。
- 问题 3 改造：
  - **Schema v1 增字段**（老数据全部缺省，`native` 默认 false 走老 preview）：`jamDeckCanvasFolderRects` 解析 rect 字典；`jamDeckCanvasFolderSchema` 读出 `native/label/nativeGroupId/positions/stacked`；`folderRecord` 通过 overrides 写回；`collectGroups` 初始化 + 锚点更新分支同步。
  - **原生折叠/展开核心**（CanvasFolderController 新增）：`getNativeGroupCapability` / `isNativeFolder` / `nativeGroupNode` / `nativeFolderBounds` / `nativeFolderGroupNodeData` / `nativeFolderRecord` / `captureNativeMemberScreenRects` / `animateNativeFolderTransition`（WAAPI FLIP + `is-jam-deck-folder-transitioning` 禁交互）/ `expandNativeFolder` / `collapseNativeFolder` / `renameNativeFolder`。
  - **编组入口 `createFolder`**：编组前捕获 `positions`（成员原始矩形），`placed` 算后构建 `stacked`；`canvas.createGroupNode({save:false})` 拿到 `nativeGroupId`；folder record 写 `native/label/nativeGroupId/positions/stacked`；`mutateNodes` 一次性提交（成员堆叠坐标 + anchor payload + group node 数据）。能力缺失时 `nativeGroupId=""` → 老 preview 路径（优雅降级）。
  - **交互分流**：`toggleFolderPreview` native 分支 → expand/collapse；`onDocumentKeydown` Escape 拦截 native 展开态 → `collapseNativeFolder`（capture 阶段 `stopImmediatePropagation` 优先于 Obsidian）；`onClick` 拦截 native 展开态的空白点击（仅按钮可点）；`finishFolderShellDrag` 整组拖动同步 group bbox；`ungroup` native 分支恢复 positions + `canvas.removeNode` + `view.requestSave`。
  - **壳体 UI**：`createFolderHeader` 新增 `view.close`（chevron-up，收起按钮，native 展开态显示）+ label dblclick 弹 `window.prompt` 重命名（调 `renameNativeFolder`）；`updateFolderView` 给 shell 加 `is-native-folder` class，native 展开态改 position（bounds 顶部 200×40 浮条，expandedBounds 顶部居中）、`shell.hidden = expanded && !nativeExpanded`、`view.label` 文本同步 `group.label`、`view.close` display 切换。
  - **`reconcile`** 的 `collapsed:true` 强制改为 `collectedGroup.native ? !!collectedGroup.collapsed : true`——native 模式 collapsed 真实持久化（展开 = 成员回原位，重开 Obsidian 保持）。
  - **CSS**：`.jam-deck-canvas-folder.is-expanded.is-native-folder` 控制条样式（隐藏 backboard/representatives/front，header 全高 flex 横排，controls `opacity:1/visibility:visible`，label ellipsis，count 隐藏）；加 `pointer-events:auto !important` 覆盖壳体默认 `none`。
  - **边界 fallback**：`collapseNativeFolder` 对缺 `stacked` 矩形的新加入成员 fallback 到 anchor 的 stacked rect（不留在原位露出）；`expandNativeFolder` 缺 `positions` 时用当前 data 矩形。
- 测试：`tests/jam-deck-test.js` schema 字段断言由 8 改 13 + native/label/positions 解析断言 + controls 3 按钮顺序断言（close/color/ungroup）。`npm run verify` 全绿。
- 部署：版本 0.28.8，`npm run deploy` 成功，data.json 保持 `F95D651E…B61B440DDFD0614B`，备份 `.jam-deck-backup-20260805-111300-ca1dc25c`。`plugin:reload id=jam-deck` 热重载。
- 实机验证：Obsidian 1.13.4 (installer 1.12.7) 启动正常（CLI `Obsidian.com` 拉起 GUI）。JamDeck 工作台画布组件当前为「未打开文件」空状态，无法自动跑编组端到端；交互细节（壳体点击展开 / 关闭按钮 + Escape 收起 / 缩放后折叠不露出 / 折叠成员连接点不可交互 / 原生 group 视觉囊括）需 Jam 在挂载图片节点的画布上手动验收。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-05 — 0.28.7 屎山清理（大型重构）

- Jam 要求整体 review 并清理屎山代码。先 git 备份（0.28.6 快照）再分批处理，每批 verify + 提交。
- **CSS final cascade 合并（根因）**：styles.css 68 个选择器重复定义（同名规则 2-6 次、末尾覆盖前面）是 hover 等样式修不好的根因（DeepSeek 改前面规则被末尾覆盖）。用 python 脚本解析所有顶层规则，对 25 组完全相同的选择器按"后定义覆盖前定义、保留独有属性"合并为单一定义，删除前面重复，文件 3300+ → 3235 行。更新 3 条断言（final cascade 结构验证 → 单一定义验证）。工作台视觉验证无破坏。
- **拆分 5 个超长函数**：TaskDetailModal.onOpen(200行)→renderTaskFields/Images/Actions；renderAiChat(172行)→Header/Body/InputRow；createFolderView(155行)→Backboard/Layers/Header；renderMusicPlayer(144行)→Hero/Transport；showPreview(137行)→buildPreviewVisuals/createPreviewCard。全部行为不变。
- **controlMusic 确认轮询**：220/900ms 裸 setTimeout 加 pending id 检查，消除提前确认后的幽灵回调。
- **rAF helper**：抽取 jamDeckRequestFrame 消除 3 处 rAF fallback 重复。
- **魔法数字常量化**：JAM_DECK_STACK_PREVIEW_CLEANUP_MS、JAM_DECK_FOLDER_FALLBACK_WIDTH/HEIGHT_RATIO。
- **legacy 数据迁移**：日记 v1→v2（upgradeLegacyTaskInJournal）保留 + TODO（删除会放弃老日记迁移，确认发版周期后再删）。
- 提交序列：CSS 合并(40bbb86) → 拆 TaskDetailModal(b9dfc9b) → renderAiChat(eda9fd7) → createFolderView(d5bee39) → renderMusicPlayer(737c76e) → showPreview(d24b0c7) → controlMusic(46a4342) → rAF helper(adb362f) → 魔法数字(553956e) → legacy 标注(5ccd388)。
- 回归：`npm run verify` 全绿。部署 0.28.7，备份 `.jam-deck-backup-20260805-095724-1532dca8`。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-05 — 0.28.6 色板更新 + 前片透视 + 折叠选中范围

- Jam 反馈：①中灰换天蓝，六色饱和度各 +30% 独立调整；②前片"固定底边、翻顶边、顶边宽度加宽"；③图片成文件夹后选中范围仍巨大，需缩小到壳体附近。
- 实现：
  - **色板**：`JAM_DECK_CANVAS_FOLDER_COLORS` 中灰 `#A9A9A9` → 天蓝 `#5E9BD6`；其余按 HSL 饱和度 ×1.3 独立换算（python colorsys）：`#9BC287 / #CC96BA / #E9B85C / #E3846A`。浅灰 #DDDCDC 饱和度近 0 保持。
  - **前片翻开（理解修正）**：Jam 要的是「**底边固定、顶边朝 viewer 翻起、顶边显宽**」。正确实现：transform-origin **50% 100%**（底边铰链）+ `rotateX(80deg)`（正角：顶边向 viewer 方向翻起，近大远小 → 顶边宽度增加）+ perspective 260px 强化透视。⚠️ 我一度误实现为固定顶边（origin 50% 0% + rotateX(-80deg)，底边收窄）——Jam 明确纠正后改回。hover 悬浮微翻（origin 50% 0% + rotateX(-30deg)）为独立状态，保持不变。
  - **折叠选中范围**：运行时取证发现 folder 成员节点被选中（`is-selected`，包围盒 808×539px 远超壳体 137×103px）。`updateFolderView` 折叠分支：若 `canvas.selection` 含任一成员 → `deselectAll()` 清除，选中框回归壳体。
- 回归：+3 断言（折叠清选中、rotateX(80deg) 正角、front origin 底边）；`npm run verify` 全绿。版本 0.28.6。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-05 — 0.28.5 文件夹面板浓度 + 前片翻开方向

- Jam 反馈：①文件夹颜色很浅，想提高面板浓度；②前片翻动动画上下颠倒，要调过来。
- 改法（styles.css，两处）：
  - `--jd-folder-panel: color-mix(in srgb, var(--jd-folder-color) 78%, #edf3f5 22%)` → `90% / 10%`（面板颜色更实）。
  - `.jam-deck-canvas-folder-front, .jam-deck-canvas-folder-header` 的 `transform-origin: 50% 100%`（底边）→ `50% 0%`（顶边）——前片 rotateX(-80deg) 翻开动画改为绕顶边旋转，与 hover（origin 50% 0%）一致，方向修正。
- 回归：无相关断言，`npm run verify` 全绿。版本 0.28.5。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-05 — 0.28.4 动画与系统「减少动态效果」脱钩

- Jam 反馈：为什么插件动画要跟 Windows 动画设置挂钩？应该脱钩——Jam Deck 动画正常做，要关就在插件设置里关。
- 实现：
  - **CSS**：删除 styles.css 全部 12 处 `@media (prefers-reduced-motion: reduce)` 块（均为"禁用动画"性质，无必要布局规则）；末尾加 `.jam-deck-root.jam-deck-no-motion *::before/::after { animation-duration/transition-duration: 0.001s !important }` 统一停用动效（成熟 CSS 手法）。
  - **设置**：DEFAULT_SETTINGS 加 `animationsEnabled: true`；设置页顶部加「动画效果」toggle（onChange → saveSettings + applyAnimationSetting）。
  - **JS**：`JamDeckView.render` 按设置给 root toggle `jam-deck-no-motion`；新增 `JamDeckPlugin.applyAnimationSetting()`（onload 调用 + 设置变更同步已打开视图，经 `getLeavesOfType`）；`CanvasImageStackController.collapsePreview` 与 `CanvasFolderController.prefersReducedMotion()` 从 `matchMedia` 改为读 `this.root.closest(".jam-deck-root.jam-deck-no-motion")`（DOM class 驱动，无需 plugin 引用）。
  - 测试：7 条 reduced-motion 断言改为脱钩断言（styles 无 prefers-reduced-motion、no-motion class 规则、animationsEnabled 设置、JS 不读 media query、fixture 用 root.closest mock）。
- 坑：python `open('w')` 文本模式把 styles.css 换行从 LF 写成 CRLF，导致全部多行字符串断言失败——用 `wb` 替换 `\r\n → \n` 恢复 LF。
- 回归：`npm run verify` 全绿。版本 0.28.4。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-05 — 0.28.3 展开图糊：FLIP 改为真实布局落地

- Jam 反馈：点开编组排开了，但图糊——"放大是变回原图清晰的样子"，不是把代理成员放大。
- 根因（静态分析 + 运行时取证）：位图本身 1536×1024（够清晰），但 FLIP 动画用 `transform: scale(9.35)` 把**代理小图（56px）的渲染结果**放大，且 transform 一直保留在最终态——浏览器放大的是 56px 光栅化结果，不是原图重采样，因此糊。
- 修复（经典 FLIP 落地）：
  - main.js `showPreview`：卡片 `left/top/width/height` 直接 = 排列目标（position），起点 transform = `translate3d(var(--jd-stack-from-x), ...) scale(var(--jd-stack-from-scale))`（从 source 飞到 target 的过渡）；is-visible 后 transform 归 identity（`translate3d(0,0,0) scale(1)`）——**最终态无缩放，img 用 1536 位图重采样到 ~590px，清晰**。
  - `collapsePreview`：return 偏移相对 target 布局计算（visual 增存 position）。
  - 文本字号/内边距改为直接 16px（不再反向补偿 targetScale）。
  - styles.css：卡片起点/终点/is-closing/reduced-motion 四处的 transform 语义同步（`--jd-stack-to-*` 弃用，改用 `--jd-stack-from-*`）。
- 回归：更新 4 条断言（from 起点、is-visible identity、reduced-motion identity、文本固定字号）；`npm run check` + `npm test` 全绿。
- 部署：0.28.3，`npm run deploy` 成功（data.json 保持 `4B82F291…DC60`，备份 `.jam-deck-backup-20260805-005016-4f47bcb7`）。
- ⚠️ 启动问题：命令行/Start-Process 启动 Obsidian 仍 GPU FATAL（RDP 会话 Chromium GPU 初始化失败），Jam 手动双击可启动。已请 Jam 手动打开验证。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-04 — 0.28.2 文件夹壳体：代表图白边 + 文案对齐

- Jam 反馈：拖文件堆叠（编组）后，进去的示例文件（代表成员）没有白色描边；壳体底部"2 个节点 / 编组"文案偏上，应与右侧图标（颜色圆钮 / 取消编组）按下方间距和左方间距对齐，目前要下移。
- 改法（纯 CSS，styles.css）：
  - `.jam-deck-canvas-folder-proxy` 加 `border: 2px solid rgb(255 255 255 / 0.92); box-sizing: border-box;`，让代表图（最多 4 个真实节点）带白边。
  - `.jam-deck-canvas-folder:has(> front) > header > .meta` 由 `top: calc(42% + 11px)` 改为 `top: auto; bottom: 26px;`，与同 header 内 controls（`bottom: 26px`）底部对齐——meta 内部的 count / label 因此贴近壳体底缘、与图标同行。
- 千问视觉查验（热重载后）发现：白边在 plugin:reload 下未必立刻刷新（CSS 插入由插件 onload 触发），需重启 Obsidian；meta 最初我按 Jam "下移 10px" 直接 `top: +21px` 导致文案脱出壳体，改为 bottom 对齐后稳。
- 千问同时揭示两个未改的相关问题（与本次无关但需后续观察）：
  1. 多数 representative 渲染为 Obsidian Canvas 的骨架占位（"几道横杠纹样"）而非真实图片——可能是成员文件未加载/未识别，非 CSS 问题；
  2. 壳体前片（半透磨砂面板）在暗色主题下"几乎不可见"——Figma 纸面板的体量感没体现。
- Jam 第三点"点开编组内容不自动排列展开"未能在本次复现：当前 Obsidian 因 GPU 进程崩溃无法稳定启动（疑似 RTX 5080 渲染占用），Jam 重启 Obsidian 后需点开编组复现，FLIP 布局逻辑（`jamDeckLayoutCanvasStackPreview` + 切换 sourceRects）未发现破坏。
- 回归：`npm run check` + `npm test` 通过；`npm run build:game-deck` 因 Obsidian 残留进程锁住 `game-deck/main.js` 写入失败（环境问题，非代码），`game-deck/main.js` 语法 `node --check` 通过，未影响本次发布。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-04 — 0.28.2 补：展开叠图根因 = reduced-motion 杀 FLIP（已修）

- Jam 实机复现：点开文件夹（编组），两张图仍叠在源位置小图，没有放大排开。
- **根因（运行时 eval 定位）**：系统开了「减少动态效果」（`prefers-reduced-motion: reduce` = true）。styles.css 的 reduced-motion 块（旧 1275-1280 行）把 `.is-visible .jam-deck-canvas-stack-preview-card { transform: none; }`——FLIP 的目标 transform 被强杀，卡片永远停在 source 小图位置；`--jd-stack-to-scale` 实际已算出 8.8–9.4 倍放大、wrapper 也有 is-visible，纯粹是 CSS 覆盖掉了落位。
- 修复：reduced-motion 下**保留最终落位 transform**（`translate3d(var(--jd-stack-to-x), var(--jd-stack-to-y), 0) scale(var(--jd-stack-to-scale))` / closing 保留 return 值），只去掉 transition（过渡动画）。与 VISUAL_DESIGN.md「reduce 时取消过渡但保留最终排版」对齐。
- 运行时验证：CLI eval 注入修复 CSS 后，两张卡 computed transform 变为 `matrix(9.35…)`/`matrix(8.82…)`，rect 各约 548px 并排展开。新增 1 条回归断言（reduced-motion 下 is-visible 保留最终 transform）。
- ⚠️ 部署受阻：Obsidian GPU crash 残留的 zombie 进程（PID 4448/94044/49864/64336/53880，60-80K）**无法被 Stop-Process / taskkill /F / Kill / CIM Terminate 终止**，持续锁住 `jam-deck` 的 styles.css/manifest.json 句柄（cp Permission denied）。**需 Jam 重启电脑**清理后部署修复版（源文件已就绪）。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-04 — 0.28.1 Canvas 悬浮改为 300ms 按住延迟判定

- Jam 反馈：0.28.0 按下即悬浮导致**单击也会闪一下悬浮**再展开预览，希望用延迟区分点击与按住。
- 修改：pointerdown 时不再立即 addClass，改为 `setTimeout(lift, CANVAS_STACK_LIFT_DELAY_MS)`（300ms）挂起；
  - 300ms 内松手 → `drag.dispose()` clearTimeout，走单击路径（togglePreview 展开），全程不悬浮；
  - 按住超 300ms → 定时器触发 lift() 悬浮；
  - 拖动越过 5px 阈值 → 立即 clearTimeout + lift()（拖动意图明确，不等 300ms）。
- 常量 `CANVAS_STACK_LIFT_DELAY_MS = 300` 置于顶部常量区；removeClass 逻辑不变（finishDrag/清理统一）。
- 回归：更新 1 条旧断言为 4 条新断言（定时器挂起、常量、拖动立即 lift、dispose 清理定时器），样式断言不变；`npm run verify` 全绿。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-04 — 0.28.0 Canvas 节点按住即悬浮（阴影 + 50% 透明）

- Jam 反馈：Canvas 按住图片没反应，拖过 5px 阈值才悬浮；希望**按下立即悬浮**，只要阴影、降 50% 透明度、不要缩放。
- 根因：`onPointerDown` 只在 move 超过 5px（`drag.moved`）时才 addClass `is-jam-deck-stack-dragging`。
- 修改：pointerdown 建立 drag 记录后**立即** addClass；move 回调不再负责加 class。移除逻辑不变，`finishDrag` 与清理路径统一 removeClass，单击（不移动）路径在松手后正常恢复并展开预览。
- 样式：`.canvas-node.is-jam-deck-stack-dragging` 去掉 `translate: 0 -6px` 与 `scale: 1.018`，改为 `opacity: 0.5`；保留三层柔和阴影；transition 只保留 opacity / box-shadow。图片与混合堆叠两类选择器统一处理，dark 主题阴影不变。
- 规范同步：docs/VISUAL_DESIGN.md「Canvas」悬浮条目改写为仅阴影 + 50% 透明度、无位移无缩放。
- 回归：新增 4 条断言（pointerdown 即加 class、opacity 0.5、无 scale 1.018、无 translate 0 -6px）；`npm run verify` 全绿。
- 处理模型签名：具体模型标识不可见（主代理，WorkBuddy）

## 2026-08-04 — 0.27.3 修复"处理中"提示模型错标

- Jam 反馈：切到千问后聊天窗提示仍显示"DeepSeek 处理中"。
- 根因：`sendAiMessage` 的占位提示 `${imageCtx ? "千问" : "DeepSeek"} 处理中…` 用"是否挂图片"推断模型——切到千问后发纯文本（无图片上下文）就错标成 DeepSeek，实际请求走的是 qwen。
- 修复：改为 `${this.plugin.settings.aiProvider === "qwen" ? "千问" : "DeepSeek"} 处理中…`（跟随模型按钮状态）。
- 回归：新增 2 条断言（providerLabel 跟随 provider + 旧推断写法禁止再出现）；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-04 — 0.27.2 AI 贴回画布自动找空位 + 聚焦

- Jam 反馈：AI 返回内容触发自动贴画布时会融入/堆叠到现有文本或图片节点，希望能自己找空位放并自动聚焦过去。
- 根因：`createCanvasTextNode` 按 target 右侧/下方固定偏移计算 pos，不检查该区域是否已有节点。
- **新增** `findFreeCanvasRect(canvas, baseCenter, width, height, excludeId)`：
  - 收集画布全部节点 rect（world 坐标），矩形相交判断（24px 安全间距）；
  - 目标位置空闲 → 直接用；被占 → 向右扫描（步长 = 新节点宽 + 80，每行 8 步），一行放不下就下移一行（步长 = 高 + 80，最多 4 行）；全满兜底回原位置（保证至少创建成功）。
- **聚焦**：创建成功后 deselectAll → select(created) → `canvas.zoomToSelection()`（视图拉过去），无该方法回退 wrapperEl.focus()。
- 复用：翻译（sendAiQuick）与 applyAiOperations 的 addCanvasText 都走 createCanvasTextNode，统一受益。
- 回归：新增 3 条断言（finder 存在、放置走 finder、zoomToSelection 聚焦）；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-04 — 0.27.1 修复空预览条占位

- Jam 反馈：预览条在没内容时仍显示。
- 根因：`.jam-deck-ai-image-dock` 显式 `display: flex` 优先级高于 HTML `hidden` 属性（与 imageSearch 工具栏按钮的 `[hidden]` 被 `.clickable-icon` 覆盖是同一类坑），空 dock 一直占位。
- 修复：`.jam-deck-root .jam-deck-ai-image-dock[hidden] { display: none; }`。
- 回归：新增 1 条 styleSource 断言；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-04 — 0.27.0 AI 助手拖图进对话框

- Jam 反馈：不能把剪贴板的图直接拖进 AI 助手对话框，体验不流畅（之前只有 canvas 节点右键打开图片这条路径）。
- **新增**：
  - `setAiImageContext(buf, mime, path, name)`：核心加载（≤15MB 校验 → 压缩至 2048 → 强制切千问 → 设 `aiCanvasContext.kind="image"` → push 图片消息+提示 → 渲染 → 更新预览条），拖/粘/文件三入口共用。
  - `loadAiImageIntoChat(path, name)`：读文件（vault 优先，外部路径走 fs）→ setAiImageContext。
  - `updateAiImageDock` / `clearAiImageDock`：输入框上方预览条（缩略图 44px + 文件名 + × 移除）；重渲染窗口时按 context 恢复。
  - renderAiChat：chat 加 dragover/dragenter/dragleave/drop（CLIPBOARD_DRAG_MIME 剪贴板条目 → CLIPBOARD_DIR 文件；Files → path 或 arrayBuffer；拖拽悬停高亮 `is-jam-deck-ai-drop-target`）；input 加 paste（clipboardData.files 截图 → FileReader → base64）。
- **同步**：toggleAiProvider 切 DeepSeek 降级图片上下文时清 dock；clearAiChat 清 dock；对话里图片消息可被归档（appendAiLog 的 `[图片：文件名]`）。
- 样式：`.jam-deck-ai-image-dock`（accent 虚线条）+ drop 高亮 outline。
- 回归：新增 6 条断言（loader 三入口、dock、paste、drop 高亮）；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-04 — 0.26.0 落盘通用守卫

- 背景：0.25.5 归档 ENOENT 暴露了「`vault.create` 不自动建父目录」这一类问题，决定做成通用守卫强制走，防止再次裸奔。
- 新增（JamDeckPlugin）：
  - `ensureVaultFileParent(filePath)`：取文件路径的父目录递归 `ensureVaultFolder`（幂等）。
  - `writeVaultFile(filePath, content, header)`：先 ensure 父目录，再「存在→read+modify 追加 / 不存在→create 带标题」，返回写入是否成功。
- 三条路径收口：
  - `archiveAiChat` → `this.plugin.writeVaultFile(filePath, block, header)`（替代手写 create/modify + ensureVaultFolder）。
  - `appendAiLog` → `this.writeVaultFile(path, line, "# AI 对话记录")`（Work/AI对话记录.md 之前裸奔）。
  - `CanvasInkOwner.writeText` → 开头 `await this.plugin.ensureVaultFileParent(path)`（笔迹保存裸奔）。
- 审计结论：其余 vault 写路径已自带 ensure（canvas 附件、Life 日报、Work 日报、CLIPBOARD_DIR/ICON_DIR 的 createFolder try/catch）；外部资源 validate（存在性+大小限制）在 readExternalCanvasImage / createCanvasAttachmentFromClipboard 已覆盖，本轮保持。
- 回归：更新 1 条旧断言 + 新增 4 条（ensureVaultFileParent、writeVaultFile、对话记录与笔迹走守卫）；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-04 — 0.25.5 修复归档失败（首次无目标子目录）

- Jam 反馈：AI 助手归档报 `ENOENT: no such file or directory, open '...\attachments\jam-deck-chatbot\2026-08-04.md'`。
- 根因：Obsidian `vault.create` 不会自动建父目录，首次归档时 `attachments/jam-deck-chatbot/` 还没创建过，create 直接抛错。
- 修复：`archiveAiChat` 写入前 `await this.ensureVaultFolder("attachments/jam-deck-chatbot")`（与 canvas 拖入附件逻辑一致），保证子目录就绪。
- 回归：新增 1 条断言（归档必须确保子目录存在）；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-04 — 0.25.4 修复剪贴板拖入 Canvas 失败

- Jam 反馈：拖剪贴板图片到 canvas 提示「图片加入 Canvas 失败 · 剪贴板图片无效」。
- 根因：0.25.2 队列化重构时 drop 处理器对 clipboard 源多取了一层 `.item`（`source.item`），但 `getClipboardCanvasDrop` 返回的 `items: [item]` 元素就是 item 对象本身，再 `.item` 等于 `undefined`，被 `createCanvasAttachmentFromClipboard` 的守卫直接拒绝。external 路径（`source.file/path/name`）不受影响。
- 修复：drop 处理器 clipboard 分支直接传 `source`（即 item）。一行改动。
- 回归：新增 2 条断言（`items: [item]` 形态 + `source.item` 不可再次出现）；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-04 — 0.25.3 大图量平移卡顿优化 + 多图拖入自动排布

- Jam 反馈：S5 赛季 guide 启用中，画布移动卡；希望多图拖入自动排列开。
- **卡顿根因**：`CanvasImageSearchController` 在 root 上每帧 pointermove 都 rAF 同步工具栏，`syncToolbar` 每次跑 `findSelectedImageNode` + `findSelectedAiNode` 两次全量遍历 `canvas.nodes`（每节点 `nodeEl.matches(".is-selected")`）——平移时高频 O(n)，图越多越卡（ink overlay 的 move 非绘制时直接 return，排除）。
- **优化**：① pointerdown 起 `suppressSync` 暂停同步，pointerup/pointercancel 恢复并补一次（平移/拖拽期间完全不扫节点）；② 合并成 `findSelectedNodes()` 单次遍历同时归类 image/text，多选（count>1）仍按原语义返回空；③ 移除 pointermove 直连 sync（选中态变化由 class MutationObserver 兜底）。
- **自动排布**：drop 批次重置 `entry.dropCursorRect`；每个 operation 记 `dropIndex`；`commitCanvasImageDrop` 中第 2 张起按上一张真实 rect `x = prev.x + prev.width + CANVAS_DROP_AUTO_GAP(28)`、同宽高 setData 排布（markMoved + render），随后更新 dropCursorRect 供下一张；单张拖入/剪贴板单卡行为不变。
- 回归：新增 5 条断言（suppressSync、findSelectedNodes 合并、AUTO_GAP、dropCursorRect 排布）；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-04 — 0.25.2 Canvas 多图拖入队列化

- Jam 反馈：不能一口气拖几张图进 Canvas，且问是不是该"轮询"；之前为单开同步卡顿做过限制。
- 根因：① `getCanvasExternalImageDrop` 用 `files.find` 只取第一个图片文件（一次多选拖入只进一张）；② `entry.activeDropOperation` 是单槽锁——上一张还在写（每张都 `saveImmediately` 全量序列化保存）时，新 drop 直接拒绝「上一张图片仍在写入」。
- 修复：
  - `getCanvasExternalImageDrop` 改为收集 transfer 全部图片文件 + file:// uri 去重补充，返回 `sources[]`；clipboard 分支统一成 `items[]`。
  - drop 为每个图片建 operation 入队（`enqueueCanvasDrop`），`drainCanvasDropQueue` 串行执行；dragover 不再因 activeDropOperation 拒绝。`activeDropOperation` 退化为"当前正在跑的 operation"（destroy/回滚语义保留）。
  - 保存优化：`commitCanvasImageDrop` 只在 `operation.batchTail`（队列尾）执行 `saveImmediately` 与 select/focus，中间张仅 `requestSave`（Obsidian 合并保存），单张场景行为不变。
  - 成功 Notice 移出逐张，由队列层汇总「成功 X 张 / 失败 Y 张」；失败细节仍逐张提示。
- 回归：新增 6 条断言（队列入队/串行、batchTail、外部全量收集、旧单槽锁文案移除）；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-04 — 0.25.1 标题栏操作按钮右侧分组

- Jam 反馈：0.25.0 的「归档」「清理」按钮位置奇怪——header 是 `justify-content: space-between`，我直接把按钮插在 provider 按钮与关闭按钮之间，四个子项被均匀分散，按钮散在标题栏中部且显得像消失。
- 修复：把归档 / 清理 / 关闭三个按钮包进 `headerActions`（`jam-deck-ai-chat-actions`，flex + gap 4px），标题与模型按钮独占左侧，操作组整组贴右端、关闭按钮在最右；满足「关闭按钮左侧排列、至少 4px 间距」。
- 回归：新增 1 条断言（actions 分组存在）；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-04 — 0.25.0 AI 对话归档与清理

- Jam 需求：AI 助手要能管理聊天记录——① 归档按钮把当前窗口对话上下文经 DeepSeek 压缩整理后按日期存到 `attachments/jam-deck-chatbot`；② 已归档内容不清理、但不被下次归档重复记录；③ 清理按钮只清窗口上下文，不影响已归档。
- **归档**：新增 `archiveAiChat()`。取 `aiMessages.slice(aiArchivedCount)`（游标去重），序列化为纯文本（图片消息用 `[图片:文件名]` 占位），固定调 `api.deepseek.com/chat/completions`（与当前 provider 无关，用 settings.aiModel）压缩成 ≤150 字纪要；写入 `attachments/jam-deck-chatbot/${YYYY-MM-DD}.md`（存在则 append，不存在 create，`## HH:mm` + 模型/条数头注）。成功后 `aiArchivedCount = aiMessages.length`——已归档对话保留在窗口，但下次归档不再重复。
- **清理**：新增 `clearAiChat()`。清空 `aiMessages`、重置游标与输入，重渲染窗口；只动会话状态，归档文件不受影响。
- **游标生命周期**：`aiArchivedCount` 在 `openAiChatWithCanvasText` / `openAiChatWithCanvasImage` 打开新会话时重置为 0。
- **UI**：标题栏模型按钮右侧新增「归档」「清理」两个胶囊按钮（复用 provider-btn 层级；清理 hover 用 `--jd-danger` 色提示），拖动/pointerdown 事件已按 button 排除，不影响拖头。
- 边界：未配置 DeepSeek Key / 无新增对话 / 压缩失败 / 写入失败均有 Notice 提示；`aiBusy` 期间禁用。
- 回归：新增 8 条断言（archive/clear 存在、归档路径、游标去重、清理不动存档、固定 DeepSeek 端点）；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-04 — 0.24.2 切换 DeepSeek 时降级图片上下文

- Jam 反馈：对图片节点打开 AI（千问看图）对话几轮后，点标题旁模型按钮切到 DeepSeek，发纯文本仍报「看图需要千问（多模态）」。
- 根因：`openAiChatWithCanvasImage` 设置的 `aiCanvasContext.kind === "image"`（含 base64）没有释放机制；`sendAiMessage` 的拦截只看 context 是否非空，不看本轮是否真的传图——纯文本也被当作看图请求拦下。
- 修复：`toggleAiProvider()` 切到 deepseek 且当前为图片上下文时，降级为纯节点上下文 `{canvas, nodeId, rect}`（保留 askDeckAi 的选中节点操作能力），追加一条 assistant 提示说明图片上下文已移除；`sendAiMessage` 拦截逻辑不变（有图时仍必须千问）。
- 回归：新增 4 条断言（看图拦截存在、canvas 图片入口、切 DeepSeek 降级提示、降级判定条件）；`npm run verify` 全绿。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-03 — 0.24.1 对话记录落盘 + 浮钮/窗口双向联动

- Jam 需求：① 聊天记录清得快，专门记录到文档便于回溯；② 聊天窗口跟随悬浮按钮；③ 拖窗口同步移动按钮。
- **记录落盘**：`appendAiLog(role, content, provider)` 追加到 `Work/AI对话记录.md`（时间戳+角色+内容，AI 标注模型；vault.create/modify，不存在自动建；失败不影响对话）。写入时机：sendAiMessage 完成（文字问答、图片问答）与 sendAiQuick 完成（翻译）。
- **双向联动**：位置状态统一存 `settings.aiFabPos`（持久化，DEFAULT_SETTINGS.aiFabPos=null 兼容旧数据）。`updateAiFabPos(x,y)` clamp 后更新 + `layoutAiFabChat()` 重排：FAB 按 pos 定位；chat 贴在 FAB 右侧（右侧放不下自动换左侧、垂直 clamp），`toggleAiChat` 打开时重排。FAB 拖拽与 chat header 拖拽（`is-dragging` 光标，排除按钮点击）共用 updateAiFabPos，pointerup 时 saveSettings。
- `npm run verify` 通过；版本 0.24.0 → 0.24.1。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.24.0 AI 浮钮可拖拽 + 消息可选中/复制

- Jam 需求：① 千问能否出图（答复：不能，出图需通义万相 Wanx 独立异步接口，另行排期）；② AI 悬浮按钮自由移动；③ 对话内容可选中复制。
- **FAB 拖拽**：pointerdown 记录起点 + setPointerCapture，pointermove 边界约束（相对 root，52px 尺寸）更新 left/top（right/bottom 置 auto），pointerup 结束；拖动 >5px 视为移动（click 忽略，避免误开关）；位置存 `aiFabPos`（view 字段），render 重建时恢复；`touch-action: none` + `is-dragging` 样式。
- **消息选中/复制**：`.jam-deck-ai-message-text` 显式 `user-select: text; cursor: text`；气泡 hover 显示复制按钮（copy 图标，`copyAiText` 用 plugin.clipboard.writeText / navigator 兜底），图片消息不显示。
- `npm run verify` 通过；版本 0.23.4 → 0.24.0。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.23.4 流式 fetch 改为 requestUrl（图片对话真正根因）

- Jam 反馈：0.23.3 后图片对话仍 failed to fetch，且纯文字一度也失败。排查线索：**FAB 直接开 AI 对话千问正常（走 askDeckAi→requestUrl），发图片失败（走 streamChatWithImage→fetch）** → 定位到 **Obsidian 渲染进程的 fetch 流式不可用**（此前 0.22.0 流式翻译同样一直受影响，只是未被注意）。
- 修复：`streamChat` 内部从 fetch+SSE 改为 **requestUrl 非流式**（Obsidian 主进程网络栈），`onChunk` 一次回调全文——streamTranslate / streamChatWithImage 及所有调用方接口不变、增量渲染写法兼容。代价：失去流式打字机效果，换取稳定。
- 部署流程验证：本次首次由我 **CloseMainWindow 优雅关闭 Obsidian**（Jam 已授权）→ 部署 → 完成，全程无需 Jam 手动关。
- `npm run verify` 通过；版本 0.23.3 → 0.23.4。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.23.3 修复图片对话 failed to fetch

- Jam 反馈：图片发到对话报 `failed to fetch`。排查：用最小 base64 图实测 Token Plan 端点——返回 400（仅因 1x1 尺寸 <10px 限制），证明**端点、key、多模态格式全部正常**；问题在 Jam 的原图 base64 body（10MB+）导致 fetch 上传超时中断。
- 修复：`compressImageDataUrl`（canvas 缩放最长边 2048px；PNG/WebP 保持格式、JPEG 白底 + 0.85；压缩结果更小时才替换）——body 通常 <2MB；`streamChat` 加 AbortController 90s 超时，超时/网络错误给出明确提示。
- `npm run verify` 通过；版本 0.23.2 → 0.23.3。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.23.2 千问 Token Plan 专属端点自动路由

- Jam 反馈：千问 401 `Incorrect API key provided`。排查：直接实测 API 确认 401 invalid_api_key；key 格式（sk-、114 位、含 -._）正常。查证阿里云官方 FAQ：**Token Plan 个人版专属 API Key 以 `sk-sp-` 开头，与百炼通用 key（sk-）格式不同不可混用；Base URL 专属 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；官方报错表明确 `401 Incorrect API key provided` = 误用百炼通用 Base URL**。
- Jam 是 Token Plan 用户，填了 `sk-` 开头的通用 key + 通用端点 → 必然 401。
- 修复：`getAiConfig()` 千问分支**按 key 前缀自动路由**——`sk-sp-` → Token Plan 专属端点，`sk-` → dashscope 通用端点；设置面板 desc 说明两类 key 的来源与格式。
- `npm run verify` 通过；版本 0.23.1 → 0.23.2。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.23.1 千问默认 qwen3.8-max + AI 身份认知

- Jam 反馈：千问问"你是什么模型"答"未公开"，且要用 qwen3.8-max。查证：**Qwen3.8-Max 2026-08-03 当天发布**，2.4T MoE 旗舰、原生多模态视觉、OpenAI 兼容，API 名 `qwen3.8-max`（百炼预览名 qwen3.8-max-preview）。
- 千问模型下拉更新：qwen3.8-max（默认，推荐）/ qwen3.8-max-preview / qwen-vl-max / qwen-vl-plus / qwen3-vl-plus；DEFAULT_SETTINGS.qwenModel 默认改 qwen3.8-max。
- **AI 身份认知**：askDeckAi 与 streamChatWithImage 的 system prompt 注入 `你运行在 {label}，当前模型是 {model}`——问"你是什么模型"如实回答，不再"未公开"。
- `npm run verify` 通过；版本 0.23.0 → 0.23.1。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.23.0 千问多模态接入 + 模型切换 + 图片对话

- Jam 需求：① 加千问 API（多模态识别），DS 栏位保留；② AI 对话窗加模型切换按钮；③ AI 助手支持发送图片到对话。
- **Provider 路由**：`getAiConfig()` 返回 {baseUrl, apiKey, model, label}——DeepSeek `https://api.deepseek.com` / 千问 `https://dashscope.aliyuncs.com/compatible-mode/v1`（OpenAI 兼容，已查证）。`chatCompletion`（非流式 JSON 通道）与 `streamChat`（流式 SSE 公共方法）统一走 config；`streamTranslate`、`streamChatWithImage`（多模态，user content 数组 image_url base64 + text）复用。
- **设置**：DEFAULT_SETTINGS 加 `qwenApiKey/qwenModel(默认 qwen-vl-max)/aiProvider(默认 deepseek)`；设置面板分三块：DeepSeek（key+模型）、千问（key+模型，视觉）、当前默认模型下拉。
- **模型切换按钮**：对话窗标题旁 `.jam-deck-ai-provider-btn` 胶囊（显示 DS/千问），`toggleAiProvider()` 切换 + Notice + 重渲染 chat。
- **图片对话**：Canvas AI 按钮扩展——`findSelectedAiNode` 接受 text 或 image；图片节点点击 → `openAiChatWithCanvasImage`：vault `readBinary` → `Buffer.toString("base64")`（≤15MB 限制），**自动切千问**（多模态必需），aiCanvasContext.kind="image"，消息区渲染 base64 缩略图；`sendAiMessage` 图片分支走 `streamChatWithImage` 流式问答（描述/配色/构图/风格）。provider 非 qwen 时提示切换。
- `npm run verify` 通过；版本 0.22.1 → 0.23.0。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.22.1 修复间隔悬停绿点失效

- Jam 反馈：悬停组件间隔出现的小绿点经常失效，进编辑模式触发过后才在常态出现。
- 根因：`enableLayoutSashes` 在 render 时用 `placeLayoutSashHandle` 计算 handle 的 `left/top`（基于 widget 的 getBoundingClientRect），此后不更新。窗口/面板缩放、图片加载、canvas-embed 挂载、compact 切换等都会改变 widget 实际矩形 → handle 坐标过期 → probe 的 18px 判定永远不命中。编辑模式切换会触发 `renderAllViews` → 重建 handles（坐标刷新），所以"激活"后正常。
- 修复：`enableLayoutSashes` 增加 `ResizeObserver`（观察 grid + 每个 widget 元素）+ `window.resize` 监听，统一走 rAF 防抖 `scheduleReposition` → `reposition()` 重算所有 handle 位置；`cleanupLayoutSashes` 同步清理 observer/listener/frame。
- `npm run verify` 通过；版本 0.22.0 → 0.22.1。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.22.0 翻译流式提速 + 联网搜索（function calling）

- Jam 需求：① 翻译速度偏慢要优化；② 增加联网搜索，AI 觉得需要搜或用户说"搜索"时触发。
- **翻译流式**：`streamTranslate(text, lang, onChunk)` 新通道——原生 `fetch` + `stream:true`，SSE 逐块解析 delta.content 增量渲染（渲染进程 Electron fetch 支持流式，requestUrl 不支持）。语种按钮走该通道：system prompt 极简（只输出翻译结果，不包 JSON）、**不注入待办上下文**（输入更小、首字更快）、temperature 0.3。`sendAiQuick` 流式填充气泡，完成后 `createCanvasTextNode` 创建节点。
- **createCanvasTextNode 抽取**：applyAiOperations 的 addCanvasText 分支与流式翻译共用（size {width,height}、创建后 getData 校验、save:false 统一 requestSave、幽灵节点清理）。
- **联网搜索**：askDeckAi 请求加 `tools: [{web_search}]` + `tool_choice: "auto"`，system prompt 说明"需要最新/实时信息或用户要求搜索时调用"。`chatCompletion(payload)` 公共请求方法；有 tool_calls 时执行 `webSearch(query)`（**DuckDuckGo HTML 主源**、cn.bing.com 兜底，UA 伪装，正则提取标题/链接/摘要，最多 5 条）→ 结果作为 tool 消息回填 → 第二轮请求出最终 reply。**注意：加 tools 后去掉 response_format json_object（避免与 function calling 互斥），JSON 输出靠 system prompt 约束 + fallback 解析**。
- 端到端实测（真实 API Key）：tools 请求返回 `tool_calls=["web_search:{query:深圳今天天气}"]` ✓；流式返回 145 chunks ✓；DuckDuckGo 抓取 10 条结果 ✓（Bing 当前反爬返回 0 块，仅作兜底）。
- `npm run verify` 通过；版本 0.21.3 → 0.22.0。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.21.3 修复 AI 翻译长文本截断

- Jam 实机反馈：翻译一段约 800 字符的英文，结果只翻译了开头几句（"为什么少了这么多字"）。根因：`openAiChatWithCanvasText` 注入 AI 的 `canvasContext.text` 做了 `slice(0, 300)`——AI 只看到原文前 300 字符，自然只翻译了开头。对话消息里虽展示了完整文本，但 askDeckAi 的上下文独立构建，不含消息历史。
- 修复：上下文文本上限 300 → **8000 字符**（DeepSeek 1M 上下文无压力）；payload 增加 `max_tokens: 8192` 防止长翻译输出被模型默认上限截断。
- 注意：Canvas 文本节点 text 由 `getData().text` 读取，展示与注入用同一份（展示不截断，注入截 8000 防爆上下文）。
- `npm run verify` 通过；版本 0.21.2 → 0.21.3。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.21.2 AI 翻译语种快捷选项

- Jam 反馈：翻译语种做成选项更快。实现：选中文本节点点 AI 按钮后，`renderAiChat` 在消息列表底部渲染 `.jam-deck-ai-quick` 行（`渲染为：中文 / 英文 / 韩文 / 日文` 四个胶囊按钮）。
- 点击按钮 → `sendAiQuick(lang)`：预填输入框"把选中文本翻译成X"→ 复用 `sendAiMessage` 完整发送链路 → 移除选项行（`aiQuickDone = true` 防止重建后重复出现）。
- 显示条件：`aiCanvasContext.nodeId` 存在且 `!aiQuickDone`；`openAiChatWithCanvasText` 重置 `aiQuickDone = false`。普通 FAB 打开对话（无节点上下文）不显示快捷选项。其他要求仍走输入框。
- `npm run verify` 通过；版本 0.21.1 → 0.21.2。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.21.1 修复 addCanvasText 幽灵节点（0,0,0,0）

- Jam 实机反馈：翻译后 Canvas 卡了一下，重载后看不到结果（测试板 S5赛季Guide.canvas）。排查：`.canvas` 文件里 4 个新文本节点中 1 个正常（ecee9a21，含 x/y/width/height），3 个为 `x:0,y:0,width:0,height:0` 幽灵节点（0299af42、4e282770、4f408570）。
- 根因：`canvas.createTextNode` 的 `size` 参数格式错误——我传了 `{x, y}`，Obsidian 内部（解包 obsidian-1.13.4.asar 确认 `createTextNode` → `moveAndResize(L8(pos, size, position))`）期望 `{width, height}`（`defaultTextNodeDimensions` 即 `{width,height}`）。size 读取 undefined → 节点落位 NaN/0；部分节点渲染时按内容自适应出尺寸（英文那个正常），其余留在 0 尺寸。连续创建 + 内部自动 requestSave 也造成卡顿。
- 修复：`size: { width, height }`；`save: false` 统一由外部 `requestSave()` 保存；**创建后 `getData()` 校验 width/height > 0**，不合法立即 `canvas.nodes.delete` + `destroy` 清理，绝不留下幽灵节点。
- 遗留：测试板的 3 个幽灵节点在 `.canvas` 文件里（Obsidian 运行中不可直接改），下次 Jam 关 Obsidian 部署时一并脚本清理（备份后删 0 尺寸 text 节点）。
- `npm run verify` 通过；版本 0.21.0 → 0.21.1。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.21.0 Canvas 选中工具栏：Eagle 仅图片 + 文本节点 AI 翻译

- Jam 反馈：① 选中文本节点时 Eagle 搜图按钮也出现；② 希望选中文本节点时有 AI 按钮，把文本送进 AI 对话、补充语种后翻译，结果以文本节点贴在原文右/下方。
- ① 修复：`CanvasImageSearchController.syncToolbar` 原来用 `button.hidden` 控制 Eagle 按钮，但 Obsidian 原生 `.canvas-menu .clickable-icon` 样式会覆盖 `[hidden]`（按钮常驻显示）。改为**内联 `style.display`** 控制（`this.selectedNode ? "" : "none"`），优先级最高，文本节点选中时正确隐藏。
- ② 新增：`findSelectedTextNode()`（单选 + `jamDeckCanvasStackKind(data) === "text"`）+ `ensureAiToolbarButton()`（同 `.canvas-menu`，`message-circle` 图标，`.jam-deck-canvas-ai-toolbar` 类）。点击调用 `deckView.openAiChatWithCanvasText(node, canvas)`：读取节点 `getData().text`，重置对话（清空 aiMessages/aiInputValue），把文本作为 user 消息 + 引导语加入，打开对话窗并 focus 输入框；同时记录 `aiCanvasContext = {canvas, nodeId, text, rect}`。
- 新操作 `addCanvasText`：`askDeckAi` 注入 Canvas 目标节点上下文（id/type/text/rect 世界坐标），system prompt 增加该 action（text 必填、targetNodeId 必填、position right/down）；`applyAiOperations` 新增分支——`canvas.nodes.get(nodeId)` 取目标，按 right（x+w+gap）/ down（y+h+gap）算新节点中心，`canvas.createTextNode({pos, position:"center", size, text})` + `requestSave()`，尺寸按文本长度/行数估算（宽 200–480、行高 22）。
- `sendAiMessage` 把 `this.aiCanvasContext` 透传给 askDeckAi / applyAiOperations；普通待办对话时该字段为 undefined，行为不变。
- `npm run verify` 通过；版本 0.20.2 → 0.21.0。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.20.2 AI 对话窗放大与能力边界说明

- Jam 实机反馈：① 对话窗太小，② 在聊天窗口让它"继续开发 JamDeck"表现不符合预期。处理：
- 对话窗 340×480 → **680×780**（`max-width/max-height` 约束保留，副屏空间不足时自动收缩）。
- system prompt 追加能力边界：AI 助手只操作待办；开发/写代码/跑命令类请求不编造，reply 引导"请用 WorkBuddy 会话完成"并可将需求转述为待办（如「开发 JamDeck：XXX」）。避免模型对越界请求产生无效操作或幻觉回复。
- `npm run verify` 通过；版本 0.20.1 → 0.20.2。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.20.1 AI 助手重构为悬浮对话窗

- Jam 实机反馈 0.20.0 两个问题：① 只有输入框、看不到 AI 输出，不像 chatbot；② 主功能栏下方展开面板位置尴尬。重构为**右下角悬浮 AI 胶囊按钮（FAB）+ 悬浮对话窗**。
- 对话窗：340×480、`position: absolute` 相对 `.jam-deck-root`（root 已有 `position: relative`），圆角 `--jd-radius-lg`、柔和阴影；头部标题 + 关闭按钮；消息列表（用户右对齐墨色 9% 底、AI 左对齐纸面底 + 细边框气泡，hint 低对比）；底部 auto-grow 输入 + 发送。消息历史 `aiMessages` 存 view 实例字段，`renderAllViews` 重建时恢复；`aiMessagesEl` 自动滚动到底。
- 发送流：追加用户气泡 → 追加"处理中…"气泡 → `askDeckAi` 返回 `{reply, operations}`（system prompt 增加 reply 字段与"纯提问返回空 operations"规则）→ `applyAiOperations` 执行（空数组不再抛错，返回全 0）→ 把"处理中"气泡原位替换为 `reply + 执行统计`。错误同样原位替换为错误消息。`applyAiOperations` 签名保持数组。
- 悬浮按钮可键盘操作（tabindex=0，Enter/Space 开合），`is-user` 用 `--jd-ink` 9% 混合不引入新色板；荧光绿仅 input focus 细环。
- 移除 0.20.0 的 toolbar AI 按钮、`.jam-deck-ai-panel`/`.jam-deck-ai-status` 及其方法（toggleAiPanel/renderAiPanel/setAiBusy/renderAiStatus）。`npm run verify` 通过；版本 0.20.0 → 0.20.1。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-03 — 0.20.0 AI 对话助手（DeepSeek V4）

- 起因：外部脚本直接改 `data.json` 会被运行中插件的内存副本定时保存覆盖（2026-08-03 连续两次踩坑：Obsidian 定时自动保存 + 关闭时保存都会整份写回旧数据）。结论是不再走外部写盘，改在插件内部原生修改。
- 主功能栏新增 AI 入口（第五入口，`jam-deck-action`）：点击展开/收起极简输入面板（`.jam-deck-ai-panel`），输入框 auto-grow（scrollHeight 自适应，上限 160px），Enter 发送、Shift+Enter 换行，发送中按钮变 `…` 且禁用。面板状态（展开/输入内容/上次结果）存在 view 实例字段，`renderAllViews` 重建时恢复，不丢内容。
- 接入 DeepSeek Chat Completions（OpenAI 兼容，`https://api.deepseek.com/chat/completions`，`requestUrl` 调用，桌面端无 CORS）：`askDeckAi` 注入当前进行中/已完成待办 + 本地日期作上下文，`response_format: json_object` + temperature 0.2，system prompt 限定只返回 `{"operations":[...]}`（addTask / completeTask / deleteTask，≤20 条，text≤120 字，dueDate 必须 YYYY-MM-DD，category 限 work/life）。
- `applyAiOperations` 直接操作内存 `settings.deckTasks`（addTask 用 `makeDeckTask` 支持 dueDate/category；completeTask 仅 active；deleteTask 按 id），统一一次 `saveSettings` + `renderAllViews`，与手点按钮同路径，无外部写盘竞态。归档（写日记）涉及日记同步，第一版不开放，避免误写。
- 设置面板新增 `JamDeckSettingTab`：DeepSeek API Key（password 输入，仅存本地 data.json）+ 模型下拉（deepseek-v4-flash 默认 / deepseek-v4-pro）。`DEFAULT_SETTINGS` 增加 `aiApiKey: ""`、`aiModel: "deepseek-v4-flash"`（`loadSettings` 的 Object.assign 天然兼容旧数据）。
- 测试：`tests/jam-deck-test.js` 的 obsidian mock 补齐 `PluginSettingTab/Setting/normalizePath/requestUrl`。`npm run verify` 通过（build:game-deck + check + 全部回归）。
- 版本同步 0.19.6 → 0.20.0（manifest / package / CHANGELOG 一致）。
- 处理模型签名：具体模型标识不可见（主代理/实现与验证）

## 2026-08-02 — 0.19.6 背板实机渲染与固定层序

- 实机截图确认 0.19.5 只有图片和前片，CSS `background-image` 背板没有实际渲染。背板改为 `createFolderView` 直接生成 Figma 240×181.79 路径的内联 SVG，不再依赖插件资源 URL 或缓存。
- 背板、真实代表图、前片和 header 分别锁定 39、40–43、45、46 层，代表图层使用 `!important` 抵抗 Obsidian 原生节点内联 z-index 变化；无独立遮罩，旧堆叠开合路径不变。`npm run verify` 通过。受保护部署备份为 `.jam-deck-backup-20260802-222943-e9d0f920`，`data.json` 保持 `63CD4774…57474`（18860 bytes）；Obsidian 1.13.4 深色主题实机确认灰色背板页签已出现在图片后、前片前。
- 处理模型签名：GPT-5（主代理/实现与验证）

## 2026-08-02 — 0.19.5 Figma 底板、圆角链与无遮罩层序修正

- 再次读取 Figma `NZS4 / 102:6`，确认设计层级没有独立遮罩；`createFolderView` 删除 mask DOM，折叠层序固定为 backboard → 真实 representatives → front → header，旧堆叠展开、悬停抬起、拖出和颜色列表不变。
- 找到“底板缺失”的几何根因：此前把含透明阴影边距的 240×181.79 SVG 压缩进 200×141.79 容器，使可见路径仅约 166.7px 宽。现在以 120%×128.21% 和 50%/40% 定位恢复 Figma 原始溢出；移除矩形 CSS 阴影并使用 SVG 自带路径阴影，底部圆角不再被方形阴影削平。
- 图片节点、`.canvas-node-container`、`media-embed` 与图片本体逐层复用 10px 圆角，容器和媒体层强制裁切；前片最终级联保持 x=0/y=50/w=200/h=100、四角 10px。回归测试锁定无遮罩 DOM/CSS、底板溢出几何、圆角裁切链和原有预览生命周期。
- 版本同步为 0.19.5，`npm run verify` 通过；受保护部署后源码与运行副本的 `main.js`、`styles.css`、`manifest.json`、底板 SVG 哈希一致，个人 `data.json` 部署前后保持 `79627102…97D80`（18664 bytes），备份为 `.jam-deck-backup-20260802-215449-68fd5f8a`。
- Obsidian 1.13.4 实机视觉检查已在原测试 Canvas 完成：200×150 文件夹的完整底板比例、代表图圆角、前片四角与右下双凹槽均可见；只改变 Canvas 视口缩放/平移，没有编辑节点。继续自动点击检查开合时 Windows 控制返回 `0x80070005`，未重复抢占；开合与收拢路径由既有 DOM/生命周期回归通过。
- 处理模型签名：GPT-5（主代理/集成）、gpt-5.6-luna（Executor：CSS/底板/圆角）、gpt-5.6-luna（Executor：DOM/回归测试）、gpt-5.6-luna（实现审计）

## 2026-08-02 — 0.19.4 Figma 文件夹完成态、磨砂开合与原生 Canvas 安静让渡

- 重新读取 Figma `NZS4 / 102:6` 的节点层级而不依赖中文 frame 名称，建立 0/2/3/4 代表图 fixture：200×150 壳体内显式使用背板 SVG、x=2/y=41/w=196/h=98 遮罩、四组真实代表图坐标/尺寸/旋转、x=0/y=50/w=200/h=100 前片、数量/“编组”文字和两道凹槽。装饰层全部 pointer-transparent，SVG 透明角不再被矩形底色填平。
- 前片材质参考 `fayazara/portfolio-site-template/src/components/Folder.astro`：小面积固定 16px blur/180% saturate、半透白色渐变、内侧白环与柔和多层阴影；点击文件夹继续打开旧 stack preview，前片翻开后卡片散开，关闭时先等卡片 260ms 回位再用 600ms 合拢。drag-out、pointercancel、viewport 变化、Esc、空白点击、销毁和 reduced-motion 均清理状态，不解散编组。
- 原生 Canvas 卡住的生命周期闭环改为 quiet teardown：owned detached leaf 有明确 ownership，原生扫描排除自有 leaf；冲突集合规范化并以单 timer/串行 promise 调和。暂停只销毁 Jam Deck 自有控制器/监听器并卸载 owned leaf，跳过 `saveImmediately`、`view.close` 和 workspace 激活/布局操作；同路径最后一个原生 leaf 关闭后 fresh mount 一次。
- 图片 drop 和 Eagle 搜索纳入 entry 的异步销毁屏障：冲突暂停先 closing/abort，再等待在途任务结算，任何后续节点创建、保存和 Notice 都以 entry/token/signal 校验为前提；画笔 owner 只在这些任务停止后完成一次独立 sidecar 安全落盘，不写原生 `.canvas`。回归覆盖 100 事件 burst、双 native leaf、owned leaf 排除、路径规范化、敏感 API 零调用、异步穿透、文件夹层序/材质/预览开合与 timer 清理。
- 版本同步为 0.19.4，`npm run verify` 最终通过。Obsidian 主窗口正常退出后完成受保护部署并重新启动；源码与运行副本的 `main.js`、`styles.css`、`manifest.json`、背板 SVG 哈希一致，个人 `data.json` 保持 `2CB26771…59C1DD2`（17974 bytes），备份为 `.jam-deck-backup-20260802-203120-e9edeee3`。
- Obsidian 1.13.4 实机检查：原生 `Study/灵感感念.canvas` 打开时 Jam Deck 显示暂停态，关闭最后一个原生标签后约 1 秒只恢复一次；折叠文件夹点击可散开 6 张旧 stack preview 卡片，点击空白后卡片先回位并完成前片合拢；颜色圆钮可展开横向 6 色圆点列表。检查仅改变临时视口/选择状态，结束时关闭预览、色值列表和选区，没有编辑 Canvas 节点。
- 处理模型签名：GPT-5（主代理/集成）、gpt-5.6-sol（Planner）、gpt-5.6-terra（Advisor）、gpt-5.6-luna（Executor：Figma 视觉与动效、Canvas 生命周期与异步 teardown、独立代码审查）

## 2026-08-02 — 0.19.3 按 Figma 重做文件夹外观并恢复旧堆叠交互

- 以 Figma `NZS4` 节点 `102:6` 为唯一视觉基准：折叠壳体固定为 200×150 世界尺寸并随 Canvas 缩放，以锚点中心定位；使用 Figma 导出的背板 SVG，前片按 200×100、10px 圆角、`#e7e7e7 → #f2f2f2` 渐变与 `0 -4px 8px rgba(0,0,0,.05)` 实现。节点数与“编组”分别使用 8px/20% 和 12px/50% 的文字层级，只保留右下颜色圆钮与两道凹槽。
- 明确文件夹只是旧堆叠的折叠皮肤，不引入第二套展开语义：点击文件夹壳体代理到既有 stack preview，原有卡片展开、点击聚焦、拖出及周边节点避让继续工作；移除壳体上的展开、聚焦和解散常驻按钮，避免再次把一次点击解释为取消编组。
- 修复 `CanvasImageStackController.onPointerDown` 中误插入的未定义 `shell` 访问，该异常曾让任意节点 pointerdown 都中断，从而造成按住悬浮、点击展开和手拖自动成组同时消失。显式文件夹预览以 `folder:*` 外部 cluster 注册，在 reconcile 时保活并于收拢/销毁时清理。
- 多选工具栏“网格排列”改用 Obsidian 内置并已核验存在的 `layout-grid` 图标；新增真实 pointer 事件、文件夹预览代理、外部 cluster 生命周期、200×150 几何、Figma CSS/资产及部署白名单回归。版本同步为 0.19.3，`npm run verify` 通过。
- 已关闭 Obsidian 后受保护部署并重新启动 Jamnote；`main.js`、`styles.css`、`manifest.json` 与 Figma SVG 资产均与源码哈希一致，个人 `data.json` 保持 `2CB26771…59C1DD2`（17974 bytes），备份为 `.obsidian/plugins/.jam-deck-backup-20260802-181952-e9bbd798`。Obsidian 1.13.4 主窗口运行且响应；Windows 截图助手因 `0x80070005` / `0x80070057` 无法完成视觉点击冒烟，未以自动截图替代人工界面验收。
- 处理模型签名：GPT-5（主代理/集成）、gpt-5.6-sol（Planner）、gpt-5.6-terra（Advisor）、gpt-5.6-luna（Executor：堆叠交互恢复、网格图标、Figma 视觉与折叠几何）

## 2026-08-02 — 0.19.2 修复文件夹缩略图遮挡与启动恢复

- 实机复现 0.19.1 折叠文件夹只剩彩色封面：紧凑节点高度下 `min-height: 52px` 会盖住整个上方缩略图区。封面改为下方 58% 且最多占 `100% - 28px`，单列/双列真实代表成员可继续从封面上方露出并保留轻微旋转。
- `CanvasFolderController` 在代表成员应用展示 transform 前捕获其屏幕矩形；折叠、展开、收拢阶段壳体优先使用该稳定矩形，展开恢复时清理，避免已缩放/旋转几何反馈进下一帧边界。新增源码契约回归测试。
- 启动恢复期间先临时禁用 Jam Deck 验证 Jamnote Vault 可稳定打开，再恢复原测试 Canvas 与插件；重新启用后可持续加载并写回新的编组操作，未改写个人 `data.json`。版本同步为 0.19.2，`npm run verify` 通过。
- 处理模型签名：GPT-5（主代理/集成）、gpt-5.6-sol（Planner）、gpt-5.6-terra（Advisor）、gpt-5.6-luna（Executor：核心动效、视觉、测试、实机视觉审计与修复）

## 2026-08-02 — 0.19.1 Canvas 文件夹动效与运行时收口

- Canvas 文件夹展开/收拢改为五态 runtime 状态机：展开 300ms、收拢 260ms，成员错峰 18ms（最多 72ms），同时插值标准 `transform` 与 `opacity`；减少动态效果或 WAAPI 不可用时直接落到最终布局。
- 文件夹壳体按稳定 ID 使用 keyed view，移除全量 overlay 清空；只保留真实 Canvas 成员作为代表，不 clone、不 reparent。展开 2–4 个成员使用两列，5 个及以上使用三列，6 个即 3×2；颜色菜单使用 leaf 内单一 popover 与 6 个可访问 radio。
- `anchorNodeId` 仅作为 runtime group 别名，schema v1 的八个可持久化字段和 `jamdeck.folderId`/`jamdeck.folder` 边界不变。聚焦只由显式按钮设置 `focusRequestToken`，展开完成后消费一次并按最新成员过滤，空集合不 zoom、不写数据；事务 rollback、销毁清理、拖拽阈值与原生 Canvas 交互保持回归覆盖。
- 版本同步为 0.19.1（`manifest.json`、`package.json`、`package-lock.json`、`CHANGELOG.md`）；更新 README、架构说明和 Spatial 视觉规范，`npm run verify` 通过。
- 处理模型签名：GPT-5（主代理/集成）、gpt-5.6-sol（Planner）、gpt-5.6-terra（Advisor）、gpt-5.6-luna（Executor：核心动效、视觉、测试与文档）

## 2026-08-02 — 0.19.0 Canvas 文件夹编组

- 新增 `CanvasFolderController`：支持手拖节点在严格超过较小节点面积 50% 时自动建组；多选工具栏提供“堆叠编组”和“网格排列”，新组默认折叠。
- 文件夹关系写入 Canvas 节点 `jamdeck.folderId` 与锚点 `jamdeck.folder` schema v1，不触碰插件 `data.json`；折叠壳体可整体移动、展开、循环 6 色、聚焦和取消编组，预览最多 4 个真实代表成员，单个居中、多个双列并带稳定轻旋转，非代表隐藏且无常驻 clone。
- 显式文件夹与旧隐式混合堆叠分开处理；每次编组、整组移动、网格布局、颜色/折叠状态和取消编组共用一次 Canvas history/save 事务，失败时逐节点回滚。原生 group 未作为权威，因为 Obsidian 1.12.7 的 group 没有可靠 `memberIds`，移动只按包围盒包含关系推断。
- 版本同步为 0.19.0（`manifest.json`、`package.json`、`package-lock.json`、`CHANGELOG.md`）；更新 README、架构说明和 Spatial 视觉规范，`npm run verify` 通过。
- 处理模型签名：GPT-5（主代理/集成）、gpt-5.6-sol（Planner）、gpt-5.6-terra（Advisor）、gpt-5.6-luna（Executor：核心、视觉、能力调查、测试、代表成员集成、文档）

## 2026-08-02 — 0.18.5 修复 Eagle 图片拖入卡死

- 复核 Eagle 拖图后渲染进程升至约 2GB，发现 `.canvas` 曾被截断为 0 字节；新增嵌入 Canvas 专属外部图片 drop handler，拦截 `Files` / `file://` 图片，先受控复制到 `attachments/jam-deck-canvas-assets/`，再创建单一图片节点。
- 外部图片读取上限为 64MB，避免异常大图直接进入 Canvas 解码；空 Canvas 文件返回暂停状态，不再启动原生视图重试循环。
- 保留剪贴板拖图链路，新增路径解析、附件队列和完整回滚；`npm run verify` 通过。
- 本轮处理模型签名：GPT-5（主代理）

## 2026-08-02 — 0.18.4 修复原生 Canvas 切换卡死

- 复核发现 Obsidian 1.13 的工作区 `children` 可能不是普通数组，0.18.3 的 `Array.isArray(children)` 判断会把已打开的原生 Canvas 误判为未挂载，导致 Jam Deck 与原生页面同时渲染同一 `.canvas`。
- Canvas 叶节点识别现在先排除 Jam Deck 自有叶；`getLeavesOfType("canvas")` 返回的其余叶都按原生候选处理，不依赖数组形状、活动状态或 DOM 是否连接，同一路径的原生 Canvas 会可靠触发冲突保护。
- 冲突变化不再调用 `renderAllViews()`，而是只销毁/恢复对应的 Canvas 嵌入壳，避免 workspace 事件、Canvas open/close 和整页重建互相触发形成渲染循环。
- 曾出现的渲染进程约 1.24GB 占用已通过命令行停止并重启；当前 Canvas 已先备份到 `D:\Project\JamDeck\debug-backups\灵感感念.canvas.20260802-113125.bak`。
- `npm run verify` 通过；本轮部署前后仍执行受保护备份并保留个人 `data.json`。
- 处理模型签名：GPT-5（主代理）、GPT-5.6-sol（分析代理）

## 2026-08-02 — 0.18.3 避免 Canvas 双实例并行渲染

- 定位到同一 `.canvas` 文件在 Jam Deck 与 Obsidian 原生页面各有一套完整 CanvasView；两套视图同时监听文件变化、维护节点与重绘，会让原生拖动明显卡顿，极端情况下互相等待造成假死。
- Canvas 运行适配器现在识别已挂载的原生 Canvas leaf；检测到同一路径时不创建第二个嵌入实例，已存在的嵌入实例也会被关闭并显示“原生页面编辑中，已暂停渲染”的轻量状态。
- 工作区 `layout-change` / `active-leaf-change` 经过 120ms 防抖后检查冲突集合；原生 Canvas 关闭后自动重建 Jam Deck 嵌入视图，避免需要手动刷新。
- `npm run check`、`npm test` 通过；受保护部署完成后个人 `data.json` 保持 `84377798…E9BB0BB3`（17271 bytes），最新备份为 `D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260802-112528-f7fedf9b`。
- 处理模型签名：GPT-5（主代理）

## 2026-08-02 — 0.18.2 修正以图搜图入口位置

- 根据界面复核确认 0.18.1 实际挂到了 Canvas 底部 `.canvas-card-menu` 新建节点工具栏，已改为使用 Obsidian 原生 `canvas.menu.menuEl` / `.canvas-menu` 选中节点工具栏；底部主工具栏不再出现以图搜图按钮。
- 搜索按钮使用原生 `clickable-icon` 类，并由 `.canvas-menu` 的原生布局负责按钮大小、间距、投影与明暗主题；控制器只在单选图片节点时插入、选区变化时同步并在销毁时移除。
- 保留前一版前 10 个结果、5×2 网格和源图尺寸布局；新增静态回归断言，确保搜索入口不再解析 `cardMenuEl`。
- `npm run verify` 通过后受保护部署到 Vault 运行副本；部署前关闭 Obsidian，部署后重新启动；个人 `data.json` 保持 `E4F94068…DFDA892`（17051 bytes）未覆盖，最新备份为 `D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260802-111133-54b8259a`。
- 处理模型签名：GPT-5（主代理）、GPT-5.6-sol（分析代理）

## 2026-08-02 — 0.18.1 Canvas 以图搜图工具栏与 5×2 结果网格

- 复核 0.18.0 后将以图搜图入口从图片节点右上角的临时悬浮按钮迁移到原生 Canvas 上方悬浮工具栏；仅单选图片节点时显示，复用画笔入口的工具栏底板、按钮尺寸、阴影和明暗主题，工具栏重建后自动补回且不重复。
- Eagle 搜索请求和结果解析上限统一收敛为 10 张；结果按 API 返回顺序保留，不改变素材本体与 Eagle 管理边界。
- 结果节点沿用源图的 Canvas 宽高，按 5 列×2 行、40 世界单位间距排在源图下方；移除原图右侧同位堆叠路径，搜索结果不会再被通用堆叠识别覆盖。
- 批量创建继续以一次 Canvas 历史提交，发生异常时移除本次已创建节点并保存回滚；成功提示改为“原图下方”。
- 更新 README、CHANGELOG、版本号至 0.18.1；补充 `resultGridLayout` 导出并保留旧 `stackLayout` 兼容别名。
- `npm run verify` 通过（Game Deck 构建、两份语法检查、Jam Deck 与 Game Deck fixture 全部通过）；补充了以图搜图上限、5×2 网格和工具栏作用域回归断言。
- Obsidian 运行副本已通过命令行关闭后受保护部署，`main.js`、`styles.css`、`manifest.json` 与项目源一致；个人 `data.json` 保持 `43FDD778…0BA7942`（16785 bytes），备份为 `D:\jam16\Jamnote\.obsidian\plugins\.jam-deck-backup-20260802-105300-e84c3558`。
- 部署后已重新启动 Obsidian；本轮未使用 Computer Use，未做界面截图冒烟，待 Jam 在 Canvas 中选中图片确认工具栏按钮和网格位置。
- 处理模型签名：GPT-5（主代理）、GPT-5.6-sol（分析代理）

## 2026-08-01 — 0.18.0 Canvas 图片 Eagle 以图搜图

- 新增 `CanvasImageSearchController`（随 Canvas entry 挂载/销毁）：rAF 合并的 pointermove 命中 `.canvas-node`，经 `jamDeckCanvasStackKind` 确认图片节点后在节点右上角显示圆形按钮；堆叠预览、图片聚焦与拖拽期间隐藏；按钮 pointerdown/click 双拦截，不触发原生选中与拖动。
- 搜索链路：`vault.readBinary` 读图片字节，`jamDeckEagleSearchBody` 手工构造 multipart（文件名消毒、limit 字段），`requestUrl` POST 到 ai-search 固定端口 `127.0.0.1:38766`。该服务有 DNS Rebinding 白名单与 CORS null，浏览器 fetch 不可达；requestUrl 走 Node 层天然绕过。
- 结果解析：响应 `{success, results:[{id,score}]}` 截前 20（`jamDeckEagleTopResults`），逐一读 `JAM收集.library/images/{id}.info/metadata.json` 拼出 vault 相对路径与像素宽高比；软排除的文件 `adapter.read` 与 `getAbstractFileByPath` 仍可用；`isDeleted`、缺名/缺扩展名的结果跳过。
- 插入布局：`jamDeckEagleStackLayout` 让全部结果落在原图右侧 40px 同一位置（与原图同宽、按各自宽高比定高），与既有 50% 重叠规则天然形成一个混合堆叠；`createFileNode` + `setData` 后一次 `requestPushHistory.run()` 合并为单次撤销，任一步失败移除已创建节点并重新保存。
- 配套迁移（Jam 委托执行）：Eagle 库从 `D:\jam16\JAM收集.library` 迁入 vault `D:\jam16\Jamnote\JAM收集.library`，robocopy 分三轮合并（中途一次部分移动被完整收拢，13851 item 无丢失，仅一个 item 目录曾被拆半已拼回）；`.obsidian/app.json` 的 `userIgnoreFilters` 软排除库目录——不进入 Obsidian 索引，但 canvas 仍可按路径引用渲染；Eagle 侧资源库路径存在 leveldb 未直接改，首次打开需手动指向新位置。
- 回归覆盖：控制器挂载/销毁、固定端口与 requestUrl、20 上限、multipart 构造与文件名消毒、metadata/item 路径、已删除过滤、堆叠布局（回退宽高比与同位成堆）、按钮样式作用域与暗色主题；`npm run verify` 通过。
- 处理模型签名：GLM-5.2（主代理，WorkBuddy）

## 2026-08-01 — Game Deck 0.3.0 32×18 正方形网格与 Blender 资产骨架

- 网格从 24×16 改为 32×18，`CELL` 从 1.3 改为 1，使每格在世界与 Blender 里都是 1×1 正方形，整片地块宽高比正好 16:9，固定镜头取景与编辑态 `aspect-ratio` 一致。
- `MIN_W/H` 降为 2；默认三件物件按新网格重排。`dataVersion` 升到 2：旧 24×16 不迁移坐标，加载时重置为默认布局并写回。
- 用本机 `D:\Blender 5.2\blender.exe --background` 跑 `game-deck/assets/build_blend.py`，生成 `game-deck.blend`：集合 `GameDeck → grid/props/foliage/scenery/terrain/lighting`，子集合 `house/chest/musicbox/grass_blade/...`，各方块占位 + 参考太阳/补光/相机；约定与重建方式写在 `assets/README.md`。
- 回归锁定 32×18、CELL=1、16:9，以及 `.blend` / 构建脚本中的集合与对象名。`npm run verify` 通过；Game Deck 0.3.0 受保护部署，`data.json` 保持 `AEFFF3A5…E37E97`（511 bytes），备份 `.game-deck-backup-20260801-230118-c1ea9c87`。下次打开会因 `dataVersion` 升到 2 重置为新网格默认排布。
- 处理模型签名：Cursor Grok 4.5（主代理）

## 2026-08-01 — Game Deck 0.2.0 固定镜头与首屏卡顿修复

- Jam 反馈「刚打开非常卡」。定位到三处：`GROUND_SEGMENTS = 190` 让 36481 个顶点在启动时各跑一次 `heightAt`（多次三角函数）与 `Color.setHSL`（带色彩管理转换）；5.8 万草叶实例的矩阵合成；以及 `shadowMap` 每帧重烤。草本身一直是 `InstancedMesh`，不是实例化缺失的问题。
- 地面细分降到 110；草叶降到 3.2 万且每叶顶点 10→8，改用向中心收拢的幂次采样（指数 1.35），实测地块区域仍是 15.3 根/㎡（原 5.8 万均匀分布为 15.8），地块后方降到 10 根/㎡ 交给雾过渡。
- `renderer.shadowMap.autoUpdate = false`，改为布局变化 120 帧、悬停开合 45 帧的按需重烤；像素比上限 1.75→1.35；雾拉近到 45/118 让远处无草地带化入天色。
- 镜头固定：新增 `frameDistance()`，以正前方 48° 俯视方向对地块 8 个角点（含 8 单位建筑净高）二分求最小距离，留 6% 边距，`resize` 时重算，移除 OrbitControls 与 `resetView`/`focusOn`。固定视角顺带让草叶可以一次性按由近到远排序命中 early-z。
- 树冠与云各自 `mergeGeometries` 合成单个几何体（树冠双色靠烘焙顶点色保留）、石头改 `InstancedMesh`，场景 draw call 约 160→60。视图先画出「正在生成草原…」并隔两帧再建场景，配合 `renderer.compileAsync` 预编译 shader。
- 新增回归：固定镜头在 1.9 / 1.6 / 1.1 三种宽高比下都要把地块 8 个角点收进 NDC 且贴边（最远角 > 0.85），窄窗口距离必须更远；另断言无 OrbitControls、阴影非逐帧、草叶排序、地面细分上限与几何体合并。`npm run verify` 通过，Game Deck 0.2.0 受保护部署，`data.json` 保持 `AEFFF3A5…E37E97`（511 bytes），备份 `.game-deck-backup-20260801-175546-be6863b2`。
- 处理模型签名：Claude Opus 5（主代理）

## 2026-08-01 — 0.17.3 单组件右下角独立缩放

- 修正 0.17.2 把外边界交点统一解释为整条 sash 的问题：`jamDeckCollectLayoutNodes` 在 edge 交点精确查找右下角 owner，唯一命中时写入 `widgetId`。
- 新增 `jamDeckResizeWidgetAtCorner`；带 owner 的 `xy` 节点直接以 pointer 增量修改该组件 `w/h`，不再调用横纵 sash，因此播放器、剪贴板和 Canvas 的右下角互不牵连。
- 外边界中段节点继续走 `jamDeckApplySashDelta` 统一收缩贴边组件；没有 owner 的内部十字节点仍保持四周联动，视觉样式不增加新层级。
- 回归覆盖截图对应三个 owner、播放器/剪贴板/Canvas 各自独立缩放、相邻组件完全不变以及 UI 分流；`npm run verify` 通过。0.17.3 受保护部署后 `data.json` 保持 `B36A116A…337FCB`（16892 bytes），回滚备份为 `.jam-deck-backup-20260801-180943-c3a4039c`。
- 处理模型签名：Codex / GPT-5（主代理）

## 2026-08-01 — 0.17.2 外边界圆点与最大组件自动切分

- `jamDeckCollectLayoutSashes` 把当前布局包围盒的右边界、底边界建成 `edge:end` sash；与内部横/竖缝组合后自动生成右侧交点、底部交点和右下角三个 `xy` 节点，复用既有 9px 绿色圆点交互。
- 外边界增量支持在机械 2×2 下限与画布上限之间双向夹紧；向内拖统一缩短所有贴边组件，重新收集节点时 sash 跟随新的最大占用边界，因此圆点不会在第一次收缩后消失。
- 新增 `jamDeckInsertWidgetByCompressingLargest`：默认尺寸和最小完整尺寸均找不到独立空位时，按面积、持久化顺序和稳定 ID 选择最大可压缩组件，以损失面积较小的右切/下切方向插入新组件。
- `addWidget` 改为原子生成下一布局；自动切分只改变目标最大组件，保存失败恢复旧数组，没有组件能保持机械下限时才提示无法让位。
- 回归覆盖截图对应的三个外边界节点、右/底整体收缩、边界跟随与反向恢复，以及最大面积组件选择、最小完整尺寸插入、无关组件固定和全局无碰撞；`npm run verify` 通过。0.17.2 受保护部署后 `data.json` 保持 `E01AB589…F55AED`（18667 bytes），回滚备份为 `.jam-deck-backup-20260801-174437-3479c5ed`。
- 处理模型签名：Codex / GPT-5（主代理）

## 2026-08-01 — 0.17.1 编辑态空白区域自由放置

- 修复编辑拖放只识别矩形填充槽和零缝推挤点的问题：新增 `direct` 落位，鼠标下方原尺寸矩形通过边界与碰撞校验后即可直接提交。
- 自由放置保留组件原宽高，并根据 pointerdown 时组件内的抓取偏移计算目标坐标；同一空白区内拖动不会把组件强制居中到鼠标，也不会扰动无关组件。
- 普通拖动按“原尺寸自由放置 → 填充槽 → 零缝推挤”决策；按住 Shift 时仍优先执行画布边缘延伸填充，避免破坏既有显式操作。
- 新增回归夹具覆盖自由区域提交、尺寸保持、无关组件不动、完整尺寸预览与抓取偏移传递；`npm run verify`（双插件构建、语法检查与测试）通过。0.17.1 受保护部署后 `data.json` 保持 `FB2007AF…FAC8D7`（18561 bytes），回滚备份为 `.jam-deck-backup-20260801-172447-5ae179c1`。
- 处理模型签名：Codex / GPT-5（主代理）

## 2026-08-01 — 0.17.0 / Game Deck 0.1.0：拆成两个插件，草原世界落地

- Jam Deck 侧做减法：删除 `VIEW_TYPE_GAME_DECK`、`GameDeckWorldView`、骰子 ribbon、`openGameDeck`、`game-deck-world.js` 及其样式，`scripts/deploy.ps1` 的可选文件列表恢复为三件套；回归断言反过来锁定「主插件不得再出现 GameDeck 字样」。
- Game Deck 侧独立成插件：`game-deck/`（manifest id `game-deck` + styles.css + esbuild 产物 main.js）与 `game-deck/src/`（ESM 源码），`scripts/build-game-deck.mjs` 打包、`scripts/deploy-game-deck.ps1` 部署；后者允许首次建目录，但仍校验目标 manifest id 并对 `data.json` 做前后哈希比对。
- 布局引擎按同源算法移植为 `game-deck/src/layout.js`（24×16 网格、最小 3×3）：矩形填充、零缝隙推挤、Shift 贴边、缝隙合并与间距节点、单块缩放全部保留纯函数形态，直接被 `tests/game-deck-test.mjs` 覆盖。
- 世界层：`terrain.js` 中心平坦四周丘陵的高度函数，`wind.js` 把风的位移注入到 `project_vertex` 之后（instanceMatrix 之后才位移，整片草才朝同一方向倒），`grass.js` 用 5.8 万草叶 + 900 朵野花的 InstancedMesh 并在建筑落地时剔除脚下草，`scenery.js` 提供树冠摇摆与飘云，`props.js` 程序化生成房屋（山墙屋顶 + 炊烟 + 暖光窗）、箱子（掀盖）、音乐盒（开盖转发条飘音符）。
- 交互闭环：浏览态悬停抬起加名牌、点击选中出说明卡；「编辑地块」切到 2D 覆盖层（3D 停帧省电），完成后按新布局带动画归位。视觉沿用 Spatial 规范——细边、小圆点、绿色渐变缝隙提示，无厚重色块。
- `npm run verify` 通过（打包 + 双插件语法检查 + jam-deck fixture + game-deck 断言）。
- 处理模型签名：Claude Opus 5（主代理）

## 2026-08-01 — 0.16.2 紧凑组件恢复改为共享边界压缩

- 修复水印恢复只会移动整块组件、锁死邻居尺寸而误报“没有足够空间”的问题：优先复用现有横/竖 sash，把目标组件与下方或右侧组件的公共边界直接推开。
- 恢复只补齐未达到完整显示阈值的轴；例如音乐播放器宽度已经足够、仅高度被压扁时，保留宽度并向下扩高，同时保持下方 Canvas 底边不动、压缩其高度。
- sash 压缩受机械最小尺寸、网格边界和全局碰撞校验约束；无法完整恢复时再进入原有确定性整块让位，提交失败仍原子回滚。
- 新增上下相邻音乐播放器 / 原生 Canvas 回归夹具，覆盖共享边界恢复、既有宽度保留、下方组件压缩及无碰撞约束；完成 `npm run verify`。0.16.2 受保护部署后 `data.json` 保持 `98FC6765…321F3F`（19134 bytes），回滚备份为 `.jam-deck-backup-20260801-152656-2641e2ab`。
- 处理模型签名：Codex / GPT-5（主代理）

## 2026-08-01 — 0.16.1 编辑态圆点缩放与即时内容恢复

- 移除编辑态组件右下角 `jam-deck-resize-handle` 斜杠及独立 resize 事件，编辑态和浏览态统一挂载间距绿色圆点。
- sash 的高频样式写入、紧凑状态切换和圆点重定位改为每个动画帧合并一次，pointermove 只更新最新布局快照。
- 紧凑组件保留已挂载的标题、正文和 Canvas/浏览器等内容；CSS 仅隐藏显示。拖动尺寸一旦达到该类型完整显示阈值，立即切换 `is-compact-live-full` 显示真实内容，松手仅原子保存。
- 更新回归断言并完成 `npm run verify`（含 GameDeck 构建、语法检查和全部 fixture）；0.16.1 受保护部署后源/运行文件哈希一致，`data.json` 保持 `7C78F9E8…126742`（18013 bytes），备份为 `.jam-deck-backup-20260801-145819-248075be`。Obsidian 已重新启动并实机确认编辑态无右下角斜杠，随后恢复浏览态。
- 处理模型签名：Codex / GPT-5（主代理）

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
