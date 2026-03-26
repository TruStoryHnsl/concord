// WebSocket handler module.
//
// Bridges browser WebSocket clients to the libp2p mesh network.
// Each connected guest gets a dedicated task pair:
//   1. Read from WS -> publish to mesh via NodeHandle
//   2. Read from mesh events (broadcast::Receiver) -> send to WS

use std::sync::Arc;

use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use concord_net::events::NetworkEvent;
use concord_net::node::NodeHandle;

use crate::auth::GuestAuthManager;
use crate::server::WebhostAppState;

// ── Client -> Server messages ──────────────────────────────────────

/// Messages sent from browser guests to the server over WebSocket.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ClientMessage {
    /// Authenticate with a session token.
    Authenticate {
        token: String,
    },
    /// Send a chat message to a channel.
    SendMessage {
        #[serde(rename = "channelId")]
        channel_id: String,
        content: String,
    },
    /// Subscribe to events on a topic.
    Subscribe {
        topic: String,
    },
    /// Ping (keepalive).
    Ping,
}

// ── Server -> Client messages ──────────────────────────────────────

/// Messages sent from the server to browser guests over WebSocket.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(dead_code)]
enum ServerMessage {
    /// Authentication succeeded.
    Authenticated {
        #[serde(rename = "guestId")]
        guest_id: String,
    },
    /// A new chat message arrived.
    NewMessage {
        id: String,
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "senderId")]
        sender_id: String,
        content: String,
        timestamp: i64,
    },
    /// A peer was discovered.
    PeerDiscovered {
        #[serde(rename = "peerId")]
        peer_id: String,
    },
    /// A peer departed.
    PeerDeparted {
        #[serde(rename = "peerId")]
        peer_id: String,
    },
    /// Connection status update.
    ConnectionStatus {
        #[serde(rename = "connectedPeers")]
        connected_peers: usize,
    },
    /// An error occurred.
    Error {
        message: String,
    },
    /// Pong (keepalive response).
    Pong,
}

// ── WebSocket upgrade handler ──────────────────────────────────────

/// Axum handler that upgrades an HTTP request to a WebSocket connection.
pub async fn ws_upgrade_handler(
    ws: WebSocketUpgrade,
    State(state): State<WebhostAppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| {
        handle_connection(
            socket,
            state.node_handle.clone(),
            state.event_sender.subscribe(),
            state.auth.clone(),
        )
    })
}

