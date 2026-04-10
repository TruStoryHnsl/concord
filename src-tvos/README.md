# Concord tvOS (Apple TV) — Path C Native SwiftUI Shell

**Status:** ACTIVE — server picker, bridge implementation, asset catalog, and build script committed. Channel list + message view are placeholders.

This directory contains the tvOS Xcode project for Concord's Apple TV client. It follows **Path C** from the feasibility study (`docs/native-apps/appletv-feasibility.md`): a standalone native SwiftUI frontend. Since WebKit is unavailable on tvOS (`WKWebView` is `API_UNAVAILABLE(tvos)`), the app talks directly to the Concord/Matrix API via `URLSession` rather than loading a webview.

## Architecture

```
src-tvos/
  ConcordTV.xcodeproj/     — Xcode project (tvOS 17.0+, Swift 5)
  ConcordTV/
    ConcordTVApp.swift      — @main SwiftUI App entry (server picker flow)
    ServerPickerView.swift  — Native server picker (URL input + validation)
    WebViewHost.swift       — Post-connection placeholder (channel list coming)
    JSBridge.swift          — 4-function bridge protocol + real implementation
    Info.plist              — tvOS-specific plist keys
    ConcordTV.entitlements  — Keychain + multicast entitlements
    Assets.xcassets/        — App Icon + Top Shelf Image (placeholder art)
```

## Bridge API (4 functions)

The bridge protocol (`ConcordBridgeProtocol`) defines the interface between the native SwiftUI shell and the Concord server. On tvOS, this is implemented as direct native calls (UserDefaults for persistence, ASWebAuthenticationSession for OAuth).

| Function | Implementation | Status |
|---|---|---|
| `setServerConfig(_ config:)` | UserDefaults JSON persistence | Implemented |
| `getServerConfig()` | UserDefaults JSON read | Implemented |
| `focusChanged(elementId:)` | Logs to console (UIFocus bridge deferred) | Stub |
| `openAuthURL(_ url:)` | ASWebAuthenticationSession | Implemented |

The TypeScript client module at `client/src/api/tvOSHost.ts` wraps these with typed functions that no-op on non-tvOS platforms.

## Build

Build on orrpheus (macOS, M1 Pro):

```bash
# Release build (device):
./scripts/build_tvos_native.sh

# Debug build (simulator):
./scripts/build_tvos_native.sh --sim

# Clean + build:
./scripts/build_tvos_native.sh --clean
```

Artifacts land in `src-tvos/build/Build/Products/`.

## Known Capability Gaps

These Concord features are **not available** on tvOS (any implementation path):

- **Voice channels** — tvOS lacks WebRTC; no microphone on Apple TV hardware
- **Video channels** — same constraint; view-only at best
- **Camera / photo picker** — no camera hardware on Apple TV
- **File uploads** — no filesystem picker on tvOS
- **Peer discovery mesh** — mDNS bridge is non-trivial; v0.1 uses manual server picker

The React client shows a capability banner (`TVCapabilityBanner`) when TV users navigate to voice/video channels.

## Client-Side TV Support

The React client (shared across all platforms) includes TV-specific adaptations:

- `client/src/hooks/usePlatform.ts` — `isTV`, `isAppleTV`, `isAndroidTV` detection flags
- `client/src/hooks/useDpadNav.ts` — DPAD spatial focus navigation hook
- `client/src/styles/tv.css` — 10-foot UI CSS overrides (24px base, 48px targets, focus rings)
- `client/src/components/tv/TVCapabilityBanner.tsx` — Dismissible voice/video unavailability banner
- `client/src/components/layout/ChatLayout.tsx` — TV layout branch with DPAD-navigable panes

## Cross-References

- `docs/native-apps/appletv-feasibility.md` — full feasibility study
- `client/src/api/tvOSHost.ts` — TypeScript bridge client (feature-detects, no-ops elsewhere)
- `client/NATIVE_BUILD.md` — build matrix with tvOS build commands
- `scripts/build_tvos_native.sh` — tvOS build script
