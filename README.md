# Concord

Self-hosted Discord-style voice and text chat on Matrix.

This public repository contains the Docker edition of Concord: the web client,
FastAPI service, Matrix homeserver configuration, LiveKit voice stack, TURN
relay, and Caddy edge proxy.

## What Is Included

- `docker-compose.yml` for the production Docker stack.
- `client/` for the React web client.
- `server/` for the Concord API service.
- `web/` for the web/Caddy image build.
- `config/` for runtime proxy, voice, TURN, and Matrix defaults.
- `.env.example` for operator configuration.

Native desktop, mobile, private planning files, generated test evidence, and
development-only automation are intentionally not part of this public edition.

## Quick Start

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set at minimum:

   ```dotenv
   CONDUWUIT_SERVER_NAME=chat.example.com
   SITE_ADDRESS=chat.example.com
   SITE_URL=https://chat.example.com
   PUBLIC_BASE_URL=https://chat.example.com
   CONDUWUIT_REGISTRATION_TOKEN=<secure random value>
   LIVEKIT_API_KEY=<secure random value>
   LIVEKIT_API_SECRET=<secure random value>
   TURN_SECRET=<secure random value>
   ADMIN_USER_IDS=@admin:chat.example.com
   ```

3. Start Concord:

   ```bash
   docker compose up -d --build
   ```

4. Open the configured site in a browser and create the first admin account.

## Runtime Notes

- `CONDUWUIT_SERVER_NAME` is permanent after first boot because it becomes part
  of Matrix user IDs.
- `config/tuwunel.toml` is generated from `config/tuwunel.toml.template` on
  first API startup and is rewritten by the admin UI when federation settings
  change.
- `TLS_MODE=letsencrypt_http01` is the default for public domain deployments.
  Use `TLS_MODE=letsencrypt_dns01_cloudflare` when your origin cannot receive
  public HTTP-01 validation traffic and you can provide `CLOUDFLARE_API_TOKEN`.
- Voice requires the LiveKit and coturn ports in `.env.example`,
  `docker-compose.yml`, `config/livekit.yaml`, and `config/turnserver.conf` to
  stay aligned.

## License

See [LICENSE](./LICENSE). Concord trademarks are covered by
[TRADEMARKS.md](./TRADEMARKS.md).
