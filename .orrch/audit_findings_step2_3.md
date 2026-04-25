# Audit findings — steps 2 & 3

Date: 2026-04-24
Project: /home/corr/projects/concord

---

## verify-claim (Feature Tester)

### ITEM phase-priority-mobile-testing-ios-build: iOS build pipeline
**Verdict:** partial
**Evidence:**
- `src-tauri/Cargo.toml:99-101` mentions `aarch64-apple-ios` and `aarch64-apple-ios-sim` triples in comments only; iOS target dependencies block (line 106) is empty.
- `src-tauri/gen/apple/` Xcode project tree exists.
**Missing evidence:**
- No `native-audio` Cargo feature found in this repo (only `default = []`, `reticulum = []`).
- No build script verifies cross-compilation succeeds.
**Notes:** scaffold present; `native-audio` feature was likely in `concord-beta` (referenced by PLAN context).

### ITEM phase-priority-mobile-testing-ios-entitlements: iOS entitlements + permissions
**Verdict:** verified
**Evidence:**
- `src-tauri/gen/apple/concord_iOS/Info.plist` declares NSBluetoothAlwaysUsageDescription, NSBonjourServices (`_concord._tcp`/`_udp`), NSCameraUsageDescription, NSLocalNetworkUsageDescription, NSMicrophoneUsageDescription, UIBackgroundModes:audio.
- `src-tauri/gen/apple/concord_iOS/concord_iOS.entitlements` declares wifi-info + keychain access.

### ITEM phase-priority-mobile-testing-mpc-transport: MultipeerConnectivity transport scaffold
**Verdict:** false
**Evidence:**
- No `ConcordMPCManager.swift` or `MpcTransport` source anywhere in `/home/corr/projects/concord` (only PLAN.md references it).
**Missing evidence:**
- No Swift source file, no Rust FFI bridge.
**Notes:** Per MEMORY.md, beta-mesh work lives in separate `concord-beta` repo.

### ITEM phase-priority-mobile-testing-ipad-layout: iPad-specific layout
**Verdict:** verified
**Evidence:**
- `client/src/components/layout/ChatLayout.tsx:217-220` reads `platform.isIPad`.
- `src-tauri/gen/apple/project.yml:72,78,148`.
- `client/src/components/layout/__tests__/ChatLayout.iPad.test.ts` exists.

### ITEM phase-priority-internet-first-wireguard-detection: WireGuard tunnel detection
**Verdict:** false
**Evidence:**
- `src-tauri/src/servitude/transport/mod.rs:265,357,367-368` defines a WireGuard transport stub that returns `TransportError::NotImplemented("wireguard")`.
**Missing evidence:**
- No `wireguard.rs` detection module, no `ConnectionType::WireGuard` enum, no `get_wireguard_status` Tauri command, no dashboard status card.
**Notes:** Frontend `transports.wireguard` boolean toggle exists in AdminTab but no detection logic.

### ITEM beta-mesh-* (all): Tauri+Rust scaffold, libp2p, identity, DM encryption, audio pipeline, security audit framework, voice commands, BLE/WiFi Direct, LICENSE
**Verdict:** unverifiable
**Evidence:** Beta mesh work lives in separate `concord-beta` repo; no sibling at `/home/corr/projects/concord-beta`. All beta-mesh items out of scope for this repo audit.

### ITEM mesh-network-* (all): mathematical framework, deterministic addressing, procedural map, orphaned node, viewer backend/frontend, node verification, server verification, stale detection, forum-as-channel, prominence, reputation, cooperative compute, cluster mode, fluid hypervisor, invisible voting, group theory, perspective map, forum map view, friend mesh sharing, charter immutability, phantom node
**Verdict:** unverifiable
**Evidence:** All mesh-network items reside in concord-beta (per MEMORY); no mesh primitives in concord root.

### ITEM mesh-network-tunnel-detection-orrtellite: Tunnel detection via orrtellite
**Verdict:** false
**Evidence:** Same as ITEM phase-priority-internet-first-wireguard-detection — only NotImplemented stubs in mod.rs:265.

### ITEM places-system-* (all): minting, communal governance, block list, default rules screen
**Verdict:** unverifiable
**Evidence:** Beta-scope items; not present in concord root.

### ITEM service-node-headless-binary: Headless service node binary — servitude
**Verdict:** false
**Evidence:** No standalone `concord-daemon` binary or workspace target in `src-tauri/Cargo.toml` or top-level.
**Notes:** Item explicitly marks itself as later promoted to embedded module (next item).

### ITEM service-node-mesh-map-integration: Mesh map integration
**Verdict:** false
**Evidence:** No `TOPIC_MAP_SYNC`/`auto_join_places` strings present in concord root.

