use serde::Serialize;

use concord_webhost::{WebhostConfig, WebhostServer};

use crate::{AppState, WebhostState};

/// Information about a running webhost instance, returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhostInfoPayload {
    pub url: String,
    pub pin: String,
    pub port: u16,
    pub active_guests: usize,
}

/// Start the guest web server for browser access.
///
/// If a webhost is already running, it is stopped first.
#[tauri::command]
pub async fn start_webhost(
    state: tauri::State<'_, AppState>,
    webhost_state: tauri::State<'_, WebhostState>,
    port: Option<u16>,
) -> Result<WebhostInfoPayload, String> {
    // Stop existing server if any.
    {
        let mut guard = webhost_state.handle.lock().map_err(|e| e.to_string())?;
        if let Some(mut existing) = guard.take() {
            existing.shutdown();
        }
    }

    let config = WebhostConfig {
        port: port.unwrap_or(0),
        pin: None, // auto-generate
        server_id: state.peer_id.clone(),
        db: Some(state.db.clone()),
    };

    let server = WebhostServer::new(
        config,
        state.node.clone(),
        state.event_sender.clone(),
    );

    let handle = server.start().await.map_err(|e| e.to_string())?;

    let info = WebhostInfoPayload {
        url: handle.url.clone(),
        pin: handle.pin.clone(),
        port: handle.port,
        active_guests: 0,
    };

    {
        let mut guard = webhost_state.handle.lock().map_err(|e| e.to_string())?;
        *guard = Some(handle);
    }

    Ok(info)
}

/// Stop the guest web server.
#[tauri::command]
pub fn stop_webhost(
    webhost_state: tauri::State<'_, WebhostState>,
) -> Result<(), String> {
    let mut guard = webhost_state.handle.lock().map_err(|e| e.to_string())?;
    if let Some(mut handle) = guard.take() {
        handle.shutdown();
    }
    Ok(())
}

/// Get the current webhost status, or null if not running.
#[tauri::command]
pub async fn get_webhost_status(
    webhost_state: tauri::State<'_, WebhostState>,
) -> Result<Option<WebhostInfoPayload>, String> {
    // Extract info without holding the MutexGuard across an await point.
    let basic_info = {
        let guard = webhost_state.handle.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(|handle| {
            (
                handle.url.clone(),
                handle.pin.clone(),
                handle.port,
                handle.auth_ref(),
            )
        })
    };

    match basic_info {
        Some((url, pin, port, auth)) => {
            let active_guests = auth.active_count().await;
            Ok(Some(WebhostInfoPayload {
                url,
                pin,
                port,
                active_guests,
            }))
        }
        None => Ok(None),
    }
}
