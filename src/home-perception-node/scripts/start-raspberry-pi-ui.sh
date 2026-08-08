#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "${script_dir}/.." && pwd)"
cd "${project_dir}"

python_bin="${TAREVIS_PYTHON:-${project_dir}/.venv/bin/python}"
if [[ ! -x "${python_bin}" ]]; then
  python_bin="$(command -v python3 || true)"
fi
if [[ -z "${python_bin}" || ! -x "${python_bin}" ]]; then
  echo "Python 3 was not found. Create .venv or set TAREVIS_PYTHON." >&2
  exit 1
fi

export PYTHONPATH="${project_dir}/src${PYTHONPATH:+:${PYTHONPATH}}"

host="${TAREVIS_HOST:-0.0.0.0}"
port="${TAREVIS_PORT:-8787}"
vision_source="${TAREVIS_VISION_SOURCE:-picamera2://0}"
vision_width="${TAREVIS_VISION_WIDTH:-640}"
vision_height="${TAREVIS_VISION_HEIGHT:-480}"
vision_fps="${TAREVIS_VISION_FPS:-5}"

arguments=(
  --config configs/raspberry-pi.toml
  ui-server
  --host "${host}"
  --port "${port}"
  --vision-source "${vision_source}"
  --vision-width "${vision_width}"
  --vision-height "${vision_height}"
  --vision-fps "${vision_fps}"
)

if [[ "${TAREVIS_AUTO_START_VISION:-1}" != "0" ]]; then
  arguments+=(--auto-start-vision)
fi

exec "${python_bin}" -m tarevis_home_node "${arguments[@]}"
