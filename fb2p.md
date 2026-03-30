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

## Entry: 2026-03-27 01:15 — 0326feedback2.md

### Raw Input
Source: `0326feedback2.md` (8 lines)

### Optimized Prompt

## Objective
Add a launch animation system and a Game Center feature to concord v2.

## Requirements
1. **Launch animation**: Minimum-length welcome animation on all app boot/reload. Serves as display buffer while app loads. All concord versions (desktop, mobile, web portal) must show it.
2. **Game Center**: Roll20 replacement with node-based game engine.
   - Node-based toolkit for creating custom chat-based games (e.g., custom Mafia)
   - LLM-powered interactive role-play nodes that adopt specified archetypes
   - In-game markets, towns, wallet management via interactive chatroom
   - Node-based chatroom game engine for creating unique games and interactive UIs
   - Open source game development environment
   - 5 games available at feature release (games TBD)
   - Games run entirely on heuristic node-based logical processing with approved local LLM models

## Resolved Questions (2026-03-27)
1. **Launch games**: Chess, Checkers, Mafia, Poker (all kinds), Trivia (all kinds), Pictionary, Telestrations, Scrabble (8+ games, more as desired).
2. **LLM models**: Flexible — any API (Claude, Gemini) or local Ollama instance. Game dev pipeline determines how to power LLM elements per-game.
3. **Game engine paradigm**: Flow-based visual code editor. General-purpose, capable of making anything. Purpose-built node types for point-and-click and text-controlled game dev.

## Acceptance Criteria
- App shows animation on every boot/reload (all platforms)
- Flow-based editor can create custom games
- At least one working chatroom game demonstrates the engine
- LLM integration works with multiple providers
- Game engine is open source and user-extensible

### Status
Generated: 2026-03-27 01:15
Questions resolved: 2026-03-27
Executed: pending
Queued: 2 of 3

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

---

## Entry: 2026-04-12 05:33 — 2026-04-12 05:33.md (Tunnel Architecture + Terminology + Game Center + Comms Flow)

### Raw Input
Source: `.feedback/2026-04-12 05:33.md` (86 lines) — multi-project file, concord packets extracted below.

Covers: tunnel architecture via charters (two design approaches), comms flow clarification (P2P for comms, tunnels for proximity), terminology overhaul ("servers" → "service nodes", management app → "servitude"), naming convention theme ("social contracts"), commerce deferred to v3, Game Center as standalone sub-apps (game-maker + game-center), orrtellite as dependency for NET tunnels, mesh map addressing tied to geology, audit of orrtellite function boundaries.

### Optimized Prompt

## Objective
Refine Concord's tunnel architecture, rename "server" terminology to "service nodes" / "servitude", clarify the comms flow (P2P for actual communication, tunnels for virtual proximity only), expand the Game Center into standalone sub-apps, defer commerce features to v3, and integrate orrtellite as a dependency for NET-based secure tunnels.

## Requirements
1. **Tunnel architecture via charters**: Tunnels are integrated with the mesh-map as minted charters written to the immediate area around the node's home address. A tunnel charter dictates: exclusivity, destination visibility, hashed secrets for encrypted map navigation, and credentials. Any node with access can continue downstream, enabling chain-based routing.
2. **Sidekick node alternative** (second design approach): Every user-node has access to a small sidekick node that hosts VPN tunnel instances configured per the tunnel charter. Requests are routed via chains of these containerized VPN connections. Concurrent sidekick nodes reading a charter = live traffic density indicator.
3. **Tunnels are public by default**: Default setting allows public, unrestricted, anonymized use of node tunnels for map navigation and connection construction. ALL mesh-map data is freely shared and publicly available for efficient mesh connection management.
4. **Communication flow**: Actual communications are managed exclusively by mesh-clustered P2P handshakes. Tunnels ONLY serve to place machines close enough together virtually that the P2P protocol can operate at long distances. Local mesh + NET tunnels are complementary — NOT replacements for each other.
5. **Terminology overhaul**:
   - "Servers" → **"service nodes"** (headless persistent infrastructure nodes)
   - Native management application → **"servitude"** (manages service nodes)
   - All naming decisions inside concord must align with the theme: **"single word descriptions of various social contracts"**
6. **Commerce deferred to v3**: No advertising, marketplaces, or economy features in v2. Current featureset UX must be perfect first. Tool-first design. Social-media-like features that emerge from public decentralized communication are features, not bugs.
7. **Game Center as standalone sub-apps**:
   - **concord-game-maker**: 100% dedicated companion app, fantastic dev environment for concord-compatible games
   - **concord-game-center**: Game console designed to play game-maker games natively + extensions for other compatible simple games
