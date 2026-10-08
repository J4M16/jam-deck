# 灵动岛桌面折射

Windows x64 使用原生 Windows Graphics Capture，`IsCursorCaptureEnabled(false)` 禁止光标合成，窗口内容保护排除灵动岛自身；macOS Apple Silicon 使用 ScreenCaptureKit，明确排除灵动岛窗口并关闭光标。两平台均在 Chromium 中使用工作台已有的 Hyalite 光学引擎，消费同一 glassBlur（0–16）和 glassQuality 设置。轻盈档仅模糊，均衡档加入边缘折射。

展开最高约 30fps，无音频。Windows 在 GPU 中裁切灵动岛的物理像素矩形，只将该区域读回 CPU，再缩到 DIP 大小；Mac 在系统端裁切。两平台通过本地管道发送 JPEG，渲染端同时最多解码一帧。没有桌面图像落盘或上传。收起停止采样并释放系统捕获缓冲，退出释放滤镜和辅助进程。透明网页裁切平顶、31px 下圆角，没有 40% 白色填色。Windows 当前验收目标为 Windows 11 x64。

文字保持在折射层之外：每秒读取一次 128×6 桌面缩略图，剪贴板条目、倒计时、品牌与恢复按钮各自依据下方区域选择字色，使用明暗缓冲区避免闪烁。文字滑杆仍按原比例混合；次级字色与轻微字边保护改善细字识别。普通 UI 更新复用最近一次采样，不能额外读取像素或先闪回系统字色。

Mac 需要屏幕录制权限；权限拒绝或采样异常时退出灵动岛并恢复工作台。辅助程序压缩嵌入 main.js，运行时验证 SHA-256 并释放到临时目录。Mac 经 macos-15 CI 编译、临时签名；Windows 使用 Visual C++ /MT 静态运行库编译，启动隐藏控制台窗口。发布仍为标准三文件，无运行时下载或编译。

构建：运行 `.github/workflows/island-capture.yml`，将两个 artifact 分别下载到 `.cache/island-capture-macos-arm64` / `.cache/island-capture-windows-x64`；Windows 本机也可运行 `scripts/build-island-capture-windows.ps1`。随后运行 `node scripts/embed-island-capture.js` 和 `npm run verify`。renderer.js / controller.js 修改后也必须重新嵌入；分发测试核对两个二进制的架构、哈希和源码哈希。

2026-09-21：Apple Silicon 编译成功。没有 M5 实机，权限提示、实际采样坐标、圆角和性能仍待实机验证；编译通过不代表视觉验收。
