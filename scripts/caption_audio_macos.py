"""macOS capture adapters. Audio stays in bounded memory queues, never in files."""
import json
import queue
import subprocess
import threading
import time


PERMISSION_HINT = "请在 macOS 系统设置 → 隐私与安全性 → 屏幕与系统音频录制中允许 Obsidian，然后完全退出并重新打开 Obsidian"


class SystemAudio:
    sample_rate, channels, dtype = 16000, 1, "<i2"
    device = "macOS 默认播放设备"

    def __init__(self, executable):
        self.executable = executable
        self.frames = queue.Queue(maxsize=100)
        self.metadata = threading.Event()
        self.received = threading.Event()
        self.ended = threading.Event()
        self.closing = threading.Event()
        self.error = None
        self.detail = ""
        self.child = None
        self.threads = []

    def _put(self, raw):
        try:
            self.frames.put_nowait(raw)
            self.received.set()
        except queue.Full:
            self.error = "系统声音采集溢出，请暂停后重新开始"

    def _audio(self):
        pending = b""
        try:
            while raw := self.child.stdout.read(3200):
                pending += raw
                while len(pending) >= 3200:
                    self._put(pending[:3200])
                    pending = pending[3200:]
            if len(pending) % 2:
                self.error = "系统声音 PCM 数据不完整"
            elif pending:
                self._put(pending)
        except (OSError, ValueError) as error:
            if not self.closing.is_set():
                self.error = str(error)
        finally:
            self.ended.set()

    def _logs(self):
        try:
            for raw in self.child.stderr:
                line = raw.decode("utf-8", errors="replace").strip()
                self.detail = line[-1000:]
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                kind, data = event.get("message_type"), event.get("data") or {}
                if kind == "metadata":
                    # AudioTee can fall back to the original format on conversion failure.
                    # Never interpret float/stereo/native-rate bytes as 16 kHz mono PCM16.
                    if (data.get("sample_rate"), data.get("channels_per_frame"),
                            data.get("bits_per_channel"), data.get("is_float")) != (16000, 1, 16, False):
                        self.error = "系统声音格式转换失败，需要 16 kHz 单声道 PCM16"
                    else:
                        self.metadata.set()
                elif kind == "error":
                    self.error = str(data.get("message", line))
        except (OSError, ValueError):
            pass  # pipes close during normal shutdown

    def __enter__(self):
        self.child = subprocess.Popen(
            [self.executable, "--sample-rate", "16000", "--chunk-duration", "0.1"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        for target in (self._audio, self._logs):
            thread = threading.Thread(target=target, daemon=True)
            self.threads.append(thread)
            thread.start()
        return self

    def wait_ready(self, stop):
        deadline = time.monotonic() + 110
        while not stop.wait(0.05):
            self._check()
            if self.metadata.is_set() and self.received.is_set():
                return True
            if time.monotonic() > deadline:
                raise RuntimeError(f"未收到系统声音。{PERMISSION_HINT}")
        return False

    def _check(self):
        if self.error:
            raise RuntimeError(f"{self.error}。{PERMISSION_HINT}")
        if self.ended.is_set() and self.frames.empty() and not self.closing.is_set():
            raise RuntimeError(f"系统声音采集已退出：{self.detail}。{PERMISSION_HINT}")

    def read(self, timeout=0.1):
        self._check()
        try:
            return self.frames.get(timeout=timeout)
        except queue.Empty:
            self._check()
            return None

    def __exit__(self, *args):
        self.closing.set()
        if self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait(timeout=1)
        for thread in self.threads:
            thread.join(timeout=0.2)
        self.child.stdout.close()
        self.child.stderr.close()


class Microphone:
    channels, dtype = 1, "<f4"

    def __init__(self):
        self.frames = queue.Queue(maxsize=100)
        self.overflow = threading.Event()

    def __enter__(self):
        import sounddevice as sd
        try:
            device = sd.query_devices(kind="input")
            if device["max_input_channels"] < 1:
                raise RuntimeError("没有可用的默认麦克风")
            self.sample_rate = int(device["default_samplerate"])
            self.device = device["name"]
            self.stream = sd.RawInputStream(
                samplerate=self.sample_rate, channels=1, dtype="float32",
                blocksize=int(self.sample_rate * 0.1), callback=self._capture,
            )
            try:
                self.stream.start()
            except Exception:
                self.stream.close()
                raise
        except Exception as error:
            raise RuntimeError(f"麦克风不可用：{error}。请检查默认输入设备，并在 macOS 隐私与安全性 → 麦克风中允许 Obsidian，重新打开 Obsidian") from error
        return self

    def _capture(self, data, count, timing, status):
        if status:
            self.overflow.set()
        try:
            self.frames.put_nowait(bytes(data))
        except queue.Full:
            self.overflow.set()

    def wait_ready(self, stop):
        return not stop.is_set()

    def read(self, timeout=0.1):
        if self.overflow.is_set():
            raise RuntimeError("麦克风采集溢出，请暂停后重新开始")
        if not self.stream.active:
            raise RuntimeError("麦克风已断开，请检查输入设备后重新开始")
        try:
            return self.frames.get(timeout=timeout)
        except queue.Empty:
            return None

    def __exit__(self, *args):
        try:
            self.stream.stop()
        finally:
            self.stream.close()
