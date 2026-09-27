# Jam Deck 项目约定

- 与 Jam 使用中文沟通。
- 后续功能开发必须同时考虑 Windows 与 macOS Apple Silicon（M 系列，当前目标机为 M5、最新系统）。涉及录音、文件路径、进程、权限或系统 API 时分别实现与验证；不能把 Windows 专用路径当成通用方案。缺少某个平台的实机环境时，明确记录未验证项，不宣称该平台已实测通过。
- 每次收到 Jam 的新需求，第一条回复必须给出预计耗时范围，并简要说明采用“快速 / 标准 / 深度”哪一级验证，让 Jam 先判断是否值得继续。
- 非大型功能、非顽固 Bug、非生命周期/持久化等高风险修改默认走快速验证：一次差异审查、项目强制测试、一次部署与必要视觉检查；没有发现异常时不得反复检查同一细节。只有测试失败、实机结果不符或风险确实较高时才升级验证级别，并及时说明新增耗时。
- `D:\Project\JamDeck` 是唯一开发源；不要直接在 Vault 插件目录开发。
- Obsidian 运行副本位于 `X:\jam16\Jamnote\.obsidian\plugins\jam-deck`，只能通过部署脚本更新。
- `data.json` 是个人运行数据，禁止复制、提交、覆盖或删除。
- **`data.json` 会被"旧结构"覆盖，新增的 settings 字段可能整段丢失（2026-09-27 两次事故，根因未定论）**。当天 `deckRoutines` 九条模板与全部实例丢了两次，第二次发生在整体重启、确认进程数归零之后，所以**不能简单归因为热重载僵尸**。已确证的事实与已排除项如下，下次遇到照这个清单走，别重复我的误判：
  - **可靠判定手法**：读磁盘 `data.json` 的顶层 key 数与清单。当前代码的 `loadSettings` 一定会把 `deckRoutines` 补成数组，因此**磁盘缺这个 key 就说明最后一次写入不是当前实例做的**（事故时磁盘 37 个 key，运行中实例内存 38 个）。再对比文件 mtime 与 `clipboardItems[0].ts`：两次事故中它们都精确吻合到秒，且内容正是用户刚复制的文字。
  - 已排除：插件重复注册（`app.plugins.manifests` 只有一条 `jam-deck`，指向正确目录）；部署备份目录被当插件加载（`.jam-deck-backup-*` 未出现在 manifests 里）；代码层面的丢字段路径（全仓只有一处 `this.settings = ...` 赋值，`saveSettings` / `setAppearance` / `pollClipboard` 全部保存 `this.settings` 全量）。
  - 两个仍未排除的嫌疑：① `plugin:reload` 残留的旧实例仍在轮询剪贴板并持有旧 settings 快照；② **vault 位于坚果云 FUSE 挂载盘**（`X:` 卷标 `zhanghonglicloud`，`FileSystem=FUSE`，本机运行 `NutstoreDriverSvc`），云端把旧版本同步回来覆盖本地。第二次事故中同一句复制被记成两个不同时间戳（21:46:50 与 21:47:08），说明**存在两个各自写盘的写入方**，但本机进程列表只有一个 Obsidian。未见坚果云冲突副本。
  - 因此操作纪律（无论最终根因是哪个都适用）：一次会话内**不要连续多轮 reload**，改动攒一起、部署后只重载一次；**新增会被持久化的 settings 字段、或改动 `saveSettings` 链路后，部署完整体重启 Obsidian**；种入或修改运行数据后**立刻复核磁盘 key 清单**，并在几分钟后再复核一次，确认没有被回滚；涉及运行数据的改动先备份 `data.json` 到 `debug-backups/`。
  - 若再次复现，优先做这个判别实验：记下 mtime → 用 eval 让当前实例保存一次 → 立刻读磁盘确认 key 数为 38 → 静置观察 mtime 是否在无人操作时自行变化。mtime 自行变化即指向云同步；仅在复制后变化且 key 数掉回 37 即指向旧实例写入。
- 修改后至少运行 `npm run verify`。
- 发布到 Obsidian：**无需关闭 Obsidian**（正常运行不锁插件文件），`npm run deploy`（部署目标 = 环境变量 `JAM_DECK_TARGET_PLUGIN_DIR`，未设置则需 `npm run deploy -- -TargetPluginDir <目录>` 显式传参；脚本拒绝无目标静默执行）；部署后用 `Obsidian.com plugin:reload id=jam-deck vault=Jamnote` 热重载（JS 与 CSS 一并刷新）。仅在 Obsidian 处于异常状态（如 GPU 崩溃残留 zombie 进程锁文件）时才需先关闭再部署。
- Obsidian 启停：**GUI 启动用 `Obsidian.exe`**（不是 Obsidian.com——它只是 CLI wrapper）。**RDP 会话下 GPU 进程常崩溃**（`GPU process isn't usable`），必须带参数：
  ```
  Obsidian.exe --disable-gpu --disable-gpu-sandbox --in-process-gpu
  ```
  其中 `--disable-gpu-sandbox` 是关键 flag（缺它会闪退）。带这三参启动时 Obsidian 1.13 不会进 CLI 模式，参数透传给 Electron，无 FATAL。**长期方案**：进入设置 → 外观 → 关闭「硬件加速」后，无参双击即可。优雅关闭用 `CloseMainWindow`。CLI 操作（plugin:reload / eval / dev:screenshot 等）走 `Obsidian.com <command> vault=Jamnote`。
