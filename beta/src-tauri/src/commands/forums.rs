use chrono::Utc;
use serde::Serialize;
use uuid::Uuid;

use concord_core::types::{ForumPost, ForumScope};

use crate::AppState;

/// JSON-serializable forum post payload for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForumPostPayload {
    pub id: String,
    pub author_id: String,
    pub alias_name: Option<String>,
    pub content: String,
    pub timestamp: i64,
    pub hop_count: u8,
    pub max_hops: u8,
    pub origin_peer: String,
    pub forum_scope: String,
}

impl From<&ForumPost> for ForumPostPayload {
    fn from(post: &ForumPost) -> Self {
        Self {
            id: post.id.clone(),
            author_id: post.author_id.clone(),
            alias_name: post.alias_name.clone(),
            content: post.content.clone(),
            timestamp: post.timestamp.timestamp_millis(),
            hop_count: post.hop_count,
            max_hops: post.max_hops,
            origin_peer: post.origin_peer.clone(),
            forum_scope: match post.forum_scope {
                ForumScope::Local => "local".to_string(),
                ForumScope::Global => "global".to_string(),
            },
        }
    }
}

/// Forum settings payload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForumSettingsPayload {
    pub local_forum_range: u8,
}

/// Post a message to the local forum (hop-limited).
#[tauri::command]
pub async fn post_to_local_forum(
    state: tauri::State<'_, AppState>,
    content: String,
    max_hops: Option<u8>,
) -> Result<ForumPostPayload, String> {
    let hops = max_hops.unwrap_or_else(|| {
        let db = state.db.lock().ok();
        db.and_then(|db| db.get_setting("local_forum_range").ok().flatten())
            .and_then(|v| v.parse().ok())
            .unwrap_or(3)
    });

    let alias_name = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_active_alias(&state.peer_id)
            .ok()
            .flatten()
            .map(|a| a.display_name)
    };

    // Encrypt the forum post content for the wire.
    let plaintext_content = content.clone();
    let forum_key = concord_core::crypto::derive_forum_key("local");
    let (wire_content, encrypted_content, enc_nonce) =
        match concord_core::crypto::encrypt_channel_message(&forum_key, content.as_bytes()) {
            Ok((ct, nonce)) => (String::new(), Some(ct), Some(nonce.to_vec())),
            Err(_) => (content, None, None),
        };

    let wire_post = ForumPost {
        id: Uuid::new_v4().to_string(),
        author_id: state.peer_id.clone(),
        alias_name: alias_name.clone(),
        content: wire_content,
        timestamp: Utc::now(),
        hop_count: 0,
        max_hops: hops,
        origin_peer: state.peer_id.clone(),
        forum_scope: ForumScope::Local,
        signature: state.keypair.sign(b""),
        encrypted_content,
        nonce: enc_nonce,
    };

    // Store locally with decrypted content.
    let local_post = {
        let mut p = wire_post.clone();
        p.content = plaintext_content;
        p.encrypted_content = None;
        p.nonce = None;
        p
    };

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.store_forum_post(&local_post).map_err(|e| e.to_string())?;
    }

    // Publish encrypted version to mesh
    state
        .node
        .post_to_forum(wire_post)
        .await
        .map_err(|e| e.to_string())?;

    Ok(ForumPostPayload::from(&local_post))
}

/// Post a message to the global forum (unlimited propagation).
#[tauri::command]
pub async fn post_to_global_forum(
    state: tauri::State<'_, AppState>,
    content: String,
) -> Result<ForumPostPayload, String> {
    let alias_name = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_active_alias(&state.peer_id)
            .ok()
            .flatten()
            .map(|a| a.display_name)
    };

    // Encrypt the forum post content for the wire.
    let plaintext_content = content.clone();
    let forum_key = concord_core::crypto::derive_forum_key("global");
    let (wire_content, encrypted_content, enc_nonce) =
        match concord_core::crypto::encrypt_channel_message(&forum_key, content.as_bytes()) {
            Ok((ct, nonce)) => (String::new(), Some(ct), Some(nonce.to_vec())),
            Err(_) => (content, None, None),
        };

    let wire_post = ForumPost {
        id: Uuid::new_v4().to_string(),
        author_id: state.peer_id.clone(),
        alias_name: alias_name.clone(),
        content: wire_content,
        timestamp: Utc::now(),
        hop_count: 0,
        max_hops: 255, // unlimited for global
        origin_peer: state.peer_id.clone(),
        forum_scope: ForumScope::Global,
        signature: state.keypair.sign(b""),
        encrypted_content,
        nonce: enc_nonce,
    };

    // Store locally with decrypted content.
    let local_post = {
        let mut p = wire_post.clone();
        p.content = plaintext_content;
        p.encrypted_content = None;
        p.nonce = None;
        p
    };

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.store_forum_post(&local_post).map_err(|e| e.to_string())?;
    }

    // Publish encrypted version to mesh
    state
        .node
        .post_to_forum(wire_post)
        .await
        .map_err(|e| e.to_string())?;

    Ok(ForumPostPayload::from(&local_post))
}

/// Retrieve forum posts by scope with pagination.
#[tauri::command]
pub fn get_forum_posts(
    state: tauri::State<'_, AppState>,
    scope: String,
    limit: Option<u32>,
    before: Option<i64>,
) -> Result<Vec<ForumPostPayload>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let posts = db
        .get_forum_posts(&scope, limit.unwrap_or(50), before)
        .map_err(|e| e.to_string())?;
    Ok(posts.iter().map(ForumPostPayload::from).collect())
}

/// Get the current forum settings.
#[tauri::command]
pub fn get_forum_settings(
    state: tauri::State<'_, AppState>,
) -> Result<ForumSettingsPayload, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let range = db
        .get_setting("local_forum_range")
        .map_err(|e| e.to_string())?
        .and_then(|v| v.parse().ok())
        .unwrap_or(3u8);
    Ok(ForumSettingsPayload {
        local_forum_range: range,
    })
}

/// Set the local forum hop range.
#[tauri::command]
pub fn set_local_forum_range(
    state: tauri::State<'_, AppState>,
    max_hops: u8,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_setting("local_forum_range", &max_hops.to_string())
        .map_err(|e| e.to_string())
}
