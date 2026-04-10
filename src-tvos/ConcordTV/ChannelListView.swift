// ChannelListView.swift
// Concord tvOS — native two-column channel list (INS-023).
//
// Replaces the bare "coming soon" placeholder in `WebViewHost` with
// a proper SwiftUI two-pane layout that exercises the tvOS Focus
// Engine correctly. The left pane lists configured servers (right
// now only the one from `ConcordJSBridge.getServerConfig()` since
// the tvOS shell is single-server); the right pane lists a small
// static set of channels so the Focus Engine has real targets to
// navigate between.
//
// This is intentionally NOT a full Matrix client implementation.
// The tvOS track is deferred post-v0.3 per the feasibility study
// (`docs/native-apps/appletv-feasibility.md`), but the shell, the
// server picker, and this channel-list placeholder are all
// scaffolding that real data-loading code can plug into later. The
// job of this view is to:
//
//   1. Present a navigable layout that the Siri Remote can traverse.
//   2. Give the Focus Engine actual focus targets so the "press
//      Menu to go back" behavior works from day one.
//   3. Surface the currently-configured server URL so the user
//      knows which instance they're connected to.
//   4. Honestly communicate the capability gap — voice / video
//      channels are not available on tvOS because WebRTC is absent
//      from tvOS's WebKit (and there is no WebKit on tvOS at all
//      for our Path C shell anyway).
//
// Layout direction:
//   - Dark theme (#121214 background) matching the rest of the
//     Concord design system.
//   - 10-foot type scale (48pt+ for primary items, 32pt+ for
//     secondary) to match the `html[data-tv="true"]` rules in
//     `client/src/styles/tv.css`.
//   - Generous vertical spacing (24pt+ between rows) so the focus
//     ring does not crowd neighbouring items at full HD / 4K.

import SwiftUI

// MARK: - Channel model

/// Minimal placeholder channel model used by the static list below.
/// When real data loading lands, this struct is the join point — it
/// matches the fields the React client's `ChannelSidebar` consumes
/// so the same downstream logic can be reused.
struct TVChannel: Identifiable, Hashable {
    let id: String
    let name: String
    /// Either `.text` or `.voice`. The voice variant is always
    /// shown as unavailable on tvOS; the row is still focusable so
    /// the user can select it and see the explanation.
    let kind: Kind

    enum Kind {
        case text
        case voice
    }

    /// Three-channel static seed list. Real implementations should
    /// replace this with a `URLSession` fetch against the Concord
    /// API's `/api/servers/{id}/channels` endpoint.
    static let placeholder: [TVChannel] = [
        TVChannel(id: "general", name: "general", kind: .text),
        TVChannel(id: "announcements", name: "announcements", kind: .text),
        TVChannel(id: "voice-lobby", name: "Voice Lobby", kind: .voice),
    ]
}

// MARK: - Channel list view

/// Two-column SwiftUI view: servers on the left, channels on the
/// right. Used by `WebViewHost` as the post-connect main screen.
struct ChannelListView: View {
    /// Bridge handle for reading the stored server config. The view
    /// reads once at init time because the tvOS shell has no reactive
    /// server-config stream yet — on reconnect the whole view tree
    /// is rebuilt via `serverConnected` in `ConcordTVApp`.
    private let bridge: ConcordBridgeProtocol

    /// Resolved server display name for the left pane. Computed from
    /// the persisted config with a fallback to the host URL.
    private let serverDisplayName: String

    /// Explicit focus state for the first focusable row so the tvOS
    /// Focus Engine has a deterministic landing target when the view
    /// first appears.
    @FocusState private var focusedChannelID: String?

