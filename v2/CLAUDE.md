# Concord v2 — Development Guide

## Overview
Concord v2 is a native P2P mesh-networked communication platform. Every device is a node in a mesh network providing text, voice, and video chat.

## Tech Stack
- **App Shell:** Tauri v2 (Rust backend + web frontend)
- **P2P Networking:** libp2p (Rust) — mDNS, Kademlia DHT, GossipSub, QUIC, Noise
- **Voice/Video:** str0m (sans-IO WebRTC)
- **Frontend:** React 19 + TypeScript + Tailwind CSS + Zustand
- **Storage:** SQLite via rusqlite
- **Wire Protocol:** MessagePack (rmp-serde)

## Project Structure
- `crates/concord-core` — Pure library: identity, types, serialization, trust, crypto
- `crates/concord-net` — P2P networking engine (async/tokio, libp2p)
- `crates/concord-media` — Voice/video via str0m WebRTC
- `crates/concord-store` — Local persistence (SQLite)
- `crates/concord-webhost` — Embedded HTTP server for browser guests
- `crates/concord-daemon` — Headless server binary (concord-server)
- `src-tauri/` — Tauri v2 app shell, IPC commands
- `frontend/` — React + TypeScript + Tailwind UI

## Development Commands
```bash
# Install frontend dependencies
cd frontend && npm install

# Run in development mode (frontend + Rust hot reload)
cd src-tauri && cargo tauri dev

# Build for current platform
cargo tauri build

# Build headless server only
cargo build -p concord-daemon --release

# Run all Rust tests
cargo test --workspace

# Run frontend lint
cd frontend && npm run lint
```

## Design System
The UI follows the "Kinetic Node" design system. See `design/KINETIC_NODE_DESIGN.md`.

Key rules:
- **No borders** — use surface color shifts to define sections
- **Glassmorphism** for overlays: rgba(35,38,42,0.6) + 20px backdrop blur
- **Gradient CTAs**: linear-gradient from primary (#a4a5ff) to primary-container (#9496ff)
- **Fonts**: Space Grotesk for headlines, Manrope for body/labels
- **Icons**: Material Symbols Outlined

## Architecture Notes
- Every node is a libp2p peer with an Ed25519 identity
- **The local mesh is infrastructure-free** — no WiFi router, no internet required
- GossipSub topics map 1:1 to chat channels
- Messages are signed and stored locally in SQLite
- The host node acts as SFU for voice/video with 5+ participants
- Non-local connections go through QUIC "tunnels" (the ONLY internet-dependent path)

## Transport Layer (CRITICAL)
The mesh operates over radio, NOT just IP networks. `concord-net/src/transport.rs` defines the abstraction.

**Transport tiers (auto-selected, best available):**
| Tier | Technology | Bandwidth | Needs Infrastructure? | Capabilities |
|------|-----------|-----------|----------------------|-------------|
| BLE | Bluetooth Low Energy | ~200 kbps | No | Discovery + text only |
| WiFi Direct | WiFi P2P | ~250 Mbps | No | Text, voice, video |
| WiFi AP | Device broadcasts hotspot | ~100 Mbps | No | Mesh extension |
| LAN | mDNS over IP | full | Yes (router) | When devices share a network |
| Tunnel | QUIC over internet | full | Yes (internet) | Non-local connections |

**Platform-native implementations (Tauri v2 plugins):**
- iOS: MultipeerConnectivity (BLE + WiFi seamlessly)
- Android: Nearby Connections API (BLE + WiFi Direct + WiFi Aware)
- Linux: BlueZ (D-Bus) for BLE, wpa_supplicant for WiFi Direct
- macOS: CoreBluetooth + MultipeerConnectivity
- Windows: Windows.Devices.Bluetooth + WiFi Direct APIs

**Graceful degradation:** BLE-only = text mode. WiFi Direct = full voice/video. The app automatically upgrades connections (BLE discovery → WiFi Direct data channel).
