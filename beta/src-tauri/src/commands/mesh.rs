use serde::{Deserialize, Serialize};

use concord_core::mesh_map::{self, ConfidenceTier, EntryKind, EntryPayload, GovernanceModel, OwnershipMode};
use concord_net::ConnectionType;
use crate::AppState;

/// A peer as seen by the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerPayload {
    pub peer_id: String,
    pub addresses: Vec<String>,
    pub display_name: Option<String>,
}

/// Node status information for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatusPayload {
    pub is_online: bool,
    pub connected_peers: usize,
    pub peer_id: String,
    pub display_name: String,
}

/// A tunnel (connection) as seen by the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelPayload {
    pub peer_id: String,
    pub connection_type: String,
    pub remote_address: String,
    pub established_at: i64,
    pub rtt_ms: Option<u32>,
}

/// Returns a list of peers discovered on the local mesh network.
#[tauri::command]
pub async fn get_nearby_peers(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PeerPayload>, String> {
    let peers = state.node.peers().await.map_err(|e| e.to_string())?;
    Ok(peers
        .into_iter()
        .map(|p| PeerPayload {
            peer_id: p.peer_id,
            addresses: p.addresses,
            display_name: p.display_name,
        })
        .collect())
}

/// Returns the current node's status (online, peer count, identity).
#[tauri::command]
pub async fn get_node_status(
    state: tauri::State<'_, AppState>,
) -> Result<NodeStatusPayload, String> {
    let peers = state.node.peers().await.map_err(|e| e.to_string())?;
    Ok(NodeStatusPayload {
        is_online: true,
        connected_peers: peers.len(),
        peer_id: state.peer_id.clone(),
        display_name: state.display_name.clone(),
    })
}

/// Subscribe to a GossipSub topic (channel).
#[tauri::command]
pub async fn subscribe_channel(
    state: tauri::State<'_, AppState>,
    topic: String,
) -> Result<(), String> {
    state
        .node
        .subscribe(&topic)
        .await
        .map_err(|e| e.to_string())
}

/// Returns all active tunnel connections.
#[tauri::command]
pub async fn get_tunnels(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TunnelPayload>, String> {
    let tunnels = state.node.get_tunnels().await.map_err(|e| e.to_string())?;
    Ok(tunnels
        .into_iter()
        .map(|t| TunnelPayload {
            peer_id: t.peer_id,
            connection_type: t.connection_type.to_string(),
            remote_address: t.remote_address,
            established_at: t.established_at,
            rtt_ms: t.rtt_ms,
        })
        .collect())
}

/// Dial a peer by PeerId and address.
#[tauri::command]
pub async fn dial_peer(
    state: tauri::State<'_, AppState>,
    peer_id: String,
    address: String,
) -> Result<(), String> {
    state
        .node
        .dial_peer(&peer_id, &[address])
        .await
        .map_err(|e| e.to_string())
}

/// Initiate a Kademlia DHT bootstrap query.
#[tauri::command]
pub async fn bootstrap_dht(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .node
        .bootstrap_dht()
        .await
        .map_err(|e| e.to_string())
}

/// Enriched mesh node for the frontend, combining peers + verification + compute.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshNodePayload {
    pub peer_id: String,
    pub display_name: Option<String>,
    pub addresses: Vec<String>,
    pub verification_state: String,
    pub remaining_ttl: u8,
    pub last_confirmed_at: Option<i64>,
    pub received_compute_weight: f64,
    pub connection_type: Option<String>,
    pub rtt_ms: Option<u32>,
    pub last_seen: i64,
}

/// Compute priority entry for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputePriorityEntry {
    pub peer_id: String,
    pub priority: u8,
    pub display_name: Option<String>,
    pub share: f64,
}

