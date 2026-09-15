#!/bin/bash
set -euo pipefail
caption_script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
caption_python="${PYTHON:-python3.12}"
if ! command -v "$caption_python" >/dev/null 2>&1; then
  echo '需要 Python 3.12。请先安装，或用 PYTHON=/绝对路径/python3.12 bash scripts/setup-captions.sh 指定。' >&2
  exit 1
fi
exec "$caption_python" "$caption_script_dir/setup-captions-macos.py" "$@"
