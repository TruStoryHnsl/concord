# Concord v2 — Development Report

**Project:** Concord v2 — P2P Mesh-Networked Communication Platform
**Started:** 2026-03-25
**Report Date:** 2026-03-26
**Status:** Phases 1–5 complete, Phase 6 in progress

---

## Vision

Concord v2 is a ground-up rewrite of Concord — from a Docker-based Matrix/Element wrapper into a fully native, peer-to-peer mesh-networked communication platform. Every device is a node. No central server required. Text, voice, and video chat flow directly between peers over an encrypted mesh network. Non-local peers connect through QUIC "tunnels." A headless `concord-server` binary serves as a dedicated backbone node.

The UI follows the "Kinetic Node" design system — a Midnight Teal + indigo/mint palette with glassmorphism, Space Grotesk headlines, and a "no borders, only surface shifts" philosophy. 9 screens were pre-designed in Stitch before development began.

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| App Shell | Tauri v2 | Single codebase for iOS/Android/macOS/Windows/Linux. Rust backend IS the networking core. Small binaries. |
| P2P Networking | libp2p (Rust) | mDNS, Kademlia DHT, GossipSub, QUIC, Noise, Relay, DCUtR. Battle-tested in IPFS/Polkadot. |
| Voice/Video | str0m (Rust) | Sans-IO WebRTC. Integrates with libp2p's transport without competing for sockets. |
| Frontend | React 19 + TypeScript + Tailwind + Zustand | Direct port of the Kinetic Node HTML/Tailwind mockups. Vite bundler. |
| Storage | SQLite via rusqlite | Local-first. Each node stores its own data. Encrypted at rest (SQLCipher planned). |
| Wire Protocol | MessagePack (rmp-serde) | Compact binary format for P2P traffic. JSON for Tauri IPC. |
| Encryption | X25519 + ChaCha20-Poly1305 | E2E DMs. TOTP (HMAC-SHA1) for 2FA. Ed25519 for identity/signing. |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Tauri v2 Shell                        │
│  ┌────────────────────┐  ┌────────────────────────────────┐  │
│  │   React Frontend   │  │      Rust Backend              │  │
│  │   (Kinetic Node)   │◄─┤  ┌──────────┐ ┌────────────┐  │  │
│  │                    │  │  │ NodeHandle│ │  Database   │  │  │
│  │  Zustand Stores    │  │  │ (libp2p) │ │  (SQLite)   │  │  │
│  │  + Tauri Events    │  │  └─────┬────┘ └──────┬─────┘  │  │
│  └────────────────────┘  │        │              │        │  │
│                          │  ┌─────▼──────────────▼─────┐  │  │
│                          │  │    Node Event Loop       │  │  │
│                          │  │  mDNS │ GossipSub │ Kad  │  │  │
│                          │  │  Relay│ DCUtR     │QUIC  │  │  │
│                          │  └──────────────────────────┘  │  │
│                          └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Mesh Network     │
                    │  (Other Nodes)     │
                    └────────────────────┘