/// Returns enriched mesh nodes with verification state and compute weight.
#[tauri::command]
pub async fn get_mesh_nodes(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MeshNodePayload>, String> {
    let peers = state.node.peers().await.map_err(|e| e.to_string())?;
    let tunnels = state.node.get_tunnels().await.map_err(|e| e.to_string())?;

    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Build tunnel lookup
    let tunnel_map: std::collections::HashMap<String, _> = tunnels
        .into_iter()
        .map(|t| (t.peer_id.clone(), t))
        .collect();

    // Get all verification tags
    let tags: std::collections::HashMap<String, _> = db
        .get_all_verification_tags()
        .unwrap_or_default()
        .into_iter()
        .map(|t| (t.peer_id.clone(), t))
        .collect();

    let mut nodes = Vec::new();
    for peer in &peers {
        let tag = tags.get(&peer.peer_id);
        let tunnel = tunnel_map.get(&peer.peer_id);
        let compute_weight = db.get_received_compute_weight(&peer.peer_id).unwrap_or(0.0);

        let verification_state = tag
            .map(|t| match t.state {
                concord_core::types::VerificationState::Verified => "verified",
                concord_core::types::VerificationState::Stale => "stale",
                concord_core::types::VerificationState::Speculative => "speculative",
            })
            .unwrap_or("speculative")
            .to_string();

        nodes.push(MeshNodePayload {
            peer_id: peer.peer_id.clone(),
            display_name: peer.display_name.clone(),
            addresses: peer.addresses.clone(),
            verification_state,
            remaining_ttl: tag.map(|t| t.remaining_ttl).unwrap_or(0),
            last_confirmed_at: tag.and_then(|t| t.last_confirmed_at.map(|v| v as i64)),
            received_compute_weight: compute_weight,
            connection_type: tunnel.map(|t| t.connection_type.to_string()),
            rtt_ms: tunnel.and_then(|t| t.rtt_ms),
            last_seen: 0, // TODO: wire from peer record
        });
    }

    Ok(nodes)
}

/// Set this node's compute power distribution priorities.
#[tauri::command]
pub async fn set_compute_priorities(
    state: tauri::State<'_, AppState>,
    entries: Vec<ComputePriorityEntry>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let priorities: Vec<(String, u8)> = entries
        .iter()
        .map(|e| (e.peer_id.clone(), e.priority))
        .collect();
    db.set_local_compute_priorities(&priorities)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Get this node's compute power distribution priorities.
#[tauri::command]
pub async fn get_compute_priorities(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ComputePriorityEntry>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let priorities = db.get_local_compute_priorities().map_err(|e| e.to_string())?;
    let shares = concord_store::mesh_store::compute_allocation_shares(&priorities);
    Ok(shares
        .into_iter()
        .map(|s| ComputePriorityEntry {
            peer_id: s.peer_id,
            priority: s.priority,
            display_name: None,
            share: s.share,
        })
        .collect())
}

// ─── Mesh Map Commands ─────────────────────────────────────────────

/// A mesh map entry as seen by the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshMapEntryPayload {
    pub address: String,
    pub kind: String,
    pub owner_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub confidence: String,
    pub ttl_ticks: u8,
    pub locale_path: Vec<String>,
    pub display_name: Option<String>,
    pub engagement_score: Option<i8>,
    pub trust_rating: Option<f64>,
    pub is_server_class: bool,
    pub route_count: usize,
}

/// Returns all mesh map entries, optionally filtered by kind.
#[tauri::command]
pub async fn get_mesh_map_entries(
    state: tauri::State<'_, AppState>,
    kind: Option<String>,
) -> Result<Vec<MeshMapEntryPayload>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let entries = match kind.as_deref() {
        Some("node") => db.get_mesh_map_entries_by_kind(&EntryKind::Node),
        Some("place") => db.get_mesh_map_entries_by_kind(&EntryKind::Place),
        Some("call_ledger") => db.get_mesh_map_entries_by_kind(&EntryKind::CallLedger),
        Some("locale") => db.get_mesh_map_entries_by_kind(&EntryKind::Locale),
        _ => db.get_all_mesh_map_entries(),
    }
    .map_err(|e| e.to_string())?;

    Ok(entries.into_iter().map(entry_to_payload).collect())
}

/// Returns the engagement profile for the local node.
#[tauri::command]
pub async fn get_engagement_profile(
    state: tauri::State<'_, AppState>,
) -> Result<EngagementProfilePayload, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let counters = db
        .get_engagement_counters(&state.peer_id)
        .map_err(|e| e.to_string())?;
    let score = mesh_map::compute_engagement_score(&counters);
    let ratio = counters.posting_ratio();

    Ok(EngagementProfilePayload {
        messages_sent: counters.messages_sent,
        messages_read: counters.messages_read,
        forum_posts_created: counters.forum_posts_created,
        forum_posts_read: counters.forum_posts_read,
        posting_ratio: ratio,
        engagement_score: score,
    })
}

/// Engagement profile as seen by the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngagementProfilePayload {
    pub messages_sent: u64,
    pub messages_read: u64,
    pub forum_posts_created: u64,
    pub forum_posts_read: u64,
    pub posting_ratio: f64,
    pub engagement_score: i8,
}

