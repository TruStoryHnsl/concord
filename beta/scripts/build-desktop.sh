#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cd src-tauri && cargo tauri build
