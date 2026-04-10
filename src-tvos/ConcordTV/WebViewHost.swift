// WebViewHost.swift
// Concord tvOS — web content host view.
//
// Hosts the Concord client UI on Apple TV. The tvOS SDK does NOT
// include WebKit.framework (WKWebView is API_UNAVAILABLE(tvos)),
// so the production path will either:
//   (a) use JavaScriptCore + TVMLKit for a TVML-based shell, or
//   (b) use a native SwiftUI frontend that talks directly to the
//       Concord server API (no webview at all).
//
// The feasibility study (docs/native-apps/appletv-feasibility.md)
// assumed WKWebView was available on tvOS — this scaffold corrects
// that assumption. Path C is revised: SwiftUI-native frontend
// backed by URLSession against the Concord API, not a webview shell.
//
// Implementation status: SCAFFOLD ONLY — placeholder UI committed,
// real implementation deferred to post-v0.3.

import SwiftUI

/// SwiftUI view that will host the Concord client UI on Apple TV.
///
/// The view is responsible for:
///   1. Presenting the server picker on first launch
///   2. Rendering chat channels, messages, and settings natively
///   3. Handling tvOS focus/DPAD navigation via the UIFocus system
///
/// Since WebKit is unavailable on tvOS, this will be a native SwiftUI
/// frontend — not a webview wrapper. The JS bridge protocol in
/// JSBridge.swift is retained as the interface contract for the
/// TypeScript side (tvOSHost.ts), which will be adapted to use
/// URLSession-backed native calls instead of postMessage.
struct WebViewHost: View {
    var body: some View {
        // TODO(post-v0.3): Replace with the native SwiftUI Concord
        // client (server picker → channel list → message view).
        VStack(spacing: 16) {
            Image(systemName: "tv")
                .font(.system(size: 80))
                .foregroundColor(Color(red: 0x7C/255, green: 0x4D/255, blue: 0xFF/255))
            Text("Concord")
                .font(.largeTitle)
                .fontWeight(.bold)
                .foregroundColor(.white)
            Text("Apple TV")
                .font(.headline)
                .foregroundColor(.gray)
            Text("Connect to a server to get started.")
                .font(.subheadline)
                .foregroundColor(.gray)
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0x12/255, green: 0x12/255, blue: 0x14/255))
    }
}

#if DEBUG
#Preview {
    WebViewHost()
}
#endif
