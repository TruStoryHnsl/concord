# Changelog

All notable changes to Concord will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Mobile logout** — always-visible 44×44 account button in the mobile top bar opens an `AccountSheet` glass panel with username and a Logout action. Reachable from every mobile view (chat, channels, DMs, servers, settings). Fallback Logout button also appended to the bottom of `SettingsPanel`. (INS-001)
- **Markdown rendering in chat** — chat message bodies now render markdown via `react-markdown` + `remark-gfm` with a hardened `rehype-sanitize` schema. Supports bold, italic, inline `code`, fenced code blocks, ordered/unordered lists, links (open in new tab with `rel="noopener noreferrer"`), headings (h1–h6), and blockquotes. URL link previews still work because URL extraction runs on the raw body before parsing. New deps: `react-markdown ^9`, `remark-gfm ^4`, `rehype-sanitize ^6`. (INS-002)
- **Auto-growing chat input** — `MessageInput` is now a `<textarea>` that grows to `min(40vh, 8 lines)` then becomes internally scrollable. The chat history reflows upward automatically because the form is `flex-shrink-0` inside a `flex-col min-h-0` parent. Plain Enter sends, Shift+Enter inserts a newline, IME composition is guarded, and edit-mode/Escape behavior is preserved. (INS-003)
- **Mobile navigation redesign** — flat 5-icon `BottomNav` replaced with a floating glass nav: sliding pill indicator, slightly elevated center "Chat" tab with primary glow, `active:scale-95` press feedback, ≥44×44 tap targets, `cubic-bezier(0.16,1,0.3,1)` 280ms transition. Same five `MobileView` destinations and `onChange`/`onSettingsOpen` API as before. (INS-001)
- **Runtime federation allowlist** — Admin → Federation now applies allowlist changes live via a Matrix server restart. Previously edits required manually copying a regex string into `.env` and recreating the container. New "Apply Changes" button with confirmation modal surfaces the brief downtime (~10-15s) before restart.
- `docker-socket-proxy` sidecar (`tecnativa/docker-socket-proxy`) scoped to `CONTAINERS=1 POST=1` so concord-api can restart the conduwuit container without mounting the host docker socket directly.
- `server/services/tuwunel_config.py` — atomic read/write helper for the new TOML config, with file locking and tmp-file-then-rename semantics to prevent torn reads.
- `server/services/docker_control.py` — thin async wrapper around the docker-socket-proxy API for restarting compose services by label.
- `scripts/migrate-federation-config.sh` — one-time migration helper that moves legacy `.env` federation vars into `config/tuwunel.toml`. Invoked automatically by `install.sh` on every run (no-op when nothing to migrate).
- `GET /api/admin/federation` now returns `pending_apply` (derived from TOML mtime vs. last successful apply timestamp) so the UI badge survives page reloads.
- `POST /api/admin/federation/apply` — new endpoint that triggers the container restart.

### Changed
- **Mobile scroll containers chained** — added `min-h-0` through the `ChatLayout` mobile shell, `SettingsPanel` tab content, and `ServerSettingsPanel` tab content so every mobile view scrolls top to bottom without clipping. `SubmitPage` switched to `items-start sm:items-center` + `overflow-y-auto` to fix mobile clipping. (INS-001)
- **Global text wrapping** — added `.concord-message-body` rule (`overflow-wrap: anywhere; word-break: break-word; min-width: 0`) so long unbroken strings in chat messages no longer cause horizontal overflow on mobile. (INS-001)
- **Federation config moved from `.env` to `config/tuwunel.toml`.** The three keys `CONDUWUIT_ALLOW_FEDERATION`, `CONDUWUIT_FORBIDDEN_REMOTE_SERVER_NAMES`, and `CONDUWUIT_ALLOWED_REMOTE_SERVER_NAMES` are no longer read by docker-compose.yml. They are preserved (commented-out) by the migration script for reference. All other `CONDUWUIT_*` env vars are unchanged.
- Federation allowlist regex patterns are now fully anchored (`^escaped-name$`). The previous implementation only anchored the end with `$`, which permitted unintended substring matches. **Security hardening.**
- `PUT /api/admin/federation/allowlist` now rejects invalid hostnames with HTTP 400 instead of silently dropping them. RFC-1123 hostname validation applies.
- `docker-compose.yml` now bind-mounts `./config/tuwunel.toml` into both `conduwuit` (RO) and `concord-api` (RW) containers.

### Fixed
- **Mobile users could not log out** — there was no logout affordance reachable from any mobile view. (INS-001)
- **Mobile pages clipped instead of scrolling** in several settings/server-settings/submit views due to missing `min-h-0` on parent flex columns. (INS-001)
- **Long unbroken strings in chat messages overflowed horizontally** on narrow viewports. (INS-001)
- Allowlist edits made in the admin UI now actually take effect without manual `.env` editing and container recreation. Previously the UI accepted changes but the running Tuwunel process silently ignored them until a human operator intervened.

### Security
- **Chat message rendering is now sanitized.** Markdown is parsed via `react-markdown` and run through `rehype-sanitize` with a hardened schema: dangerous tags (`script`, `iframe`, `style`, `object`, `embed`) are filtered, all `on*` event handlers are stripped, `href` URLs are restricted to `http`/`https`/`mailto`, and `src` URLs are restricted to `http`/`https`. Hostile bodies like `<img src=x onerror=alert(1)>` and `[click](javascript:...)` no longer execute. (INS-002)

## [0.1.0] - 2026-03-31

### Added
- Kinetic Node UI redesign (Space Grotesk + Manrope fonts, surface hierarchy, glassmorphism, gradient CTAs, Material Symbols)
- Mobile bottom navigation — persistent access to Servers, Channels, Chat, Settings
- Lobby auto-join for all users (new registrations and existing logins)
- Welcome message with getting-started guide in lobby #welcome channel
- Dev mode deployment (Vite HMR via docker-compose.dev.yml)
- Self-containment feasibility report

### Changed
- Project restructured from v1/v2 directories to semantic versioning
- Former v2 (Tauri/libp2p beta) moved to `beta/` directory
- Scope changed from commercial to public

### Fixed
- Mobile navigation bug — menu items were unreachable without drawer discovery
