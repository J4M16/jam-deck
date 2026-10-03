# 灵动岛桌面折射

Windows 使用 Electron 桌面视频流，窗口内容保护排除灵动岛自身；macOS Apple Silicon 使用 ScreenCaptureKit，明确排除灵动岛窗口。两平台均在 Chromium 中使用工作台已有的 Hyalite 光学引擎，消费同一 glassBlur（0–16）和 glassQuality 设置。轻盈档仅模糊，均衡档加入边缘折射。

展开最高 30fps，无音频。Windows 桌面流限制为显示器 DIP 分辨率，只把灵动岛矩形绘制到小画布；Mac 在系统端裁切后通过本地管道发送 JPEG。没有桌面图像落盘或上传。收起停止采样，退出释放流、滤镜和辅助进程。透明网页裁切平顶、31px 下圆角，没有 40% 白色填色。

Mac 需要屏幕录制权限；权限拒绝或采样异常时退出灵动岛并恢复工作台。辅助程序经 macos-15 CI 编译、临时签名后压缩嵌入 main.js，运行时验证 SHA-256 并释放到临时目录。发布仍为标准三文件，无运行时下载或编译。

构建：运行 `.github/workflows/island-capture.yml`，将 artifact 下载到 `.cache/island-capture-macos-arm64`，然后运行 `node scripts/embed-island-capture.js` 和 `npm run verify`。renderer.js / controller.js 修改后也必须重新嵌入。

2026-09-21：Apple Silicon 编译成功。没有 M5 实机，权限提示、实际采样坐标、圆角和性能仍待实机验证；编译通过不代表视觉验收。
