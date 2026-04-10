// JSBridge.swift
// Concord tvOS — JavaScript bridge protocol and stub implementation.
//
// Defines the 4-function bridge interface between the tvOS SwiftUI
// shell and the Concord web client running in WKWebView. The web
// side (`client/src/api/tvOSHost.ts`) calls these via
// `window.webkit.messageHandlers.<name>.postMessage(body)`.
//
// Implementation status: SCAFFOLD ONLY — protocol defined, stub
// implementation provided. Real logic deferred to post-v0.3.
//
// Reference: docs/native-apps/appletv-feasibility.md §4 (Path C)

import Foundation
import WebKit

// MARK: - Bridge Protocol

/// The 4-function bridge contract between the tvOS native shell and
/// the Concord web client bundle.
///
/// Each function corresponds to a WKScriptMessageHandler name:
///   - `concordSetServerConfig` → `setServerConfig(_:)`
///   - `concordGetServerConfig` → `getServerConfig(callbackName:webView:)`
///   - `concordFocusChanged`    → `focusChanged(elementId:)`
///   - `concordOpenAuthURL`     → `openAuthURL(_:)`
protocol ConcordBridgeProtocol: AnyObject {
    /// Persist the server configuration to UserDefaults.
    ///
    /// Called when the user selects or configures a homeserver in the
    /// server picker. The config is a JSON object with at minimum a
    /// `homeserverUrl` key.
    ///
    /// - Parameter config: Dictionary decoded from the JS message body.
    func setServerConfig(_ config: [String: Any])

    /// Load the stored server configuration from UserDefaults and
    /// deliver it back to JavaScript via a named callback.
    ///
    /// The JS side registers `window[callbackName]` as a one-shot
    /// callback. The native side evaluates
    /// `window[callbackName](jsonPayload)` on the webview to deliver
    /// the response.
    ///
    /// - Parameters:
    ///   - callbackName: The JS global function name to invoke with the result.
    ///   - webView: The WKWebView to evaluate the callback script on.
    func getServerConfig(callbackName: String, webView: WKWebView)

    /// Notify the native layer that DOM focus has moved to a new element.
    ///
    /// Used to keep the tvOS UIFocus system in sync with the web
    /// bundle's roving tabindex managed by `useDpadNav.ts`.
    ///
    /// - Parameter elementId: The `id` attribute of the newly focused DOM element.
    func focusChanged(elementId: String)

    /// Open an authentication URL via ASWebAuthenticationSession.
    ///
    /// Delegates OAuth/OIDC flows to the system auth session handler,
    /// which presents a modal browser sheet and handles the redirect
    /// back to the app.
    ///
    /// - Parameter url: The full authentication URL to open.
    func openAuthURL(_ url: String)
}

// MARK: - Stub Implementation

/// Stub implementation of the bridge protocol.
///
/// Logs all calls to the console. Replace with real UserDefaults /
/// ASWebAuthenticationSession integration when tvOS development
/// begins (post-v0.3).
final class ConcordJSBridge: NSObject, ConcordBridgeProtocol {

    func setServerConfig(_ config: [String: Any]) {
        // TODO(post-v0.3): Persist to UserDefaults.
        print("[ConcordJSBridge] setServerConfig: \(config)")
    }

    func getServerConfig(callbackName: String, webView: WKWebView) {
        // TODO(post-v0.3): Read from UserDefaults, serialize to JSON,
        // evaluate `window[callbackName](json)` on the webView.
        print("[ConcordJSBridge] getServerConfig requested (callback: \(callbackName))")
    }

    func focusChanged(elementId: String) {
        // TODO(post-v0.3): Update UIFocus engine state.
        print("[ConcordJSBridge] focusChanged: \(elementId)")
    }

    func openAuthURL(_ url: String) {
        // TODO(post-v0.3): Present ASWebAuthenticationSession.
        print("[ConcordJSBridge] openAuthURL: \(url)")
    }
}

// MARK: - WKScriptMessageHandler (deferred)

/// When the bridge is wired up, this extension will route incoming
/// WKScriptMessage calls to the appropriate protocol method based on
/// the message handler name.
///
/// TODO(post-v0.3): Uncomment and implement.
// extension ConcordJSBridge: WKScriptMessageHandler {
//     func userContentController(
//         _ userContentController: WKUserContentController,
//         didReceive message: WKScriptMessage
//     ) {
//         guard let body = message.body as? [String: Any] else { return }
//
//         switch message.name {
//         case "concordSetServerConfig":
//             setServerConfig(body)
//         case "concordGetServerConfig":
//             if let callbackName = body["callbackName"] as? String,
//                let webView = message.webView {
//                 getServerConfig(callbackName: callbackName, webView: webView)
//             }
//         case "concordFocusChanged":
//             if let elementId = body["elementId"] as? String {
//                 focusChanged(elementId: elementId)
//             }
//         case "concordOpenAuthURL":
//             if let url = body["url"] as? String {
//                 openAuthURL(url)
//             }
//         default:
//             print("[ConcordJSBridge] unknown message: \(message.name)")
//         }
//     }
// }