### ITEM service-node-promote-to-embedded: Promote concord-daemon to embedded servitude module
**Verdict:** verified
**Evidence:**
- `src-tauri/src/servitude/{mod.rs,config.rs,lifecycle.rs}` all exist.
- `Cargo.toml:30-31` adds `toml` and `thiserror` deps.
- `mod.rs:14-17,41-47` declares Transport enum and exports `ServitudeConfig`, `Transport`, `LifecycleState`.

### ITEM service-node-tauri-invoke-handlers: Wire Tauri invoke handlers for embedded servitude
**Verdict:** verified
**Evidence:** `src-tauri/src/lib.rs:8,26,57,91,110,144,327-329` defines `ServitudeState(Mutex<Option<ServitudeHandle>>)` and `servitude_start`, `servitude_stop`, `servitude_status` Tauri commands.

### ITEM service-node-web-admin-ui: Web admin UI for service node configuration
**Verdict:** verified
**Evidence:**
- `client/src/components/settings/AdminTab.tsx:1477` defines `ServiceNodeSection`.
- `server/routers/admin.py:861-1089` has service-node config router with `_serialize_service_node`.
- `server/services/service_node_config.py` exists.
- Test `client/src/components/settings/__tests__/AdminTab.service-node.test.tsx` exists.

### ITEM service-node-resource-controls: Resource contribution controls
**Verdict:** verified
**Evidence:** Controls live inside `ServiceNodeSection` in AdminTab.tsx.

### ITEM service-node-first-deployment-orrgate: First deployment — orrgate
**Verdict:** partial
**Evidence:**
- `docker-compose.yml` exists at repo root.
- `scripts/verify_deployed_bundle.sh` exists.
**Missing evidence:** Actual orrgate deployment is external state.
**Notes:** Per MEMORY.md `reference_orrgate_deployment.md`, orrgate must NOT host concord; this item is potentially obsolete.

### ITEM game-center-game-dev-workflow-design: Game dev workflow design
**Verdict:** verified
**Evidence:** `docs/game-center/game-dev-workflow.md` exists.

### ITEM game-center-launch-animation: Launch animation
**Verdict:** verified
**Evidence:** `client/src/components/LaunchAnimation.tsx`, `client/src/bootSplash.ts`, `client/src/components/__tests__/LaunchAnimation.test.tsx` all exist.

### ITEM mobile-dashboard-reconnect-last-channel: 1-2 tap reconnect to last channel
**Verdict:** partial
**Evidence:** `concord_last_channel` localStorage key referenced in `ChatLayout.tsx:147`.
**Missing evidence:** Named `handleReconnectLastChannel` symbol not found.
**Notes:** Likely renamed/refactored; functional intent appears preserved.

### ITEM mobile-dashboard-host-exchange / mobile-dashboard-open-profile / mobile-dashboard-node-settings
**Verdict:** partial
**Evidence:** Various `openSettings(...)` calls present in ChatLayout, but explicit named handlers (handleHostExchange/handleOpenProfile/handleOpenNodeSettings) not found.

### ITEM regression-step-1-build-provenance / regression-step-5-blockquote
**Verdict:** verified
**Evidence:** `scripts/verify_deployed_bundle.sh` and `MessageContent.tsx` blockquote in CLASSNAME_TAGS confirmed.

### ITEM ins-001-mobile-logout-control: Logout control on mobile
**Verdict:** verified
**Evidence:** `useAuthStore((s) => s.logout)` consumed in `ChatLayout.tsx:171`; `<UserBar logout={logout}/>`; comments at lines 1264 and 1704 noting Logout is now in Settings → Profile only; `handleLogout` at line 2659.

### ITEM ins-001-mobile-vertical-scrolling / text-formatting / menu-redesign
**Verdict:** unverifiable
**Evidence:** Behavior-only claims, no specific symbols/files.

### ITEM ins-002-markdown-parser / syntax-support / html-sanitization / apply-everywhere
**Verdict:** verified
**Evidence:** `MessageContent.tsx` uses react-markdown + remark-gfm + rehype-sanitize.

### ITEM ins-002-dark-theme: Verify rendering matches dark theme
**Verdict:** unverifiable
**Evidence:** Visual claim.

### ITEM ins-009-verify-deployed-bundle / blockquote-support / audit-room-renderers
**Verdict:** verified

