# Concord v1: Self-Containment Feasibility Report
## Can v1 become a fully self-contained application?

**Date:** 2026-03-30
**Status:** Analysis Complete

---

## Executive Summary

Concord v1 is **already 95% self-contained** via Docker Compose. All four core
services (Matrix homeserver, FastAPI backend, LiveKit voice, Caddy reverse proxy)
run from a single `docker compose up`. The remaining 5% is external TURN relay
dependency for users behind strict NAT. Making v1 fully self-contained is
**feasible and moderate in scope**, but significantly expands the project's
operational surface area.

---

## Current Architecture

```
┌─────────────────────────────────────────────────┐
│                  docker-compose.yml              │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Conduwuit │  │ Concord  │  │ LiveKit  │      │
│  │ (Matrix)  │  │   API    │  │ (Voice)  │      │
│  │ Port 6167 │  │ Port 8000│  │ Port 7880│      │
│  └──────────┘  └──────────┘  └──────────┘      │
│                                                  │
│  ┌──────────────────────────────────────┐       │
│  │            Caddy (Reverse Proxy)      │       │
│  │         Ports 8080/8443 (exposed)     │       │
│  └──────────────────────────────────────┘       │
│                                                  │
│  ┌──────────────────────────────────────┐       │
│  │          SQLite (concord.db)          │       │
│  │       RocksDB (Conduwuit state)       │       │
│  └──────────────────────────────────────┘       │
└─────────────────────────────────────────────────┘

External Dependencies:
  - Metered.ca TURN relay (optional, for strict NAT)
  - Google STUN server (stun:stun.l.google.com:19302)
  - SMTP server (optional, for email invites)
  - Freesound API (optional, for soundboard library)
```

## What "Self-Contained" Would Mean

### Tier 1: Already Self-Contained (Current State)
Everything needed to run Concord v1 is in the Docker Compose stack:
- **Authentication**: Matrix homeserver handles user registration/login
- **Messaging**: Matrix rooms for persistent text channels
- **Voice/Video**: LiveKit SFU for WebRTC
- **Web Serving**: Caddy serves the React SPA + handles TLS
- **Database**: SQLite (zero-config) + RocksDB (Conduwuit state)
- **API**: FastAPI handles servers, invites, soundboard, moderation

**Verdict**: A user can `./install.sh && docker compose up -d` and have a
working chat platform with zero external service accounts.

### Tier 2: Moderate Effort - Bundle TURN Server
**Problem**: Users behind symmetric/strict NAT (common on mobile networks,
corporate firewalls) cannot establish WebRTC peer connections without a TURN
relay. Currently, this falls back to Metered.ca (external SaaS).

**Solution**: Add a `coturn` container to docker-compose.yml.

```yaml
coturn:
  image: coturn/coturn:latest
  network_mode: host
  volumes:
    - ./config/turnserver.conf:/etc/turnserver.conf
  restart: unless-stopped
```

**Effort**: ~2 hours
- Add coturn service to docker-compose.yml
- Generate TURN credentials in install.sh
- Update voice.py router to return local TURN server URLs
- Update Caddyfile if proxying TURN over TLS
- Expose UDP port range (49152-65535) for media relay

**Impact**: Eliminates the last hard external dependency. Voice works for
everyone regardless of NAT type.

### Tier 3: Higher Effort - Bundle Optional Services

#### 3a. Self-Hosted SMTP (Mailpit or similar)
Currently email invites require an external SMTP server.
- Could bundle Mailpit for development/small deployments
- Production email still needs a real SMTP relay (deliverability)
- **Effort**: ~1 hour for dev, not recommended for production
- **Verdict**: Skip - SMTP is inherently external

#### 3b. Freesound Mirror / Local Sound Library
- Could ship a curated local sound pack instead of API dependency
- **Effort**: ~3 hours + storage for audio files
- **Verdict**: Nice-to-have, low priority

---

## Scope Expansion Analysis

### What Changes if We Commit to "Self-Contained"

