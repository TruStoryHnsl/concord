#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build -p concord-daemon --release
echo "Built: target/release/concord-daemon"
