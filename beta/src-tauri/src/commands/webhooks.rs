use serde::Serialize;
use uuid::Uuid;

use concord_store::WebhookRecord;

use crate::AppState;

// ── Payload structs ─────────────────────────────────────────────────

/// JSON payload for a webhook, sent to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookPayload {
    pub id: String,
    pub server_id: String,
    pub channel_id: String,
    pub name: String,
    pub token: String,
    pub webhook_url: String,
    pub message_count: i64,
    pub created_at: i64,
    pub last_used: Option<i64>,
}

fn record_to_payload(rec: &WebhookRecord, host_port: Option<u16>) -> WebhookPayload {
    let port = host_port.unwrap_or(8080);
    WebhookPayload {
        id: rec.id.clone(),
        server_id: rec.server_id.clone(),
        channel_id: rec.channel_id.clone(),
        name: rec.name.clone(),
        token: rec.token.clone(),
        webhook_url: format!("http://localhost:{}/api/webhook/{}", port, rec.token),
        message_count: rec.message_count,
        created_at: rec.created_at,
        last_used: rec.last_used,
    }
}

/// Generate a cryptographically random base62 token (32 characters).
fn generate_webhook_token() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

// ── Commands ────────────────────────────────────────────────────────

/// Create a new webhook for a server channel.
#[tauri::command]
pub fn create_webhook(
    state: tauri::State<'_, AppState>,
    webhost_state: tauri::State<'_, crate::WebhostState>,
    server_id: String,
    channel_id: String,
    name: String,
) -> Result<WebhookPayload, String> {
    let now = chrono::Utc::now().timestamp();
    let token = generate_webhook_token();

    let record = WebhookRecord {
        id: Uuid::new_v4().to_string(),
        server_id,
        channel_id,
        name,
        token,
        avatar_seed: Some(Uuid::new_v4().to_string()),
        created_by: state.peer_id.clone(),
        created_at: now,
        last_used: None,
        message_count: 0,
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.create_webhook(&record).map_err(|e| e.to_string())?;

    // Get the webhost port if running.
    let port = {
        let guard = webhost_state.handle.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(|h| h.port)
    };

    Ok(record_to_payload(&record, port))
}

/// Get all webhooks for a server.
#[tauri::command]
pub fn get_webhooks(
    state: tauri::State<'_, AppState>,
    webhost_state: tauri::State<'_, crate::WebhostState>,
    server_id: String,
) -> Result<Vec<WebhookPayload>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let webhooks = db
        .get_webhooks_for_server(&server_id)
        .map_err(|e| e.to_string())?;

    let port = {
        let guard = webhost_state.handle.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(|h| h.port)
    };

    Ok(webhooks.iter().map(|w| record_to_payload(w, port)).collect())
}

/// Delete a webhook by ID.
#[tauri::command]
pub fn delete_webhook(
    state: tauri::State<'_, AppState>,
    webhook_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_webhook(&webhook_id).map_err(|e| e.to_string())?;
    Ok(())
}