### ITEM ins-001b-channel-label-truncation / ins-002b-drag-reorder
**Verdict:** verified
**Evidence (ins-002b):** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` declared in `client/package.json:15-17`. `SortableServerRow` defined in `ServerSidebar.tsx`. `SERVER_ORDER_STORAGE_KEY_PREFIX = "concord_server_order"`.

### ITEM ins-003b-channel-tile-redesign / ins-004b-channel-add-delete
**Verdict:** unverifiable / partial
**Notes:** ins-004b self-describes as "partial" pending INS-012.

### ITEM ins-005b-notification-badges / ins-006b-mark-read-realtime
**Verdict:** unverifiable / partial
**Evidence (006b):** `useUnreadCounts.ts:96,166,226` references `m.fully_read` marker handling.

### ITEM ins-007b-server-presence-badge: Green presence badge on servers with active users
**Verdict:** false
**Evidence:** No `presence` references in `ServerSidebar.tsx`; no green-dot badge code found.

### ITEM ins-003-replace-input / max-height / message-area-reflow / smooth-transition / desktop-mobile / enter-semantics
**Verdict (replace-input, enter-semantics):** verified
**Evidence (enter-semantics):** `MessageInput.tsx:108,169-170`: `isCoarsePointer` check + Enter without shift + `!isComposing` triggers send.
**Verdict (others):** unverifiable / behavior-only

### ITEM ins-010-verify-deployed-bundle / audit-flex-chain
**Verdict:** verified / unverifiable

### ITEM ins-011-utility-buttons-top-bar
**Verdict:** verified
**Evidence:** `ChatLayout.tsx:1271,1716` use `TopBarIconButton`; `BugReportModal`/`StatsModal`/`HelpModal` referenced.

### ITEM ins-017-collapse-mobile-utility-bar
**Verdict:** partial
**Evidence:** `_MobilePillRow` referenced but `TopBarOverflowMenu` symbol search returned no hits.

### ITEM ins-016-mobile-dashboard-pills
**Verdict:** partial
**Notes:** Comments at lines 1268, 1503, 1515 indicate `MobilePillRow` was REMOVED in INS-044 — DMs moved to top bar. Item description is stale w.r.t. removal.

### ITEM ins-012-unified-settings: Unified comprehensive settings interface
**Verdict:** verified
**Evidence:** `SettingsModal.tsx:64` defines `SettingsPanel`; line 17 imports `ServerSettingsContent`; line 374 delegates server tabs.

### ITEM ins-014-linux-native-pipeline / ins-015-machine-split
**Verdict:** verified
**Evidence:** `scripts/build_linux_native.sh`, `client/NATIVE_BUILD.md`, `tauri.conf.json` + per-platform build scripts present.

### ITEM ins-022-* (settings-node-toggle, foreground-background, qr-host, qr-guest, battery-disclosure)
**Verdict:** verified
**Evidence:** `SettingsModal.tsx`, `NodeHostingTab.tsx`, `useServitudeLifecycle.ts`, `HostPairingQR.tsx`, `GuestPairingScanner.tsx`, `pairingSchema.ts` all exist + tests present.

### ITEM ins-024-wave-0/1/2/3 (asapi-gate, echo, docker-service, tauri-bubblewrap)
**Verdict:** verified
**Evidence:** `server/tests/test_tuwunel_asapi.py`, `test_appservice_echo.py`, `docker-compose.yml:67-128` (concord-discord-bridge), `discord_bridge.rs` all exist.

### ITEM ins-024-wave-4-stronghold-bridges-ui
**Verdict:** partial
**Evidence:**
- `src-tauri/Cargo.toml:28` adds `tauri-plugin-stronghold`.
- `bridge_commands.rs:220,389,434` defines `discord_bridge_set_bot_token`, `discord_bridge_enable`, `discord_bridge_disable`.
- `client/src/api/bridges.ts` exists.
**Missing evidence:** No `client/src/components/settings/BridgesTab.tsx` file exists; bridges UI is integrated elsewhere.

### ITEM ins-024-wave-4b-user-mode / wave-5-commercial-ship / bridge-protocol-doc
**Verdict:** verified / partial / verified

### ITEM ins-025-explore-backend / explore-ui
**Verdict:** verified
**Evidence:** `server/routers/explore.py`, `server/services/tuwunel_config.py`, `server/tests/test_explore.py`; `ExploreModal.tsx`, `client/src/api/concord.ts:1608` (`listExploreServers`).

### ITEM ins-026-* (diagnostic, caddy-routing, cloudflare-config, e2e-smoke-test)
**Verdict:** verified / verified / unverifiable / partial
**Evidence:** `docs/federation-reachability-diagnosis.md`, `config/Caddyfile`, `client/src/__tests__/federation.smoke.test.ts`.

### ITEM ins-027-* (well-known-helper, server-config-store, getapibase-refactor, server-picker-screen, server-side-wellknown, cross-reference-update)
**Verdict:** verified (most), unverifiable (cross-reference-update meta-task)
**Evidence:** `client/src/api/wellKnown.ts:263` exports `discoverHomeserver`; `client/src/stores/serverConfig.ts`; `client/src/api/serverUrl.ts`; `ServerPickerScreen.tsx:272`; `server/routers/wellknown.py:122-154`.

### ITEM ins-028-* (server-github-issue, admin-ui-github-link, pat-rotation-runbook)
**Verdict:** verified
**Evidence:** `server/routers/admin.py:177` `_create_github_issue_for_bug_report`; `database.py:55` migration; `AdminTab.tsx:1374-1383` "View on GitHub" link; `docs/deployment/github_bug_report_token.md`.

### ITEM ins-032-* (multi-source-audit, concord-peering-ux, source-model-unification)
**Verdict:** verified
**Evidence:** `SourcesPanel.tsx`, `DiscordSourceBrowser.tsx`, `ExploreModal.tsx`, `client/src/stores/sources.ts:21,57` (`ConcordSource` with `platform` field).

### ITEM ins-033-* (source-abstraction-audit, discord-source-entry, message-send-parity, source-picker-ui)
**Verdict:** verified
**Evidence:** Uniform platform discriminant in sources store; `useMatrix.ts:662,678` defines `useSendMessage`.

### ITEM ins-035-* (wave 0/1/2/3/4/5)
**Verdict:** verified (most), partial (wave-4)
**Evidence (waves verified):** `docs/bridges/discord-video-feasibility.md`; `discord-voice-bridge/src/pure.js:22,140` (DISCORD_VIDEO_IDENTITY_PREFIX); `discord-voice-bridge/src/index.js:57,282-290` (VIDEO_INGEST_AVAILABLE guard); `server/models.py:219-220` (`video_enabled`, `projection_policy`); `server/routers/admin_discord_voice.py:43-161`; `client/src/api/bridges.ts:71-72,242-243`.
**Missing evidence (wave-4):** No dedicated `BridgesTab.tsx` file; UI presumed inline in another tab.

### ITEM ins-036-* (shared-display, readonly-admin, per-user, hybrid, wave 0-5)
**Verdict:** verified, except wave-5 partial
**Evidence:** `client/src/components/extension/InputRouter.ts:11-14` defines all four input modes; `BrowserSurface.tsx:23,29`; `client/src/extensions/sdk.ts:25`; `docs/extensions/{session-model,shell-api,worldview-migration,roll20-feasibility}.md`.

### ITEM ins-034-* / ins-037-* (transport-trait-audit, promotion-checklist, integration-design, feature-flag, ux-surface)
**Verdict:** verified
**Evidence:** `src-tauri/src/servitude/transport/mod.rs`; `docs/reticulum/{transport-trait-audit,reticulum-promotion-checklist,main-build-integration}.md`; `Cargo.toml:16,121` declares `reticulum = []`; `transport/reticulum.rs`; `mod.rs:148,193` includes `Reticulum` variant; `sources.ts:57` includes `"reticulum"` platform.

### ITEM ins-038-sources-panel-leftmost
**Verdict:** verified
**Evidence:** `SourcesPanel.tsx` exists and is consumed by `ChatLayout.tsx:953,1370`.

### ITEM ins-039-server-tile-sort / ins-041-remove-quick-actions / ins-042-pill-hide-show-swipe / ins-043-swipe-pages-only / ins-044-plus-pill-multi-tab / ins-045-left-edge-tap / ins-046-right-edge-tap / ins-047-browse-tab-restore / ins-048-status-bar-hardware
**Verdict:** unverifiable
**Evidence:** Behavior-only; some have stale comments.
**Notes (ins-042/044):** Comments at ChatLayout.tsx:1503,1515 indicate pill menu may have been removed entirely in INS-044, contradicting hide/show behavior in INS-042.

### ITEM ins-040-settings-top-bar
**Verdict:** verified
**Evidence:** `SettingsPanel` defined in `SettingsModal.tsx:64`; ChatLayout has top-bar buttons.

### ITEM ins-049-servitude-ui-web / ins-050-docker-first-boot / ins-052-native-in-process-hosting
**Verdict:** verified
**Evidence:** `AdminTab.tsx:1477` `ServiceNodeSection`; `DockerFirstBootScreen.tsx:25`; `lifecycle.rs`, `transport/matrix_federation.rs`, `servitude_start` in `lib.rs:57,327`.

### ITEM ins-051-default-domain-concordchat
**Verdict:** partial
**Evidence:** `concorrd` purged from `install.sh` and `docker-compose.yml`. Tests reference `example.concordchat.net`.
**Missing evidence:** PUBLIC_BASE_URL inference still pending.

### ITEM ins-053-permission-channel-creation / ins-054-private-channels-closed
**Verdict:** unverifiable / verified (decision-only)

### ITEM ins-013-auto-scroll-on-send / ins-018-mobile-return-newline
**Verdict:** unverifiable / verified
**Evidence (018):** `MessageInput.tsx:108,169` confirms `isCoarsePointer` early return + `isComposing` guard.

### ITEM ins-019a-chart-rendering / ins-019b-concord-side
**Verdict:** verified
**Evidence:** `MessageContent.tsx:34,300-359,410,453,520` defines `ChartAttachment`, `validateChartAttachment`, `ChartRenderer`, `InvalidChartPill`, `ChartErrorBoundary`. Test `MessageContent.chart.test.tsx` exists. `docs/openclaw_chart_tool_spec.md` exists.

### ITEM unfinished-launch-animation-shipped / unfinished-service-node-admin-shipped / unfinished-hollow-start-reintegrated
**Verdict:** verified
**Evidence:** Commits and files all confirmed.

### ITEM shipped-voice-input-speech-gate / shipped-turn-relay-hardening
**Verdict:** verified
**Evidence:** `client/src/voice/noiseGate.ts`; tests; `server/tests/test_turn_relay_smoke.py`.

### ITEM shipped-definitive-app-icon
**Verdict:** partial
**Evidence:** `concord-definitive-icon.png` exists.
**Missing evidence:** Cross-platform icon assets not separately verified.

---

## codebase-audit (Developer) — undeclared features

### UNDECLARED: Per-extension upstream-API proxy (`/api/ext-proxy/*`)
**Kind:** api endpoint / module
**Location:** `server/routers/ext_proxy.py:1-300+`
**What it does:** Server-side proxy for extensions to hit upstream APIs (OpenSky/Sentinel/NYC DOT) without leaking OAuth client_secrets to the iframe; per-ext secrets stored in `instance.json[extension_secrets]`; admin endpoints `GET/PATCH /api/admin/extensions/{ext_id}/secrets`; user-facing `GET /api/users/me/extensions/{ext_id}/browser-config`; public companion `GET /api/extensions/{ext_id}/public-config`. Shipped as v0.6.0/v0.6.1.
**Suggested plan placement:** New phase under "Extension Platform" — companion to INS-036 wave 4 (Extension SDK).

### UNDECLARED: Discord user OAuth2 connection (`/api/users/me/discord/oauth/*`)
**Kind:** api endpoint + UI panel
**Location:** `server/routers/user_discord_oauth.py`, `client/src/components/settings/UserConnectionsTab.tsx`, `client/src/components/discord/{DiscordBrowser,DiscordPanel}.tsx`
**What it does:** Per-user Discord account connection via OAuth2 (start/callback/delete), guild listing, channel browsing, and best-effort message read/send via the bridge sqlite token. Replaces the prior bridge-QR per-user login. Admin OAuth credential storage via `/api/admin/integrations/discord-oauth`. Shipped as v0.5.0.
**Suggested plan placement:** New item under PRIORITY: Discord Source Integration (INS-033) or a new "User Account Connections" phase.

### UNDECLARED: App-channel kind (`channel_type: "app"` + extension binding)
**Kind:** module + api endpoint
**Location:** `server/models.py` (Channel.extension_id, app_access), `server/routers/servers.py`, `client/src/api/concord.ts`
**What it does:** Promotes installed extensions to first-class server channels under "Applications" group, with `extension_id` reference and `app_access` ("all" | "admin_only"). Shipped as v0.7.0.
**Suggested plan placement:** Extension Session / Browser Surface Platform (INS-036) — Wave 6 follow-up.

### UNDECLARED: Soundboard subsystem (clips + sound library import)
**Kind:** api endpoint + UI panel
**Location:** `server/routers/soundboard.py`, `client/src/components/voice/SoundboardPanel.tsx`
**What it does:** Per-server soundboard with clip upload, CRUD, magic-byte file validation, 5MB cap, and Freesound library search/import backed by `FREESOUND_API_KEY`.
**Suggested plan placement:** Voice/Audio Platform — new phase, or backfill into "Shipped" inventory.

### UNDECLARED: Server webhooks (`/api/servers/{id}/webhooks`, `/api/hooks/{id}`)
**Kind:** api endpoint
**Location:** `server/routers/webhooks.py`
**What it does:** CRUD webhook tokens per server plus an inbound `POST /api/hooks/{webhook_id}` ingestion endpoint that posts as a synthetic Matrix author into a target channel.
**Suggested plan placement:** New "Integrations" section, or backfill into Shipped inventory.

### UNDECLARED: TOTP / two-factor authentication
**Kind:** api endpoint + UI flow
**Location:** `server/routers/totp.py` (status/setup/verify/disable/login-verify/users-with-totp), `client/src/api/concord.ts` (getTOTPStatus, loginVerifyTOTP), `client/src/hooks/useTOTPUsers.ts`, `client/src/components/auth/LoginForm.tsx` (totpCode flow)
**What it does:** TOTP enrolment + login second-factor verification, with admin-visible TOTP-users list.
**Suggested plan placement:** Security / Auth — new section, or backfill into Shipped inventory.

### UNDECLARED: Moderation surface — channel pin-locks, vote-kick, ban-settings, whitelist
**Kind:** api endpoint + UI components
**Location:** `server/routers/moderation.py`, `client/src/components/moderation/{BanOverlay,PinDialog,VoteKickBanner}.tsx`
**What it does:** Owner can PIN-lock channels; per-server vote-kick proposal/vote/execute with eligibility gating; ban-settings; member-permissions/role patches; server bans/whitelist routes.
**Suggested plan placement:** Server-scope Moderation — new phase, or backfill into Shipped inventory.

### UNDECLARED: Direct invites (cross-server user-to-user invitation)
**Kind:** api endpoint + UI banner
**Location:** `server/routers/direct_invites.py`, `client/src/components/DirectInviteBanner.tsx`, `client/src/stores/directInvites.ts`
**What it does:** Server admins search users by Matrix ID and issue named direct invites to specific channels; recipient sees banner and accept/decline; auto-joins target room on accept.
**Suggested plan placement:** Discovery & Onboarding — new phase, or backfill.

### UNDECLARED: Stats subsystem (voice session timing, message counters, per-user stats)
**Kind:** api endpoint + UI modal
**Location:** `server/routers/stats.py`, `client/src/components/StatsModal.tsx`
**What it does:** Self-reported telemetry — clients report voice-join start/end and message-send increments; server aggregates per-user stats accessible via StatsModal.
**Suggested plan placement:** User Engagement / Telemetry — new section, or backfill.

### UNDECLARED: URL link-preview proxy (`GET /api/preview`)
**Kind:** api endpoint
**Location:** `server/routers/preview.py`
**What it does:** Server-side OpenGraph/HTML scraping for chat link previews with SSRF guards (private-IP / internal-hostname blocklist + DNS resolution check).
**Suggested plan placement:** Chat Polish — new section, or backfill.

### UNDECLARED: Room diagnostics (`GET /api/rooms/{room_id}/diagnostics`)
**Kind:** api endpoint
**Location:** `server/routers/rooms.py`
**What it does:** Per-room state-and-membership snapshot for diagnostics (truncates JSON values to 500 chars).
**Suggested plan placement:** Operations / Observability — new section, or backfill.

### UNDECLARED: Disposable / anonymous node provisioning (`/api/nodes/disposable`)
**Kind:** api endpoint
**Location:** `server/routers/nodes.py`
**What it does:** Operator-facing endpoint to create disposable anonymous nodes.
**Suggested plan placement:** Service Node Mode — backfill the disposable-node API as a separate sub-task.

### UNDECLARED: Federation allowlist + apply (`/api/admin/federation*`, `migrate-federation-config.sh`)
**Kind:** api endpoint + script
**Location:** `server/routers/admin.py` (federation routes), `scripts/migrate-federation-config.sh`
**What it does:** Admin-controlled tuwunel federation allowlist editor + apply (regenerates tuwunel.toml `allowed_remote_server_names`).
**Suggested plan placement:** Federation — backfill as the operator-side counterpart of INS-025/026.

### UNDECLARED: Global instance-admin ban list (`/api/admin/bans*`)
**Kind:** api endpoint
**Location:** `server/routers/admin.py` (bans routes)
**What it does:** Cross-server per-instance ban registry (separate from per-server bans in `servers.py`).
**Suggested plan placement:** Admin / Trust & Safety — new section.

### UNDECLARED: Bug-report modal (separate from INS-028 GitHub issue auto-creation)
**Kind:** UI modal
**Location:** `client/src/components/BugReportModal.tsx`
**What it does:** User-facing report submission UI used by both the top-bar icon (INS-011) and the GitHub-issue pipeline (INS-028).
**Suggested plan placement:** name mismatch — PLAN.md never tracks the modal as a deliverable.

### UNDECLARED: Chat tools palette + composers (Poll, Heatmap, Timed, Scheduled, Gallery, GIF)
**Kind:** UI components
**Location:** `client/src/components/chat/ChatToolsPanel.tsx`, `client/src/components/chat/tools/{Poll,Heatmap,Timed,Scheduled}Composer.tsx`, `chatWidgets.ts`, `ChatWidgetBanner.tsx`
**What it does:** "+" popover in MessageInput exposes seven tools with composer modals and chat-widget banner rendering.
**Suggested plan placement:** Chat Polish — new "Rich Compose" phase.

### UNDECLARED: Format popover (per-user font/alignment/color overrides)
**Kind:** UI component + store
**Location:** `client/src/components/chat/FormatPopover.tsx`, `client/src/stores/format.ts`, `client/src/hooks/useResolvedFormat.ts`
**What it does:** Lets the sender override font family / alignment / colour for outgoing messages, persisted via Matrix account data and resolved per recipient.
**Suggested plan placement:** Chat Polish — new section.

### UNDECLARED: Reactions bar (quick emoji + custom)
**Kind:** UI component
**Location:** `client/src/components/chat/ReactionBar.tsx`
**What it does:** Renders Matrix `m.reaction` annotations on messages with a quick-pick five-emoji bar (👍❤️😂🎉👀) and add-reaction affordance.
**Suggested plan placement:** Chat Polish — backfill.

### UNDECLARED: Typing indicator + presence + unread counters + voice notifications + D-pad
**Kind:** hooks
**Location:** `client/src/hooks/{useTyping,usePresence,useUnreadCounts,useNotifications,useVoiceNotifications,useVoiceParticipants,useFederation,useDpadNav}.ts`, `client/src/components/chat/TypingIndicator.tsx`
**What it does:** Live Matrix typing notifications, presence updates, per-channel unread counts, browser/desktop notifications, voice-event toasts, D-pad TV navigation.
**Suggested plan placement:** Chat Polish + TV Polish — backfill.

### UNDECLARED: DM (direct message) HTTP API + sidebar/list/composer UI
**Kind:** api endpoint + UI panel
**Location:** `server/routers/dms.py`, `client/src/components/dm/{DMSidebar,DMListItem,NewDMModal}.tsx`, `client/src/stores/dm.ts`
**What it does:** Native Concord DMs — create-or-fetch DM room with another user, list active DMs, dedicated sidebar.
**Suggested plan placement:** Chat Core — backfill as a primary feature.

### UNDECLARED: Discord voice/audio bridge admin endpoints (`/api/admin/discord-voice/*`)
**Kind:** api endpoint
**Location:** `server/routers/admin_discord_voice.py`
**What it does:** Admin CRUD for Discord-voice bridge rooms and lifecycle control of the `discord-voice-bridge` sidecar.
**Suggested plan placement:** INS-035 Wave 4 (Admin/data/UI expansion) — split out as its own sub-task.

### UNDECLARED: Discord voice bridge sidecar (Node.js service `discord-voice-bridge/`)
**Kind:** module / sidecar service
**Location:** `discord-voice-bridge/`
**What it does:** Standalone Node sidecar that bridges Discord voice channels into Concord's LiveKit rooms (audio relay + mixer).
**Suggested plan placement:** Backfill as Shipped inventory under "Voice/Bridge".

### UNDECLARED: AndroidTV / Google TV manifest validator script
**Kind:** other (build script)
**Location:** `scripts/build_androidtv_check.sh`, `src-tauri/gen/android/AndroidManifest.xml.template`
**What it does:** Pre-build gate that validates `AndroidManifest.xml.template` for Play-Store TV / leanback compliance.
**Suggested plan placement:** INS-020 native-app delivery — Android TV sub-task.

### UNDECLARED: tvOS WKWebView JS bridge client (`tvOSHost.ts`)
**Kind:** module
**Location:** `client/src/api/tvOSHost.ts`
**What it does:** TS wrappers for the 4-function tvOS native bridge: `setServerConfig`, `getServerConfig`, `focusChanged`, `openAuthURL`.
**Suggested plan placement:** INS-023 — backfill as a shipped sub-task.

### UNDECLARED: Hosting tab (`HostingTab.tsx`) — separate from NodeHostingTab
**Kind:** UI panel
**Location:** `client/src/components/settings/HostingTab.tsx`
**What it does:** A second hosting-related settings tab beside `NodeHostingTab.tsx`.
**Suggested plan placement:** Requires user decision — either declare under INS-052 or merge with NodeHostingTab.

### UNDECLARED: TV banners (`TVCapabilityBanner.tsx`, `TVVoiceUnavailableBanner.tsx`)
**Kind:** UI components
**Location:** `client/src/components/tv/TVCapabilityBanner.tsx`, `client/src/components/voice/TVVoiceUnavailableBanner.tsx`
**What it does:** Capability gating UI shown on tvOS clients (no WebRTC = no voice).
**Suggested plan placement:** INS-023 — backfill.

### UNDECLARED: Server remint-ownership endpoint (`POST /api/servers/{id}/remint-ownership`)
**Kind:** api endpoint
**Location:** `server/routers/servers.py`
**What it does:** Stable-build counterpart to the mesh-network "charter immutability + remint" feature — re-issues a server's ownership record.
**Suggested plan placement:** Stable-build governance — new sub-task.

### UNDECLARED: Auth-code (per-server invite ladder) endpoints
**Kind:** api endpoint
**Location:** `server/routers/invites.py`, `server/services/auth_code.py`
**What it does:** Per-server time-rotating numeric auth-codes augmenting invite tokens.
**Suggested plan placement:** Onboarding / Invites — new section.

### UNDECLARED: Email invites + email-availability check
**Kind:** api endpoint + service
**Location:** `server/routers/invites.py`, `server/services/email.py`
**What it does:** Operator can send invite-via-email and the client can pre-check whether an email is already registered.
**Suggested plan placement:** Onboarding / Invites — new section.

### UNDECLARED: Guest session registration (`POST /api/register/guest`)
**Kind:** api endpoint
**Location:** `server/routers/registration.py`
**What it does:** Creates a guest Matrix session (anonymous browse / read-only entry).
**Suggested plan placement:** Onboarding — new section.

---

## gap-audit (Researcher) — stale references

### GAP: INS-024 Wave 4 — `client/src/components/settings/BridgesTab.tsx`
**Item status in PLAN.md:** complete (`[x]` Wave 4)
**Referenced artifact:** `client/src/components/settings/BridgesTab.tsx`
**Existence check:** not found in `client/src/`. Backup-only at `.codex-backups/ui-20260412T235920/settings/BridgesTab.tsx`. `SettingsModal.tsx` does not import it. Tauri commands wired in `lib.rs`/`bridge_commands.rs` but no React component consumes them.
**Severity of gap:** broken claim — Wave 4 is checked but the user-facing Discord bridge settings UI is absent.

### GAP: INS-035 Wave 4 — Discord voice video config UI in `BridgesTab.tsx`
**Item status in PLAN.md:** complete (`[x]` Wave 4)
**Referenced artifact:** `BridgesTab.tsx` UI exposing `video_enabled`, `projection_policy`, `max_video_bitrate_kbps`, `audio_only_fallback`
**Existence check:** backend fields exist; types in `client/src/api/bridges.ts`. No client component renders these fields. `BridgesTab.tsx` itself is absent.
**Severity of gap:** broken claim.

### GAP: PLAN.md — `fb2p.md`
**Item status in PLAN.md:** referenced in Open Conflicts resolution (orrtellite boundary audit) and Recent Changes 2026-03-27 entry
**Referenced artifact:** `fb2p.md` at repo root
**Existence check:** not found. Repo root has `naming-brainstorm.md` but `fb2p.md` is missing.
**Severity of gap:** outdated doc.

---

## exercise (Beta Tester) — top 5 user-facing live exercise

### FEATURE: INS-027 Server Picker first-launch screen
**Claim (paraphrased):** First-launch native screen accepts a homeserver hostname, runs `/.well-known/concord/client` discovery, persists resolved config, proceeds to login.
**Invocation:** `cd client && npx vitest run src/components/auth/__tests__/ServerPickerScreen.test.tsx src/api/__tests__/wellKnown.test.ts`
**Outcome:** works-as-claimed (test-level)
**Observed:** `Test Files 2 passed (2) | Tests 34 passed (34)`. Source flow `input → connecting → success → confirm → onConnected`; distinct error classes (`DnsResolutionError`, `HttpServerError`, `InvalidUrlError`, `JsonParseError`).
**Discrepancy:** None at unit level. Live network discovery against a real instance not exercised (no Tauri shell / dev server in audit env).

### FEATURE: INS-002 Markdown rendering in chat
**Claim:** Chat messages render markdown (bold/italic/code/lists/links/headings/blockquote), GFM, sanitized against XSS.
**Invocation:** `npx vitest run src/components/chat/__tests__/MessageContent.markdown.test.tsx`
**Outcome:** works-as-claimed (test-level — but thin coverage)
**Observed:** `Test Files 1 passed (1) | Tests 2 passed (2)`. react-markdown + remark-gfm + rehype-sanitize wired.
**Discrepancy:** Only 2 markdown tests for the breadth of claimed features — flags the failure mode in CLAUDE.md (tests written to be passed, not rigorous). Unit tests do not verify visual rendering or XSS-payload sanitization end-to-end.

### FEATURE: INS-019a Chart attachments
**Claim:** Chart attachments render via `ChartRenderer`, validated, wrapped in `ChartErrorBoundary`, with `InvalidChartPill` shown on failure.
**Invocation:** `npx vitest run src/components/chat/__tests__/MessageContent.chart.test.tsx`
**Outcome:** works-as-claimed
**Observed:** `Test Files 1 passed (1) | Tests 10 passed (10)`. All four exports present.
**Discrepancy:** None at unit layer. No browser-rendered visual verification.

### FEATURE: INS-022 QR pairing (host + guest)
**Claim:** Host shows pairing QR encoding wellKnown-compatible payload; guest scanner decodes and pairs.
**Invocation:** `npx vitest run src/components/pairing/__tests__/`
**Outcome:** works-as-claimed (test-level)
**Observed:** `Test Files 3 passed (3) | Tests 16 passed (16)`. `qrcode` lib used; payload encoded via `encodePairingPayload`; TURN/feature flags stripped before serializing.
**Discrepancy:** No two-device live pairing exercised in this env.

### FEATURE: INS-011 + INS-040 Top-bar utility buttons + Settings
**Claim:** Top bar exposes Settings, Bug Report, Stats, Help icons; Settings opens unified panel.
**Invocation:** `npx vitest run src/components/layout/__tests__/TopBarMoreMenuIcons.test.ts src/components/settings/__tests__/SettingsPanel.navigation.test.tsx src/components/settings/__tests__/SettingsModal.tv.test.ts`
**Outcome:** **partial**
**Observed:** `Test Files 3 passed (3) | Tests 9 passed (9)`. ChatLayout source: only `chat_bubble` and `handyman` (Tools) are first-class top-bar icons; Settings/Bug/Stats/Help live INSIDE the Tools dropdown as `OverflowMenuItem`s (lines 3695-3705) — one click deeper than implied.
**Discrepancy:** Functionally present, structurally different from claim. Top bar ≠ four separate icons; it's a dropdown.
