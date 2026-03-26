#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# WebKitGTK has rendering bugs with NVIDIA GPUs on Wayland.
# Disable the DMA-BUF renderer to prevent blank/gray windows.
if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    export WEBKIT_DISABLE_DMABUF_RENDERER=1
fi

cargo tauri dev "$@"
