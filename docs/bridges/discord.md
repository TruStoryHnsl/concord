# Discord Bridge — Sandboxed Matrix Application Service

Status: **DESIGN / DOCUMENTATION STAGE** (INS-024). No bridge service is
currently deployed on orrgate. This document is the operator runbook and
sandbox-boundary contract that MUST be satisfied before the
`concord-discord-bridge` Docker service lands in `docker-compose.yml`.

Source of truth: `PLAN.md > PRIORITY: Discord Bridge — Sandboxed Integration
(INS-024)`.

## 1. Goal

Bridge Discord guilds/channels into Concord's Matrix rooms with bidirectional
message relay, while strictly containing:

- Discord API credentials (bot token, application ID)
- Discord rate-limit failures
- The bridge daemon's dependency surface and any CVE exposure it carries
- Any crashes, panics, or unhandled errors in the bridge itself

None of these may degrade `tuwunel`, `concord-api`, the LiveKit SFU, or any
other Concord service. A Discord API outage is a cosmetic degradation of the
bridged rooms only — everything else keeps running.

## 2. Why an Application Service (AS), not a bot or custom protocol

Matrix ships a formalized **Application Service API** designed for exactly
this pattern: an out-of-process daemon that the homeserver trusts to own a
namespace of virtual users and room aliases, receives homeserver events via a
push transaction API, and sends events back via the standard client-server
API authenticated by an `as_token`.

That shape is the correct sandbox boundary:

- The AS lives in its own container, runs its own process tree, has its own
  dependencies, and speaks HTTP to the homeserver over a well-defined
  contract.
- The homeserver loads a single registration YAML file that describes the
  namespace and tokens. That file is the only shared artifact.
- No shared Python/Node/Go runtime, no shared volumes, no shared secrets.

The alternative — running a Discord bot as another thread inside
`concord-api` or another process inside the `tuwunel` container — does not
satisfy the sandbox requirement because a crash or supply-chain compromise in
the bot code would land inside one of the core Concord services.

## 3. Bridge daemon selection

Two actively-used Matrix↔Discord bridges exist. We pick one before writing
Docker Compose config, not after.

