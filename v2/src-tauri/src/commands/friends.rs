use serde::Serialize;

use concord_core::types::{FriendSignal, PresenceStatus};

use crate::AppState;

/// JSON-serializable friend payload for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendPayload {
    pub peer_id: String,
    pub display_name: Option<String>,
    pub alias_name: Option<String>,
    pub added_at: i64,
    pub is_mutual: bool,
    pub auto_tunnel: bool,
    pub last_online: Option<i64>,
}

/// Presence settings payload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceSettingsPayload {
    pub visible: bool,
    pub status: String,
}

/// Send a friend request to a peer.
#[tauri::command]
pub async fn send_friend_request(
    state: tauri::State<'_, AppState>,
    peer_id: String,
) -> Result<(), String> {
    // Add locally as a pending (non-mutual) friend
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.add_friend(&peer_id, None).map_err(|e| e.to_string())?;
    }

    // Send the friend request signal
    let signal = FriendSignal::Request {
        from_peer: state.peer_id.clone(),
        display_name: state.display_name.clone(),
    };

    state
        .node
        .send_friend_signal(&peer_id, signal)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Accept a friend request from a peer.
#[tauri::command]
pub async fn accept_friend_request(
    state: tauri::State<'_, AppState>,
    peer_id: String,
) -> Result<(), String> {
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        // Add the friend if not already added
        db.add_friend(&peer_id, None).map_err(|e| e.to_string())?;
        // Mark as mutual
        db.set_friend_mutual(&peer_id, true)
            .map_err(|e| e.to_string())?;
    }

    // Send accept signal
    let signal = FriendSignal::Accept {
        from_peer: state.peer_id.clone(),
    };

    state
        .node
        .send_friend_signal(&peer_id, signal)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get all friends.
#[tauri::command]
pub fn get_friends(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<FriendPayload>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let friends = db.get_friends().map_err(|e| e.to_string())?;
    Ok(friends
        .iter()
        .map(|f| FriendPayload {
            peer_id: f.peer_id.clone(),
            display_name: f.display_name.clone(),
            alias_name: f.alias_name.clone(),
            added_at: f.added_at,
            is_mutual: f.is_mutual,
            auto_tunnel: f.auto_tunnel,
            last_online: f.last_online,
        })
        .collect())
}

/// Remove a friend.
#[tauri::command]
pub fn remove_friend(
    state: tauri::State<'_, AppState>,
    peer_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_friend(&peer_id).map_err(|e| e.to_string())
}

/// Set the user's presence status.
#[tauri::command]
pub fn set_presence(
    state: tauri::State<'_, AppState>,
    status: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Validate status
    match status.as_str() {
        "online" | "away" | "dnd" | "offline" => {}
        _ => return Err(format!("invalid presence status: {status}")),
    }
    db.set_setting("presence_status", &status)
        .map_err(|e| e.to_string())
}

/// Get presence settings.
#[tauri::command]
pub fn get_presence_settings(
    state: tauri::State<'_, AppState>,
) -> Result<PresenceSettingsPayload, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let visible = db
        .get_setting("presence_visible")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(true);
    let status = db
        .get_setting("presence_status")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "online".to_string());
    Ok(PresenceSettingsPayload { visible, status })
}

/// Set whether presence is visible to friends.
#[tauri::command]
pub fn set_presence_visible(
    state: tauri::State<'_, AppState>,
    visible: bool,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_setting("presence_visible", if visible { "true" } else { "false" })
        .map_err(|e| e.to_string())
}

/// Convert a string status to PresenceStatus enum.
pub fn parse_presence_status(status: &str) -> PresenceStatus {
    match status {
        "away" => PresenceStatus::Away,
        "dnd" => PresenceStatus::DoNotDisturb,
        "offline" => PresenceStatus::Offline,
        _ => PresenceStatus::Online,
    }
}
