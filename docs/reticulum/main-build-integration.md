# Reticulum Main-Build Integration

**Status:** Proposed 2026-04-15 · completes INS-037 transport integration design
**Scope:** root Concord repo (`src-tauri/`, stable Matrix build)
**Question answered:** does Reticulum integrate through the same transport path as `ServitudeHandle`, or as a separate overlay beside Matrix?

---

## 1. Decision

**Use the same transport path.**

Reticulum in the main build is an **additive `Servitude` transport** behind a Cargo feature flag:

- new config/runtime variant: `Transport::Reticulum`
- new runtime module: `src-tauri/src/servitude/transport/reticulum.rs`
- feature gate: `reticulum`
- default build: feature **OFF**

Reticulum is **not** a replacement for Matrix federation and **not** a resurrection of the old beta-only libp2p mesh inside the root repo.

### What Reticulum does in main build

- peer discovery over Reticulum announce/path mechanisms
- encrypted link establishment between Concord nodes that support it
- a small Concord envelope for text/presence relay over those links
- feed discovered peers into the same Explore/Sources surface as Matrix peers

### What Reticulum does *not* do in main build

- replace Matrix room/state protocol
- replace `tuwunel`
- pull the full concord-beta mesh stack back into this repo
- own BLE/WiFi Direct/MultipeerConnectivity mobile mesh work

That beta-only work stays in `concord_beta`.

---

## 2. Why this path

The repo already has the right seam:

- `ServitudeHandle`
- `TransportRuntime`
- config-driven transport selection
- lifecycle start/stop/health contract

So INS-034's transport audit answer for the root repo is effectively **yes**: the existing transport path is sufficient, with one addition — `Reticulum` becomes another `TransportRuntime` variant.

Why not a separate overlay layer?

- separate lifecycle = duplicated start/stop/health logic
- separate settings path = duplicated config/UI wiring
- separate discovery service = harder blast-radius control
- harder to keep feature flag fully off in default builds

Same transport seam keeps the optional dependency contained.

---

## 3. Architecture boundary

```text
Concord Tauri shell
  └─ ServitudeHandle
      ├─ MatrixFederationTransport   (default, existing)
      ├─ TunnelTransport             (future)
      ├─ WireGuardTransport          (future)
      └─ ReticulumTransport          (new, feature-gated)
           ├─ Reticulum adapter / sidecar process
           ├─ peer discovery
           ├─ encrypted links
           └─ Concord envelope relay (text + presence MVP)
```

### Key boundary choice

`ReticulumTransport` owns only the **link layer + peer envelope transport**.
It does **not** reimplement full Matrix semantics.

So the main build becomes:

- **Matrix** = canonical room/history/state protocol
- **Reticulum** = optional additive reachability + direct peer relay path

This matches the user's plan language: additive, not replacement.

---

## 4. Feature-flag contract

`src-tauri/Cargo.toml` gets:

```toml
[features]
default = []
reticulum = []
```

Real dependency wiring later can use optional crates or a sidecar binary, but the rule is fixed now:

### OFF by default

Default build must compile with:

```bash
cargo build
cargo test
```

without any Reticulum dependencies present.

### ON explicitly

Reticulum build compiles only with:

```bash
cargo build --features reticulum
```

### No leakage rule

When feature is off, these must not exist in compiled code paths:

- `Transport::Reticulum` enum variant references behind ungated matches
- Reticulum crate imports
- build scripts fetching Reticulum assets
- runtime UI toggles that imply support without capability detection

---

## 5. Runtime shape

## 5.1 Config enum

Current enum:

- `WireGuard`
- `Mesh`
- `Tunnel`
- `MatrixFederation`

Planned enum:

- `WireGuard`
- `Mesh`
- `Tunnel`
- `MatrixFederation`
- `Reticulum` *(feature-gated)*

`Mesh` remains a placeholder and still points conceptually at beta-only work. `Reticulum` is separate because this repo's integration goal is not "bring back the mesh rewrite" — it is "add a stable optional transport for discovery and direct encrypted links."

## 5.2 Transport runtime

`TransportRuntime` gains:

```rust
#[cfg(feature = "reticulum")]
Reticulum(reticulum::ReticulumTransport),
```

When feature is off, the variant does not exist.

## 5.3 Sidecar vs linked library

**Decision: prefer sidecar/adapter process first.**

Reasons:

- keeps dependency blast radius out of Concord process
- matches existing child-process pattern (`MatrixFederationTransport` -> tuwunel)
- easier to feature-gate cleanly
- easier to pin/log/restart independently
- better fit if the best usable Reticulum implementation remains Python-first

So `ReticulumTransport` should treat Reticulum like an external runtime managed by the servitude lifecycle, not like a deeply linked library unless later evidence proves a Rust-native path is clearly better.

---

