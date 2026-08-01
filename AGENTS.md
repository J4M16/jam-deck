# Jam Deck 项目约定

- 与 Jam 使用中文沟通。
- `D:\Project\JamDeck` 是唯一开发源；不要直接在 Vault 插件目录开发。
- Obsidian 运行副本位于 `D:\jam16\Jamnote\.obsidian\plugins\jam-deck`，只能通过部署脚本更新。
- `data.json` 是个人运行数据，禁止复制、提交、覆盖或删除。
- 修改后至少运行 `npm run verify`。
- `GameDeck` 分支同时维护第二个独立插件 Game Deck（id `game-deck`，源码 `game-deck/src`）。改其源码后需 `npm run build:game-deck`（verify 已包含），部署用 `npm run deploy:game-deck`（目标 `.obsidian/plugins/game-deck`）。详见 `docs/GAME_DECK.md`。
- 发布到 Obsidian 前先禁用 Jam Deck 或关闭 Obsidian，再运行 `npm run deploy`。新版本部署完成后：若 Obsidian 未运行，必须主动启动 Obsidian；若 Obsidian 已运行，则重新启用或重载 Jam Deck，确保用户实际进入新版本。
- 保持 `manifest.json`、`package.json` 与 `CHANGELOG.md` 版本一致。
- 每次功能变更同时更新 `docs/DEVELOPMENT_LOG.md` 和 Obsidian 的 `Work/Jam Deck.md`/`log.md`。
- `docs/DEVELOPMENT_LOG.md` 的每条新变更必须在末尾增加处理模型签名，格式为 `处理模型签名：<模型标识>（<角色>）`。若 Planner、Advisor、Designer、Executor 或其他子代理实际参与，同一行追加所有参与模型与角色；不得猜测不可见的内部模型版本，无法确认时明确写 `具体模型标识不可见`。
- Canvas 适配依赖 Obsidian 内部视图 API；修改生命周期、拖拽或持久化前必须补回归测试。
- 任何 UI 功能变更前必须先阅读 `docs/VISUAL_DESIGN.md`，复核 Spatial 白板规范；不得因新增功能引入厚重日期格、列表卡片墙或大面积荧光底色。
- 状态默认使用小圆点、细环、轻分隔和文字层级；工作/生活分类放在待办标题前，不另起一行堆叠彩色胶囊。
