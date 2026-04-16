# Reticulum Promotion Checklist (INS-034 / INS-037)

**Status:** In progress — Wave 1 complete, Waves 2–4 pending  
**Date:** 2026-04-16  
**Scope:** Steps required to promote Reticulum from the INS-031 beta proving
ground to main-build shipping quality under INS-037.

**Prerequisites:**
- `docs/reticulum/main-build-integration.md` — architecture decision (Option A chosen)
- `docs/reticulum/transport-trait-audit.md` — Transport trait compatibility audit

---

## 1. Transport Trait Compatibility Gate

**Reference:** `docs/reticulum/transport-trait-audit.md`

The existing `Transport` trait in
`src-tauri/src/servitude/transport/mod.rs` was audited on 2026-04-14. Result:
**compatible without modification.** The trait requires `name()`, `is_critical()`,
`start()`, `stop()`, and `is_healthy()` — all implementable by a child-process
transport like `ReticulumTransport`.

Checklist:

- [x] Audit existing `Transport` trait for Reticulum hosting compatibility
- [x] Confirm no structural changes to the trait are needed
- [x] Confirm `async_trait` bounds are compatible with child-process lifecycle management
- [ ] **Re-audit** if the trait is modified by any other INS-037 wave before promotion

---

## 2. Feature Flag OFF-by-Default Verification

**Reference:** `src-tauri/Cargo.toml` `[features]` section

The `reticulum` Cargo feature must be OFF by default so the standard build is
unaffected.

Checklist:

- [x] `reticulum = []` declared in `[features]` in `Cargo.toml`
- [x] `cargo build` (no flags) compiles clean — no Reticulum code in the default binary
- [x] `cargo build --features reticulum` compiles clean — Reticulum code compiles without errors
- [x] `cargo test` passes the same test count with and without `--features reticulum`
- [ ] CI pipeline has a separate job that builds with `--features reticulum` to prevent silent breakage
- [ ] Release binary (GitHub Releases / AUR) built WITHOUT the flag; opt-in binaries documented separately

**Verification command:**
```bash
# Must produce identical output except for timing:
cargo build 2>&1 | grep -E "^error"
cargo build --features reticulum 2>&1 | grep -E "^error"
```

---

## 3. `rnsd` Binary Bundling / Runtime Dependency Documentation

**Reference:** `src-tauri/src/servitude/transport/reticulum.rs` — binary discovery order

Reticulum's canonical implementation is Python (`pip install rns`). A compiled
`rnsd` binary is not available for all targets. This must be resolved before promotion.

**Binary discovery order** (implemented in `ReticulumTransport::find_rnsd_bin()`):

1. `RNSD_BIN` env var — dev/ops override
2. `<exe_dir>/resources/reticulum/rnsd` — bundled binary
3. `PATH` lookup (`which rnsd`)

**Promotion checklist:**

- [ ] **Decision required:** bundle a compiled `rnsd` OR require system install OR embed a Python runtime  
  _Options:_
  - **Bundle compiled binary** (PyInstaller / Nuitka build of `rns`) — largest bundle, most portable
  - **Require system Python + `pip install rns`** — smallest bundle, requires user action
  - **Embed Python via `pyo3`** — mid-size, highest maintenance burden (not recommended)
  - **Wait for a native Rust `rnsd` port** — currently experimental, no production users
- [ ] If bundling: add build script or CI step to fetch/compile `rnsd` binary for each target platform
- [ ] If requiring system install: add a pre-flight check in `ReticulumTransport::start()` that surfaces a helpful error if `rnsd` is missing (partially implemented — `find_rnsd_bin` already does this)
- [ ] Update `docs/deployment/` to document the runtime dependency on `rnsd` when the feature flag is enabled
- [ ] Update `docker-compose.yml` or add a `docker-compose.reticulum.yml` overlay for containerized deployment (see §6)

---

## 4. Integration Test Checklist

**Reference:** `src-tauri/src/servitude/transport/reticulum.rs` tests (Wave 1)

Wave 1 ships unit tests covering lifecycle state (name, is_critical, initial
stopped state, data dir creation). Higher-level integration tests are required
before promotion.