| Aspect | Current | Self-Contained |
|--------|---------|----------------|
| Docker services | 4 | 5 (+ coturn) |
| Open ports | 3 (HTTP, HTTPS, LiveKit) | 5+ (+ TURN TCP/UDP ranges) |
| RAM usage | ~400MB | ~450MB (coturn is lightweight) |
| install.sh complexity | Moderate | Moderate+ (TURN config) |
| Firewall requirements | Simple | More complex (UDP ranges) |
| Documentation | Moderate | Needs TURN/NAT troubleshooting |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| TURN port exposure | Medium | Restrict to authenticated users only |
| Bandwidth from relaying | Medium | Rate-limit per-user relay sessions |
| coturn security updates | Low | Pin to stable tag, renovate bot |
| Increased support surface | Medium | Better install wizard diagnostics |

### New Operational Responsibilities

1. **TURN credential rotation** - Need a mechanism to rotate shared secrets
2. **UDP port management** - Cloud providers often block UDP by default
3. **Bandwidth monitoring** - TURN relays can consume significant bandwidth
4. **NAT detection** - Should add client-side ICE candidate checking to
   diagnose connection issues

---

## What Self-Containment Does NOT Include

To be clear, "self-contained" means the application runs independently.
It does NOT mean:

1. **Single binary** - Still Docker Compose with multiple containers
2. **Offline operation** - Still needs network for multi-user communication
3. **No DNS** - Still needs a domain for HTTPS (or use :8080 HTTP-only)
4. **No system deps** - Still requires Docker + Docker Compose on the host

### What Would Make It Truly Single-Binary

This is a much larger undertaking:

- **Embed Matrix homeserver**: Would require rewriting auth against a simpler
  system (Matrix is powerful but heavy for a self-contained app)
- **Embed voice server**: LiveKit is Go — would need CGO bindings or a Rust
  reimplementation (this is essentially what v2 is doing with libp2p)
- **Embed web server**: Replace Caddy with built-in HTTP serving in the API

**Effort**: 3-6 months. This is essentially the v2 rewrite strategy.

---

## Recommendation

### Do This Now (Tier 2): Bundle coturn
- Low effort, high impact
- Eliminates the only hard external dependency
- Makes "works on any VPS" a true statement
- Estimated: **2 hours of implementation + 1 hour testing**

### Don't Do This: Single Binary Rewrite
- That's what v2 (Tauri + libp2p + Rust) is already pursuing
- v1 should remain the stable, Docker-based deployment
- Invest v1 effort in UX polish, not architecture restructuring

### Consider Later (Tier 3): Local Sound Library
- Ship 50-100 curated sound effects with the Docker image
- Keep Freesound as an optional enhancement
- Low priority, nice polish

---

## Implementation Plan (If Approved)

### Phase 1: coturn Integration (2 hours)
1. Add `coturn` service to `docker-compose.yml`
2. Create `config/turnserver.conf` template
3. Add TURN configuration to `install.sh` wizard
4. Update `server/routers/voice.py` to return local TURN credentials
5. Update documentation

### Phase 2: Connection Diagnostics (3 hours)
1. Add ICE candidate gathering diagnostic to client
2. Show connection quality indicator in voice UI
3. Add TURN usage stats to admin panel
4. Log relay vs direct connections for monitoring

### Phase 3: Polish (2 hours)
1. Health check for coturn in docker-compose
2. Bandwidth monitoring/alerts
3. TURN credential rotation mechanism
4. Update README with self-hosting guide

**Total estimate: 7 hours for full self-containment**

---

## Conclusion

Concord v1 is already remarkably self-contained for a chat platform with
voice support. The only meaningful gap is TURN relay for strict NAT users,
which is a straightforward coturn addition. The project scope increase is
**moderate and manageable** — roughly 7 hours of work for complete
self-containment.

The single-binary dream is better served by v2's Rust/libp2p approach.
v1 should focus on being the best Docker-based deployment possible.