## 6. Discovery model

### Source of truth

Reticulum discovery is transport-local. It yields **peer candidates**, not immediately trusted servers.

### Flow

1. `ReticulumTransport` starts local adapter/daemon.
2. Adapter announces local Concord node identity.
3. Adapter listens for Reticulum announces.
4. Matching Concord peers are normalized into a transport-agnostic `DiscoveredPeer` record.
5. UI merges these records into Explore/Sources beside Matrix peers.

### `DiscoveredPeer` minimum shape

```json
{
  "peer_id": "reticulum:abcd1234",
  "transport": "reticulum",
  "display_name": "Alice's Concord",
  "server_hint": null,
  "room_hints": [],
  "presence": "online",
  "capabilities": ["text", "presence"],
  "reachable": true
}
```

Matrix peers still produce their own records. UI merges both into one transport-agnostic list.

---

## 7. Envelope protocol

Main-build MVP over Reticulum carries a **small Concord envelope**, not raw Matrix events.

```json
{
  "version": 1,
  "type": "presence_update",
  "from": "reticulum:abcd1234",
  "timestamp": 1744704000000,
  "body": {}
}
```

Initial envelope types:

- `hello`
- `presence_update`
- `text_relay`
- `peer_goodbye`

### Why not raw Matrix over Reticulum?

Because the main-build goal here is smaller:

- prove discovery
- prove encrypted links
- prove additive text/presence relay
- keep Matrix canonical for stable-room semantics

Running full Matrix room/state replication over Reticulum would explode scope and blur into the beta mesh track again.

---

## 8. UI integration

Reticulum-discovered peers appear in the **same** Explore/Sources UI as Matrix peers.

Rules:

- transport is secondary metadata, not primary label
- UI should say "Concord peer" first, not "Reticulum node"
- user can filter by availability/capabilities, not by protocol jargon unless in advanced/debug view

### UI data contract

Both Matrix and Reticulum discovery feed the same client-side list shape:

```ts
type DiscoverableSource = {
  id: string;
  kind: "peer" | "server" | "room";
  transport: "matrix" | "reticulum";
  title: string;
  subtitle?: string;
  capabilities: string[];
  online: boolean;
};
```

This keeps INS-037 UX surface aligned with INS-025 / INS-032 instead of spawning a separate Reticulum page.

---

## 9. Failure / blast-radius rules

Reticulum is **non-critical**.

If `ReticulumTransport` fails:

- Matrix transport keeps running
- Concord UI stays usable
- discovered Reticulum peers disappear or show degraded
- servitude may enter a degraded-transports state, not total failure

This should copy the Discord bridge pattern, not the core-Matrix path.

---

## 10. Security posture

### Trust boundary

A discovered Reticulum announce is **not** automatic trust.

Required before meaningful relay:

- cryptographic peer identity from Reticulum layer
- Concord capability/version handshake (`hello` envelope)
- explicit allow/accept policy for persistent pairing if the product later needs it

### Logging

Do not dump raw Reticulum payloads or keys into logs.

Log only:

- peer IDs
- transport state transitions
- capability handshake summaries
- redacted error causes

---

## 11. Implementation phases

### Phase A — design + feature gate

- this doc
- add Cargo feature
- add gated enum/runtime placeholders
- default build still clean

### Phase B — transport scaffold

- `reticulum.rs` runtime module
- start/stop/health semantics
- sidecar binary discovery
- config wiring

### Phase C — discovery

- announce/listen
- normalize to `DiscoveredPeer`
- surface in Explore/Sources

### Phase D — encrypted channel + text/presence MVP

- capability handshake
- direct encrypted channel
- envelope relay

### Phase E — ops/deployment

- docs
- compose/runtime notes
- capability detection in native builds

---

## 12. Explicit non-goals

Not part of INS-037 design:

- mobile BLE/WiFi Direct mesh
- libp2p replacement
- CRDT/shared-state sync
- audio/video over Reticulum
- removing Matrix federation
- folding `concord_beta` back into this repo

---

## 13. Acceptance checklist

INS-037 design is complete when:

- [x] architecture choice made: same transport seam
- [x] role of Reticulum vs Matrix made explicit
- [x] feature-flag contract defined
- [x] sidecar-vs-library direction chosen
- [x] discovery/UI merge shape defined
- [x] MVP relay scope defined: text + presence only
- [x] failure isolation rules defined
- [x] non-goals called out to prevent beta/main-build scope collapse

---

## 14. Follow-on code changes implied

Later implementation should touch:

- `src-tauri/Cargo.toml`
- `src-tauri/src/servitude/config.rs`
- `src-tauri/src/servitude/transport/mod.rs`
- `src-tauri/src/servitude/transport/reticulum.rs`
- Explore/Sources client data contract
- deployment docs / compose notes
