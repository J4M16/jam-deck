# Jam Deck 项目约定

- 与 Jam 使用中文沟通。
- 每次收到 Jam 的新需求，第一条回复必须给出预计耗时范围，并简要说明采用“快速 / 标准 / 深度”哪一级验证，让 Jam 先判断是否值得继续。
- 非大型功能、非顽固 Bug、非生命周期/持久化等高风险修改默认走快速验证：一次差异审查、项目强制测试、一次部署与必要视觉检查；没有发现异常时不得反复检查同一细节。只有测试失败、实机结果不符或风险确实较高时才升级验证级别，并及时说明新增耗时。
- `D:\Project\JamDeck` 是唯一开发源；不要直接在 Vault 插件目录开发。
- Obsidian 运行副本位于 `D:\jam16\Jamnote\.obsidian\plugins\jam-deck`，只能通过部署脚本更新。
- `data.json` 是个人运行数据，禁止复制、提交、覆盖或删除。
- 修改后至少运行 `npm run verify`。
- `GameDeck` 分支同时维护第二个独立插件 Game Deck（id `game-deck`，源码 `game-deck/src`）。改其源码后需 `npm run build:game-deck`（verify 已包含），部署用 `npm run deploy:game-deck`（目标 `.obsidian/plugins/game-deck`）。详见 `docs/GAME_DECK.md`。
- 发布到 Obsidian 前先禁用 Jam Deck 或关闭 Obsidian，再运行 `npm run deploy`。新版本部署完成后：若 Obsidian 未运行，必须主动启动 Obsidian；若 Obsidian 已运行，则重新启用或重载 Jam Deck，确保用户实际进入新版本。
- 部署时优先通过命令行检查、关闭和启动 Obsidian 进程，避免 Computer Use 抢占 Jam 的鼠标与键盘；只有确实需要界面实机验证时才使用 Computer Use。
- 保持 `manifest.json`、`package.json` 与 `CHANGELOG.md` 版本一致。
- 每次功能变更同时更新 `docs/DEVELOPMENT_LOG.md` 和 Obsidian 的 `Work/Jam Deck.md`/`log.md`。
- `docs/DEVELOPMENT_LOG.md` 的每条新变更必须在末尾增加处理模型签名，格式为 `处理模型签名：<模型标识>（<角色>）`。若 Planner、Advisor、Designer、Executor 或其他子代理实际参与，同一行追加所有参与模型与角色；不得猜测不可见的内部模型版本，无法确认时明确写 `具体模型标识不可见`。
- Canvas 适配依赖 Obsidian 内部视图 API；修改生命周期、拖拽或持久化前必须补回归测试。
- 任何 UI 功能变更前必须先阅读 `docs/VISUAL_DESIGN.md`，复核 Spatial 白板规范；不得因新增功能引入厚重日期格、列表卡片墙或大面积荧光底色。
- 状态默认使用小圆点、细环、轻分隔和文字层级；工作/生活分类放在待办标题前，不另起一行堆叠彩色胶囊。