- [x] Unit: `test_reticulum_transport_name` — name returns `"reticulum"`
- [x] Unit: `test_reticulum_transport_not_critical` — is_critical returns false
- [x] Unit: `test_reticulum_transport_initially_stopped` — child is None at init
- [x] Unit: `test_resolve_data_dir_creates_directory` — data dir is non-empty
- [ ] **Integration: node discovery smoke test** — two `rnsd` instances on LAN discover each other via announce
  ```bash
  # Manual smoke test (once rnsd is bundled or installed):
  # Terminal A: start rnsd with a Concord announce
  rnsd --config /tmp/rns-a/config &
  python3 -c "import RNS; ... # announce a Concord destination"
  # Terminal B: start rnsd, verify it receives the announce
  rnsd --config /tmp/rns-b/config &
  python3 -c "import RNS; ... # check RNS.Transport.destinations"
  ```
- [ ] **Integration: encrypted channel round-trip** — instance A opens an `RNS.Link` to instance B, sends a message, B receives it
- [ ] **Integration: tuwunel ↔ Reticulum peering** — tuwunel configured with a `TCPClientInterface` pointing at `rnsd`'s management port can exchange Matrix federation traffic over a Reticulum link (requires Wave 2 work)
- [ ] **Regression: `cargo test` still passes 79+ tests** after any future trait modification
- [ ] **Regression: `cargo test --features reticulum`** adds only Reticulum-scoped tests, does not regress existing tests

---

## 5. Ops / Deployment Checklist

**Reference:** `docker-compose.yml`, `docs/deployment/`

- [ ] **Wave 2** (INS-037 W2): write a real `rnsd.conf` that declares:
  - A `TCPServerInterface` on a loopback port (so tuwunel can use `TCPClientInterface` to peer)
  - A `managementport` so the health probe in `is_healthy()` actually works
  - Storage path set to the data directory resolved by `ReticulumTransport::resolve_data_dir()`
- [ ] Document any required host-level network interface config (TUN/TAP for IP-level interfaces, serial port for LoRa links)
- [ ] Add `docs/deployment/reticulum-feature-flag.md` covering:
  - How to enable the feature flag in a custom build
  - How to install/bundle `rnsd`
  - Supported physical interfaces and how to declare them in `rnsd.conf`
  - How to verify Reticulum is working (`rns --status`, management port probe)
- [ ] Update `docker-compose.yml` with a comment block or overlay file showing the Reticulum-enabled container configuration
- [ ] Confirm that the Reticulum data directory (`~/.local/share/concord/reticulum/` on Linux) is covered by backup/restore procedures

---

## 6. UX Verification Checklist

**Reference:** `client/src/stores/sources.ts`, `client/src/components/sources/`

INS-037 requires that Reticulum-discovered peers appear in the same
Explore/Sources UI as Matrix peers. UX scaffolding lands in the Reticulum UX
surface task (cluster 5 in the current sprint); end-to-end verification
requires a running Reticulum transport.

- [x] **UX scaffolding:** `ConcordSource.platform` accepts `"reticulum"` variant
- [x] **UX scaffolding:** add-source flow has a "Reticulum" option in the picker
- [x] **UX scaffolding:** Reticulum sources appear in SourcesPanel with a placeholder icon
- [ ] **End-to-end:** a Reticulum-discovered peer appears in the Sources panel automatically (no manual entry required)
- [ ] **End-to-end:** clicking a Reticulum source in SourcesPanel opens the same room browser as Matrix/Concord sources
- [ ] **End-to-end:** the transport is transparent to the user — they see "a Concord instance", not "a Reticulum node"
- [ ] **Regression:** existing Matrix and Discord sources continue to work after Reticulum transport is enabled

---

## Wave Summary

| Wave | INS-037 Item | Status | Blocking on |
|------|-------------|--------|-------------|
| W0 | Design doc + feature flag | DONE | — |
| W1 | ReticulumTransport lifecycle stub | DONE (this sprint) | — |
| W2 | Real rnsd config + tuwunel peering | TODO | rnsd bundling decision (§3) |
| W3 | Node discovery via announce | TODO | W2 complete |
| W4 | Encrypted channel establishment | TODO | W3 complete |

---

## References

- `src-tauri/src/servitude/transport/reticulum.rs` — INS-037 Wave 1 implementation
- `src-tauri/src/servitude/transport/mod.rs` — TransportRuntime enum
- `src-tauri/Cargo.toml` — `[features]` section
- `docs/reticulum/main-build-integration.md` — architecture decision
- `docs/reticulum/transport-trait-audit.md` — Transport trait audit
- Reticulum Network Stack: https://reticulum.network
- `rns` Python package: https://github.com/markqvist/Reticulum
