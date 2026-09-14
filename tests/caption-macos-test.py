"""Portable protocol/lifetime tests; these do not impersonate macOS hardware tests."""
import hashlib
import importlib.util
import io
import json
import queue
import subprocess
import sys
import tarfile
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


capture = load("capture", "caption_audio_macos.py")
installer = load("installer", "setup-captions-macos.py")


def metadata(**kwargs):
    return (json.dumps({"message_type": "metadata", "data": {
        "sample_rate": 16000, "channels_per_frame": 1, "bits_per_channel": 16,
        "is_float": False, **kwargs,
    }}) + "\n").encode()


class Child:
    def __init__(self, raw=b"\0\1" * 2000, logs=None, stubborn=False):
        self.stdout = io.BytesIO(raw)
        self.stderr = io.BytesIO(metadata() if logs is None else logs)
        self.stubborn = stubborn
        self.returncode = None
        self.terminated = self.killed = False

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        if not self.stubborn:
            self.returncode = 0

    def kill(self):
        self.killed = True
        self.returncode = -9

    def wait(self, timeout):
        if self.returncode is None:
            raise subprocess.TimeoutExpired("fixture", timeout)
        return self.returncode


class MacCapture(unittest.TestCase):
    def test_pcm_frames_and_last_partial_chunk(self):
        child = Child()
        with patch.object(capture.subprocess, "Popen", return_value=child) as spawn:
            with capture.SystemAudio("/space dir/audiotee") as audio:
                self.assertTrue(audio.wait_ready(threading.Event()))
                self.assertEqual(audio.read(), b"\0\1" * 1600)
                self.assertEqual(audio.read(), b"\0\1" * 400)
                with self.assertRaisesRegex(RuntimeError, "采集已退出"):
                    audio.read()
            self.assertEqual(spawn.call_args.args[0], ["/space dir/audiotee", "--sample-rate", "16000", "--chunk-duration", "0.1"])
        self.assertTrue(child.terminated)
        self.assertTrue(child.stdout.closed and child.stderr.closed)

    def test_incorrect_metadata_and_truncated_pcm_rejected(self):
        for child in (Child(logs=metadata(bits_per_channel=32, is_float=True)), Child(raw=b"x")):
            with patch.object(capture.subprocess, "Popen", return_value=child):
                with capture.SystemAudio("fixture") as audio:
                    with self.assertRaisesRegex(RuntimeError, "格式转换失败|PCM 数据不完整"):
                        audio.wait_ready(threading.Event())

    def test_permission_error_and_force_cleanup(self):
        child = Child(logs=b'{"message_type":"error","data":{"message":"Permission denied"}}\n', stubborn=True)
        with patch.object(capture.subprocess, "Popen", return_value=child):
            with self.assertRaisesRegex(RuntimeError, "Permission denied.*隐私与安全性"):
                with capture.SystemAudio("fixture") as audio:
                    audio.wait_ready(threading.Event())
        self.assertTrue(child.killed)

    def test_bounded_queue_and_cancel_while_awaiting_permission(self):
        audio = capture.SystemAudio("fixture")
        for _ in range(101):
            audio._put(b"\0\0")
        self.assertEqual(audio.frames.qsize(), 100)
        with self.assertRaisesRegex(RuntimeError, "溢出"):
            audio.read()
        stop = threading.Event()
        stop.set()
        self.assertFalse(capture.SystemAudio("fixture").wait_ready(stop))

    def test_microphone_raw_callback_and_cleanup(self):
        class Stream:
            active = False
            closed = False
            def __init__(self, **kwargs):
                self.options = kwargs
            def start(self):
                self.active = True
            def stop(self):
                self.active = False
            def close(self):
                self.closed = True
        sd = types.SimpleNamespace(query_devices=lambda **kwargs: {
            "max_input_channels": 1, "default_samplerate": 48000, "name": "Mac microphone"}, RawInputStream=Stream)
        with patch.dict(sys.modules, sounddevice=sd):
            with capture.Microphone() as mic:
                self.assertEqual(mic.sample_rate, 48000)
                mic.stream.options["callback"](b"\0" * 40, 10, None, False)
                self.assertEqual(mic.read(), b"\0" * 40)
                mic.stream.options["callback"](b"\0" * 40, 10, None, True)
                with self.assertRaisesRegex(RuntimeError, "溢出"):
                    mic.read()
            self.assertFalse(mic.stream.active)
            self.assertTrue(mic.stream.closed)

    def test_microphone_denial_is_actionable(self):
        sd = types.SimpleNamespace(query_devices=lambda **kwargs: (_ for _ in ()).throw(RuntimeError("No device")))
        with patch.dict(sys.modules, sounddevice=sd):
            with self.assertRaisesRegex(RuntimeError, "麦克风.*允许 Obsidian"):
                with capture.Microphone():
                    self.fail("not reached")