/// Returns active call ledgers from the mesh map.
#[tauri::command]
pub async fn get_active_calls(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ActiveCallPayload>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let entries = db
        .get_mesh_map_entries_by_kind(&EntryKind::CallLedger)
        .map_err(|e| e.to_string())?;

    let calls: Vec<ActiveCallPayload> = entries
        .into_iter()
        .filter_map(|e| match &e.payload {
            EntryPayload::CallLedger(cl) => {
                if cl.status == mesh_map::CallStatus::Active {
                    Some(ActiveCallPayload {
                        address: mesh_map::address_hex(&e.address),
                        call_id: cl.call_id.clone(),
                        participants: cl.participants.clone(),
                        call_type: format!("{:?}", cl.call_type),
                        started_at: cl.started_at as i64,
                        hosting_node: cl.hosting_node.clone(),
                    })
                } else {
                    None
                }
            }
            _ => None,
        })
        .collect();

    Ok(calls)
}

/// Active call as seen by the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveCallPayload {
    pub address: String,
    pub call_id: String,
    pub participants: Vec<String>,
    pub call_type: String,
    pub started_at: i64,
    pub hosting_node: String,
}

// ─── Helpers ───────────────────────────────────────────────────────

// ─── Place Commands ─────────────────────────────────────────────

/// A place as seen by the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacePayloadFrontend {
    pub address: String,
    pub place_id: String,
    pub name: String,
    pub owner_id: String,
    pub governance: String,
    pub encryption_mode: String,
    pub visibility: String,
    pub member_count: u32,
    pub hosting_nodes: Vec<String>,
    pub minted_at: i64,
}

/// Mint a new place. The caller becomes the owner.
#[tauri::command]
pub async fn mint_place(
    state: tauri::State<'_, AppState>,
    name: String,
    visibility: String,
    governance: String,
) -> Result<PlacePayloadFrontend, String> {
    let gov = match governance.as_str() {
        "public" => GovernanceModel::Public,
        _ => GovernanceModel::Private,
    };

    let entry = mesh_map::mint_place(
        &state.keypair,
        &name,
        gov,
        OwnershipMode::Unencrypted,
        &visibility,
    );

    // Persist to local DB
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.upsert_mesh_map_entry(&entry).map_err(|e| e.to_string())?;
    }

    // Publish to mesh via GossipSub
    let data = concord_core::wire::encode(&entry).map_err(|e| e.to_string())?;
    state.node.publish(concord_net::TOPIC_MAP_SYNC, data).await.map_err(|e| e.to_string())?;

    // Build response
    match &entry.payload {
        EntryPayload::Place(pp) => Ok(PlacePayloadFrontend {
            address: mesh_map::address_hex(&entry.address),
            place_id: pp.place_id.clone(),
            name: pp.name.clone(),
            owner_id: pp.owner_id.clone(),
            governance: format!("{:?}", pp.governance),
            encryption_mode: format!("{:?}", pp.encryption_mode),
            visibility: pp.visibility.clone(),
            member_count: pp.member_count,
            hosting_nodes: pp.hosting_nodes.clone(),
            minted_at: pp.minted_at as i64,
        }),
        _ => Err("unexpected payload type".to_string()),
    }
}

/// Get all known places from the mesh map.
#[tauri::command]
pub async fn get_places(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PlacePayloadFrontend>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let entries = db.get_places().map_err(|e| e.to_string())?;

    Ok(entries
        .into_iter()
        .filter_map(|e| match &e.payload {
            EntryPayload::Place(pp) => Some(PlacePayloadFrontend {
                address: mesh_map::address_hex(&e.address),
                place_id: pp.place_id.clone(),
                name: pp.name.clone(),
                owner_id: pp.owner_id.clone(),
                governance: format!("{:?}", pp.governance),
                encryption_mode: format!("{:?}", pp.encryption_mode),
                visibility: pp.visibility.clone(),
                member_count: pp.member_count,
                hosting_nodes: pp.hosting_nodes.clone(),
                minted_at: pp.minted_at as i64,
            }),
            _ => None,
        })
        .collect())
}

// ─── Block Commands ─────────────────────────────────────────────

/// A blocked peer as seen by the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedPeerPayload {
    pub peer_id: String,
    pub blocked_at: i64,
    pub reason: String,
}

/// Block a peer.
#[tauri::command]
pub async fn block_peer(
    state: tauri::State<'_, AppState>,
    peer_id: String,
    reason: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.block_peer(&peer_id, &reason).map_err(|e| e.to_string())
}

/// Unblock a peer.
#[tauri::command]
pub async fn unblock_peer(
    state: tauri::State<'_, AppState>,
    peer_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.unblock_peer(&peer_id).map_err(|e| e.to_string())?;
    Ok(())
}

