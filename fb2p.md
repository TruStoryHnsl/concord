# Concord — Feedback to Prompt Record

---

## Entry: 2026-03-27 01:15 — 0326feedback.md

### Raw Input
Source: `0326feedback.md` (60 lines, 14KB)

### Optimized Prompt

## Objective
Implement the core mesh network social architecture for concord v2: forums as live mesh-scoped chatrooms, a 3D/2D mesh map viewer, cooperative compute clustering via `cluster_ledger`, and the "Places" (server) system with minting, ownership transfer, and communal governance.

## Requirements
1. **Forums as mesh-scoped live channels**: Forums display outgoing messages from nodes within a configurable hop range (default: 2 hops). Forums support text chat, voice/video channels, and temporary broadcast channels with pins. Content is compiled live from the public mesh network.
2. **Optional location broadcasting**: Nodes can broadcast physical location accurate to 5 miles for mesh map positioning.
3. **Mesh map viewer**: 2D bubble map centered on user-node showing all connections. Tunnels, LAN nodes, local P2P nodes, and speculative nodes each have distinct visual styles. 3D mode available for exploring forum space around any tunneled node.
4. **Node prominence heuristics**: Public forum display prioritizes nodes by ledger data, public standing, and server membership size.
5. **Mandatory node registration**: All concord instances register on the mesh ledger. Nodes can anonymize but cannot be invisible — anonymous nodes are counted in the invisible tally.
6. **Mobile-first homepage dashboard**: 1-2 taps from launch to: reconnect to last channel, host a text/voice/video exchange.
7. **Cooperative compute pipeline**: When multiple capable nodes are in a cluster, they share hosting load. Stability is primary concern — other nodes fill gaps when the host falters. Each additional node improves stability and quality.
8. **Fluid hypervisor role**: Cluster leadership transfers automatically to the optimal node based on real-time performance. Rooms persist at their mesh sub-address even when the original host leaves.
9. **Invisible cluster voting**: Clusters can vote to become invisible on the mesh map. An invisible node counter is always visible in the forum scope. Users connecting to invisible clusters count as invisible nodes themselves.
10. **Web portal hosting without domain**: Every node can host a web portal for non-concord-users via transient URLs. Needs a shared public domain (user owns multiple domains, willing to dedicate one).
11. **Three connection methods**: Tunnels (VPN-like bridges between friends), LAN discovery, local P2P (WiFi/Bluetooth). All three form the mesh map.
12. **Map data harvesting**: Nodes broadcast updates to the public forum. New nodes build their map over time from forum data. Public harvested data is speculative until verified by containerized user probes.
13. **Mesh addressing**: Group theory heuristics partition the mesh into hierarchical locales. Filepath-style addresses for searchability. Pillar nodes serve as landmarks.
14. **Cluster mode + cluster_ledger**: Initiating node creates a `cluster_ledger` file. Any registered node wearing the ledger participates in load balancing. The ledger is the source of truth for system info needed to interlock processing. Kubernetes-like container contribution model.
15. **Places (servers)**: `cluster_ledger` with a dedicated mesh address and key. Any qualifying node can cluster on it and assist hosting.
16. **Place minting + ownership**: Minting creates a place. Re-minting transfers ownership with compressed+encrypted historical ledger in header. Rollback possible if new owner goes stale. Unencrypted places allow committee-based admin changes. Encrypted ownership is permanent once set.
17. **Communal governance**: Public places have responsibility-based hierarchy with communal override capability. Voting requires: 1+ month old account, confirmed human, 2FA configured. Private places use authoritarian admin model.
18. **Map merge protocol**: Timecoded entries prevent stale data overwriting fresh. Detailed exchange on clustering. Independent verification before committing.
19. **Stale data tier**: Unverified nodes within scope are tagged as potentially stale after timeout.
20. **Anti-stalking tools**: Block individual nodes, IP addresses, or tagged malicious MAC addresses. Blocked nodes see zero trace of the blocking node.