class MacInstaller(unittest.TestCase):
    def test_native_arm64_and_minimum_os(self):
        with patch.object(installer.sys, "platform", "darwin"), patch.object(installer.sys, "version_info", (3, 12)), patch.object(installer.platform, "machine", return_value="arm64"):
            with patch.object(installer.platform, "mac_ver", return_value=("26.0", (), "")):
                installer.validate_platform()
            with patch.object(installer.platform, "mac_ver", return_value=("14.1", (), "")):
                with self.assertRaisesRegex(RuntimeError, "14.2"):
                    installer.validate_platform()

    def test_existing_runtime_registers_mac_path_without_redownload(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            scripts = root / "plugin/scripts"
            scripts.mkdir(parents=True)
            runtime = root.resolve() / "中文 runtime"
            python = runtime / "caption-runtime/bin/python3"
            python.parent.mkdir(parents=True)
            python.write_bytes(b"fixture")
            model = runtime / "model"
            model.mkdir()
            (model / "keep.onnx").write_bytes(b"model")
            tee = runtime / "audiotee"
            tee.write_bytes(b"binary")
            (scripts / "caption-model.json").write_text(json.dumps({"name": "model", "files": {"keep.onnx": installer.digest(model / "keep.onnx")}}))
            (scripts / "caption-audiotee.json").write_text(json.dumps({"binary_sha256": installer.digest(tee)}))
            with patch.object(installer, "HERE", scripts), patch.object(installer, "validate_platform"), patch.object(installer.sys, "argv", ["setup", "--install-dir", str(runtime)]), patch.object(installer.subprocess, "run") as run, patch.object(installer, "download") as download, patch("builtins.print"):
                installer.run()
                download.assert_not_called()
                self.assertTrue(all(call.kwargs.get("check") for call in run.call_args_list))
            config_dir = root / "plugin/.cache"
            config = json.loads((config_dir / "caption-runtime-darwin.json").read_text(encoding="utf-8"))
            self.assertEqual(config["python"], str(python))
            self.assertEqual(config["audiotee"], str(tee))
            self.assertEqual([p.name for p in config_dir.iterdir()], ["caption-runtime-darwin.json"])

    def test_installer_extracts_only_verified_executable(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive, target = root / "audiotee.tgz", root / "audiotee"
            content = b"fixture binary"
            with tarfile.open(archive, "w:gz") as tar:
                for name in ("package/bin/audiotee", "package/unused"):
                    info = tarfile.TarInfo(name)
                    info.size = len(content)
                    tar.addfile(info, io.BytesIO(content))
            spec = {"sha256": installer.digest(archive), "binary_sha256": hashlib.sha256(content).hexdigest()}
            installer.install_audiotee(archive, target, spec)
            self.assertEqual(target.read_bytes(), content)
            self.assertFalse((root / "package").exists())
            spec["binary_sha256"] = "bad"
            with self.assertRaisesRegex(ValueError, "checksum"):
                installer.install_audiotee(archive, target, spec)
            self.assertEqual(target.read_bytes(), content)


if __name__ == "__main__":
    unittest.main()
