# concord

Self-hosted Discord replacement on Matrix. Voice, soundboards, server discovery, optional federation — your control plane, your data.

> **This repository is the open-source, self-hostable Docker edition of Concord** —
> the free infrastructure half. You run it on a box you own; it becomes a Concord
> *instance* that any Concord client connects to. The web UI is served by the
> stack itself and is **free forever**. Native desktop/mobile clients (a separate
> product) connect to the very same instance over the same protocols, with no
> capability difference between web and native — [see "Connecting clients"](#connecting-clients).

## What it is

A small-community chat platform that looks and feels like Discord but runs on
infrastructure you own. A handful of Docker services and one `.env` file:
**tuwunel** handles Matrix (auth, rooms, presence, federation), **LiveKit**
handles WebRTC voice, a **FastAPI** service handles the Discord-style
server/invite/soundboard model Matrix doesn't natively expose, and **Caddy**
fronts it all with auto-HTTPS.

Own the homeserver, the recordings, the user database, the moderation tools, and
the federation policy — all on a box you can `ssh` into.

## Why

Discord is great until you remember someone else owns the kill switch. Concord
is the same UX without that — same channels, same roles, same voice rooms, same
soundboard — but everything lives on hardware you control. It's a Discord-shaped
server/invite/soundboard model on top of Matrix, so you get federation and the
end-to-end story for free, and the UX still feels like the thing your friends
already know how to use.

Concord is infrastructure, not a service. Every functional capability stays free
in the browser-accessible web UI.

## Architecture

```
                        ┌──────────────────┐
                        │   web client     │  React 19 + TS + Vite
                        │    (browser)     │
                        └────────┬─────────┘
                                 │ HTTPS
                                 ▼
                       ┌───────────────────┐
                       │   Caddy (web)     │  auto-HTTPS, static bundle,
                       │  reverse-proxy    │  path-based routing
                       └─────┬───────┬─────┘
                             │       │
              ┌──────────────┘       └──────────────┐
              │                                     │
              ▼                                     ▼
   ┌──────────────────┐                  ┌──────────────────────┐
   │     tuwunel      │◀──restart────┐   │     concord-api      │
   │ (Matrix homesvr) │              │   │     (FastAPI)        │
   │  conduwuit fork  │              │   │  servers, invites,   │
   │  RocksDB ~170MB  │              │   │  DMs, soundboard,    │
   └──────────────────┘              │   │  TOTP, moderation,   │
              ▲                      │   │  admin, federation   │
              │ federation           │   └─────┬───────────┬────┘
              ▼                      │         │           │
        other Matrix                 │   docker-socket-    │
        homeservers                  └───proxy (CONTAINERS=1│
                                         POST=1, no host   │
                                         socket)           │
                                                           │ tokens
                                                           ▼
                                                ┌──────────────────┐
                                                │     LiveKit      │
                                                │   (WebRTC SFU)   │
                                                │  voice + sound-  │
                                                │  board injection │
                                                └──────────────────┘
                                                       ▲
                                            optional   │
                                                       ▼
                                                ┌──────────────┐
                                                │ coturn TURN  │
                                                │ (or external │
                                                │  metered.ca) │
                                                └──────────────┘
```

| Component | Image / source | Role |
|---|---|---|
| **tuwunel** | `ghcr.io/matrix-construct/tuwunel:main` | Matrix homeserver — auth, rooms, messages, presence, federation. Conduwuit successor, RocksDB-backed (~170 MB RAM vs Synapse 500 MB+). Compose name is still `conduwuit` for back-compat. |
| **concord-api** | built from `./server` (FastAPI / Python) | The Discord-shaped overlay Matrix doesn't ship. Routers: admin, servers, invites, direct invites, DMs, voice, soundboard, webhooks, moderation, registration, TOTP, stats, media, preview, well-known. |
| **livekit** | `livekit/livekit-server:v1.9` | WebRTC SFU. Voice/video routing + soundboard audio injection into rooms. |
| **docker-socket-proxy** | `tecnativa/docker-socket-proxy` | Locked-down sidecar (`CONTAINERS=1 POST=1`). Lets concord-api restart tuwunel for live federation-policy hot-swap without ever giving the API the host docker socket. |
| **web** (Caddy) | built from `./web` | Reverse proxy, auto-HTTPS, static React bundle, path-based routing. |
| **coturn + sslh** | embedded (optional voice) | TURN relay for NAT traversal, with an SNI multiplexer that shares port 443 between web and TURN-TLS (see [Ports](#ports--firewall)). |

All services run on an internal `concord` bridge network. The web client is the
only thing exposed to the user.

## Quickstart

```bash
git clone https://github.com/TruStoryHnsl/concord.git
cd concord
cp .env.example .env
# edit .env — at minimum set CONDUWUIT_SERVER_NAME and SITE_ADDRESS
docker compose up -d --build
```

- `CONDUWUIT_SERVER_NAME` is your Matrix server name — it appears in every user
  ID (`@you:chat.example.com`) and **cannot be changed after first run** without
  wiping the database. Use your domain, or something like `myserver.local` for a
  LAN-only trial.
- `SITE_ADDRESS` is what Caddy serves and obtains a certificate for. A bare
  domain → auto-HTTPS; a `:8080`-style port → HTTP-only (local trials).

Pre-built images are published to GHCR
(`ghcr.io/trustoryhnsl/concord-web`, `ghcr.io/trustoryhnsl/concord-concord-api`),
so a vanilla operator can run the stack without building from source.

Local frontend hacking with Vite HMR:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

---

## Configuration — setting up every feature

All runtime configuration is environment-driven via `.env` (copied from
[`.env.example`](./.env.example), which documents every variable inline). This
section walks each feature. Generate any secret with `openssl rand -base64 32`
(or `-hex 32` for tokens).

### Server identity & networking

| Variable | Purpose |
|---|---|
| `CONDUWUIT_SERVER_NAME` | Matrix server name — permanent, in every user ID. |
| `INSTANCE_NAME` | Display title on the login page / browser tab / emails. Safe to change anytime. |
| `SITE_ADDRESS` | Public address Caddy serves (domain → auto-HTTPS; `:8080` → HTTP-only). |
| `BIND_HOST` | Interface Docker binds: empty/`0.0.0.0` = all interfaces, `127.0.0.1` = localhost only. |
| `CONDUWUIT_REGISTRATION_TOKEN` | Token new users must present to register (see Accounts). |

### TLS / certificates

Pick a `TLS_MODE` that matches your topology:

| `TLS_MODE` | When to use | Extra vars |
|---|---|---|
| `internal_longlived` | Tailscale-only / LAN with no public DNS. Caddy self-signed CA, accepted once per device. | — |
| `letsencrypt_http01` | Public origin reachable on port 80. Real Let's Encrypt cert. **(prod default)** | `ACME_EMAIL` (optional) |
| `letsencrypt_dns01_cloudflare` | Behind a CDN/VPN/tunnel with no public port 80, but DNS in Cloudflare. | `CLOUDFLARE_API_TOKEN` (Zone:Read + DNS:Edit on one zone — never a global key) |

Optional **Cloudflare Tunnel**: set `TUNNEL_TOKEN` to connect your domain
without port-forwarding (the installer writes a `cloudflared` service into
`docker-compose.override.yml`). Full details: [`docs/deployment/tls-mode.md`](./docs/deployment/tls-mode.md).

### Accounts, registration & admin

- **Registration** is gated by `CONDUWUIT_REGISTRATION_TOKEN`. Share it with the
  people you want on your instance; rotate it to close registration.
- **Admins**: list Matrix IDs in `ADMIN_USER_IDS` (comma-separated, e.g.
  `@admin:chat.example.com`). Admins get the Settings → Admin panel (users,
  moderation, federation, stats).
- **2FA**: TOTP enrollment is built into the account settings; no env config needed.

### Voice & video

```bash
LIVEKIT_API_KEY=$(openssl rand -base64 32)
LIVEKIT_API_SECRET=$(openssl rand -base64 32)
TURN_SECRET=$(openssl rand -hex 32)
```

- **LiveKit** is the WebRTC SFU; the key/secret pair authorizes the API to mint
  room tokens.
- **TURN** (bundled coturn) is required for voice when users are behind NAT or a
  CDN that blocks UDP. `TURN_DOMAIN`/`TURN_HOST` are auto-derived from your
  instance domain (`turn.<domain>`) — you normally leave them unset. Behind NAT,
  the installer sets `TURN_EXTERNAL_IP` in the override file.
- **External TURN** (e.g. metered.ca) is supported as an alternative to the
  bundled coturn.
- Port details and the LiveKit UDP range: [`docs/voice/port-coherence.md`](./docs/voice/port-coherence.md)
  and [Ports](#ports--firewall) below.

### Federation (instance-to-instance Matrix)

Federation is managed **at runtime** (Settings → Admin → Federation), persisted
to `config/tuwunel.toml`, and applied via an automated ~10–15 s homeserver
restart from the admin panel. For advanced regex allow/deny patterns, edit
`config/tuwunel.toml` directly and `docker compose restart conduwuit`. Migrating
a pre-0.2.0 `.env`-based config? Run `./scripts/migrate-federation-config.sh`.

### Email / SMTP (optional)

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` to enable
email invites and account recovery. Leave blank to disable.

### Soundboard (optional)

Set `FREESOUND_API_KEY` (free key at <https://freesound.org/apiv2/apply>) to let
users pull sound effects from the Freesound library into the soundboard.

### Bug reports → GitHub (optional)

Set `GITHUB_BUG_REPORT_TOKEN` (a fine-grained PAT with **Issues: Read and write**
on a single repo) and `GITHUB_BUG_REPORT_REPO` to mirror in-app bug reports to
GitHub issues. Only the user-typed title/description are sent; system info stays
local. Rotation runbook: [`docs/deployment/github_bug_report_token.md`](./docs/deployment/github_bug_report_token.md).

---

## Ports & firewall

The stack is designed so a home operator forwards **one TCP port (443)**. An SNI
multiplexer (`sslh`) sniffs each inbound 443 ClientHello and routes
`turn.<your-domain>` to coturn-TLS and everything else to the Caddy web stack.

| Port | Proto | Purpose | Open to internet? |
|---|---|---|---|
| **443** | TCP | Web + Matrix + concord-api + TURN-TLS (SNI-muxed) | **Yes** (the one you must forward) |
| 80 | TCP | ACME HTTP-01 validation | Only for `letsencrypt_http01` |
| 8080 | TCP | Caddy (HTTP-only mode / behind the mux) | Local trials only |
| 3478 | UDP/TCP | STUN/TURN | Recommended for voice |
| 5349 | TCP | TURN over TLS (direct, non-muxed) | Optional |
| 7881 | TCP | LiveKit ICE/TCP fallback | Recommended for voice |
| 50000–50100 | UDP | LiveKit RTC media range | **Yes, for voice** |

Override the LiveKit range with `LIVEKIT_UDP_START`/`LIVEKIT_UDP_END` (keep it in
sync with `config/livekit.yaml` — CI's config-lint enforces this).

---

## Connecting clients

Your running stack is a **Concord instance**: a domain that serves the Matrix
client-server API (via tuwunel), the concord-api REST overlay, and LiveKit voice,
all behind Caddy on 443. Clients discover everything they need from just the
domain via two unauthenticated well-known documents:

- `GET https://<domain>/.well-known/matrix/client` — standard Matrix homeserver discovery.
- `GET https://<domain>/.well-known/concord/client` — Concord-specific: LiveKit URL, TURN servers, and feature affordances.

### Web browser

Nothing to install — visit `https://<your-domain>`, register with the
registration token (or log in), and you're in. This is the free-forever UI and
ships with the stack.

### Native desktop & mobile clients

The native Concord apps (desktop and mobile — distributed separately from this
repository) connect to your instance with **full feature parity**; there is no
capability delta between web and native against the same server.

1. In the client, **add a source / connect to an instance** and enter your
   domain (e.g. `chat.example.com`). The client fetches the well-known docs above
   and auto-configures homeserver + voice endpoints.
2. **Register or log in** a Matrix account on your instance (registration uses
   the same `CONDUWUIT_REGISTRATION_TOKEN`).
3. You now have the full Discord-style experience — servers, channels, DMs, voice
   rooms, soundboard, moderation — backed by your homeserver.

> Native builds default to a peer-to-peer profile (`CONCORD_PROFILE=p2p_only`)
> and can *also* connect to a domain-hosted instance like this Docker stack
> (`CONCORD_PROFILE=web_first`). Connecting to your instance is the
> "join an existing domain-accessible instance" path.

### What must be reachable for a client

- **443/TCP** to the domain — chat, login, media, and TURN-TLS all ride this.
- **Voice** additionally needs the LiveKit media range (**50000–50100/UDP**) and
  ideally **3478** + **7881** reachable, or a working TURN relay as fallback. If
  voice connects but no audio flows, TURN is almost always the missing piece —
  start with `docs/voice/port-coherence.md` and `scripts/verify_turn_relay.sh`.

### For client developers — the compatibility contract

Any client that speaks these three wire surfaces is fully compatible with a
Concord instance; the web client has no privileged channel:

1. **Matrix client-server API** (tuwunel) — auth, rooms, timeline, E2EE, media.
2. **concord-api REST** — the Discord-shaped overlay (servers, invites, DMs,
   soundboard, moderation, admin); browse the routers under `server/routers/`.
3. **LiveKit** — WebRTC voice/video, with tokens minted by concord-api.

Auto-configuration is the well-known pair above. Because compatibility is a
property of these protocols rather than of any shared UI code, a native client
can match every web capability — and add OS-native ones — with no compromise.

---

## Operations

- **Health**: `GET /api/health` on the web container; `docker compose ps` for
  service state.
- **Federation hot-swap**: changes from Settings → Admin → Federation restart
  tuwunel automatically (~10–15 s) via the locked-down docker-socket-proxy.
- **Helper scripts** (`scripts/`): config-coherence lint, TLS-mode lint,
  federation-config migration, TURN relay smoke test.

## Development

- **Client** (`./client`): `npm install && npm run dev` (Vite), `npm test` (Vitest).
- **Server** (`./server`): FastAPI + pytest.
- **CI** (`.github/workflows/ci.yml`): config-coherence lint, client vitest+build,
  server pytest, and a docker-compose voice integration smoke test.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for branch/commit conventions.

## License

[`LICENSE`](./LICENSE) (FSL-1.1-Apache-2.0 — converts to Apache-2.0 two years
after each release). Trademarks: [`TRADEMARKS.md`](./TRADEMARKS.md). Contributions
are under [`CONTRIBUTING.md`](./CONTRIBUTING.md) + [`CLA.md`](./CLA.md).