## Constraints
- Wire encryption is mandatory; at-rest encryption via SQLCipher still needed
- No central server dependency — all features must work peer-to-peer
- Speculative map data must be sandboxed until verified by probe
- Map protocol must handle massive scale via hierarchical locale partitioning

## Technical Decisions
- cluster_ledger is a transferable file/record, not a fixed server role
- Kubernetes-like compute contribution model
- Group theory for mesh address partitioning
- Probes are special containerized nodes: no auth, no write, silent, hop-based
- Encrypted vs unencrypted ownership is a one-way decision (can encrypt, never decrypt)

## Resolved Questions (2026-03-27)
1. **Web portal domain**: `*.concorrd.com` (PLACEHOLDER — reassess before distribution)
2. **Probes**: NOT containerized. Simple ping operations. Two trust tiers: tunnel-based (high-permission full exchange) and non-tunnel (low-permission speculative only). Server nodes act as verification workhorses upgrading speculative → confirmed.
3. **"Confirmed human"**: One merit-badge in a broader reputation system. Three displayed metrics: real-user-confidence-score, engagement_profile (-10 to 10), overall trust rating. All stored in mesh map.
4. **Ledger compaction**: Zero-loss compression. Never delete history. Media content excluded from ledger body; filenames and transfer records preserved.
5. **Forum hop scope**: Configurable, default 2. Map navigation is two-pronged: global physical view + 2D layered traversable diagram.
6. **Mobile dashboard**: + user profile customization, + node settings.

## Additional Requirements (from Q&A session)
- Tunnel implementation via orrtellite virtual LAN networks
- Stale/removed node detection: "might be done" nodes tracked as speculative
- Disposable anonymous nodes for private browsing (must still contribute compute)
- Place admins can restrict anonymous users (ban, cap, limit chat)
- Call ledgers: one-on-one calls create a ledger with mesh address (lifecycle TBD)
- Mesh map mathematical framework needed: lightweight, procedural, deterministic addressing
- Orphaned node handling: once a node knows a location, it can reach it independently
- Server nodes anchor tunnels for persistent user connections

## Acceptance Criteria
- Nodes can form clusters and dynamically transfer hypervisor role
- Mesh map renders with distinct visual styles for each connection type
- Node verification protocol works at both trust tiers
- Reputation system displays three metrics
- Places can be minted, transferred, and rolled back
- Communal voting works for public places
- Anti-stalking blocking is complete (node, IP, MAC)
- Anonymous browsing via disposable nodes works

### Status
Generated: 2026-03-27 01:15
Questions resolved: 2026-03-27
Executed: **complete** (2026-03-28). All 20 requirements implemented — backend + frontend. 267 Rust tests, 0 TS errors.
Queued: 1 of 3 — DONE

---

## Entry: 2026-03-27 01:15 — general-admin session (concord-server concept)

### Raw Input
User stated in conversation: "There is supposed to be an instance of concord-server running on orrgate that offers itself as a full time compute node to a server (or place_ledger). Each node has control over how much their node contributes and how much their node takes away. The purpose of concord-server applications are to contribute a node of compute to clusters addressed on the mesh network. They are essentially the same as a user client node machine, except one of the handful of limited performance modes."

### Optimized Prompt

## Objective
Define and implement a headless "concord-server" performance mode that runs on dedicated machines (like orrgate) to contribute persistent compute to mesh network clusters.

## Requirements
1. **Server performance mode**: A concord node configuration that runs headless (no UI), auto-joins configured clusters, and contributes compute continuously.
2. **Resource contribution controls**: Each node controls how much CPU, bandwidth, and storage it contributes and consumes. Configurable per-cluster.
3. **Identical binary**: concord-server is the same binary as the client, just running in a server-optimized performance mode. No separate codebase.
4. **Performance modes** (a handful of presets):
   - `desktop` — full UI, balanced resource usage
   - `mobile` — battery-optimized, minimal background compute
   - `server` — headless, maximum contribution, auto-join clusters
   - (others TBD)