/// Get all blocked peers.
#[tauri::command]
pub async fn get_blocked_peers(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<BlockedPeerPayload>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let blocked = db.get_blocked_peers().map_err(|e| e.to_string())?;
    Ok(blocked
        .into_iter()
        .map(|b| BlockedPeerPayload {
            peer_id: b.peer_id,
            blocked_at: b.blocked_at as i64,
            reason: b.reason,
        })
        .collect())
}

// ─── Helpers ───────────────────────────────────────────────────────

// ─── Mesh Map Viewer API ─────────────────────────────────────────

/// Data for the mesh map viewer's global view (physical locations + connectivity).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapViewerNode {
    pub peer_id: String,
    pub display_name: Option<String>,
    pub confidence: String,
    pub is_server_class: bool,
    pub prominence: f64,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub portal_url: Option<String>,
    pub route_count: usize,
    pub engagement_score: Option<i8>,
    pub trust_rating: Option<f64>,
}

/// Returns all nodes formatted for the mesh map viewer.
/// Sorted by prominence (highest first).
#[tauri::command]
pub async fn get_mesh_map_for_viewer(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MapViewerNode>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let entries = db
        .get_mesh_map_entries_by_kind(&EntryKind::Node)
        .map_err(|e| e.to_string())?;

    let mut nodes: Vec<MapViewerNode> = entries
        .iter()
        .filter_map(|e| match &e.payload {
            EntryPayload::Node(np) => {
                let prominence = mesh_map::compute_prominence(e);
                Some(MapViewerNode {
                    peer_id: e.owner_id.clone(),
                    display_name: np.display_name.clone(),
                    confidence: format!("{:?}", e.confidence),
                    is_server_class: np.is_server_class,
                    prominence,
                    lat: np.location.as_ref().map(|l| l.lat),
                    lon: np.location.as_ref().map(|l| l.lon),
                    portal_url: np.portal_url.clone(),
                    route_count: np.routes.len(),
                    engagement_score: np.engagement_score,
                    trust_rating: np.trust_rating,
                })
            }
            _ => None,
        })
        .collect();

    // Sort by prominence descending
    nodes.sort_by(|a, b| b.prominence.partial_cmp(&a.prominence).unwrap_or(std::cmp::Ordering::Equal));
    Ok(nodes)
}

// ─── Mobile Dashboard API ───────────────────────────────────────

/// Quick actions and status for the mobile-first homepage dashboard.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPayload {
    /// Peer ID of the local node.
    pub peer_id: String,
    /// Display name.
    pub display_name: String,
    /// Number of connected peers.
    pub connected_peers: usize,
    /// Number of known places.
    pub known_places: u32,
    /// Number of active calls.
    pub active_calls: u32,
    /// Last channel the user was active in (for 1-tap reconnect).
    pub last_channel: Option<LastChannelInfo>,
    /// Total mesh map entries known.
    pub mesh_map_size: u32,
    /// Node's portal URL.
    pub portal_url: String,
}

/// Info about the last active channel for quick reconnect.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastChannelInfo {
    pub server_id: String,
    pub channel_id: String,
    pub server_name: String,
    pub channel_name: String,
}

/// Returns dashboard data for the mobile homepage.
#[tauri::command]
pub async fn get_dashboard(
    state: tauri::State<'_, AppState>,
) -> Result<DashboardPayload, String> {
    let peers = state.node.peers().await.map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let known_places = db.get_places().map_err(|e| e.to_string())?.len() as u32;
    let active_calls = db
        .get_mesh_map_entries_by_kind(&EntryKind::CallLedger)
        .map_err(|e| e.to_string())?
        .iter()
        .filter(|e| matches!(&e.payload, EntryPayload::CallLedger(cl) if cl.status == mesh_map::CallStatus::Active))
        .count() as u32;
    let mesh_map_size = db.mesh_map_entry_count().map_err(|e| e.to_string())?;

    // Try to find the last channel from settings
    let last_channel = db
        .get_setting("last_active_channel")
        .ok()
        .flatten()
        .and_then(|val| serde_json::from_str::<LastChannelInfo>(&val).ok());

    let portal_url = mesh_map::portal_url_for_node(&state.peer_id);

    Ok(DashboardPayload {
        peer_id: state.peer_id.clone(),
        display_name: state.display_name.clone(),
        connected_peers: peers.len(),
        known_places,
        active_calls,
        last_channel,
        mesh_map_size,
        portal_url,
    })
}

