# Concord v2 — Status Report

**Date:** 2026-03-26
**Codebase:** ~19,800 LOC (10,300 Rust + 9,500 TypeScript)
**Tests:** 175 passing, 0 failures
**Commits:** 7 since inception (2026-03-25)

---

## What's Real vs What's Stubbed

### Fully Working (Production-Grade)

| Component | Evidence |
|-----------|---------|
| **Ed25519 Identity** | Keypair generation, signing, verification. Industry-standard `ed25519_dalek`. |
| **E2E Encryption** | X25519 key exchange + ChaCha20-Poly1305 AEAD. Monotonic nonce counters. Random nonces via OsRng. 17 crypto tests. |
| **P2P Networking** | libp2p swarm with QUIC transport, mDNS discovery, GossipSub pub/sub, Kademlia DHT, Relay server/client, DCUtR hole-punching. `two_peers` example demonstrates end-to-end message flow. |
| **Text Messaging** | Full flow: UI → Tauri command → encrypt → GossipSub publish → remote peer receives → decrypt → store → UI event. Verified working in native app. |
| **SQLite Persistence** | 19 tables, all with CRUD operations. 103 store tests. Messages, servers, channels, peers, identity, invites, members, attestations, aliases, DMs, forums, conversations, webhooks, settings, TOTP, server keys. |
| **Server/Channel Architecture** | Create servers with channels, invite codes (max_uses enforcement), membership roles, per-channel GossipSub topic routing. |
| **Trust Attestation System** | Positive + negative attestations, weighted by attester trust level (0.5x-3.0x), cross-account reputation bleed (15% sibling factor). 5-tier badges. |
| **TOTP 2FA** | HMAC-SHA1 per RFC 6238. Validated against Google Authenticator test vectors. |
| **Alias System** | Multiple personae per identity, cross-account reputation linking. |
| **Frontend UI** | 12 routes, 45+ components, 9 Zustand stores. Kinetic Node design system fully ported. Responsive layout with 4 tiers down to 120x120 widget mode. |
| **Tauri Integration** | 30+ IPC commands, 10+ event types, async state management. Browser mock layer for UI iteration. |
| **Headless Daemon** | Starts node + webhost, auto-creates server, TOML config, `init`/`start`/`status` CLI. |

### Structured But Incomplete

| Component | What Exists | What's Missing |
|-----------|------------|---------------|
| **Voice/Video** | VoiceEngine + VoiceEngineHandle (async loop), VoiceSession (participant tracking), SignalingManager (SDP/ICE exchange), encrypted voice signaling over GossipSub. UI: VoiceChannel view, VoiceConnectionBar, ParticipantCard. | **No audio pipeline.** `audio.rs`, `video.rs`, `sfu.rs` are comment-only stubs. No cpal (microphone capture), no Opus (encoding), no str0m RTP (media transport). Users can "join" voice channels but no audio flows. |
| **Browser Guest WebUI** | axum HTTP server, PIN auth (6-digit), WebSocket bridge structure, rust-embed for SPA serving. GuestAuthPage UI. | WebSocket message routing is partial. Webhook event delivery to external URLs not implemented. Guest doesn't receive channel encryption keys during auth. |
| **Forums** | Local (TTL-hop-limited) + Global (mesh-wide). Encrypted with scope-derived keys. Storage, Tauri commands, ForumPage UI with local/global tabs. | No moderation tools, no pinned posts, no threading/replies. |

### Not Implemented (Design Only)

| Component | What Exists | What's Needed |
|-----------|------------|--------------|
| **BLE/WiFi Direct Transport** | `Transport` trait, `TransportManager`, 5 transport tiers defined with bandwidth/capability specs. Informed by bitchat protocol analysis. | Tauri v2 native plugins per platform: CoreBluetooth (iOS/macOS), BlueZ (Linux), Nearby Connections (Android). WiFi Direct via wpa_supplicant (Linux) or platform APIs. |
| **Distributed Ledger / CRDT** | Conceptual design saved to project memory. Server state shared between nodes via GossipSub. | No CRDT library integrated. No vector clocks. No causal ordering. No conflict resolution. No mesh map serialization format. |
| **Message History Sync** | `sync.rs` is a comment stub (9 lines). | When a peer reconnects after being offline, it has no way to recover missed messages. This is a **critical gap** for intermittent connectivity. |
| **Mesh Topology Management** | `mesh.rs` is a comment stub (11 lines). | No peer scoring, no connection rebalancing, no backbone promotion. GossipSub handles basic mesh maintenance, but application-level topology optimization is missing. |

---

## Architectural Shortcuts & Compromises

### 1. No Message History Sync (CRITICAL)
Messages are broadcast via GossipSub exactly once. If a peer is offline, they miss the message permanently. The `sync.rs` module is entirely empty. For a mesh network where nodes go on/offline frequently, this is the single biggest gap. **Impact:** Any device that sleeps (phones, laptops) loses messages.

### 2. No CRDT / Distributed State (HIGH)
Server state (members, channels, bans) is stored locally but not replicated. The vision is that "the server exists on the ledger and all connected nodes share it" — but there's no actual shared ledger. Each node has its own SQLite copy that can diverge. **Impact:** If two nodes both add members while disconnected, they'll have different member lists with no reconciliation.