5. **Orrgate deployment**: First concord-server instance runs on orrgate, contributing to place_ledger clusters.

## Technical Decisions
- Same binary, different config — not a fork
- Server mode auto-joins configured place_ledger addresses on startup
- Resource limits are per-node settings, not per-cluster

## Resolved Questions (2026-03-27)
1. **"Performance modes" clarification**: Not separate modes — server nodes are just nodes representing a place instead of a user. They provide persistent infrastructure. Dynamic workload adjustment based on processing load. Separate concept: user nodes can act as "support server" for another connection (special node-authorized behavior, not the headless server app).
2. **Admin interface**: Web admin UI for server configuration.
3. **Authentication**: Same as any node. Admin mints a ledger appendix to whitelist the server. Default behavior whitelists admin's friends list. Server is as trustworthy as the place it serves.

## Additional Requirements (from Q&A session)
- Server nodes act as tunnel anchors so users stay persistently meshed to a place
- Server nodes are primary verification workhorses for speculative map data
- Server nodes take on greater share of shared compute for stability

## Acceptance Criteria
- Headless server starts and auto-joins configured place_ledger addresses
- Web admin UI for configuration
- Resource contribution is configurable and dynamically adjustable
- Server acts as tunnel anchor and map data verifier
- Orrgate can run a persistent server instance

### Status
Generated: 2026-03-27 01:15
Questions resolved: 2026-03-27
Executed: **partial** (2026-03-28). Daemon wired to mesh: self-registration as Backbone, map sync topics, confidence degradation task, auto_join_places config. Remaining: admin RPC, resource controls, verification pipeline, tunnel anchor.
Queued: 3 of 3

---

## Entry: 2026-04-11 20:21 — 2026-04-11 20:21.md (Testing Protocol Refinement)

### Raw Input
Source: `.feedback/2026-04-11 20:21.md` (52 lines)

CONCORDv2 FEEDBACK - Testing Protocol. Reiterates the need to test v2 on real iOS devices (iPhone + iPad) before further development. Defines "full connection" as stable, performant, feature-complete with **file exchange, text chat, voice chat, and video chat**. Lists 7 passing conditions (identical to those already captured in PLAN.md from earlier 2026-04-11 intake). Mentions iOS sideloading via developer trust process (already resolved: AltStore/Sideloadly). Calls out iPad version as a separate need (already in roadmap).

### Optimized Prompt

## Objective
Refine the Concord v2 testing protocol to include file exchange as a core component of "full connection" validation, and confirm the mobile testing pipeline is unblocked.

## Requirements
1. **"Full connection" definition update**: A full connection is stable, performant, and feature-complete with **file exchange, text chat, voice chat, and video chat**. All 7 testing protocol conditions must validate all four capabilities.
2. **File exchange in testing protocol**: Each of the 7 passing conditions that references "full connection" must include file exchange alongside text/voice/video. This means file sharing must work over WiFi Direct (condition 1), through phantom node web portals (condition 2), and across all cluster configurations (conditions 3-6).
3. **iPad-specific build**: Create an iPad-optimized layout (responsive or dedicated) alongside the iPhone build.
4. **iOS sideloading**: Use AltStore/Sideloadly to deploy test builds to physical iPhone and iPad (already resolved as the method).

## Constraints
- No Apple Developer Program enrollment required (7-day re-signing via free provisioning)
- File exchange must work across all transport types (WiFi Direct, tunnel, internet)
- iPad layout must be responsive enough for landscape and split-view use

## Technical Decisions
- (No new technical decisions — all align with existing plan)

## Open Questions
None — all items either already resolved or are direct refinements of existing plan items.

## Acceptance Criteria
- File exchange is tested as part of every "full connection" validation
- iPad test build runs and is usable on physical iPad hardware
- iPhone test build runs and is usable on physical iPhone hardware

### Status
Generated: 2026-04-11 20:21
Executed: N/A (refinement of existing plan — no new implementation work, just definition update)
Queued: 4 of 4 (informational — merged into existing testing protocol)
