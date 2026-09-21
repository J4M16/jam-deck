# 灵动岛原生材质

原生窗口只绘制桌面磨砂；Electron 保留所有控件、剪贴板拖拽和 31px 下圆角高光。
两层都是平顶，展开 72 DIP。收起不绘制磨砂。前景无白色填色。

## Windows 11 x64

`windows.cpp` 使用 Windows Composition HostBackdropBrush、圆角几何裁切和独立无输入窗口。
材质窗口紧贴 Electron HWND 下方，读取实际 HWND 尺寸/DPI，跟随 show/hide/location/destroy 事件。
标准输入接受 `show ...`、`hide`、`quit`；EOF 与宿主窗口销毁都会退出，无轮询、屏幕捕获或自建动画循环。

构建需要 VS 2022 C++ 工具与 Windows SDK（本机使用 26100）：

```powershell
.\scripts\build-island-glass.cmd
npm run verify
```

静态链接 CRT，产物由 `embed-island-glass.js` 压缩嵌入 main.js，记录源文件及二进制 SHA-256。
运行时校验并解压到用户临时目录 `jam-deck-island-glass/<sha256>.exe`，没有运行时编译或网络下载。
发布继续使用 main.js / styles.css / manifest.json 三件套。

## macOS Apple Silicon

`macos.js` 用系统 JXA/ObjC bridge 创建 NSVisualEffectView：behindWindow、active、underWindowBackground，
maskImage 裁切下圆角；无输入 NSWindow 排在 Electron 的 windowNumber 下方。
Node 通过 stdin 发送 DIP 坐标，原生侧转换为 AppKit 底部原点坐标。
异步文件通知处理命令与 EOF，不占用轮询循环。脚本同样嵌入 main.js。

macOS 源码通过语法和分发完整性检查；本次无 M5 实机，JXA/AppKit 运行、窗口层级、圆角及性能尚未实机验收。

## 验证

2026-09-21，Windows 11 / Obsidian 1.13.7 / Electron 39.8.3，双屏 150%：

- 实际桌面合成截图确认条纹被模糊、两侧下圆角外清晰，无矩形底块。
- 前景计算样式白色填色为透明，圆角 31px。
- 72px 展开 / 10px 收起，材质原生窗口随之显示 / 隐藏。
- 原生层 WM_NCHITTEST 返回 HTTRANSPARENT，同时带 NOACTIVATE / TRANSPARENT 样式。
- 点击「工作台」、模拟材质进程异常和插件热重载后，材质进程/窗口清理，主界面恢复。
- 自动回归覆盖加载取消、异常恢复、重复状态、进程退出与管道错误去重、分发完整性。

实际桌面截图仅用于上述验收，不属于功能实现。