    init(bridge: ConcordBridgeProtocol = ConcordJSBridge()) {
        self.bridge = bridge
        if let config = bridge.getServerConfig() {
            let name = (config["serverName"] as? String)
                ?? (config["homeserverUrl"] as? String)
                ?? "Unknown server"
            self.serverDisplayName = name
        } else {
            self.serverDisplayName = "Not connected"
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            // Left pane — server list. Single entry for now, wrapped
            // in a List so the Focus Engine's default scrolling
            // behaviour kicks in when real multi-server support
            // lands.
            VStack(alignment: .leading, spacing: 24) {
                Text("Servers")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(Color(white: 0.7))
                    .padding(.horizontal, 32)
                    .padding(.top, 48)

                Button(action: {}) {
                    HStack(spacing: 16) {
                        Image(systemName: "server.rack")
                            .font(.system(size: 28))
                            .foregroundColor(Color(
                                red: 0xA4/255,
                                green: 0xA5/255,
                                blue: 0xFF/255
                            ))
                        Text(serverDisplayName)
                            .font(.system(size: 26, weight: .medium))
                            .foregroundColor(.white)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                #if os(tvOS)
                .buttonStyle(.card)
                #endif
                .padding(.horizontal, 16)

                Spacer()
            }
            .frame(width: 420)
            .background(Color(
                red: 0x17/255,
                green: 0x1A/255,
                blue: 0x1D/255
            ))

            // Right pane — channel list. Three static rows today.
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Channels")
                        .font(.system(size: 36, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                    Text("placeholder — real fetch pending")
                        .font(.system(size: 18, weight: .regular))
                        .foregroundColor(Color(white: 0.45))
                }
                .padding(.horizontal, 48)
                .padding(.top, 48)
                .padding(.bottom, 32)

                ScrollView {
                    VStack(spacing: 16) {
                        ForEach(TVChannel.placeholder) { channel in
                            channelRow(channel)
                        }
                    }
                    .padding(.horizontal, 48)
                }

                Spacer()

                Text("Press Menu to return to the server picker.")
                    .font(.system(size: 20, weight: .regular))
                    .foregroundColor(Color(white: 0.5))
                    .padding(.bottom, 48)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(
            red: 0x12/255,
            green: 0x12/255,
            blue: 0x14/255
        ))
        .ignoresSafeArea()
        .onAppear {
            // Pick the first focusable channel as the initial focus
            // target so DPAD navigation starts in a predictable spot.
            focusedChannelID = TVChannel.placeholder.first?.id
        }
    }

    /// A single channel row — Focus-Engine navigable button with a
    /// text/voice icon, the channel name, and (for voice) a
    /// capability-unavailable label.
    @ViewBuilder
    private func channelRow(_ channel: TVChannel) -> some View {
        Button(action: {
            bridge.focusChanged(elementId: "channel:\(channel.id)")
        }) {
            HStack(spacing: 20) {
                Image(systemName: iconName(for: channel))
                    .font(.system(size: 28))
                    .foregroundColor(iconColor(for: channel))
                Text(channel.name)
                    .font(.system(size: 28, weight: .medium))
                    .foregroundColor(.white)
                Spacer()
                if channel.kind == .voice {
                    Text("unavailable on Apple TV")
                        .font(.system(size: 18, weight: .regular))
                        .foregroundColor(Color(
                            red: 0xFF/255,
                            green: 0xA8/255,
                            blue: 0xA3/255
                        ))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color(
                            red: 0xD7/255,
                            green: 0x38/255,
                            blue: 0x3B/255
                        ).opacity(0.15))
                        .cornerRadius(6)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        #if os(tvOS)
        .buttonStyle(.card)
        #endif
        .focusable(true)
        .focused($focusedChannelID, equals: channel.id)
    }

    private func iconName(for channel: TVChannel) -> String {
        switch channel.kind {
        case .text:
            return "number"
        case .voice:
            return "speaker.wave.2"
        }
    }

    private func iconColor(for channel: TVChannel) -> Color {
        switch channel.kind {
        case .text:
            return Color(white: 0.7)
        case .voice:
            return Color(red: 0xFF/255, green: 0xA8/255, blue: 0xA3/255)
        }
    }
}

#if DEBUG
#Preview {
    ChannelListView()
}
#endif
