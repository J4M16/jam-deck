# Jam Deck 发布就绪计划（P0 / P1）

> 目标：让别人拿到 GitHub 地址 → 下载 → 启用 → 填自己的 API key → 用上全部功能。
> 当前版本 0.29.4（master，`J4M16/jam-deck`，私有）。功能本体完整，本计划只补"拿到、装上、会配"的包装层。
> 执行约束：所有任务遵守 `AGENTS.md`——改代码必跑 `npm run verify`、`docs/DEVELOPMENT_LOG.md` 带模型签名、功能分支 `feat/<主题>`、原子提交。并行领任务时遵守 `docs/COLLABORATION.md` 的 worktree 规则。

## 决策点（Jam 拍板，不派给 agent）

- **可见性**：转公开（`gh repo edit --visibility public`）还是保持私有只发 zip？——必须在 P0-1 泄漏扫描通过后执行。

---

## P0 — 发布门槛（缺一项就别发）

### P0-1 泄漏扫描（安全闸，最先做）

- **现状**：仓库从未公开过，内含开发期痕迹。
- **任务**：
  1. 扫全部入库文件 + git 历史中的 API key 模式：`sk-`、`sk-sp-`、`ghp_`、`Bearer `、各类 token 正则
  2. 扫个人标识：`D:\jam16`、`zhanghongli`、其他私人路径/账号
  3. 已知点：`scripts/deploy.ps1` 的默认 `TargetPluginDir` 含个人路径——改为中性示例值或加注释说明"开发者自行修改"
- **产出**：扫描报告（命中清单 + 处置：删/改/确认无害）
- **验收**：0 个 key/密码级泄漏；个人路径全部有处置结论

### P0-2 LICENSE

- **任务**：仓库根新建 `LICENSE`，MIT，版权行 `Copyright (c) 2026 Jam`
- **验收**：push 后 GitHub 仓库页正确识别并显示 MIT

### P0-3 Release v0.29.4

- **背景**：Obsidian 插件手动安装 = 下载 `main.js` + `styles.css` + `manifest.json` 到 `.obsidian/plugins/jam-deck/`。BRAT（社区 beta 安装器）也按 release 拉取。
- **任务**：
  1. `git tag v0.29.4` 并 push
  2. `gh release create v0.29.4 main.js styles.css manifest.json --title "v0.29.4" --notes <从 CHANGELOG 0.29.x 摘要>`
  3. 校验：release 页三件套可下载；tag 版本号 = manifest.json 版本号（BRAT 硬性要求）
- **验收**：用一个干净的测试 vault 手动安装 release 三件套，插件能启用

### P0-4 README 安装与上手段

- **任务**（在现有 README 顶部区域插入，不动功能描述部分）：
  1. **安装**：方式 A——release 下载三件套放入 `.obsidian/plugins/jam-deck/`，重启/刷新插件列表后启用；方式 B——BRAT 添加 `J4M16/jam-deck`
  2. **快速上手**：启用后打开 Jam Deck 视图 → 「添加组件」→ 需要 AI 功能时到设置页填千问或 DeepSeek key
  3. **API key 指引**：千问（阿里云百炼/Token Plan 申请入口；**sk-sp- 前缀 key 必须配 Token Plan 专属端点**，sk- 通用 key 配百炼端点——插件按前缀自动路由）；DeepSeek 官方平台 key
- **验收**：找一个没接触过本项目的人/agent，只凭 README 5 分钟内完成安装到出图

### P0-5 可见性执行

- **前置**：P0-1 通过、Jam 已拍板
- **任务**：转公开则 `gh repo edit J4M16/jam-deck --visibility public`；保持私有则改为产出 zip 分发包（三件套打包，发文件而非链接）
- **验收**：无 GitHub 账号的第三方能按 P0-4 的指引完成安装

---

## P1 — 体验项（能用 → 好用）

### P1-1 归档路径设置项

- **现状**：工作归档写死 `Work/工作日记/YYYY-MM-DD.md`，生活归档写死 `Life/Daily.md`——这是 Jam 的 vault 结构，别人的 vault 语义不通。
- **任务**：设置面板新增「工作归档目录」（默认 `Work/工作日记`）与「生活归档文件」（默认 `Life/Daily.md`）两项；归档逻辑改读设置；`ensureVaultFolder` 兜底保留
- **验收**：改设置后归档落自定义路径；默认值行为与现状完全一致；回归测试加断言；verify 全绿

### P1-2 全新 vault 首次启动验证

- **任务**：干净测试 vault（无 Jam 的目录结构、无 data.json）启用插件，走查：默认布局渲染 → 逐个添加组件 → 点 AI 按钮（未配 key）→ 归档一条待办 → 重载插件
- **修复项**（预期会发现）：未配 key 时 AI 入口应给出"去设置页配置"的明确引导，而非报错或沉默
- **产出**：问题清单 + 修复 commit
- **验收**：全新 vault 核心流程零报错

### P1-3 README 封面与截图

- **现状**：`assets/` 有封面素材，`scripts/build_promo_cover.py` 可生成封面。
- **任务**：README 顶部插封面图；补 2–3 张实拍截图（工作台全景 / Canvas 文件夹 / AI 对话窗），存 `assets/` 并引用相对路径
- **验收**：README 首屏有视觉呈现；图片在 GitHub 网页正常渲染

### P1-4 平台兼容声明

- **任务**：README 加「兼容性」段：Windows 完整支持（音乐播放依赖 Windows 系统媒体会话 GSMTC）；macOS 未验证——音乐组件不可用，其余功能预期正常；`isDesktopOnly: true`，移动端不支持
- **验收**：README 有明确声明，无夸大

---

## 执行顺序建议

```
P0-1 泄漏扫描 ──► P0-2 LICENSE ─┬─► P0-3 Release ─► P0-4 README 安装段 ─► P0-5 公开/分发
                                 │
P1 四项可并行（各自 worktree 分支），与 P0 无依赖，但建议 P0 封板后再合 P1
```

## 不属于本计划

- 上架 Obsidian 社区商店（英文 README、obsidian-releases PR、官方 review 周期）——私下分发稳定后再议
