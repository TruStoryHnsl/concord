# Concord

[![CI](https://github.com/TruStoryHnsl/concord-docker/actions/workflows/ci.yml/badge.svg)](https://github.com/TruStoryHnsl/concord-docker/actions/workflows/ci.yml)
[![Secret scan](https://github.com/TruStoryHnsl/concord-docker/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/TruStoryHnsl/concord-docker/actions/workflows/secret-scan.yml)

Self-hosted Discord-style voice and text chat on Matrix. Your control plane,
your data — no third-party service in the middle.

This repository is the **Docker edition** of Concord: the browser client, the
FastAPI service, a Matrix homeserver (tuwunel/conduwuit), the LiveKit voice
stack, a bundled coturn TURN relay, and a Caddy edge — all wired together by
one `docker-compose.yml`.

## Concord Docker and Concord Native

Concord ships as **two deliberately different products from two repositories**:

| | This repo — `concord-docker` | `concord-native` (private) |
|---|---|---|
| Product | Self-hostable server + **browser** client, Discord-style UI | Native desktop / mobile apps, **p2p-messenger-first**, built on their own Rust mesh engine |
| Runs on | Any Docker host | Your devices (Tauri desktop, mobile shells) |
| Connectivity | Domain hosting: Matrix + LiveKit + TURN behind Caddy | Peer-to-peer mesh; shows the Discord-style UI when portaling into a Docker instance |

The two UIs are intentionally different — the split exists precisely so the
native app could become a p2p messenger first while this edition stays the
browser product. They interoperate: native clients can join a Docker instance
as a source, and this stack doubles as a support pillar for the native apps'
mesh (the Reticulum entrypoint service, relay, and per-user roaming store live
here). The repos are developed independently — there is no automated mirror
between them.

## What is included

- `docker-compose.yml` — the production multi-service stack.
- `client/` — the React web client.
- `server/` — the Concord API service (FastAPI).
- `web/` — the web/Caddy image build.
- `config/` — proxy, voice, TURN, and Matrix runtime defaults.
- `.env.example` — the operator configuration template, documented inline.

Native app source, private planning files, and development-only automation are
intentionally not part of this edition.

## Requirements

- Docker Engine with the Compose v2 plugin (`docker compose`), or Podman with
  a compose provider.
- For public deployments: a domain with a DNS record pointing at your host
  (or a Cloudflare Tunnel — no inbound ports needed in that mode).

### Ports the stack uses

| Port | Protocol | Service | When |
|---|---|---|---|
| `${HTTP_PORT}` (default 8080) | TCP | Caddy edge (web + API + Matrix) | always |
| 443 | TCP | sslh multiplexer (SNI-routes web + TURN-over-TLS) | only with `COMPOSE_PROFILES=public-ingress` |
| 3478 / 5349 | UDP+TCP | coturn TURN relay (host network) | voice behind NAT |
| 7881 | TCP | LiveKit RTC fallback | voice |
| 50000–50100 | UDP | LiveKit media | voice |
| 4242 | TCP | Reticulum entrypoint (native-app mesh support) | optional |

## Quick start

```bash
git clone https://github.com/TruStoryHnsl/concord-docker.git
cd concord-docker
cp .env.example .env
```

Edit `.env`. Every variable is documented in the file itself; the ones you
must set:

```dotenv
CONDUWUIT_SERVER_NAME=chat.example.com   # PERMANENT — see warning below
SITE_ADDRESS=chat.example.com            # or ":8080" for LAN/HTTP-only
SITE_URL=https://chat.example.com
CONDUWUIT_REGISTRATION_TOKEN=<openssl rand -base64 32>
LIVEKIT_API_KEY=<openssl rand -base64 32>
LIVEKIT_API_SECRET=<openssl rand -base64 32>
TURN_SECRET=<openssl rand -base64 32>
ADMIN_USER_IDS=@you:chat.example.com
```

> **`CONDUWUIT_SERVER_NAME` is permanent.** It becomes part of every Matrix
> user ID (`@you:chat.example.com`). Changing it after first boot breaks the
> database. Pick it like you'd pick a username.

Then start the stack:

```bash
docker compose up -d --build
```

Open your configured address in a browser and register the first account
using the `CONDUWUIT_REGISTRATION_TOKEN` you set. An account whose Matrix ID
is listed in `ADMIN_USER_IDS` gets the admin panel (Settings → Admin).

## Choosing a deployment mode

**Local / LAN only (simplest).** Set `SITE_ADDRESS=:8080`. The stack serves
plain HTTP on `http://<host>:8080`. Set `BIND_HOST=127.0.0.1` to restrict it
to the local machine. For LAN-wide HTTPS without a public domain, use
`TLS_MODE=internal_longlived` (Caddy self-signs; accept the cert once per
device).

**Public domain behind a Cloudflare Tunnel (no open ports).** Create a tunnel
in the Cloudflare dashboard pointing at `http://localhost:8080` on this host,
put its token in `TUNNEL_TOKEN`, and run `cloudflared` alongside the stack
(as a service in `docker-compose.override.yml` or on the host). Cloudflare
terminates TLS; no inbound firewall holes required. Voice still needs the
TURN/LiveKit UDP ports reachable, or calls will relay poorly.

**Direct public ingress (Caddy/sslh own the edge).** Point DNS at the host,
then:

```dotenv
SITE_ADDRESS=chat.example.com
TLS_MODE=letsencrypt_http01          # or letsencrypt_dns01_cloudflare
COMPOSE_PROFILES=public-ingress      # sslh on 443: SNI-muxes web + TURN-over-TLS
LIVEKIT_RTC_NODE_IP=<your public IP> # the address remote clients can route to
```

`letsencrypt_http01` needs port 80 reachable from the internet for the ACME
handshake; `letsencrypt_dns01_cloudflare` issues certs via the Cloudflare API
instead (set `CLOUDFLARE_API_TOKEN` — scope guidance is in `.env.example`)
and works for origins that are not publicly reachable.

## Runtime notes

- **Federation** is managed at runtime from the admin UI
  (Settings → Admin → Federation) and persisted to `config/tuwunel.toml`,
  which is generated from `config/tuwunel.toml.template` on first API
  startup. If you edit the file by hand, apply it with
  `docker compose restart conduwuit`.
- **Voice port coherence:** the LiveKit/coturn ports in `.env.example`,
  `docker-compose.yml`, `config/livekit.yaml`, and `config/turnserver.conf`
  must stay aligned if you override them.
- **Email invites** (optional): set the `SMTP_*` variables.
- **Soundboard library** (optional): set `FREESOUND_API_KEY`.

## Operations

```bash
# Upgrade to the latest release
git pull && docker compose up -d --build

# Watch logs
docker compose logs -f concord-api

# Back up everything that matters (all runtime state lives in ./data/)
docker compose stop && tar czf concord-backup.tgz data/ .env && docker compose start
```

`data/` (databases, media, keys, certificates) and `.env` (secrets) are
deliberately untracked — they never belong in git. Back them up together;
restoring both onto a fresh clone of this repo reproduces your instance.

## Development

```bash
cd client && npm ci && npm test      # React client: vitest suite
cd server && pip install -r requirements.txt
```

CI runs the client suite and build, a server bytecode check, compose-config
validation, and a full-history gitleaks scan on every push and PR.

## License

Source is licensed under [FSL-1.1-Apache-2.0](./LICENSE) — free for
internal use, non-compete for two years, then converts to Apache-2.0.
Concord trademarks are covered by [TRADEMARKS.md](./TRADEMARKS.md).
