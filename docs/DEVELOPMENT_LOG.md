# Jam Deck 开发日志

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
