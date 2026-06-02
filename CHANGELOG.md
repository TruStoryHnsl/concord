# Changelog

All notable changes to the Concord Docker edition are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Initial public release of the self-hostable Docker edition: tuwunel (Matrix
  homeserver), FastAPI overlay (`concord-api`), LiveKit (WebRTC voice),
  docker-socket-proxy sidecar, and Caddy reverse proxy with auto-HTTPS.
- React 19 web client (chat, voice, soundboards, server discovery, moderation,
  admin, optional Matrix federation).
- Environment-driven configuration via `.env` (domain/TLS, federation policy,
  TURN, SMTP, soundboard integration, registration policy).
- CI: config-coherence lint, client vitest + build, server pytest, and a
  docker-compose voice integration smoke test.
