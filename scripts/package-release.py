"""Build explicit base / optional-caption artifacts. Never package local runtime data."""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ["main.js", "styles.css", "manifest.json", "assets/jam-deck-folder-shell.svg"]
CAPTIONS = ["caption-host.js", "caption-wall.js", "THIRD_PARTY_NOTICES.md", "docs/CAPTION_WALL.md",
            "scripts/caption-bridge.py", "scripts/caption-requirements.txt", "scripts/setup-captions.ps1",
            "scripts/extract-caption-model.py", "scripts/caption-model.json",
            "scripts/caption_audio_macos.py", "scripts/caption-audiotee.json", "scripts/setup-captions.sh", "scripts/setup-captions-macos.py"]

def build():
    version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
    output = ROOT / "dist" / version
    output.mkdir(parents=True, exist_ok=True)
    for name, files in [("jam-deck", BASE), ("jam-deck-captions", CAPTIONS)]:
        target = output / f"{name}-{version}.zip"
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for file in files:
                archive.write(ROOT / file, file)
        print(f"{target.name}: {target.stat().st_size:,} bytes")
    # Preserve the standard three-file distribution used by Obsidian / BRAT.
    for name in ["main.js", "styles.css", "manifest.json"]:
        (output / name).write_bytes((ROOT / name).read_bytes())

if __name__ == "__main__":
    build()
