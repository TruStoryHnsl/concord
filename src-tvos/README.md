# Concord tvOS (Apple TV) — Path C SwiftUI Shell

**Status:** SCAFFOLD ONLY — project structure committed, implementation deferred to post-v0.3.

This directory contains the tvOS Xcode project for Concord's Apple TV client. It follows **Path C** from the feasibility study (`docs/native-apps/appletv-feasibility.md`): a standalone SwiftUI app that hosts a full-screen WKWebView loading the same `client/dist` web bundle shipped by all other Concord platforms.

## Architecture

```
src-tvos/
  ConcordTV.xcodeproj/     — Xcode project (tvOS 17.0+, Swift 5)
  ConcordTV/
    ConcordTVApp.swift      — @main SwiftUI App entry point
    WebViewHost.swift       — WKWebView host view (UIViewRepresentable)
    JSBridge.swift          — 4-function JS bridge protocol + stub
    Info.plist              — tvOS-specific plist keys
    ConcordTV.entitlements  — Keychain + multicast entitlements
```

## JS Bridge API (4 functions)

The bridge is exposed to JavaScript via `window.webkit.messageHandlers.<name>.postMessage(body)`. The TypeScript client module at `client/src/api/tvOSHost.ts` wraps these with typed functions that no-op on non-tvOS platforms.

| Handler name | Direction | Purpose |
|---|---|---|
| `concordSetServerConfig` | JS -> Native | Persist server config to UserDefaults |
| `concordGetServerConfig` | JS -> Native -> JS | Load config, respond via callback |
| `concordFocusChanged` | JS -> Native | Sync DOM focus with UIFocus system |
| `concordOpenAuthURL` | JS -> Native | Delegate OAuth to ASWebAuthenticationSession |

## Known Capability Gaps

These Concord features are **not available** on tvOS (any implementation path):

- **Voice channels** — tvOS WebKit lacks full WebRTC; receive-only at best
- **Video channels** — same constraint; view-only
- **Camera / photo picker** — no camera hardware on Apple TV
- **File uploads** — no filesystem picker on tvOS
- **Peer discovery mesh** — mDNS bridge is non-trivial; v0.1 uses manual server picker

## When to Begin Implementation

Per the feasibility study, tvOS implementation should not begin until:

1. Apple Developer Program enrollment is active (same team as iOS)
2. iOS bundle is shipping to TestFlight
3. Concord reaches v0.3 or later
4. Re-verify this feasibility study — WebKit on tvOS may have added WebRTC

## Cross-References

- `docs/native-apps/appletv-feasibility.md` — full feasibility study
- `client/src/api/tvOSHost.ts` — TypeScript bridge client (feature-detects, no-ops elsewhere)
- `client/src/hooks/usePlatform.ts` — `isAppleTV` detection flag
- `client/src/hooks/useDpadNav.ts` — DPAD focus navigation (consumed by the bridge)
- `client/NATIVE_BUILD.md` — build matrix with tvOS status
