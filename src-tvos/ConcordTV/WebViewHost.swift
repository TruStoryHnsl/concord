// WebViewHost.swift
// Concord tvOS — WKWebView host view.
//
// Wraps a full-screen WKWebView that loads the Concord client bundle.
// On tvOS the webview receives DPAD focus events bridged from the
// native UIFocus system via the JSBridge.
//
// Implementation status: SCAFFOLD ONLY — structure and protocol
// defined, actual WKWebView instantiation deferred to post-v0.3.

import SwiftUI
import WebKit

/// SwiftUI view that hosts the WKWebView for the Concord client.
///
/// The view is responsible for:
///   1. Creating and configuring the WKWebView with the JS bridge
///   2. Loading the client/dist bundle (either from app resources or
///      from a server URL resolved via the server picker)
///   3. Translating tvOS UIFocus events into JS bridge calls so the
///      web bundle's `useDpadNav` hook receives DOM focus events
struct WebViewHost: View {
    var body: some View {
        // TODO(post-v0.3): Replace with UIViewRepresentable wrapping
        // a WKWebView configured with the ConcordJSBridge handlers.
        Text("Concord tvOS — WebView host placeholder")
            .foregroundColor(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(red: 0x12/255, green: 0x12/255, blue: 0x14/255))
    }
}

// MARK: - WKWebView Configuration (deferred)

/// Creates a WKWebViewConfiguration with the Concord JS bridge
/// message handlers installed.
///
/// Call this when instantiating the WKWebView to register the 4
/// bridge functions that `client/src/api/tvOSHost.ts` expects:
///   - concordSetServerConfig
///   - concordGetServerConfig
///   - concordFocusChanged
///   - concordOpenAuthURL
///
/// TODO(post-v0.3): Implement this function.
// func makeConcordWebViewConfig() -> WKWebViewConfiguration {
//     let config = WKWebViewConfiguration()
//     let bridge = ConcordJSBridge()
//     let controller = config.userContentController
//     controller.add(bridge, name: "concordSetServerConfig")
//     controller.add(bridge, name: "concordGetServerConfig")
//     controller.add(bridge, name: "concordFocusChanged")
//     controller.add(bridge, name: "concordOpenAuthURL")
//     return config
// }

#if DEBUG
#Preview {
    WebViewHost()
}
#endif