8. **Game-maker visual code editor**: Feature-complete visual code editor as base. Must support: multiple languages in same workflow, writing text-based code via visual interface, representing existing code in visual format for edits without breaking compatibility.
9. **Game engine elements**: 3D-capable renderer viewport (OpenGL), chat-based text input, viewport click input, hotkey keyboard input, integrated generative AI nodes (Ollama, Anthropic, Gemini + image gen).
10. **Orrtellite as dependency**: The orrtellite package should be copied/repurposed or used as a dependency in concord to power NET-based secure tunnels. End users should NOT need to run an external tunneling service — orrtellite protocols are baked into concord.
11. **Charter/node/cluster design philosophy**: Hybrid between crypto ledgers, kubernetes compute clusters, and decentralized mesh networks — intended to synthesize into a zero-trust decentralized public digital communications protocol.
12. **Mesh map addressing**: Addresses could be tied to geological location of the node to make them definitive. Given enough adoption, mesh_map + NET_tunnel approach could provide worldwide decentralized comms framework.
13. **Audit recent changes**: Review whether orrtellite functions were incorrectly assigned to concord in recent changes. Orrtellite should remain standalone — some instructions may have brought orrtellite functions into concord improperly.

## Constraints
- Commerce features are explicitly v3 — do not plan or implement for v2
- "Server" terminology must be globally replaced with "service node" across UI/docs/code
- End users must never need an external tunneling service
- Local mesh connections and NET tunnels must both be active simultaneously
- Naming theme must consistently follow "social contracts" motif

## Technical Decisions
- Tunnel charters are minted records in the mesh-map, not separate infrastructure
- Two tunnel implementation approaches proposed — need to choose or hybrid (Open Question)
- P2P handshakes are the comms layer; tunnels are the proximity layer — strict separation
- Game-maker and game-center are standalone sub-apps, not embedded features
- Visual code editor should leverage existing visual coding system if possible
- User's literal words on tunnel design: "tunnels are integrated with the mesh-map as minted charters written to the immediate area around the node's home address. this charter dictates the exclusivity of the tunnel, the visibility of its destination, hashed secrets for encrypted map navigation, provide the credentials to use the tunnel"
- User's literal words on sidekick nodes: "a sidekick node that every user-node has access to that is very small but will do things like host a vpn tunnels that the node moves through [...] Each request sent by a node would be routed to its destination via chains of these containerized vpn connections"
- User's literal words on comms flow: "the actual communications be managed exclusively by mesh-clustered-p2p handshakes. The tunnel only serves to place the machines close enough together virtually that the p2p protocol can operate even at long distances"

## Open Questions
1. **Tunnel architecture choice**: Two approaches proposed — (a) charter-minted tunnels integrated directly into mesh-map, or (b) sidekick container nodes per user. Which approach to implement, or should they be hybridized?
2. **"After we have designed the game dev workflow..."**: This sentence was cut off (line 61). User was about to describe a step that follows game dev workflow design — what comes next?
3. **AI node + image gen**: The game engine elements list was cut off after mentioning AI nodes "can also be used to connect to image gen" (line 69) — what image gen capabilities are expected?
4. **Orrtellite subgroups**: User asks why creating subgroups on the personal orrtellite network is worthwhile. They understand it for the global concord mesh-map but not for their personal infrastructure. Needs explanation before proceeding.
5. **Visual code editor selection**: User wants one that "already exists" and supports visual+text dual representation. Research needed — Node-RED? Unreal Blueprints? Blockly? Rete.js? Something else?
6. **Geological addressing**: User suggests addresses "could need to be tied to the geological location of the node." Hedged language — is this a requirement or exploration?

## Acceptance Criteria
- "Server" terminology replaced with "service node" globally (UI, docs, code, PLAN.md)
- Management application renamed to "servitude"
- Tunnel architecture design documented with chosen approach
- Game Center split into game-maker and game-center sub-apps with clear boundaries
- Comms flow diagram shows P2P handshakes for communication + tunnels for proximity only
- Commerce features explicitly gated behind v3
- All naming aligns with "social contracts" theme
- Orrtellite integration plan documented (dependency vs fork)
- Audit of orrtellite function boundaries completed

### Status
Generated: 2026-04-12 05:33
Executed: pending
Queued: 5 of 5

