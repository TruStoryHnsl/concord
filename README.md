# Concord

A Discord replacement built on the [Matrix](https://matrix.org/) protocol. Self-hosted, open-source, designed for small communities.

## Features

- **Text chat** — Rooms, threads, typing indicators, read receipts, media uploads
- **Voice channels** — WebRTC voice/video via LiveKit SFU
- **Soundboard** — Upload audio clips or import from Freesound library, play into voice channels
- **Server model** — Discord-style servers with channels, roles, invites, and permissions
- **Server discovery** — Browse and join public servers
- **Invite system** — Link invites, email invites, and direct user invites
- **Admin panel** — Global admin dashboard for managing servers, users, and bug reports
- **Webhooks** — External message posting into channels
- **Dark theme** — Full dark UI with Tailwind CSS
- **Auto-HTTPS** — Caddy reverse proxy with automatic Let's Encrypt certificates

## Architecture

Four Docker services behind Caddy:

| Service | Purpose |
|---------|---------|
| **Tuwunel** | Matrix homeserver (auth, rooms, messages, presence) |
| **Concord API** | FastAPI backend (servers, invites, soundboard, admin) |
| **LiveKit** | WebRTC SFU (voice/video routing, soundboard injection) |
| **Caddy** | Reverse proxy, auto-HTTPS, static file serving |

The client is a React + TypeScript SPA that talks to all three backends.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- A server or machine with at least 1GB RAM

### Install

```bash
git clone https://github.com/user/concord.git
cd concord
chmod +x install.sh
./install.sh
```

The install wizard will:
1. Check prerequisites (Docker, Docker Compose)
2. Name your server and create your admin account
3. Configure networking (domain with auto-HTTPS, or local-only)
4. Set up optional integrations (email, soundboard library, TURN relay)
5. Generate all secrets automatically
6. Build and launch all services

### Manual Setup

If you prefer to configure manually:

```bash
cp .env.example .env
# Edit .env with your values
docker compose up -d --build
```

Then register your first account at your configured URL.

## Configuration

All configuration is in the `.env` file. Key settings:

| Variable | Description |
|----------|-------------|
| `CONDUWUIT_SERVER_NAME` | Server identity — appears in user IDs (cannot change after first run) |
| `INSTANCE_NAME` | Display title on login page (can change anytime) |
| `SITE_ADDRESS` | Domain for auto-HTTPS, or `:80` for HTTP-only |
| `HTTP_PORT` | Host port for web interface |
| `ADMIN_USER_IDS` | Comma-separated Matrix user IDs with admin access |

### Optional Services

| Variable | Purpose |
|----------|---------|
| `METERED_APP_NAME` / `_API_KEY` | External TURN relay for voice behind strict NATs |
| `SMTP_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_FROM` | Email invitations |
| `FREESOUND_API_KEY` | Sound effect library for soundboards |

### Switching to HTTPS

Set `SITE_ADDRESS` to your domain, `HTTP_PORT` to `80`, and restart. Caddy handles certificates automatically. The installer creates `docker-compose.override.yml` to map port 443.

## Project Structure

```
concord/
├── client/           # React + TypeScript + Vite
│   └── src/
│       ├── api/          # REST clients (Matrix, Concord API, LiveKit)
│       ├── components/   # UI components
│       ├── hooks/        # React hooks
│       └── stores/       # Zustand state management
├── server/           # Python FastAPI backend
│   ├── routers/          # API route handlers
│   └── services/         # Matrix admin, LiveKit tokens, email, bot
├── config/           # Caddyfile, LiveKit configuration
├── web/              # Dockerfile for Caddy + client bundle
├── docker-compose.yml
├── install.sh        # Interactive install wizard
└── .env.example      # Configuration template
```

## Routing

| Path | Backend |
|------|---------|
| `/` | Static React app (Caddy) |
| `/_matrix/` | Tuwunel (Matrix homeserver) |
| `/api/` | Concord API (FastAPI) |
| `/livekit/` | LiveKit (WebRTC signaling) |

## Management

```bash
# View logs
docker compose logs -f

# Restart services
docker compose restart

# Stop everything
docker compose down

# Rebuild after code changes
docker compose up -d --build

# View specific service logs
docker compose logs -f concord-api
docker compose logs -f conduwuit
```

## Technical Notes

- **Tuwunel** is the successor to Conduwuit. It uses RocksDB internally (~170MB RAM vs Synapse's 500MB+).
- The `CONDUWUIT_SERVER_NAME` is baked into the Matrix database on first run and cannot be changed without wiping data.
- Environment variables use the `CONDUWUIT_` prefix for backward compatibility with Conduwuit-era configs.
- The client build happens inside Docker (multi-stage build) — no Node.js required on the host.
- **Caddy** automatically provisions and renews HTTPS certificates when `SITE_ADDRESS` is set to a domain name.

## License

MIT
