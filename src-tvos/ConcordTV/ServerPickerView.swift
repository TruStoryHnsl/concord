// ServerPickerView.swift
// Concord tvOS — native server picker for Apple TV.
//
// Since WebKit is unavailable on tvOS, the server picker must be a
// fully native SwiftUI view rather than a webview loading the React
// client's ServerPickerScreen.
//
// This view presents:
//   1. A text field for entering a homeserver URL
//   2. A Connect button that validates the URL and persists the config
//   3. Visual feedback for connection status (idle, connecting, error)
//
// On successful connection, the config is saved via ConcordJSBridge's
// setServerConfig (UserDefaults persistence) and the app navigates
// to the main channel list placeholder.
//
// DPAD navigation: SwiftUI's default focus system handles the text
// field and button automatically on tvOS — no custom focus management
// needed at this level.

import SwiftUI

// MARK: - Connection State

enum ConnectionState {
    case idle
    case connecting
    case connected
    case error(String)
}

// MARK: - Server Picker View

struct ServerPickerView: View {
    @State private var serverURL: String = ""
    @State private var serverName: String = ""
    @State private var connectionState: ConnectionState = .idle
    @FocusState private var isURLFieldFocused: Bool

    /// Bridge instance for persisting the server config.
    private let bridge = ConcordJSBridge()

    /// Called when the user successfully connects to a server.
    var onConnected: (() -> Void)?

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // App branding
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 64))
                .foregroundColor(Color(red: 0x7C/255, green: 0x4D/255, blue: 0xFF/255))

            Text("Concord")
                .font(.largeTitle)
                .fontWeight(.bold)
                .foregroundColor(.white)

            Text("Connect to a homeserver")
                .font(.headline)
                .foregroundColor(.gray)

            // URL input
            VStack(spacing: 16) {
                TextField("Homeserver URL (e.g. https://matrix.example.com)", text: $serverURL)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .padding()
                    .background(Color(red: 0x1D/255, green: 0x20/255, blue: 0x24/255))
                    .cornerRadius(12)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(isURLFieldFocused
                                ? Color(red: 0x7C/255, green: 0x4D/255, blue: 0xFF/255)
                                : Color(red: 0x46/255, green: 0x48/255, blue: 0x4B/255),
                                lineWidth: 2)
                    )
                    .focused($isURLFieldFocused)
                    .autocorrectionDisabled()
                    #if os(tvOS)
                    .keyboardType(.URL)
                    #endif

                TextField("Server name (optional)", text: $serverName)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .padding()
                    .background(Color(red: 0x1D/255, green: 0x20/255, blue: 0x24/255))
                    .cornerRadius(12)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color(red: 0x46/255, green: 0x48/255, blue: 0x4B/255), lineWidth: 2)
                    )
                    .autocorrectionDisabled()
            }
            .frame(maxWidth: 600)

            // Connect button
            Button(action: connectToServer) {
                HStack(spacing: 8) {
                    if case .connecting = connectionState {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .scaleEffect(0.8)
                    }
                    Text(connectButtonLabel)
                        .font(.title3)
                        .fontWeight(.semibold)
                }
                .frame(minWidth: 200, minHeight: 44)
                .padding(.horizontal, 32)
                .padding(.vertical, 12)
                .background(canConnect
                    ? Color(red: 0x7C/255, green: 0x4D/255, blue: 0xFF/255)
                    : Color(red: 0x46/255, green: 0x48/255, blue: 0x4B/255))
                .foregroundColor(.white)
                .cornerRadius(12)
            }
            .disabled(!canConnect)

            // Status message
            if case .error(let message) = connectionState {
                Text(message)
                    .font(.callout)
                    .foregroundColor(Color(red: 0xFF/255, green: 0x71/255, blue: 0x6C/255))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }

            if case .connected = connectionState {
                Text("Connected!")
                    .font(.callout)
                    .foregroundColor(Color(red: 0x08/255, green: 0xC8/255, blue: 0x38/255))
            }

            Spacer()

            // Footer hint
            Text("Use the Siri Remote to type the server address.")
                .font(.caption)
                .foregroundColor(Color(white: 0.5))
                .padding(.bottom, 32)
        }
        .padding(.horizontal, 80)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0x12/255, green: 0x12/255, blue: 0x14/255))
        .onAppear {
            // Check if we have a saved config and auto-connect
            if let config = bridge.getServerConfig(),
               let url = config["homeserverUrl"] as? String,
               !url.isEmpty {
                serverURL = url
                serverName = config["serverName"] as? String ?? ""
                connectToServer()
            }
        }
    }

    // MARK: - Computed Properties

    private var canConnect: Bool {
        guard case .connecting = connectionState else {
            return !serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return false
    }

    private var connectButtonLabel: String {
        switch connectionState {
        case .connecting: return "Connecting..."
        case .connected: return "Connected"
        case .error: return "Retry"
        default: return "Connect"
        }
    }

    // MARK: - Connection Logic

    private func connectToServer() {
        let trimmedURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)

        // Basic URL validation
        guard !trimmedURL.isEmpty else {
            connectionState = .error("Please enter a homeserver URL.")
            return
        }

        // Ensure it looks like a URL
        var finalURL = trimmedURL
        if !finalURL.hasPrefix("http://") && !finalURL.hasPrefix("https://") {
            finalURL = "https://\(finalURL)"
            serverURL = finalURL
        }

        guard URL(string: finalURL) != nil else {
            connectionState = .error("Invalid URL format.")
            return
        }

        connectionState = .connecting

        // Validate the server by hitting /_matrix/client/versions
        // (the standard Matrix endpoint that confirms it's a homeserver)
        validateServer(url: finalURL) { result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    let config: [String: Any] = [
                        "homeserverUrl": finalURL,
                        "serverName": serverName.isEmpty ? finalURL : serverName,
                    ]
                    bridge.setServerConfig(config)
                    connectionState = .connected

                    // Brief delay so the user sees "Connected!" before navigating
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        onConnected?()
                    }

                case .failure(let error):
                    connectionState = .error(error.localizedDescription)
                }
            }
        }
    }

    private func validateServer(url: String, completion: @escaping (Result<Void, Error>) -> Void) {
        guard let versionsURL = URL(string: "\(url)/_matrix/client/versions") else {
            completion(.failure(NSError(domain: "ServerPicker", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Could not construct versions URL.",
            ])))
            return
        }

        var request = URLRequest(url: versionsURL)
        request.timeoutInterval = 10

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(NSError(domain: "ServerPicker", code: -2, userInfo: [
                    NSLocalizedDescriptionKey: "Connection failed: \(error.localizedDescription)",
                ])))
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                completion(.failure(NSError(domain: "ServerPicker", code: -3, userInfo: [
                    NSLocalizedDescriptionKey: "Invalid server response.",
                ])))
                return
            }

            if httpResponse.statusCode == 200 {
                completion(.success(()))
            } else {
                completion(.failure(NSError(domain: "ServerPicker", code: httpResponse.statusCode, userInfo: [
                    NSLocalizedDescriptionKey: "Server returned HTTP \(httpResponse.statusCode). Is this a Matrix homeserver?",
                ])))
            }
        }.resume()
    }
}

#if DEBUG
#Preview {
    ServerPickerView()
}
#endif
