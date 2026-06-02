# concord

Self-hosted Discord replacement on Matrix. Voice, soundboards, server discovery, optional federation — your control plane, your data.

## What it is

A small-community chat platform that looks and feels like Discord but runs on infrastructure you own. A handful of Docker services, one `.env` file: **tuwunel** handles Matrix (auth, rooms, presence, federation), **LiveKit** handles WebRTC voice, a **FastAPI** service handles the Discord-style server/invite/soundboard model that Matrix doesn't natively expose, and **Caddy** fronts it all with auto-HTTPS.

This repository is the **open-source, self-hostable Docker edition** — the free, configurable infrastructure. Stand it up on a box you can `ssh` into and you own the homeserver, the recordings, the user database, the moderation tools, and the federation policy.

## Why

Discord is great until you remember someone else owns the kill switch. Concord is the same UX without that — same channels, same roles, same voice rooms, same soundboard — but everything lives on hardware you control.

Most existing Matrix clients are excellent at being Matrix clients and bad at feeling like Discord. Most "self-hosted Discord" forks feel like Discord but aren't open. Concord is a wrapper layer — a Discord-shaped server/invite/soundboard model on top of Matrix — so you get the federation and end-to-end story for free, and the UX still feels like the thing your friends already know how to use.

Concord is infrastructure, not a service. Every functional capability stays free in the browser-accessible web UI.

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
| **concord-api** | built from `./server` (FastAPI / Python) | The Discord-shaped overlay Matrix doesn't ship. Routers: admin, servers, invites, direct invites, DMs, voice, soundboard, webhooks, moderation, registration, TOTP, stats, media, preview. Services: matrix_admin, livekit_tokens, email, bot, tuwunel_config, docker_control. |
| **livekit** | `livekit/livekit-server:v1.9` | WebRTC SFU. Voice/video routing + soundboard audio injection into rooms. |
| **docker-socket-proxy** | `tecnativa/docker-socket-proxy` | Locked-down sidecar (`CONTAINERS=1 POST=1`). Lets concord-api restart tuwunel for live federation-policy hot-swap without ever giving the API the host docker socket. |
| **web** (Caddy) | built from `./web` | Reverse proxy, auto-HTTPS via Let's Encrypt, static React bundle, path-based routing. |
| **coturn** | embedded service (optional) | TURN relay for clients behind strict NATs. External `metered.ca` is supported as an alternative. |
| **client** | `./client` (React 19 + TS + Vite + Zustand) | SPA — talks to tuwunel, concord-api, and LiveKit through Caddy. Mobile-first responsive layout, dark theme, floating glass bottom nav. |

All services run on an internal `concord` bridge network. The web client is the only thing exposed to the user.

## Quickstart

```bash
git clone https://github.com/TruStoryHnsl/concord.git
cd concord
cp .env.example .env
# edit .env — at minimum set CONDUWUIT_SERVER_NAME and SITE_ADDRESS
docker compose up -d --build
```

`CONDUWUIT_SERVER_NAME` is your Matrix server name (e.g. `chat.example.com`);
`SITE_ADDRESS` is the public address Caddy serves and obtains a certificate for.
For a purely local trial, point both at `localhost` and use the HTTP-only
override. See `.env.example` for the full set of options (TURN, federation,
SMTP, soundboard/Freesound, registration policy).

Local frontend hacking with Vite HMR (swaps the production Caddy bundle for a dev server):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Pre-built container images are published to GHCR
(`ghcr.io/trustoryhnsl/concord-web` and `ghcr.io/trustoryhnsl/concord-concord-api`),
so a vanilla operator can run the stack without building from source.

## Configuration

All runtime configuration is environment-driven via `.env` (copied from
`.env.example`). Highlights:

- **Domain & TLS** — `SITE_ADDRESS` + Caddy auto-HTTPS, or local HTTP for trials.
- **Federation** — opt-in Matrix federation with allow/deny policy.
- **Voice** — embedded `coturn`, or an external TURN provider such as metered.ca.
- **Email** — SMTP for verification / recovery (optional).
- **Soundboard** — optional Freesound integration.

Helper scripts live in `scripts/` (config-coherence lint, TLS-mode lint,
federation-config migration, TURN relay smoke test).

## Development

- **Client** (`./client`): `npm install && npm run dev` (Vite), `npm test` (Vitest).
- **Server** (`./server`): FastAPI + pytest.
- **CI** (`.github/workflows/ci.yml`): config-coherence lint, client vitest+build,
  server pytest, and a docker-compose voice integration smoke test.

## License

See [`LICENSE`](./LICENSE). Trademarks: [`TRADEMARKS.md`](./TRADEMARKS.md).
Contributions are welcome under the terms in [`CONTRIBUTING.md`](./CONTRIBUTING.md)
and [`CLA.md`](./CLA.md).
