# Jam Deck v0.29.4

Obsidian 副屏工作台插件：时钟、日历、待办、剪贴板、快捷方式、音乐、内嵌 Canvas 工作区与 AI 对话助手。

## 安装

1. 下载本 Release 的 `main.js`、`styles.css`、`manifest.json` 三个文件
2. 放入 `<vault>/.obsidian/plugins/jam-deck/`（无则自建）
3. Obsidian 设置 → 第三方插件 → 刷新插件列表 → 启用 Jam Deck

或使用 BRAT：添加仓库 `J4M16/jam-deck`。

## 0.29.x 变更摘要

- **0.29.4**：仓库重组——Game Deck 剥离为独立仓库（纯维护，无功能变化）
- **0.29.3**：修复边缘 widget 角点无 sash handle——canvas 组件右下角现在可以从角点拉伸（局部底/右边界纳入 edge 检测）
- **0.29.2**：文件夹背叶/前叶提亮（+15% / +10% 明度，白混保色相）
- **0.29.1**：canvas 组件右下角拉伸手柄命中半径 18→24px（内部被原生 zoom 控件遮挡的脱靶补偿）
- **0.29.0**：文件夹外观还原 NZS4 Figma「文件夹样式」——六色实色底板、单层 tint 磨砂前片、Inter 字体栈；旧数据颜色自动迁移

## 功能

- 工作台网格：时钟 / 日历 / 待办（工作·生活归档）/ 剪贴板 / 快捷方式 / 音乐 / 浏览器 / Canvas 工作区
- Canvas 增强：图片堆叠、文件夹编组（原生 Canvas group 数据化）、Eagle 以图搜图、拖入自动排布
- AI 助手：DeepSeek / 千问双 provider，支持文本与图片上下文；千问按 key 前缀自动路由端点

## 已知边界

- `isDesktopOnly: true`，移动端不支持
- Windows 完整支持；macOS 未验证（音乐组件依赖 Windows GSMTC，macOS 不可用）