// ─── Perspective-Based Map Navigation ──────────────────────────────

/// A node as seen from a particular perspective in the mesh map.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerspectiveNode {
    pub peer_id: String,
    pub display_name: Option<String>,
    /// Relationship of this node to the center: "self", "friend", "local", "tunnel", "mesh", "speculative"
    pub relation: String,
    /// Can the user shift perspective to this node?
    pub is_known: bool,
    /// Relative distance from center [0.0, 1.0] for layout positioning.
    /// 0.0 = center, smaller = closer relationship.
    pub distance: f64,
    pub prominence: f64,
    pub confidence: String,
    pub is_server_class: bool,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub portal_url: Option<String>,
    pub rtt_ms: Option<u32>,
    pub trust_rating: Option<f64>,
    pub engagement_score: Option<i8>,
    pub node_type: String,
    pub route_count: usize,
}

/// The full perspective view payload returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerspectiveViewPayload {
    /// The node we're centered on.
    pub center: PerspectiveNode,
    /// Surrounding nodes visible from this perspective.
    pub nodes: Vec<PerspectiveNode>,
    /// Places visible from this perspective.
    pub places: Vec<PlacePayloadFrontend>,
}

/// Returns the mesh map view from a particular node's perspective.
/// If `center_peer_id` is None or matches our own peer_id, returns home perspective
/// (using live connection data). Otherwise, infers the neighborhood from the mesh map.
#[tauri::command]
pub async fn get_perspective_view(
    state: tauri::State<'_, AppState>,
    center_peer_id: Option<String>,
) -> Result<PerspectiveViewPayload, String> {
    let my_peer_id = &state.peer_id;
    let center_id = center_peer_id.as_deref().unwrap_or(my_peer_id);
    let is_home = center_id == my_peer_id;

    // Gather all DB data upfront, then drop the lock before any async work.
    let (all_node_entries, all_place_entries, friends) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let nodes = db
            .get_mesh_map_entries_by_kind(&EntryKind::Node)
            .map_err(|e| e.to_string())?;
        let places = db
            .get_mesh_map_entries_by_kind(&EntryKind::Place)
            .map_err(|e| e.to_string())?;
        let friends = db.get_friends().map_err(|e| e.to_string())?;
        (nodes, places, friends)
    }; // db lock dropped here

    let friend_ids: std::collections::HashSet<String> =
        friends.iter().map(|f| f.peer_id.clone()).collect();

    // Build mesh entry lookup
    let entry_map: std::collections::HashMap<String, &mesh_map::MeshMapEntry> = all_node_entries
        .iter()
        .map(|e| (e.owner_id.clone(), e))
        .collect();

    // Build the center node
    let center = if is_home {
        PerspectiveNode {
            peer_id: my_peer_id.clone(),
            display_name: Some(state.display_name.clone()),
            relation: "self".to_string(),
            is_known: true,
            distance: 0.0,
            prominence: entry_map.get(my_peer_id).map(|e| mesh_map::compute_prominence(e)).unwrap_or(0.5),
            confidence: "SelfVerified".to_string(),
            is_server_class: false,
            lat: entry_map.get(my_peer_id).and_then(|e| match &e.payload {
                EntryPayload::Node(np) => np.location.as_ref().map(|l| l.lat),
                _ => None,
            }),
            lon: entry_map.get(my_peer_id).and_then(|e| match &e.payload {
                EntryPayload::Node(np) => np.location.as_ref().map(|l| l.lon),
                _ => None,
            }),
            portal_url: Some(mesh_map::portal_url_for_node(my_peer_id)),
            rtt_ms: None,
            trust_rating: entry_map.get(my_peer_id).and_then(|e| match &e.payload {
                EntryPayload::Node(np) => np.trust_rating,
                _ => None,
            }),
            engagement_score: entry_map.get(my_peer_id).and_then(|e| match &e.payload {
                EntryPayload::Node(np) => np.engagement_score,
                _ => None,
            }),
            node_type: "user".to_string(),
            route_count: 0,
        }
    } else {
        entry_to_perspective_node(center_id, &entry_map, &friend_ids, center_id)
    };

    let mut nodes: Vec<PerspectiveNode> = Vec::new();

    if is_home {
        // ── Home perspective: use live connection data ──
        let peers = state.node.peers().await.map_err(|e| e.to_string())?;
        let tunnels = state.node.get_tunnels().await.map_err(|e| e.to_string())?;

        let tunnel_map: std::collections::HashMap<String, _> = tunnels
            .iter()
            .map(|t| (t.peer_id.clone(), t))
            .collect();
        let peer_ids: std::collections::HashSet<String> =
            peers.iter().map(|p| p.peer_id.clone()).collect();

        // Add live peers with their actual connection data
        for peer in &peers {
            if peer.peer_id == *my_peer_id {
                continue;
            }
            let tunnel = tunnel_map.get(&peer.peer_id);
            let is_friend = friend_ids.contains(&peer.peer_id);
            let relation = if is_friend {
                "friend"
            } else if tunnel.map(|t| matches!(t.connection_type, ConnectionType::LocalMdns)).unwrap_or(false) {
                "local"
            } else if tunnel.is_some() {
                "tunnel"
            } else {
                "local" // mDNS discovered
            };
            let distance = match relation {
                "friend" => 0.2,
                "local" => 0.3,
                "tunnel" => 0.5,
                _ => 0.6,
            };

            let entry = entry_map.get(&peer.peer_id).copied();
            let (confidence, prominence, is_server, trust, engagement, lat, lon, portal, route_count, node_type_str) =
                extract_node_fields(entry, &peer.peer_id);

            nodes.push(PerspectiveNode {
                peer_id: peer.peer_id.clone(),
                display_name: peer.display_name.clone().or_else(|| entry.and_then(|e| match &e.payload {
                    EntryPayload::Node(np) => np.display_name.clone(),
                    _ => None,
                })),
                relation: relation.to_string(),
                is_known: true, // live peers are always known
                distance,
                prominence,
                confidence,
                is_server_class: is_server,
                lat,
                lon,
                portal_url: portal,
                rtt_ms: tunnel.and_then(|t| t.rtt_ms),
                trust_rating: trust,
                engagement_score: engagement,
                node_type: node_type_str,
                route_count,
            });
        }

        // Add mesh-known nodes that aren't directly connected
        for entry in &all_node_entries {
            let pid = &entry.owner_id;
            if pid == my_peer_id || peer_ids.contains(pid) {
                continue;
            }
            let is_friend = friend_ids.contains(pid);
            let relation = if is_friend { "friend" } else { "mesh" };
            let distance = if is_friend { 0.4 } else { 0.7 };

            let (confidence, prominence, is_server, trust, engagement, lat, lon, portal, route_count, node_type_str) =
                extract_node_fields(Some(entry), pid);

            nodes.push(PerspectiveNode {
                peer_id: pid.clone(),
                display_name: match &entry.payload {
                    EntryPayload::Node(np) => np.display_name.clone(),
                    _ => None,
                },
                relation: relation.to_string(),
                is_known: is_friend || entry.confidence >= ConfidenceTier::ClusterVerified,
                distance,
                prominence,
                confidence,
                is_server_class: is_server,
                lat,
                lon,
                portal_url: portal,
                rtt_ms: None,
                trust_rating: trust,
                engagement_score: engagement,
                node_type: node_type_str,
                route_count,
            });
        }
    } else {
        // ── Remote perspective: infer neighborhood from mesh map ──

        // Find the center node's locale path for proximity matching
        let center_locale = entry_map.get(center_id).map(|e| &e.locale_path);

        // Find nodes connected to the center via routes
        let mut route_neighbors: std::collections::HashSet<String> = std::collections::HashSet::new();
        for entry in &all_node_entries {
            if let EntryPayload::Node(np) = &entry.payload {
                for route in &np.routes {
                    for hop in &route.hops {
                        if hop.peer_id == center_id {
                            route_neighbors.insert(entry.owner_id.clone());
                        }
                    }
                }
            }
        }
        // Also check routes FROM the center node
        if let Some(center_entry) = entry_map.get(center_id) {
            if let EntryPayload::Node(np) = &center_entry.payload {
                for route in &np.routes {
                    for hop in &route.hops {
                        route_neighbors.insert(hop.peer_id.clone());
                    }
                }
            }
        }

        for entry in &all_node_entries {
            let pid = &entry.owner_id;
            if pid == center_id {
                continue;
            }

            let is_route_neighbor = route_neighbors.contains(pid);
            let same_locale = center_locale
                .map(|cl| {
                    // Match on at least the first 2 levels (region + cluster)
                    entry.locale_path.len() >= 2
                        && cl.len() >= 2
                        && entry.locale_path[0] == cl[0]
                        && entry.locale_path[1] == cl[1]
                })
                .unwrap_or(false);
            let is_friend_of_viewer = friend_ids.contains(pid);

            // Determine relationship and distance from the center's perspective
            let (relation, distance) = if is_route_neighbor && same_locale {
                ("local", 0.25)
            } else if is_route_neighbor {
                ("tunnel", 0.45)
            } else if same_locale {
                ("mesh", 0.55)
            } else if entry.confidence >= ConfidenceTier::TunnelVerified {
                ("mesh", 0.7)
            } else {
                ("speculative", 0.85)
            };

            let (confidence, prominence, is_server, trust, engagement, lat, lon, portal, route_count, node_type_str) =
                extract_node_fields(Some(entry), pid);

            // A node is "known" (clickable for perspective shift) if we have reasonable data
            let is_known = is_friend_of_viewer
                || entry.confidence >= ConfidenceTier::ClusterVerified
                || is_route_neighbor;

            nodes.push(PerspectiveNode {
                peer_id: pid.clone(),
                display_name: match &entry.payload {
                    EntryPayload::Node(np) => np.display_name.clone(),
                    _ => None,
                },
                relation: relation.to_string(),
                is_known,
                distance,
                prominence,
                confidence,
                is_server_class: is_server,
                lat,
                lon,
                portal_url: portal,
                rtt_ms: None,
                trust_rating: trust,
                engagement_score: engagement,
                node_type: node_type_str,
                route_count,
            });
        }
    }

    // Sort by distance (closest first), then prominence
    nodes.sort_by(|a, b| {
        a.distance
            .partial_cmp(&b.distance)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                b.prominence
                    .partial_cmp(&a.prominence)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    // Build places visible from this perspective
    let places: Vec<PlacePayloadFrontend> = all_place_entries
        .iter()
        .filter_map(|e| match &e.payload {
            EntryPayload::Place(pp) => {
                // Show places where center node is a host, member, or within the same locale
                let center_is_host = pp.hosting_nodes.contains(&center_id.to_string());
                let center_on_whitelist = pp.whitelist.contains(&center_id.to_string());
                let same_locale = entry_map.get(center_id)
                    .map(|ce| {
                        e.locale_path.len() >= 1
                            && ce.locale_path.len() >= 1
                            && e.locale_path[0] == ce.locale_path[0]
                    })
                    .unwrap_or(false);

                if center_is_host || center_on_whitelist || same_locale || pp.visibility == "public" {
                    Some(PlacePayloadFrontend {
                        address: mesh_map::address_hex(&e.address),
                        place_id: pp.place_id.clone(),
                        name: pp.name.clone(),
                        owner_id: pp.owner_id.clone(),
                        governance: format!("{:?}", pp.governance),
                        encryption_mode: format!("{:?}", pp.encryption_mode),
                        visibility: pp.visibility.clone(),
                        member_count: pp.member_count,
                        hosting_nodes: pp.hosting_nodes.clone(),
                        minted_at: pp.minted_at as i64,
                    })
                } else {
                    None
                }
            }
            _ => None,
        })
        .collect();

    Ok(PerspectiveViewPayload {
        center,
        nodes,
        places,
    })
}

/// Extract common fields from a mesh map node entry.
fn extract_node_fields(
    entry: Option<&mesh_map::MeshMapEntry>,
    peer_id: &str,
) -> (String, f64, bool, Option<f64>, Option<i8>, Option<f64>, Option<f64>, Option<String>, usize, String) {
    match entry {
        Some(e) => {
            let prominence = mesh_map::compute_prominence(e);
            let confidence = format!("{:?}", e.confidence);
            match &e.payload {
                EntryPayload::Node(np) => (
                    confidence,
                    prominence,
                    np.is_server_class,
                    np.trust_rating,
                    np.engagement_score,
                    np.location.as_ref().map(|l| l.lat),
                    np.location.as_ref().map(|l| l.lon),
                    np.portal_url.clone(),
                    np.routes.len(),
                    format!("{:?}", np.node_type),
                ),
                _ => (confidence, prominence, false, None, None, None, None, None, 0, "Standard".to_string()),
            }
        }
        None => (
            "Speculative".to_string(),
            0.0,
            false,
            None,
            None,
            None,
            None,
            Some(mesh_map::portal_url_for_node(peer_id)),
            0,
            "Standard".to_string(),
        ),
    }
}

/// Build a PerspectiveNode from mesh map data for a non-self center.
fn entry_to_perspective_node(
    peer_id: &str,
    entry_map: &std::collections::HashMap<String, &mesh_map::MeshMapEntry>,
    friend_ids: &std::collections::HashSet<String>,
    _center_id: &str,
) -> PerspectiveNode {
    let entry = entry_map.get(peer_id).copied();
    let (confidence, prominence, is_server, trust, engagement, lat, lon, portal, route_count, node_type_str) =
        extract_node_fields(entry, peer_id);
    let is_friend = friend_ids.contains(peer_id);

    PerspectiveNode {
        peer_id: peer_id.to_string(),
        display_name: entry.and_then(|e| match &e.payload {
            EntryPayload::Node(np) => np.display_name.clone(),
            _ => None,
        }),
        relation: if is_friend { "friend" } else { "center" }.to_string(),
        is_known: true,
        distance: 0.0,
        prominence,
        confidence,
        is_server_class: is_server,
        lat,
        lon,
        portal_url: portal,
        rtt_ms: None,
        trust_rating: trust,
        engagement_score: engagement,
        node_type: node_type_str,
        route_count,
    }
}

// ─── Friend Mesh Sync ──────────────────────────────────────────────

/// Sync the friend list with the mesh networking layer.
/// Friends get enhanced mesh sync: shorter cooldown + confidence upgrades on received data.
#[tauri::command]
pub async fn sync_mesh_friends(
    state: tauri::State<'_, AppState>,
) -> Result<u32, String> {
    let friend_ids = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let friends = db.get_friends().map_err(|e| e.to_string())?;
        friends.into_iter().map(|f| f.peer_id).collect::<std::collections::HashSet<_>>()
    };
    let count = friend_ids.len() as u32;
    state.node.update_mesh_friends(friend_ids).await.map_err(|e| e.to_string())?;
    Ok(count)
}

