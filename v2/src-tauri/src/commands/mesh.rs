use serde::Serialize;

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
