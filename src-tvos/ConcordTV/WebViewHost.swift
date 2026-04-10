// WebViewHost.swift
// Concord tvOS — main content placeholder (post-server-picker).
//
// This view is shown after the user connects to a homeserver via
// ServerPickerView. It serves as the placeholder for the native
// SwiftUI channel list and message view that will be implemented
// in a future sprint.
//
// The tvOS SDK does NOT include WebKit.framework, so the production
// Concord tvOS client is a fully native SwiftUI frontend that talks
// directly to the Concord/Matrix API via URLSession — not a webview.
//
// Implementation status: PLACEHOLDER — shows connected server info
// and a "coming soon" message. Real channel list + message view
// will be implemented when the tvOS track becomes active.

import SwiftUI

/// Post-connection main view for the Concord tvOS app.
///
/// Responsibilities (when fully implemented):
///   1. Display the channel list from the connected homeserver
///   2. Render messages in the selected channel
///   3. Handle DPAD navigation via the tvOS UIFocus system
///   4. Show settings and server management options
struct WebViewHost: View {
    private let bridge = ConcordJSBridge()

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "checkmark.circle")
                .font(.system(size: 64))
                .foregroundColor(Color(red: 0x08/255, green: 0xC8/255, blue: 0x38/255))

            Text("Concord")
                .font(.largeTitle)
                .fontWeight(.bold)
                .foregroundColor(.white)

            // Show connected server URL from persisted config
            if let config = bridge.getServerConfig(),
               let serverName = config["serverName"] as? String ?? config["homeserverUrl"] as? String {
                Text("Connected to \(serverName)")
                    .font(.headline)
                    .foregroundColor(Color(red: 0xA4/255, green: 0xA5/255, blue: 0xFF/255))
            }

            Text("Apple TV")
                .font(.headline)
                .foregroundColor(.gray)

            VStack(spacing: 8) {
                Text("Channel list and messaging coming soon.")
                    .font(.subheadline)
                    .foregroundColor(.gray)

                Text("Voice and video channels are not available on Apple TV.")
                    .font(.caption)
                    .foregroundColor(Color(red: 0xFF/255, green: 0xA8/255, blue: 0xA3/255))
            }
            .padding(.top, 16)

            Spacer()

            Text("Press Menu to return to the server picker.")
                .font(.caption)
                .foregroundColor(Color(white: 0.5))
                .padding(.bottom, 32)
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
