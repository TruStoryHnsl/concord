// WebViewHost.swift
// Concord tvOS — post-server-picker main shell.
//
// This view is shown after the user connects to a homeserver via
// ServerPickerView. As of INS-023 it composes `ChannelListView`
// (two-column native channel browser) rather than a bare "coming
// soon" placeholder.
//
// The tvOS SDK does NOT include WebKit.framework, so the production
// Concord tvOS client is a fully native SwiftUI frontend that talks
// directly to the Concord/Matrix API via URLSession — not a webview.
// The name `WebViewHost` is retained from the earlier scaffolding
// sprint for continuity with the feasibility doc's terminology; its
// role today is "the container view the App roots into after the
// picker flow succeeds", not literally a WKWebView wrapper (that
// was Path B and was rejected).
//
// Implementation status:
//   - Server list + placeholder channel list: SHIPPED (this sprint).
//   - Real /api/servers fetch, message list, settings: deferred to
//     the post-v0.3 tvOS track per
//     `docs/native-apps/appletv-feasibility.md`.

import SwiftUI

/// Post-connection main view for the Concord tvOS app.
///
/// Composes the shared `ChannelListView` (two-column layout) so the
/// Focus Engine has real targets to navigate between. The user can
/// return to the server picker via the Siri Remote Menu button,
/// which unmounts this view via `ConcordTVApp`'s `serverConnected`
/// state flip.
struct WebViewHost: View {
    var body: some View {
        ChannelListView()
    }
}

#if DEBUG
#Preview {
    WebViewHost()
}
#endif
