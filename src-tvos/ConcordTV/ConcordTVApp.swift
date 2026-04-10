// ConcordTVApp.swift
// Concord tvOS — SwiftUI app entry point (Path C shell).
//
// Top-level SwiftUI App that drives the Concord Apple TV client.
// Since WebKit is unavailable on tvOS, this is a fully native SwiftUI
// frontend (not a webview wrapper). The app flow is:
//
//   1. ServerPickerView — first-launch server configuration
//   2. MainView (placeholder) — will host channel list + chat
//
// The bridge protocol (JSBridge.swift) persists server config to
// UserDefaults so returning users skip the picker on subsequent launches.

import SwiftUI

@main
struct ConcordTVApp: App {
    @State private var serverConnected = false

    var body: some Scene {
        WindowGroup {
            if serverConnected {
                // Post-connection: show the main UI (channel list placeholder).
                // WebViewHost serves as the placeholder until the native
                // channel list and message view are implemented.
                WebViewHost()
            } else {
                // First launch or no saved config: show the server picker.
                ServerPickerView(onConnected: {
                    serverConnected = true
                })
            }
        }
    }
}