/// Handle a single WebSocket connection lifecycle.
async fn handle_connection(
    socket: WebSocket,
    node: NodeHandle,
    mut events: broadcast::Receiver<NetworkEvent>,
    auth: Arc<GuestAuthManager>,
) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // The guest must authenticate as their first message.
    let guest_id = loop {
        match ws_receiver.next().await {
            Some(Ok(WsMessage::Text(text))) => {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Authenticate { token }) => {
                        if let Some(session) = auth.validate_session(&token).await {
                            let msg = ServerMessage::Authenticated {
                                guest_id: session.guest_id.clone(),
                            };
                            if let Ok(json) = serde_json::to_string(&msg) {
                                let _ = ws_sender.send(WsMessage::Text(json.into())).await;
                            }
                            info!(guest = %session.display_name, "guest authenticated via WS");
                            break session.guest_id;
                        } else {
                            let msg = ServerMessage::Error {
                                message: "invalid session token".to_string(),
                            };
                            if let Ok(json) = serde_json::to_string(&msg) {
                                let _ = ws_sender.send(WsMessage::Text(json.into())).await;
                            }
                            // Give them another chance.
                        }
                    }
                    Ok(_) => {
                        let msg = ServerMessage::Error {
                            message: "authenticate first".to_string(),
                        };
                        if let Ok(json) = serde_json::to_string(&msg) {
                            let _ = ws_sender.send(WsMessage::Text(json.into())).await;
                        }
                    }
                    Err(_) => {
                        let msg = ServerMessage::Error {
                            message: "invalid message format".to_string(),
                        };
                        if let Ok(json) = serde_json::to_string(&msg) {
                            let _ = ws_sender.send(WsMessage::Text(json.into())).await;
                        }
                    }
                }
            }
            Some(Ok(WsMessage::Close(_))) | None => {
                debug!("WS client disconnected before authenticating");
                return;
            }
            _ => {
                // Binary / ping / pong frames — ignore during auth phase.
            }
        }
    };

    debug!(guest_id = %guest_id, "WS connection authenticated, starting bridge");

    // Two concurrent tasks: inbound (WS -> mesh) and outbound (mesh -> WS).
    let node_clone = node.clone();
    let guest_id_clone = guest_id.clone();

    tokio::select! {
        // Inbound: read from WebSocket, dispatch to mesh.
        _ = async {
            while let Some(Ok(msg)) = ws_receiver.next().await {
                match msg {
                    WsMessage::Text(text) => {
                        match serde_json::from_str::<ClientMessage>(&text) {
                            Ok(ClientMessage::SendMessage { channel_id, content }) => {
                                // Build a Concord message and publish it.
                                let message = concord_core::types::Message {
                                    id: uuid_v4(),
                                    channel_id: channel_id.clone(),
                                    sender_id: guest_id_clone.clone(),
                                    content: content.clone(),
                                    timestamp: chrono::Utc::now(),
                                    signature: Vec::new(), // guests don't sign
                                    alias_id: None,
                                    alias_name: None,
                                };

                                match concord_core::wire::encode(&message) {
                                    Ok(data) => {
                                        let topic = format!("concord/guest/{channel_id}");
                                        if let Err(e) = node_clone.publish(&topic, data).await {
                                            warn!(%e, "failed to publish guest message");
                                        }
                                    }
                                    Err(e) => {
                                        warn!(%e, "failed to encode guest message");
                                    }
                                }
                            }
                            Ok(ClientMessage::Subscribe { topic }) => {
                                if let Err(e) = node_clone.subscribe(&topic).await {
                                    warn!(%topic, %e, "guest subscribe failed");
                                }
                            }
                            Ok(ClientMessage::Ping) => {
                                // Handled inline — nothing extra needed.
                            }
                            Ok(ClientMessage::Authenticate { .. }) => {
                                // Already authenticated — ignore.
                            }
                            Err(e) => {
                                debug!(%e, "failed to parse client message");
                            }
                        }
                    }
                    WsMessage::Close(_) => break,
                    _ => {}
                }
            }
        } => {
            debug!(guest_id = %guest_id, "WS inbound loop ended");
        },
        // Outbound: read from mesh events, push to WebSocket.
        _ = async {
            loop {
                match events.recv().await {
                    Ok(event) => {
                        let server_msg = match event {
                            NetworkEvent::ConcordMessageReceived { message } => {
                                Some(ServerMessage::NewMessage {
                                    id: message.id,
                                    channel_id: message.channel_id,
                                    sender_id: message.sender_id,
                                    content: message.content,
                                    timestamp: message.timestamp.timestamp_millis(),
                                })
                            }
                            NetworkEvent::PeerDiscovered { peer_id, .. } => {
                                Some(ServerMessage::PeerDiscovered { peer_id })
                            }
                            NetworkEvent::PeerDeparted { peer_id } => {
                                Some(ServerMessage::PeerDeparted { peer_id })
                            }
                            NetworkEvent::ConnectionStatusChanged { connected_peers } => {
                                Some(ServerMessage::ConnectionStatus { connected_peers })
                            }
                            _ => None,
                        };

                        if let Some(msg) = server_msg {
                            match serde_json::to_string(&msg) {
                                Ok(json) => {
                                    if ws_sender.send(WsMessage::Text(json.into())).await.is_err() {
                                        break;
                                    }
                                }
                                Err(e) => {
                                    warn!(%e, "failed to serialize server message");
                                }
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!(n, "guest WS event receiver lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
        } => {
            debug!(guest_id = %guest_id, "WS outbound loop ended");
        },
    }

    info!(guest_id = %guest_id, "guest WS connection closed");
}

/// Generate a simple UUID-v4-like string.
fn uuid_v4() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: [u8; 16] = rng.r#gen();
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

