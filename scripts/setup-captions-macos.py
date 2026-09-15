"""Install the optional native macOS caption runtime, outside the synced Vault."""
import argparse
import hashlib
import importlib.util
import json
import platform
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def digest(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def valid(file, checksum):
    return file.is_file() and digest(file).lower() == checksum.lower()


def download(url, file, checksum):
    subprocess.run(["/usr/bin/curl", "-fL", "--retry", "2", "--output", str(file), url], check=True)
    if not valid(file, checksum):
        raise ValueError(f"下载校验失败：{file.name}，请重新运行安装器")


def install_audiotee(archive, target, spec):
    if not valid(archive, spec["sha256"]):
        raise ValueError("AudioTee archive checksum mismatch")
    with tarfile.open(archive, "r:gz") as tar:
        member = tar.getmember("package/bin/audiotee")
        if not member.isfile():
            raise ValueError("AudioTee binary missing")
        data = tar.extractfile(member).read()
    if hashlib.sha256(data).hexdigest() != spec["binary_sha256"]:
        raise ValueError("AudioTee binary checksum mismatch")
    partial = target.with_suffix(".partial")
    partial.write_bytes(data)
    partial.chmod(0o755)
    partial.replace(target)


def validate_platform():
    if sys.platform != "darwin":
        raise RuntimeError("此安装器只用于 macOS；Windows 请运行 setup-captions.ps1")
    if tuple(map(int, platform.mac_ver()[0].split(".")[:2])) < (14, 2):
        raise RuntimeError("字幕墙的原生系统声音采集需要 macOS 14.2 或更新版本")
    if sys.version_info[:2] != (3, 12) or platform.machine() not in ("arm64", "x86_64"):
        raise RuntimeError("需要 Apple Silicon 或 Intel 版 Python 3.12")
    if platform.machine() == "x86_64":
        translated = subprocess.run(["/usr/sbin/sysctl", "-in", "sysctl.proc_translated"], capture_output=True, text=True)
        if translated.stdout.strip() == "1":
            raise RuntimeError("请使用 Apple Silicon 原生 arm64 Python 3.12，退出 Rosetta 终端后重试")


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install-dir", type=Path, default=Path.home() / "Library/Application Support/JamDeck/captions")
    parser.add_argument("--model-archive", type=Path, help="Use an already downloaded official model archive")
    args = parser.parse_args()
    validate_platform()
    root = args.install_dir.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    runtime = root / "caption-runtime"
    python = runtime / "bin/python3"
    if not python.is_file():
        subprocess.run([sys.executable, "-m", "venv", str(runtime)], check=True)
    subprocess.run([str(python), "-c", "import sys,platform; assert sys.version_info[:2] == (3,12); assert platform.machine() == sys.argv[1]", platform.machine()], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "--no-cache-dir", "--only-binary=:all:", "-r", str(HERE / "caption-requirements.txt")], check=True)
    spec = json.loads((HERE / "caption-model.json").read_text(encoding="utf-8"))
    model = root / spec["name"]
    if not all(valid(model / name, checksum) for name, checksum in spec["files"].items()):
        with tempfile.TemporaryDirectory(prefix="caption-download-", dir=root) as temp:
            archive = args.model_archive.expanduser().resolve() if args.model_archive else Path(temp) / "model.tar.bz2"
            if not args.model_archive:
                download(spec["url"], archive, spec["sha256"])
            if not valid(archive, spec["sha256"]):
                raise ValueError("Model archive checksum mismatch")
            module_spec = importlib.util.spec_from_file_location("extractor", HERE / "extract-caption-model.py")
            extractor = importlib.util.module_from_spec(module_spec)
            module_spec.loader.exec_module(extractor)
            extractor.extract(archive, root, spec)
    tee_spec = json.loads((HERE / "caption-audiotee.json").read_text(encoding="utf-8"))
    audiotee = root / "audiotee"
    if not valid(audiotee, tee_spec["binary_sha256"]):
        with tempfile.TemporaryDirectory(prefix="caption-download-", dir=root) as temp:
            archive = Path(temp) / "audiotee.tgz"
            download(tee_spec["url"], archive, tee_spec["sha256"])
            install_audiotee(archive, audiotee, tee_spec)
    audiotee.chmod(0o755)
    # No audio permission is requested during installation; --help only tests loading.
    subprocess.run([str(audiotee), "--help"], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([str(python), "-c", "import sherpa_onnx, sounddevice, numpy"], check=True)
    if not all(valid(model / name, checksum) for name, checksum in spec["files"].items()):
        raise ValueError("Installed model checksum mismatch")
    config_dir = HERE.parent / ".cache"
    config_dir.mkdir(exist_ok=True)
    # Keep the venv path: resolving its python symlink would select the base interpreter.
    config = {"python": str(python), "model": str(model), "audiotee": str(audiotee)}
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=config_dir, delete=False) as stream:
        json.dump(config, stream, ensure_ascii=False, indent=2)
        temporary = Path(stream.name)
    temporary.replace(config_dir / "caption-runtime-darwin.json")
    print(f"字幕引擎已安装到 {root}。请重新启用 Jam Deck；首次采集时允许 Obsidian 使用麦克风/系统音频。")


if __name__ == "__main__":
    try:
        run()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"字幕安装失败：{error}", file=sys.stderr)
        sys.exit(1)
