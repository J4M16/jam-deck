# 多 Agent 协作约定

JamDeck 由多个 AI agent 协同开发（主模型负责 plan/review，执行子代理负责批量实现）。所有 agent 共享同一个工作目录 `D:\Project\JamDeck`——同一时刻只有一份工作区文件，这个事实决定了以下全部规则。

## 核心原则：唯一写者

- 同一时刻只允许一个 agent 持有写权限；其他 agent 只读：分析、测试、review。
- 写操作顺序固定：**代码 → `npm run verify` → CHANGELOG / DEVELOPMENT_LOG → commit**。
- commit 前不放手：开始写就一口气写到提交，不留半成品在工作区。

## 危险窗口

从「开始改」到「commit」之间是危险窗口：两个 agent 同时写同一文件时，后落盘者整体覆盖前者，没有任何合并过程。对策只有两条：

1. **原子提交**：任务切成小步，每步都是 verify 全绿的完整状态，完成即 commit。
2. **分支隔离**：功能开发走 `feat/<主题>` 分支，各自提交各自的，merge 时 git 按行三方合并（改不同区域自动合，改同一行才需人工）。

> 真实事故（2026-08-06）：并行会话的 agent 在剥离 Game Deck 时误删本仓库 `docs/`、`scripts/`、`tests/`（未提交），靠 `git restore` 从 HEAD 全数恢复。未提交的一切都是悬空的。

## 分支模型

- `master`：主干，始终处于可部署状态。
- `feat/<主题>`：功能分支，从 master 拉出，verify 全绿后 merge 回 master。
- 远程仓库为 GitHub 私有库；push 前本地 verify 必须通过。

## 日志规则

- `CHANGELOG.md` 与 `docs/DEVELOPMENT_LOG.md` 由完成任务的写者更新（文件顶部追加新版本段），条目末尾带模型签名。
- 版本号三处一致：`manifest.json` = `package.json` = `CHANGELOG.md`。

## 禁区

- `data.json` 永不入库、不复制、不覆盖、不删除。
- `.workbuddy/`（AI 工作记忆）、`debug-backups/` 已 gitignore，不入库。
- 任何 agent 不得在未确认无其他写者的情况下执行 `git filter-repo`、rebase 等历史重写操作。