| Project | Language | License | Maintenance signal | Puppetting | Relay mode |
|---|---|---|---|---|---|
| [`mautrix-discord`](https://github.com/mautrix/discord) | Go | **AGPLv3** | Active (mautrix suite, weekly commits typical) | Yes | Yes |
| [`matrix-appservice-discord`](https://github.com/matrix-org/matrix-appservice-discord) | Node.js | Apache-2.0 | Legacy — functional but slower cadence | Limited | Yes |

**Recommendation: `mautrix-discord`.**

Rationale:

1. The mautrix suite (Go-based) is the best-maintained family of Matrix
   bridges currently deployed in production at scale (mautrix-whatsapp,
   mautrix-telegram, mautrix-signal, mautrix-discord). Bug fixes and Discord
   API drift patches land promptly.
2. Puppetting mode — where each Discord user is mirrored as a virtual Matrix
   user — produces a significantly better UX than relay-bot mode because
   author attribution, avatars, and mentions round-trip correctly.
3. Go binaries are a single static artifact in the container, which reduces
   the attack surface relative to a Node.js dependency tree.
4. The mautrix bridges share a common configuration style, so operators who
   run multiple bridges benefit from consistent runbooks.

### License audit — AGPLv3 vs Concord's commercial scope

Concord is tagged `commercial` in `.scope`. The commercial scope profile
requires that all dependencies have licenses compatible with the project's
distribution plan. `mautrix-discord` is licensed under **AGPLv3**, which has
a specific implication worth flagging explicitly:

- **Operator deployment on orrgate (first deployment target):** Fine. Running
  an AGPLv3 binary on infrastructure we operate does not, on its own, trigger
  copyleft. We are the operator and the only users are us; no "network
  interaction by third parties" obligation kicks in yet.
- **Self-hosted operators deploying Concord:** Fine under the same reading,
  provided they are deploying the upstream `mautrix-discord` binary image
  (which is already AGPLv3-licensed) through Docker Compose. They are not
  receiving a modified `mautrix-discord` from us; they are pulling the
  upstream image.
- **Concord as a SaaS offering to third-party users:** **Flag.** AGPLv3's
  Section 13 requires that users interacting with the software over a network
  be offered the complete corresponding source code of the version they
  interact with. If we ever offer a hosted Concord service that includes the
  Discord bridge, we must provide a path for users to obtain the bridge's
  source (upstream is fine — we just publicize the link and the exact tag in
  use). This is not a blocker; it is a disclosure requirement.
- **Concord distributed as a packaged product:** The Discord bridge is an
  **optional add-on Docker service**, not a statically-linked component of
  the Concord binary. Our packaged product (desktop/mobile Tauri apps, the
  Matrix server stack) does not incorporate `mautrix-discord` code at the
  compilation or link level. The AGPL obligations apply only to operators
  who choose to enable the bridge, and only to the bridge itself, not to the
  rest of Concord.

**Action:** when the bridge lands, add a short notice to the Concord user
docs stating that the optional Discord bridge runs under AGPLv3, and link to
the `mautrix-discord` upstream for source access. Do NOT commingle the
bridge's code with Concord's own source tree.

Fallback: if `mautrix-discord`'s maintenance signal drops or a concrete AGPL
blocker is discovered for a distribution channel we care about, the
Apache-2.0 `matrix-appservice-discord` is the declared fallback. Its UX is
weaker (less puppetting polish) but its license is unambiguously permissive.

## 4. Sandbox boundary

This is the **contract** that `docker-compose.yml` must enforce when the
service lands. Any divergence from this list must be documented and
re-reviewed.

### 4.1 Container identity

- Service name: `concord-discord-bridge`
- Image: `dock.mau.dev/mautrix/discord:<pinned-tag>` (no `:latest`)
- Runs as a non-root user inside the container (mautrix images already do
  this).
- Restart policy: `unless-stopped`.

### 4.2 Credentials

- Discord bot token and Discord application ID live **only** in
  `config/discord-bridge.env` at the repo root. That file is `.gitignore`d.
- `config/discord-bridge.env` is mounted read-only into the bridge container
  via `env_file:` in `docker-compose.yml`.
- No other Concord service has this file mounted. `tuwunel`, `concord-api`,
  and `livekit` do not see the Discord bot token under any circumstance.
- Rotation: operators rotate the Discord bot token by editing
  `config/discord-bridge.env` and running
  `docker compose up -d concord-discord-bridge`.

### 4.3 Shared volumes

- The bridge container gets ONE shared artifact: the AS registration file
  (`config/discord-registration.yaml`), mounted read-only into the
  `tuwunel` container and read-write into the bridge container (the bridge
  needs to regenerate it on first run; subsequent runs treat it as stable).
- No other shared volumes. The bridge's SQLite/Postgres state lives in its
  own named volume `concord-discord-bridge-data`.
- `tuwunel`'s media store volume is NOT shared with the bridge. Attachments
  relayed across the bridge are uploaded via the Matrix client-server API
  using the `as_token`, not by writing into the homeserver's disk.

### 4.4 Network boundary

- The bridge container is on the existing `concord-internal` Docker network
  (same network as `tuwunel` and `concord-api`).
- The bridge contacts `tuwunel` at `http://tuwunel:8008` (internal DNS) for
  the AS push transaction endpoint.
- The bridge contacts Discord's public API at `https://discord.com/api/v10`
  and `wss://gateway.discord.gg/` over the default egress network.
- The bridge does NOT expose a port to the host. The homeserver reaches the
  bridge at `http://concord-discord-bridge:29334` over the internal network
  only.
- Egress firewall: if/when orrgate's firewall gets explicit egress rules,
  the bridge container needs `discord.com` and `gateway.discord.gg`
  allow-listed. Nothing else.

### 4.5 Blast radius

A bridge crash, OOM, Discord rate-limit storm, or bad upstream push MUST
result in:

- `docker compose stop concord-discord-bridge` / container exit / bridge
  container entering `restarting` state.
- Zero impact on `tuwunel`, `concord-api`, `livekit`, or `caddy`.
- Matrix rooms that are NOT bridged keep working normally.
- Matrix rooms that ARE bridged continue to relay messages among their
  Matrix-side participants; only the Discord-side relay is degraded until
  the bridge comes back.

Verification: the acceptance criterion in PLAN.md INS-024 says
`docker compose stop concord-discord-bridge` must not affect any other
Concord service. This MUST be tested during the first deployment window
on orrgate.

## 5. Application Service registration

The bridge generates a registration YAML on first run. The file has this
shape (values filled in by the bridge at generation time):

```yaml
id: discord
url: http://concord-discord-bridge:29334
as_token: <random secret>
hs_token: <random secret>
sender_localpart: _discord_bot
rate_limited: false
namespaces:
  users:
    - exclusive: true
      regex: "@_discord_.*:<concord-server-name>"
  aliases:
    - exclusive: true
      regex: "#_discord_.*:<concord-server-name>"
  rooms: []
```

- `id`: logical identifier. Unique per bridge.
- `url`: where the homeserver pushes transactions.
- `as_token` / `hs_token`: shared secrets between homeserver and bridge.
  Rotated by regenerating the registration file.
- `sender_localpart`: the bridge's own Matrix bot account.
- `namespaces.users`: virtual Matrix users the bridge owns. The `exclusive:
  true` flag prevents regular users from registering in this range.
- `namespaces.aliases`: room aliases the bridge owns.
- `namespaces.rooms`: empty — the bridge mints rooms on demand rather than
  claiming a static set.

Tuwunel loads this file via its `app_service_registration` config key
(pointing at the mounted read-only path). The homeserver must be restarted
after the registration file changes — plan for a ~5 second Matrix service
blip on each bridge-registration change.

## 6. Relayed event matrix

The bridge covers a well-defined subset of Discord ↔ Matrix events. Anything
not in this table is explicitly dropped; the operator runbook tells users
how to fall back.

| Direction | Event | Relayed? | Notes |
|---|---|---|---|
| Discord → Matrix | Text message | Yes | Author puppetted as virtual `@_discord_<userid>:concord` |
| Discord → Matrix | Message edit | Yes | Emitted as `m.room.message` with `m.new_content` |
| Discord → Matrix | Message delete | Yes | Emitted as `m.room.redaction` |
| Discord → Matrix | Reaction (add/remove) | Yes | Emitted as `m.reaction` / redaction |
| Discord → Matrix | Attachment (image/video/audio/file) | Yes | Downloaded by bridge, re-uploaded to Matrix media store under `as_token` |
| Discord → Matrix | Embed (link preview) | Yes | Flattened to message body with link; original embed dropped |
| Discord → Matrix | Sticker | Yes (as image) | Discord sticker URL re-uploaded as `m.image` |
| Discord → Matrix | Thread creation | Yes | Mapped to Matrix threads (`m.thread`) |
| Discord → Matrix | Voice state change (join/leave call) | **No** | Out of scope; LiveKit owns Matrix voice |
| Discord → Matrix | Guild member join/leave | Yes | Emitted as `m.room.member` join/leave on the virtual user |
| Discord → Matrix | Typing indicator | Yes | `m.typing` |
| Discord → Matrix | Presence | **No** | Too noisy; dropped |
| Matrix → Discord | Text message | Yes | Sent as the bridge bot, with author prefix |
| Matrix → Discord | Message edit | Yes | Discord API `PATCH /channels/{id}/messages/{id}` |
| Matrix → Discord | Message delete | Yes | Discord API `DELETE /channels/{id}/messages/{id}` |
| Matrix → Discord | Reaction (add/remove) | Yes | Discord API reaction endpoints |
| Matrix → Discord | Attachment (image/video/audio/file) | Yes | Downloaded from Matrix, re-uploaded to Discord via multipart form |
| Matrix → Discord | Reply (`m.in_reply_to`) | Yes | Mapped to Discord reply reference |
| Matrix → Discord | Thread reply | Yes where Discord supports it |
| Matrix → Discord | Typing indicator | Yes | Discord typing API |
| Matrix → Discord | Voice invites | **No** | LiveKit is Matrix-only |
| Matrix → Discord | Read receipts | **No** | Discord has no matching concept |

Mentions are translated in both directions: `@alice` on Matrix becomes
`<@discord_id>` on Discord, and vice versa. Unresolvable mentions (the
target user is not bridged) fall back to plain text.

## 7. Operator runbook

All commands assume `cd /docker/stacks/concord` on `orrgate` unless
otherwise noted.

### 7.1 Adding a new Discord server

1. Create a Discord application and bot account at
   `https://discord.com/developers/applications`. Grant the bot the
   `applications.commands`, `bot`, and the standard message/content intents
   (`GUILD_MESSAGES`, `MESSAGE_CONTENT`, `GUILD_MEMBERS`).
2. Record the bot token in `config/discord-bridge.env`:
   ```
   MAUTRIX_DISCORD_BOT_TOKEN=<token>
   MAUTRIX_DISCORD_APPLICATION_ID=<app-id>
   ```
3. Invite the bot to the Discord guild you want to bridge, using the OAuth2
   URL generated by Discord's developer portal with the scopes above.
4. From a Matrix client signed in as a bridge admin (the account listed
   under `bridge.permissions` in the mautrix-discord config), DM the bridge
   bot (`@_discord_bot:concord`) with `login`. The bridge will respond with
   a QR code or token prompt — follow it to associate your Matrix account
   with the Discord bot.
5. Send `guilds status` to the bridge bot in the same DM to confirm the
   Discord guild is visible.
6. Send `guilds bridge <guild_id>` to start mirroring channels into Matrix
   rooms. Channels appear as `#_discord_<guild>_<channel>:concord` aliases.

### 7.2 Rotating the Discord bot token

1. Generate a new token in the Discord developer portal (this invalidates
   the old one immediately on Discord's side).
2. Update `config/discord-bridge.env` with the new token.
3. Restart the bridge: `docker compose up -d concord-discord-bridge`.
4. Watch the logs: `docker compose logs -f concord-discord-bridge`. You
   should see a successful Gateway WebSocket handshake within 10 seconds.

The AS registration file tokens (`as_token`, `hs_token`) are separate from
the Discord bot token. They are rotated by regenerating the registration
file; see section 7.4.

### 7.3 Debugging bridged messages not appearing

1. Check bridge health:
   `docker compose ps concord-discord-bridge` — should be `running`.
2. Check bridge logs for the affected channel:
   `docker compose logs --tail=200 concord-discord-bridge | grep -i <channel-name>`.
3. Check that the guild is bridged: DM the bridge bot `guilds status`.
4. Check that the virtual user can see the room: DM the bridge bot
   `rooms status <matrix-room-id>`.
5. Check Discord rate limits: look for `429` responses in the bridge logs.
   Persistent 429s mean the bridge is being throttled by Discord — reduce
   traffic or increase the bridge's rate-limit backoff.
6. If the bridge's SQLite state gets corrupted: stop the service, back up
   the `concord-discord-bridge-data` volume, and follow mautrix-discord's
   upstream recovery docs.

### 7.4 Regenerating the AS registration file

Only do this if you changed the bridge's Matrix-side identity (e.g. renamed
the homeserver or rotated AS tokens for security reasons):

1. `docker compose stop concord-discord-bridge`.
2. Delete `config/discord-registration.yaml`.
3. `docker compose run --rm concord-discord-bridge /usr/bin/mautrix-discord -g -c /data/config.yaml -r /data/registration.yaml`
4. Copy the new registration YAML to `config/discord-registration.yaml`.
5. Restart both services:
   `docker compose up -d tuwunel concord-discord-bridge`.
6. The homeserver will re-register the bridge with the new tokens.

### 7.5 Shutting the bridge down cleanly

Two levels.

**Temporary (maintenance window, token rotation, or bridge upgrade):**
```
docker compose stop concord-discord-bridge
```
Other Concord services are unaffected. Bridged rooms continue to relay
among their Matrix-side participants; Discord-side relay pauses until the
bridge comes back. No data loss.

**Permanent (operator decides to drop the Discord integration):**
```
docker compose rm -s -f concord-discord-bridge
# Optionally remove state:
docker volume rm concord_concord-discord-bridge-data
```
Then remove the `concord-discord-bridge` service block from
`docker-compose.yml` and remove the `app_service_registration` entry from
the tuwunel config. Restart `tuwunel` to drop the AS namespace. The virtual
users and bridged rooms remain in the Matrix database as ghosts — run
`tuwunel-admin` purge commands if you want them gone entirely.

## 8. What this bridge explicitly does NOT do

- Does not implement a new discovery protocol. The Matrix federation
  allowlist (shipped 2026-04 in `server/routers/admin.py` and
  `client/src/hooks/useFederation.ts`) stays inside the Matrix federation
  graph and does not interact with the Discord bridge. The "Explore" menu
  (INS-025) shows federated *Matrix* servers only; Discord guilds are
  exposed as regular rooms inside the local homeserver, not as federated
  peers.
- Does not bridge voice/video. LiveKit is the Matrix voice provider;
  Discord voice channels are ignored.
- Does not relay presence or read receipts, to keep the event volume
  predictable.
- Does not give the bridge any access to `concord-api`. Concord's
  application-layer features (soundboard, moderation, TOTP, federation
  admin, stats) are invisible to the bridge.

## 9. Acceptance checklist (PLAN.md INS-024 #2)

Before marking the bridge-docs task complete, confirm:

- [x] Exact set of containers that hold Discord credentials is documented
      (exactly one: `concord-discord-bridge`).
- [x] Network edges between the bridge container and `tuwunel` /
      `concord-api` are documented.
- [x] AS registration schema and namespace are documented.
- [x] Matrix events relayed in each direction and which are dropped are
      documented (section 6).
- [x] Operator runbook covers add-server, rotate-token, debug, shutdown
      (section 7).
- [x] Commercial-scope license audit of the chosen bridge daemon is
      documented (section 3, AGPLv3 analysis).

## 10. Open follow-ups (not blocking)

- The implementation task (INS-024 #1) — actually adding the service block
  to `docker-compose.yml`, writing `config/discord-bridge.env.example`,
  writing the bridge's mautrix-discord config YAML, and deploying to
  orrgate — is the next step once this document is reviewed.
- A future enhancement could relay Discord voice-channel state into
  Matrix as `m.room.message` announcements ("X joined the voice channel"),
  without actually bridging the audio. Not in scope for INS-024.
- Puppetting mode requires each Concord user to individually log into
  Discord via the bridge bot. Whether to force that on or keep the simpler
  relay-bot mode as the default is a UX decision for the first deployment.
