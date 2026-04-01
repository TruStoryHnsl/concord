use chrono::Utc;
use serde::Serialize;
use uuid::Uuid;

use concord_core::types::DirectConversation;

use crate::AppState;

/// JSON-serializable conversation payload for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationPayload {
    pub id: String,
    pub participants: Vec<String>,
    pub created_at: i64,
    pub is_group: bool,
    pub name: Option<String>,
}

impl From<&DirectConversation> for ConversationPayload {
    fn from(conv: &DirectConversation) -> Self {
        Self {
            id: conv.id.clone(),
            participants: conv.participants.clone(),
            created_at: conv.created_at.timestamp_millis(),
            is_group: conv.is_group,
            name: conv.name.clone(),
        }
    }
}

/// Get all conversations.
#[tauri::command]
pub fn get_conversations(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ConversationPayload>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conversations = db.get_conversations().map_err(|e| e.to_string())?;
    Ok(conversations.iter().map(ConversationPayload::from).collect())
}

/// Create a group conversation.
#[tauri::command]
pub fn create_group_conversation(
    state: tauri::State<'_, AppState>,
    peer_ids: Vec<String>,
    name: Option<String>,
) -> Result<ConversationPayload, String> {
    let mut participants = peer_ids;
    if !participants.contains(&state.peer_id) {
        participants.push(state.peer_id.clone());
    }

    let conv = DirectConversation {
        id: Uuid::new_v4().to_string(),
        participants,
        created_at: Utc::now(),
        is_group: true,
        name,
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.create_conversation(&conv).map_err(|e| e.to_string())?;

    Ok(ConversationPayload::from(&conv))
}

/// Add a peer to an existing conversation.
#[tauri::command]
pub fn add_to_conversation(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    peer_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_participant(&conversation_id, &peer_id)
        .map_err(|e| e.to_string())
}
