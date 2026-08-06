# Jam Deck 项目约定

- 与 Jam 使用中文沟通。
- 每次收到 Jam 的新需求，第一条回复必须给出预计耗时范围，并简要说明采用“快速 / 标准 / 深度”哪一级验证，让 Jam 先判断是否值得继续。
- 非大型功能、非顽固 Bug、非生命周期/持久化等高风险修改默认走快速验证：一次差异审查、项目强制测试、一次部署与必要视觉检查；没有发现异常时不得反复检查同一细节。只有测试失败、实机结果不符或风险确实较高时才升级验证级别，并及时说明新增耗时。
- `D:\Project\JamDeck` 是唯一开发源；不要直接在 Vault 插件目录开发。
- Obsidian 运行副本位于 `D:\jam16\Jamnote\.obsidian\plugins\jam-deck`，只能通过部署脚本更新。
- `data.json` 是个人运行数据，禁止复制、提交、覆盖或删除。
- 修改后至少运行 `npm run verify`。
- 发布到 Obsidian：**无需关闭 Obsidian**（正常运行不锁插件文件），`npm run deploy`（部署目标 = 环境变量 `JAM_DECK_TARGET_PLUGIN_DIR`，未设置则需 `npm run deploy -- -TargetPluginDir <目录>` 显式传参；脚本拒绝无目标静默执行）；部署后用 `Obsidian.com plugin:reload id=jam-deck vault=Jamnote` 热重载（JS 与 CSS 一并刷新）。仅在 Obsidian 处于异常状态（如 GPU 崩溃残留 zombie 进程锁文件）时才需先关闭再部署。
- Obsidian 启停：**GUI 启动用 `Obsidian.exe`**（不是 Obsidian.com——它只是 CLI wrapper）。**RDP 会话下 GPU 进程常崩溃**（`GPU process isn't usable`），必须带参数：
  ```
  Obsidian.exe --disable-gpu --disable-gpu-sandbox --in-process-gpu
  ```
  其中 `--disable-gpu-sandbox` 是关键 flag（缺它会闪退）。带这三参启动时 Obsidian 1.13 不会进 CLI 模式，参数透传给 Electron，无 FATAL。**长期方案**：进入设置 → 外观 → 关闭「硬件加速」后，无参双击即可。优雅关闭用 `CloseMainWindow`。CLI 操作（plugin:reload / eval / dev:screenshot 等）走 `Obsidian.com <command> vault=Jamnote`。
- 保持 `manifest.json`、`package.json` 与 `CHANGELOG.md` 版本一致。
- 每次功能变更同时更新 `docs/DEVELOPMENT_LOG.md` 和 Obsidian 的 `Work/Jam Deck.md`/`log.md`。
- `docs/DEVELOPMENT_LOG.md` 的每条新变更必须在末尾增加处理模型签名，格式为 `处理模型签名：<模型标识>（<角色>）`。若 Planner、Advisor、Designer、Executor 或其他子代理实际参与，同一行追加所有参与模型与角色；不得猜测不可见的内部模型版本，无法确认时明确写 `具体模型标识不可见`。
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

- 主干分支为 `master`；功能开发走 `feat/<主题>` 分支，merge 前必须 `npm run verify` 全绿。
- 提交纪律：完成一个原子改动就 commit，不留长时间未提交的工作区（未提交窗口是多 agent 互踩的唯一时机）。
- 多 agent 协作：同一时刻只允许一个 agent 持有写权限（唯一写者）；写操作顺序固定为 代码 → verify → 日志/CHANGELOG → commit，commit 前不放手。
- `CHANGELOG.md`、`docs/DEVELOPMENT_LOG.md` 由完成该任务的写者在 commit 前更新并带模型签名。
- `data.json` 永不入库；`.workbuddy/`、`debug-backups/` 已 gitignore。
