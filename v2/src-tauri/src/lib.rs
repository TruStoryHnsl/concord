mod commands;
pub mod events;

use std::sync::{Arc, Mutex};

use concord_core::config::NodeConfig;
use concord_core::identity::Keypair;
use concord_core::types::NodeType;
use concord_net::events::NetworkEvent;
use concord_net::node::{Node, NodeHandle};
use concord_store::Database;
use concord_webhost::WebhostHandle;
use tauri::{Emitter, Manager};
use tokio::sync::broadcast;
use tracing::{error, info, warn};

/// Shared application state managed by Tauri.
pub struct AppState {
    pub node: NodeHandle,
    pub db: Arc<Mutex<Database>>,
    pub peer_id: String,
    pub display_name: String,
    pub keypair: Keypair,
    pub event_sender: broadcast::Sender<NetworkEvent>,
}

/// State for the optional webhost server.
pub struct WebhostState {
    pub handle: Mutex<Option<WebhostHandle>>,
}

/// Default GossipSub topic for the mesh.
const DEFAULT_TOPIC: &str = "concord/mesh/general";

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter("concord_app=debug,concord_net=debug,concord_store=info,tauri=info")
        .init();

    info!("Starting Concord v2");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Resolve data directory using Tauri's path API.
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("./concord-data"));

            std::fs::create_dir_all(&data_dir)?;

            info!(?data_dir, "using data directory");

            // 1. Open the SQLite database.
            let db_path = data_dir.join("concord.db");
            let db = Database::open(&db_path)
                .map_err(|e| anyhow::anyhow!("failed to open database: {e}"))?;

            // 2. Load or generate identity.
            let (display_name, keypair) = match db.load_identity() {
                Ok(Some((name, kp))) => {
                    info!(%name, "loaded existing identity");
                    // Ensure at least one alias exists (migration for existing identities)
                    let aliases = db.get_aliases(&kp.peer_id())
                        .map_err(|e| anyhow::anyhow!("failed to get aliases: {e}"))?;
                    if aliases.is_empty() {
                        let default_alias = concord_core::types::Alias {
                            id: uuid::Uuid::new_v4().to_string(),
                            root_identity: kp.peer_id(),
                            display_name: name.clone(),
                            avatar_seed: uuid::Uuid::new_v4().to_string(),
                            created_at: chrono::Utc::now(),
                            is_active: true,
                        };
                        db.create_alias(&default_alias)
                            .map_err(|e| anyhow::anyhow!("failed to create default alias: {e}"))?;
                        info!("created default alias for existing identity");
                    }
                    (name, kp)
                }
                Ok(None) => {
                    let kp = Keypair::generate();
                    let name = format!("Node-{}", &kp.peer_id()[..8]);
                    db.save_identity(&name, &kp)
                        .map_err(|e| anyhow::anyhow!("failed to save identity: {e}"))?;
                    // Auto-create a default alias for the new identity
                    let default_alias = concord_core::types::Alias {
                        id: uuid::Uuid::new_v4().to_string(),
                        root_identity: kp.peer_id(),
                        display_name: name.clone(),
                        avatar_seed: uuid::Uuid::new_v4().to_string(),
                        created_at: chrono::Utc::now(),
                        is_active: true,
                    };
                    db.create_alias(&default_alias)
                        .map_err(|e| anyhow::anyhow!("failed to create default alias: {e}"))?;
                    info!(%name, "generated new identity with default alias");
                    (name, kp)
                }
                Err(e) => {
                    return Err(anyhow::anyhow!("failed to load identity: {e}").into());
                }
            };

            let db = Arc::new(Mutex::new(db));

            // 3. Create the NodeConfig.
            let config = NodeConfig {
                display_name: display_name.clone(),
                node_type: NodeType::User,
                listen_port: 0, // OS picks an available port
                enable_mdns: true,
                enable_dht: true,
                data_dir: data_dir.clone(),
                bootstrap_peers: Vec::new(),
                enable_relay_server: false,
                enable_relay_client: true,
            };

            // 4. Create the Node asynchronously. We use block_on here because
            //    Tauri's setup closure is synchronous.
            let (node, handle, event_sender, event_rx) = tauri::async_runtime::block_on(async {
                Node::new(&config).await
            })
            .map_err(|e| anyhow::anyhow!("failed to create node: {e}"))?;

            let peer_id = handle.peer_id().to_string();
            info!(%peer_id, "node created");

            // 5. Subscribe to the default mesh topic and all joined server channels.
            {
                let handle_clone = handle.clone();
                let db_clone = Arc::clone(&db);
                let peer_id_clone = peer_id.clone();
                tauri::async_runtime::spawn(async move {
                    // Subscribe to default mesh topic
                    if let Err(e) = handle_clone.subscribe(DEFAULT_TOPIC).await {
                        error!(%e, "failed to subscribe to default topic");
                    } else {
                        info!(topic = DEFAULT_TOPIC, "subscribed to default topic");
                    }

                    // Auto-subscribe to all channels for servers the user has joined
                    let servers_and_channels = {
                        let db = match db_clone.lock() {
                            Ok(db) => db,
                            Err(e) => {
                                error!(%e, "failed to lock db for auto-subscribe");
                                return;
                            }
                        };
                        let servers = match db.get_user_servers(&peer_id_clone) {
                            Ok(s) => s,
                            Err(e) => {
                                error!(%e, "failed to query user servers for auto-subscribe");
                                return;
                            }
                        };
                        let mut result = Vec::new();
                        for server in &servers {
                            match db.get_channels(&server.id) {
                                Ok(channels) => {
                                    for ch in channels {
                                        result.push((server.id.clone(), ch.id.clone()));
                                    }
                                }
                                Err(e) => {
                                    warn!(server_id = %server.id, %e, "failed to get channels for auto-subscribe");
                                }
                            }
                        }
                        result
                    };

                    for (server_id, channel_id) in &servers_and_channels {
                        let topic = format!("concord/{server_id}/{channel_id}");
                        if let Err(e) = handle_clone.subscribe(&topic).await {
                            warn!(%server_id, %channel_id, %e, "failed to auto-subscribe to channel topic");
                        }
                    }

                    if !servers_and_channels.is_empty() {
                        info!(
                            count = servers_and_channels.len(),
                            "auto-subscribed to server channel topics"
                        );
                    }
                });
            }

            // 6. Spawn the Node event loop.
            tauri::async_runtime::spawn(async move {
                node.run().await;
            });

            // 7. Spawn the event forwarding task.
            let db_for_events = Arc::clone(&db);
            spawn_event_forwarder(app_handle, event_rx, db_for_events);

            // 8. Store AppState as managed state.
            let state = AppState {
                node: handle,
                db,
                peer_id,
                display_name,
                keypair,
                event_sender,
            };
            app.manage(state);

            // 9. Store WebhostState (initially empty — started via command).
            app.manage(WebhostState {
                handle: Mutex::new(None),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::get_identity,
            commands::auth::get_aliases,
            commands::auth::create_alias,
            commands::auth::switch_alias,
            commands::auth::update_alias,
            commands::auth::delete_alias,
            commands::auth::setup_totp,
            commands::auth::verify_totp_code,
            commands::auth::enable_totp,
            commands::auth::disable_totp,
            commands::auth::is_totp_enabled,
            commands::messaging::send_message,
            commands::messaging::get_messages,
            commands::mesh::get_nearby_peers,
            commands::mesh::get_node_status,
            commands::mesh::subscribe_channel,
            commands::mesh::get_tunnels,
            commands::mesh::dial_peer,
            commands::mesh::bootstrap_dht,
            commands::servers::create_server,
            commands::servers::get_servers,
            commands::servers::get_server,
            commands::servers::get_channels,
            commands::servers::join_server,
            commands::servers::create_invite,
            commands::servers::get_server_members,
            commands::servers::leave_server,
            commands::trust::get_peer_trust,
            commands::trust::attest_peer,
            commands::trust::report_peer,
            commands::trust::get_attestations,
            commands::dm::initiate_dm_session,
            commands::dm::send_dm,
            commands::dm::get_dm_history,
            commands::voice::join_voice,
            commands::voice::leave_voice,
            commands::voice::toggle_mute,
            commands::voice::toggle_deafen,
            commands::voice::get_voice_state,
            commands::webhost::start_webhost,
            commands::webhost::stop_webhost,
            commands::webhost::get_webhost_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Concord");
}

/// Spawn a background task that reads NetworkEvents from the broadcast receiver
/// and forwards them to the Tauri frontend via the app handle's event system.
fn spawn_event_forwarder(
    app_handle: tauri::AppHandle,
    mut event_rx: tokio::sync::broadcast::Receiver<NetworkEvent>,
    db: Arc<Mutex<Database>>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(event) => {
                    match &event {
                        NetworkEvent::PeerDiscovered {
                            peer_id,
                            addresses,
                            display_name,
                        } => {
                            // Upsert the peer into the database.
                            if let Ok(db) = db.lock() {
                                let _ = db.upsert_peer(
                                    peer_id,
                                    display_name.as_deref(),
                                    addresses,
                                );
                            }
                            let _ = app_handle.emit(events::PEER_DISCOVERED, &event);
                        }
                        NetworkEvent::PeerDeparted { peer_id: _ } => {
                            let _ = app_handle.emit(events::PEER_DEPARTED, &event);
                        }
                        NetworkEvent::ConcordMessageReceived { message } => {
                            // Store the message locally.
                            if let Ok(db) = db.lock() {
                                if let Err(e) = db.insert_message(message) {
                                    warn!(%e, "failed to store received message");
                                }
                            }
                            let payload = commands::messaging::MessagePayload::from(message);
                            let _ = app_handle.emit(events::NEW_MESSAGE, &payload);
                        }
                        NetworkEvent::ConnectionStatusChanged { connected_peers } => {
                            let _ = app_handle.emit(
                                events::NODE_STATUS_CHANGED,
                                serde_json::json!({
                                    "connectedPeers": connected_peers,
                                }),
                            );
                        }
                        NetworkEvent::TunnelEstablished {
                            peer_id,
                            connection_type,
                            address,
                        } => {
                            let _ = app_handle.emit(
                                events::TUNNEL_ESTABLISHED,
                                serde_json::json!({
                                    "peerId": peer_id,
                                    "connectionType": connection_type,
                                    "address": address,
                                }),
                            );
                        }
                        NetworkEvent::TunnelClosed { peer_id } => {
                            let _ = app_handle.emit(
                                events::TUNNEL_CLOSED,
                                serde_json::json!({
                                    "peerId": peer_id,
                                }),
                            );
                        }
                        NetworkEvent::AttestationReceived { attestation } => {
                            // Store the attestation locally
                            if let Ok(db) = db.lock() {
                                if let Err(e) = db.store_attestation(attestation) {
                                    warn!(%e, "failed to store received attestation");
                                }
                            }
                            let _ = app_handle.emit(
                                events::ATTESTATION_RECEIVED,
                                serde_json::json!({
                                    "attesterId": attestation.attester_id,
                                    "subjectId": attestation.subject_id,
                                    "sinceTimestamp": attestation.since_timestamp,
                                }),
                            );
                        }
                        NetworkEvent::DmSignalReceived { signal } => {
                            match signal {
                                concord_core::types::DmSignal::EncryptedMessage(dm) => {
                                    // Store the encrypted DM locally
                                    if let Ok(db) = db.lock() {
                                        let _ = db.store_dm(
                                            &dm.id,
                                            &dm.from_peer,
                                            &dm.from_peer,
                                            &dm.ciphertext,
                                            &dm.nonce,
                                            dm.timestamp.timestamp_millis(),
                                        );
                                    }
                                    let _ = app_handle.emit(
                                        events::DM_RECEIVED,
                                        serde_json::json!({
                                            "id": dm.id,
                                            "fromPeer": dm.from_peer,
                                            "toPeer": dm.to_peer,
                                            "timestamp": dm.timestamp.timestamp_millis(),
                                        }),
                                    );
                                }
                                concord_core::types::DmSignal::KeyExchange { from_peer, to_peer, public_key } => {
                                    // Log the key exchange event — session establishment
                                    // is handled by the initiate_dm_session command
                                    info!(
                                        from = %from_peer,
                                        to = %to_peer,
                                        key_len = public_key.len(),
                                        "DM key exchange signal received"
                                    );
                                }
                            }
                        }
                        NetworkEvent::AliasAnnouncementReceived { announcement } => {
                            // Store the known alias mapping
                            if let Ok(db) = db.lock() {
                                let _ = db.store_known_alias(
                                    &announcement.alias_id,
                                    &announcement.root_identity,
                                    &announcement.display_name,
                                );
                            }
                            let _ = app_handle.emit(
                                events::ALIAS_ANNOUNCED,
                                serde_json::json!({
                                    "aliasId": announcement.alias_id,
                                    "rootIdentity": announcement.root_identity,
                                    "displayName": announcement.display_name,
                                }),
                            );
                        }
                        _ => {}
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(n, "event forwarder lagged, dropped events");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    info!("event channel closed, forwarder stopping");
                    break;
                }
            }
        }
    });
}
