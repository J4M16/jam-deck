# 多 Agent 协作约定

JamDeck 由多个 AI agent 协同开发。常见形态：**多个 agent 并行写不同功能**。本约定为此设计。

## 核心原则：一个写者，一个工作区

- git 同一目录只有一份工作区、一个当前分支——**两个 agent 不能在同一个目录里同时写**：后落盘者覆盖前者，或 commit 时卷入对方未提交的半成品。
- 并行写的正确姿势：每个写者一个独立工作区，用 git 原生命令开出：
  ```
  git worktree add D:\Project\JamDeck-<任务名> feat/<主题>
  ```
  各写各的目录、各交各的分支，物理隔离，真并行成立。
- 单目录、单任务时无需 worktree，直接在 `D:\Project\JamDeck` 干。
- 只读工作（分析、测试、review）不受限，任何时刻可做。
- 任务合并完成后清理：`git worktree remove` + 删分支，不留残垣。

## 分支模型

- `master`：主干，始终可部署，与 GitHub 同步。
- `feat/<主题>`：功能分支，从 master 拉出，配独立 worktree 目录。
- 分支短命（以天计）：做完即合回合删，不养长期分叉。

## 提交纪律

- 原子提交：任务切小步，每步 verify 全绿即 commit，不留长时间未提交的工作区。
- 危险窗口 = 从开始改到 commit 之间。worktree 隔离后，窗口只威胁本写者自己。
- push 前本地 verify 必须通过；GitHub CI 再守一道。

## 合并与冲突

- **merge 串行执行**：一次只合一个分支，由 agent 跑，merge 前 verify 全绿。
- git 是行级三方合并：不同功能改不同区域 → 自动合，无需人工。
- 改到同一行附近才冲突——由执行 merge 的 agent 读两边代码语义先解；**拿不准的列给 Jam 拍板，不硬猜**。
- 冲突率控制三件套：小步提交、短命分支、功能边界切清楚。

## 日志规则

- `CHANGELOG.md` 与 `docs/DEVELOPMENT_LOG.md` 由完成任务的写者更新（文件顶部追加新版本段），条目末尾带模型签名。
- 版本号三处一致：`manifest.json` = `package.json` = `CHANGELOG.md`。

## 禁区

- `data.json` 永不入库、不复制、不覆盖、不删除。
- `.workbuddy/`（AI 工作记忆）、`debug-backups/` 已 gitignore，不入库。
- 历史重写（filter-repo / rebase 公共分支）前必须确认无其他写者在场。

> 真实事故（2026-08-06）：两个会话在同一目录同时开写，一方的删除在另一方眼里成了"灵异事件"。worktree 隔离从物理上消灭这类互踩。