// ─── WireGuard / Orrtellite Status ──────────────────────────────────

/// WireGuard mesh status as seen by the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireGuardStatusPayload {
    pub is_active: bool,
    pub mesh_ip: Option<String>,
    pub mesh_hostname: Option<String>,
    pub peer_count: usize,
    pub online_peers: usize,
    pub peers: Vec<WireGuardPeerPayload>,
}

/// A WireGuard mesh peer as seen by the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireGuardPeerPayload {
    pub hostname: String,
    pub ip: String,
    pub online: bool,
}

/// Detect WireGuard / orrtellite mesh status on this machine.
/// Returns mesh info if Tailscale is running, or inactive status.
#[tauri::command]
pub async fn get_wireguard_status() -> Result<WireGuardStatusPayload, String> {
    let status = concord_net::wireguard::detect_wireguard_mesh();
    let online_peers = status.mesh_peers.iter().filter(|p| p.online).count();
    Ok(WireGuardStatusPayload {
        is_active: status.is_active,
        mesh_ip: status.mesh_ip.map(|ip| ip.to_string()),
        mesh_hostname: status.mesh_hostname,
        peer_count: status.mesh_peers.len(),
        online_peers,
        peers: status
            .mesh_peers
            .into_iter()
            .map(|p| WireGuardPeerPayload {
                hostname: p.hostname,
                ip: p.ip.to_string(),
                online: p.online,
            })
            .collect(),
    })
}

