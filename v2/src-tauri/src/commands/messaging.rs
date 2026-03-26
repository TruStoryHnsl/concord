use chrono::Utc;
use serde::Serialize;
use tracing::debug;
use uuid::Uuid;

use concord_core::types::Message;

use crate::AppState;

/// JSON-serializable message payload for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePayload {
    pub id: String,
    pub channel_id: String,
    pub sender_id: String,
    pub content: String,
    pub timestamp: i64, // unix millis
}

impl From<&Message> for MessagePayload {
    fn from(msg: &Message) -> Self {
        Self {
            id: msg.id.clone(),
            channel_id: msg.channel_id.clone(),
            sender_id: msg.sender_id.clone(),
            content: msg.content.clone(),
            timestamp: msg.timestamp.timestamp_millis(),
        }
    }
}

/// Publishes a message to the given GossipSub channel and stores it locally.
///
/// If `server_id` is provided, the topic will be `concord/{server_id}/{channel_id}`.
/// Otherwise, it falls back to `concord/mesh/{channel_id}` for the global mesh channel.
#[tauri::command]
pub async fn send_message(
    state: tauri::State<'_, AppState>,
    channel_id: String,
    content: String,
    server_id: Option<String>,
) -> Result<MessagePayload, String> {
    let now = Utc::now();

    // Build the message.
    let msg = Message {
        id: Uuid::new_v4().to_string(),
        channel_id: channel_id.clone(),
        sender_id: state.peer_id.clone(),
        content,
        timestamp: now,
        signature: state.keypair.sign(b""), // sign placeholder — full signing in a later phase
    };

    // Serialize with MessagePack for the wire.
    let encoded = concord_core::wire::encode(&msg).map_err(|e| e.to_string())?;

    // Build the GossipSub topic string.
    // For server channels: concord/{server_id}/{channel_id}
    // For mesh channels:   concord/mesh/{channel_id}
    let topic = match &server_id {
        Some(sid) => format!("concord/{sid}/{channel_id}"),
        None => format!("concord/mesh/{channel_id}"),
    };

    state
        .node
        .publish(&topic, encoded)
        .await
        .map_err(|e| e.to_string())?;

    debug!(msg_id = %msg.id, %channel_id, ?server_id, "message published");

    // Store locally.
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.insert_message(&msg).map_err(|e| e.to_string())?;
    }

    Ok(MessagePayload::from(&msg))
}

/// Retrieves messages from the local database for a given channel.
#[tauri::command]
pub fn get_messages(
    state: tauri::State<'_, AppState>,
    channel_id: String,
    limit: Option<u32>,
    before: Option<i64>,
) -> Result<Vec<MessagePayload>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let messages = db
        .get_messages(&channel_id, limit.unwrap_or(50), before)
        .map_err(|e| e.to_string())?;
    Ok(messages.iter().map(MessagePayload::from).collect())
}
