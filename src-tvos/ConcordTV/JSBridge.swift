// JSBridge.swift
// Concord tvOS — bridge protocol and stub implementation.
//
// Defines the 4-function bridge interface between the tvOS SwiftUI
// shell and the Concord server API. Originally designed for
// WKWebView's postMessage bridge, but since WebKit is unavailable
// on tvOS, this protocol will be implemented as direct URLSession
// calls to the Concord API instead.
//
// The TypeScript side (`client/src/api/tvOSHost.ts`) retains the
// same 4-function contract — only the transport changes from
// postMessage to native HTTP.
//
// Implementation status: SCAFFOLD ONLY — protocol defined, stub
// implementation provided. Real logic deferred to post-v0.3.
//
// Reference: docs/native-apps/appletv-feasibility.md §4 (Path C)

import Foundation

// MARK: - Bridge Protocol

/// The 4-function bridge contract between the tvOS native shell and
/// the Concord server.
///
/// On tvOS this is implemented as direct API calls (not postMessage),
/// since WebKit.framework is unavailable on tvOS.
protocol ConcordBridgeProtocol: AnyObject {
    /// Persist the server configuration to UserDefaults.
    ///
    /// Called when the user selects or configures a homeserver in the
    /// server picker. The config is a dictionary with at minimum a
    /// `homeserverUrl` key.
    ///
    /// - Parameter config: Server configuration dictionary.
    func setServerConfig(_ config: [String: Any])

    /// Load the stored server configuration from UserDefaults.
    ///
    /// - Returns: The stored config dictionary, or nil if none is saved.
    func getServerConfig() -> [String: Any]?

    /// Notify the native layer that focus has moved to a new element.
    ///
    /// Used to keep the tvOS UIFocus system in sync with the SwiftUI
    /// navigation state.
    ///
    /// - Parameter elementId: Identifier of the newly focused element.
    func focusChanged(elementId: String)

    /// Open an authentication URL via ASWebAuthenticationSession.
    ///
    /// Delegates OAuth/OIDC flows to the system auth session handler.
    ///
    /// - Parameter url: The full authentication URL to open.
    func openAuthURL(_ url: String)
}

// MARK: - Stub Implementation

/// Stub implementation of the bridge protocol.
///
/// Logs all calls to the console. Replace with real UserDefaults /
/// ASWebAuthenticationSession / URLSession integration when tvOS
/// development begins (post-v0.3).
final class ConcordJSBridge: NSObject, ConcordBridgeProtocol {

    func setServerConfig(_ config: [String: Any]) {
        // TODO(post-v0.3): Persist to UserDefaults.
        print("[ConcordBridge] setServerConfig: \(config)")
    }

    func getServerConfig() -> [String: Any]? {
        // TODO(post-v0.3): Read from UserDefaults.
        print("[ConcordBridge] getServerConfig requested")
        return nil
    }

    func focusChanged(elementId: String) {
        // TODO(post-v0.3): Update UIFocus engine state.
        print("[ConcordBridge] focusChanged: \(elementId)")
    }

    func openAuthURL(_ url: String) {
        // TODO(post-v0.3): Present ASWebAuthenticationSession.
        print("[ConcordBridge] openAuthURL: \(url)")
    }
}