// ─── Helpers ───────────────────────────────────────────────────────

fn entry_to_payload(entry: concord_core::mesh_map::MeshMapEntry) -> MeshMapEntryPayload {
    let (display_name, engagement_score, trust_rating, is_server_class, route_count) =
        match &entry.payload {
            EntryPayload::Node(np) => (
                np.display_name.clone(),
                np.engagement_score,
                np.trust_rating,
                np.is_server_class,
                np.routes.len(),
            ),
            EntryPayload::Place(pp) => (Some(pp.name.clone()), None, None, false, 0),
            _ => (None, None, None, false, 0),
        };

    let kind_str = match entry.kind {
        EntryKind::Node => "node",
        EntryKind::Place => "place",
        EntryKind::CallLedger => "call_ledger",
        EntryKind::Locale => "locale",
    };

    let confidence_str = match entry.confidence {
        ConfidenceTier::Speculative => "speculative",
        ConfidenceTier::ClusterVerified => "cluster_verified",
        ConfidenceTier::TunnelVerified => "tunnel_verified",
        ConfidenceTier::SelfVerified => "self_verified",
    };

    MeshMapEntryPayload {
        address: mesh_map::address_hex(&entry.address),
        kind: kind_str.to_string(),
        owner_id: entry.owner_id,
        created_at: entry.created_at as i64,
        updated_at: entry.updated_at as i64,
        confidence: confidence_str.to_string(),
        ttl_ticks: entry.ttl_ticks,
        locale_path: entry.locale_path,
        display_name,
        engagement_score,
        trust_rating,
        is_server_class,
        route_count,
    }
}
