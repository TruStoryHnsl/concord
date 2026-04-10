// ConcordTVApp.swift
// Concord tvOS — SwiftUI app entry point (Path C shell).
//
// This is the top-level SwiftUI App that hosts the Concord web client
// inside a full-screen WKWebView. The web bundle loaded is the same
// `client/dist` output shipped in all other Concord platforms.
//
// Implementation status: SCAFFOLD ONLY — structure committed, logic
// deferred to post-v0.3 per the feasibility study at
// docs/native-apps/appletv-feasibility.md.

import SwiftUI

@main
struct ConcordTVApp: App {
    var body: some Scene {
        WindowGroup {
            WebViewHost()
        }
    }
}