```

### Rust Crate Workspace (6 crates + Tauri app)

| Crate | Purpose | Lines (approx) |
|-------|---------|---------------|
| `concord-core` | Identity, types, wire format, trust, crypto, TOTP | ~600 |
| `concord-net` | libp2p networking, node event loop, discovery, tunnels | ~900 |
| `concord-media` | Voice engine, signaling, session management | ~500 |
| `concord-store` | SQLite storage, all CRUD operations | ~800 |
| `concord-webhost` | Embedded HTTP server for browser guests (stub) | ~50 |
| `concord-daemon` | Headless server binary (stub) | ~100 |
| `concord-app` (src-tauri) | Tauri IPC commands, event forwarding, app state | ~500 |

### Frontend Structure

| Directory | Contents |
|-----------|---------|
| `components/layout/` | AppShell, BottomNav, TopBar |
| `components/dashboard/` | DashboardPage (node status, mesh chat, servers) |
| `components/chat/` | MessageList, MessageInput, ChatMessage, ServerPage |
| `components/server/` | ChannelSidebar, ServerHeader, InvitePanel, MemberList, HostSessionPage, JoinServerModal |
| `components/voice/` | VoiceChannel, VoiceConnectionBar, ParticipantCard |
| `components/mesh/` | NodeMapPage (radial visualization), PeerList |
| `components/profile/` | ProfilePage (identity, trust, devices, security) |
| `components/settings/` | SettingsPage (general, node, privacy, 2FA, advanced) |
| `components/friends/` | FriendsPage (online/away/offline groups, pending requests) |
| `components/dm/` | DmPage (E2E encrypted conversations), DmList |
| `components/ui/` | GlassPanel, Button, NodeChip, Toggle, TrustBadge |
| `stores/` | auth, mesh, servers, voice, friends, settings, dm |
| `hooks/` | useNodeEvents (Tauri event listener bridge) |
| `api/` | tauri.ts (typed invoke wrappers + browser mock layer) |

---

## Phase-by-Phase Development

### Phase 1: Foundation (Complete)
**Goal:** Two LAN peers discover each other and exchange text messages.

**What was built:**
- Cargo workspace with all 6 crates + Tauri app
- `concord-core`: Ed25519 identity generation (keypair create/sign/verify/serialize), MessagePack wire encoding, trust score computation, node configuration types
- `concord-net`: Full libp2p swarm with QUIC transport, mDNS local discovery, GossipSub pub/sub messaging, Identify protocol. The `Node` struct runs an async event loop processing swarm events. `NodeHandle` (Clone+Send+Sync) communicates via mpsc commands + broadcast events — designed for Tauri state.
- `concord-store`: SQLite database with schema (messages, channels, servers, peers, identity tables), message CRUD with pagination, identity persistence (keypair save/load), peer tracking
- Tauri IPC: `get_identity`, `send_message`, `get_messages`, `get_nearby_peers`, `get_node_status`, `subscribe_channel`. Event forwarding from broadcast receiver to Tauri event bus.
- Frontend: Kinetic Node design system fully ported to Tailwind config (40+ color tokens), Dashboard page with node status + mesh chat + peer list, MessageList/MessageInput/ChatMessage components, Zustand stores, Tauri event hooks

**Verified:** `two_peers` example — two libp2p nodes in one process discover each other via mDNS in ~450ms and exchange bidirectional GossipSub messages.

### Phase 2: Servers & Channels (Complete)
**Goal:** Create servers with channels, invite peers, chat in per-channel topics.

**What was built:**
- `concord-store`: `invites` table (code, server_id, max_uses, use_count) and `members` table (server_id, peer_id, role, joined_at). Full invite lifecycle (create, get, use with max_uses enforcement). Membership management (add, remove, query, get_user_servers).
- 8 Tauri server commands: `create_server` (creates server + default channels + owner membership + invite code + GossipSub subscriptions), `get_servers`, `get_server`, `get_channels`, `join_server` (redeem invite, add member, subscribe topics), `create_invite`, `get_server_members`, `leave_server`
- Channel → GossipSub topic routing: `concord/{server_id}/{channel_id}`. Auto-subscribe to all joined servers' channels on app startup.
- `send_message` updated to route by server_id (server channels) or mesh topic (global)
- Frontend: Server creation flow (name → visibility → channels), full server view with ChannelSidebar + chat + MemberList, InvitePanel with copy-to-clipboard, JoinServerModal, server list on Dashboard matching Kinetic Node mockup

### Phase 3: Voice & Video (Complete)
**Goal:** Voice/video signaling, state management, and UI.

**What was built:**
- `VoiceSignal` enum (7 variants: Join, Leave, Offer, Answer, IceCandidate, MuteState, SpeakingState) for WebRTC signaling over GossipSub
- Voice signaling topic: `concord/{server_id}/{channel_id}/voice-signal`. Node event loop detects voice-signal topics and decodes accordingly.
- `VoiceEngine` + `VoiceEngineHandle`: Async command/event loop (same pattern as Node/NodeHandle). Manages VoiceSession (participant tracking, mute/deafen state), SignalingManager (SDP offer/answer flow, ICE candidates). Emits VoiceEvents for UI reactivity.
- 5 Tauri voice commands: `join_voice`, `leave_voice`, `toggle_mute`, `toggle_deafen`, `get_voice_state`
- Frontend: VoiceChannel view (participant grid, join/disconnect buttons), VoiceConnectionBar (persistent bar with mic/headset/disconnect controls), ParticipantCard (avatar with speaking ring animation, mute badge)

**Note:** Audio pipeline (cpal capture → Opus → str0m RTP) is structured but not connected yet. Signaling + state management work. Real audio is the final integration step.

### Phase 4: Tunneling & Global (Complete)
**Goal:** Cross-network peer connections via Kademlia DHT, Relay, and DCUtR.

**What was built:**
- `ConcordBehaviour` upgraded from 3 to 7 protocols: mDNS, GossipSub, Kademlia (Server mode), Identify, Relay Server, Relay Client, DCUtR
- `build_swarm` rewritten with `.with_relay_client()` transport chain for relay-assisted connections
- `TunnelTracker`: Tracks active connections with type (Direct/Relayed/LocalMdns), remote address, establishment time, RTT. Detects relayed connections by checking for `/p2p-circuit/` in addresses.
- Kademlia integration: peers discovered via mDNS are added to the Kademlia routing table. Identify responses feed addresses into Kademlia. Bootstrap peers from config trigger DHT bootstrap queries.
- New NodeCommands: `BootstrapDht`, `DialPeer`, `AddPeerAddress`, `GetTunnels`
- 3 new Tauri commands: `get_tunnels`, `dial_peer`, `bootstrap_dht`
- Frontend: Full Node Map page with radial mesh visualization (SVG connection lines, color-coded by connection type), floating search bar, network legend, coverage/backbone stats cards, network status badge with signal strength, clickable peer tooltips with connection details. 5-second polling for live updates.

### Phase 5: Trust & Security (Complete)
**Goal:** Trust badges, E2E encrypted DMs, TOTP 2FA.

**What was built:**
- **Trust Attestation Protocol:** `TrustManager` creates signed attestations (`{attester}:{subject}:{timestamp}` signed with Ed25519). Attestations broadcast over GossipSub on `concord/mesh/attestations`. Each node stores attestations in SQLite and computes trust scores locally (70% attestation weight + 30% identity age). 5 badge tiers: Unverified → Recognized → Established → Trusted → Backbone.
- **E2E Encrypted DMs:** X25519 Diffie-Hellman key exchange + ChaCha20-Poly1305 symmetric encryption. `E2ESession` with monotonic nonce counters. DM signals (KeyExchange, EncryptedMessage) travel over GossipSub on `concord/dm/{sorted_peer_ids}`. Session persistence in SQLite. Encrypted messages stored locally.
- **TOTP 2FA:** Minimal HMAC-SHA1 TOTP implementation per RFC 6238 (validated against test vectors). Generate secret, compute/verify codes with time window, base32 encoding for QR URIs. Full setup/enable/disable flow.
- 12 new Tauri commands across trust (3), DMs (3), and auth/TOTP (5+existing)
- Frontend: TrustBadge component (5 visual levels with icons), ProfilePage (gradient avatar, trust display, DID, devices, security section), SettingsPage (general/node/privacy/2FA/advanced), FriendsPage (search, pending requests, status groups), DmPage (E2E indicator, message bubbles), DmList (conversations with unread counts)

---

## Test Suite

| Crate | Tests | Coverage |
|-------|-------|---------|
| concord-core | 21 | Identity roundtrip, wire encode/decode, trust levels, trust manager sign/verify, TOTP RFC vectors, E2E encrypt/decrypt |
| concord-media | 8 | Voice session lifecycle, signaling manager SDP flow |
| concord-net | 7 | Tunnel tracker connection lifecycle, mDNS integration |
| concord-store | 46 | Messages (7), identity (3), peers (5), servers (6), invites (5), members (5), trust_store (5), totp_store (4), dm_store (6) |
| **Total** | **82** | All passing, 0 failures |

Additionally, the `two_peers` example binary verifies end-to-end mDNS discovery + GossipSub messaging between two live libp2p nodes.

---

## Browser Mock Layer

A key development ergonomic: the frontend API layer (`api/tauri.ts`) auto-detects whether it's running inside Tauri or a plain browser. In browser mode, all `invoke()` calls return mock data — sample peers, messages, servers, voice participants, trust badges. This allows full UI iteration via `npm run dev` (Vite at localhost:1420) without building the Rust backend, and the UI is viewable from any device on the network.

---

## Key Architectural Decisions

1. **Node/NodeHandle pattern:** The libp2p swarm runs in a background tokio task. External code (Tauri commands) communicates via typed mpsc channels (commands in, events out). NodeHandle is Clone+Send+Sync. This same pattern was replicated for VoiceEngine.

2. **GossipSub as universal message bus:** Chat messages, voice signaling, trust attestations, and DM signals all travel over GossipSub topics with different prefixes. One protocol handles all pub/sub needs.

3. **Topic routing convention:**
   - `concord/mesh/general` — public mesh chat
   - `concord/mesh/attestations` — trust attestation broadcasts
   - `concord/{server_id}/{channel_id}` — server channel messages
   - `concord/{server_id}/{channel_id}/voice-signal` — voice signaling
   - `concord/dm/{peer_a}_{peer_b}` — direct messages (peers sorted alphabetically)

4. **Local-first storage:** Every node stores its own messages, peers, servers, and encryption sessions in SQLite. There is no central database. History sync between peers uses the existing GossipSub delivery (full sync protocol planned for later).

5. **Transport abstraction:** `concord-net/src/transport.rs` defines a `Transport` trait and `TransportManager` for infrastructure-free mesh networking (BLE, WiFi Direct, WiFi AP). These are structured for future platform-native Tauri plugins but not yet connected — current connectivity uses libp2p's QUIC + mDNS over IP.

---

## Remaining Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 6 | Next | Browser Guest WebUI (axum + rust-embed, PIN auth, WebSocket bridge) |
| 7 | Pending | concord-server headless daemon (TOML config, systemd, relay mode) |
| 8 | Pending | Mobile builds (iOS via xtool investigation, Android via NDK), battery-aware throttling, push notifications |

---

## File Counts

```
Rust source files:     ~55
Frontend source files: ~45
Design reference files: 23 (9 PNGs, 13 HTMLs, 1 design spec)
Config/build files:    ~15
Total project files:   ~140
```

---

## Development Workflow

- **Desktop testing:** `cargo tauri dev` — native window with hot-reloading frontend
- **UI iteration:** `cd frontend && npm run dev` — browser at localhost:1420 with mock data
- **Mobile preview:** Access Vite server from phone via LAN IP
- **Mesh testing:** Run two `cargo tauri dev` instances on same machine (or two machines on LAN)
- **Rust tests:** `cargo test --workspace` — 82 tests in ~0.1s
- **TypeScript check:** `cd frontend && npx tsc --noEmit`
