use serde::{Deserialize, Serialize};

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