- **CLI 通道依赖启动方式（2026-09-27 实测）**：由脚本 / `Start-Process` 启动的 Obsidian **不注册 CLI 通道**，此后所有 `Obsidian.com <command>` 一律返回 `The CLI is unable to find Obsidian`，带不带那三个 GPU 参数都一样；无参启动在 RDP 下又必然 GPU FATAL 闪退。于是形成两难：agent 能把 GUI 拉起来，但拉起来的实例用不了 CLI。**结论：需要 CLI 时必须请 Jam 自己启动 Obsidian**（双击），agent 脚本启动只用于「把被自己关掉的窗口还原」这种兜底场景。CLI 不可用时，验证改走直接读 `data.json`（只读），视觉确认交给 Jam。
- **唯一可以直接改 `data.json` 的窗口是 Obsidian 完全退出时**（无实例持有内存态）。这属于数据恢复等例外情形，且必须：先备份到 `debug-backups/`（已 gitignore）→ 读取-修改-写回而非整体覆盖 → 写后立刻重新解析并比对顶层 key 数、`deckTasks` 长度、`widgets` 与密钥字段完好 → 启动后复核插件是否正确读到。日常情况下仍然禁止碰它。
- 保持 `manifest.json`、`package.json` 与 `CHANGELOG.md` 版本一致。
- 每次功能变更同时更新 `docs/DEVELOPMENT_LOG.md` 和 Obsidian 的 `Work/Jam Deck.md`/`log.md`。
- `docs/DEVELOPMENT_LOG.md`、`CHANGELOG.md` 和 Obsidian 的 `Work/Jam Deck.md` / `log.md` 中，每条新变更必须在末尾注明工具、模型与角色，格式为 `工具：<实际工具名>；处理模型签名：<模型标识>（<角色>）`。工具名必须明确写 Codex、Cursor、WorkBuddy 等实际执行工具，不能只写模型。若 Planner、Advisor、Designer、Executor 或其他子代理实际参与，同一行追加所有参与工具、模型与角色；不得猜测不可见的内部模型版本，无法确认时明确写 `具体模型标识不可见`，但不能因此省略已知工具名。
- Canvas 适配依赖 Obsidian 内部视图 API；修改生命周期、拖拽或持久化前必须补回归测试。
- 任何 UI 功能变更前必须先阅读 `docs/VISUAL_DESIGN.md`，复核 Spatial 白板规范；不得因新增功能引入厚重日期格、列表卡片墙或大面积荧光底色。
- 状态默认使用小圆点、细环、轻分隔和文字层级；工作/生活分类放在待办标题前，不另起一行堆叠彩色胶囊。

## 架构与实现原则

- 不保留向后兼容。过时的路径直接删，不写兼容层、fallback 或 migration。
- 选能满足当前需求的最简单实现。不做预防性抽象，不加多余的配置层与间接层。
- 系统分层渐进增长：先跑通最小的端到端版本，再在可运行的产品上叠加新能力。绝不为了未完成的复杂度拆掉能跑的东西。
- 组件保持模块化，关注点清晰分离。
- 当成熟、有人维护的库能降低整体复杂度或提升可靠性时优先选用；没有明确理由不重写通用功能。
- 写自己的实现或加新包之前，先看项目里已有依赖能做什么；不先查文档和类型，就不要假设库缺某个能力。
- 架构决策往长了做。不接受"先这样、以后再换"的临时方案。
- 先看成熟产品怎么解决同一个问题，用已验证的模式，别从零发明。

## Git 与协作约定

- 分支策略（0.30.0 起）：`master` 为发布主干，`develop` 为日常开发集成分支；日常功能在 `develop` 上提交（大功能可再开 `feat/<主题>` 从 develop 分出，merge 回 develop），发布时合回 `master` 并打 tag + GitHub Release。merge 前必须 `npm run verify` 全绿。
- 提交纪律：完成一个原子改动就 commit，**commit 后立即 push 备份**（push 私有仓库 ≠ 发布；发布仅指打 tag + gh release，由 Jam 拍板）。不留长时间未提交/未推送的窗口——只 commit 不 push 是单点，2026-08-06 事故教训。
- 多 agent 协作：同一时刻只允许一个 agent 持有写权限（唯一写者）；写操作顺序固定为 代码 → verify → 日志/CHANGELOG → commit → push，push 前不放手。**禁止任何会话直接操作主工作区的 `.git` 元数据（gc / filter-repo / reset 等），历史重写必须先征得 Jam 同意**。
- `CHANGELOG.md`、`docs/DEVELOPMENT_LOG.md` 由完成该任务的写者在 commit 前更新并带完整签名。提交前必须逐条核对本次新增或修改的变更记录是否包含工具、模型与角色，并核对 Obsidian 两份笔记对应条目的签名一致；发现遗漏先补齐，再 commit。只核对本次变更，不凭猜测补写其他历史记录。
- `data.json` 永不入库；`.workbuddy/`、`debug-backups/` 已 gitignore。