### 3. Forum Encryption Uses Shared Well-Known Key (MEDIUM)
`derive_forum_key()` uses a hardcoded seed `"concord-forum-well-known-seed-v1"`. Every Concord node computes the same key. This is "encrypted radio" — external observers can't read GossipSub traffic, but any Concord peer can decrypt any forum post. This is intentional for public forums but means there's no per-forum access control.

### 4. Trust Attestation Signatures Not Verified on Receipt (MEDIUM)
Attestations are signed by the attester and broadcast via GossipSub. Receiving nodes store them but **do not verify the signature** (they'd need the attester's public key, which may not be locally available). A malicious node could forge attestations. **Fix:** Verify signatures when the attester's public key is known (from Identify protocol or Kademlia).

### 5. No Perfect Forward Secrecy in DMs (LOW)
The E2E DM system uses static X25519 shared secrets. If a shared secret is compromised, all past and future messages in that session are readable. The Double Ratchet algorithm (used by Signal) provides PFS by rotating keys per-message. The comment in `crypto.rs` notes this as a future upgrade.

### 6. Server Keys Not Distributed to Joining Members (MEDIUM)
When a user creates a server, a 32-byte secret is generated and stored locally. When another peer joins via invite, the server key should be transmitted to them (encrypted). This key distribution step is **not implemented** — joining members can't decrypt channel messages unless they also have the server key. **Impact:** Only the server creator can decrypt messages in their own channels.

### 7. Audio/Video is Signaling-Only (HIGH for voice/video use case)
The voice system handles join/leave/mute/deafen state and SDP/ICE signaling, but no actual audio data flows. The `cpal` (audio I/O), Opus (codec), and `str0m` (WebRTC RTP) integrations are stubs.

---

## Test Coverage Assessment

| Area | Tests | Quality |
|------|-------|---------|
| Crypto (encrypt/decrypt/keys) | 17 | Excellent — roundtrips, wrong-key rejection, nonce uniqueness |
| Identity (keypair lifecycle) | 4 | Good — generate, sign/verify, serialize/deserialize |
| Trust (scoring, attestations) | 15 | Good — threshold boundaries, weighted scoring, bleed |
| TOTP (RFC compliance) | 8 | Excellent — RFC test vectors, time window |
| Storage (all tables) | 103 | Comprehensive — CRUD for every table, edge cases |
| Networking (tunnels, discovery) | 7 | Moderate — tunnel type detection, basic discovery |
| Media (session, signaling) | 8 | Moderate — lifecycle, SDP flow |
| Daemon (config) | 6 | Basic — config parsing, defaults |
| Webhost (auth) | 5 | Basic — PIN validation, session tokens |
| **Frontend** | **0** | **No tests** (no Jest/Vitest configured) |
| **Integration** | **0** | **No end-to-end tests** |

**Notable absence:** No integration tests that spin up two nodes and verify message delivery. The `two_peers` example exists but isn't in the test suite.

---

## What's Been Forgotten / Not Considered

### 1. Offline-First / Message Sync
The entire system assumes peers are online. No local queue for outgoing messages when offline. No catch-up protocol for missed messages. For a mesh network, this is essential.

### 2. File/Media Sharing
No file upload, image sharing, or attachment system. Messages are text-only. For a chat platform, this is a gap.

### 3. Message Editing/Deletion
No edit or delete functionality. Messages are immutable once published to GossipSub.

### 4. Search
No full-text search across messages, forums, or DMs. SQLite FTS5 could be added relatively easily.

### 5. Notifications (System-Level)
No push notifications, no system tray indicator, no desktop notifications. The toast system is in-app only.

### 6. Rate Limiting / Spam Protection
No rate limiting on message sending, forum posting, or friend requests. A malicious peer could flood channels.

### 7. Content Moderation Tools
No reporting UI, no admin ban tools, no content filtering. The trust system flags bad actors but there's no enforcement mechanism.

### 8. Data Export / Backup
No way to export messages, settings, or identity to a file. No backup/restore flow.

### 9. Multi-Device Sync
The identity lives on one device's SQLite. No mechanism to use the same identity across multiple devices (phone + desktop). Would need key export/import or a device linking protocol.

### 10. Accessibility
No screen reader support, no keyboard navigation audit, no high-contrast mode. The Kinetic Node design uses low-contrast colors that may not meet WCAG AA.

---

## Metrics

```
Rust crates:           7 (core, net, media, store, webhost, daemon, tauri-app)
Frontend components:   45+
Routes:                12
Zustand stores:        9
Tauri IPC commands:    30+
Tauri events:          10+
SQLite tables:         19
Tests:                 175 (all passing)
Lines of code:         ~19,800
Design mockups:        9 screens (all implemented)
Git commits:           7
Development time:      ~2 days
```

---

## Recommended Next Steps (Priority Order)

1. **Message history sync** — Vector clock-based delta sync between peers on reconnection
2. **Server key distribution** — Encrypt and transmit server key to joining members via invite flow
3. **Attestation signature verification** — Verify trust attestations cryptographically
4. **Audio pipeline** — Connect cpal → Opus → str0m for real voice calls
5. **File/media sharing** — Chunk-based file transfer over GossipSub or direct streams
6. **CRDT shared state** — Operation-based CRDTs for server metadata replication
7. **Integration tests** — Two-node E2E test in CI
8. **Frontend tests** — Vitest setup with component tests
9. **BLE transport** — Platform-native Tauri plugins following bitchat's gossip pattern
10. **Content moderation** — Admin tools, reporting flow, spam protection
