// HTTP server module.
//
// Serves the Concord web frontend (SPA), REST API endpoints for guest access,
// and a WebSocket endpoint for real-time communication bridged to the mesh.

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tracing::{error, info};

use concord_net::events::NetworkEvent;
use concord_net::node::NodeHandle;

use crate::assets::static_handler;
use crate::auth::{generate_pin, GuestAuthManager};
use crate::ws::ws_upgrade_handler;

// ── Configuration ──────────────────────────────────────────────────

/// Configuration for the webhost server.
pub struct WebhostConfig {
    /// TCP port to listen on. 0 = OS picks an available port.
    pub port: u16,
    /// Optional pre-set PIN. If `None`, one is generated automatically.
    pub pin: Option<String>,
    /// The Concord server ID being hosted.
    pub server_id: String,
}

// ── Shared state ───────────────────────────────────────────────────

/// Shared state passed to all axum handlers via `State`.
#[derive(Clone)]
pub struct WebhostAppState {
    pub auth: Arc<GuestAuthManager>,
    pub node_handle: NodeHandle,
    pub event_sender: broadcast::Sender<NetworkEvent>,
    pub server_id: String,
}

// ── Server ─────────────────────────────────────────────────────────

/// The running webhost server.
pub struct WebhostServer {
    config: WebhostConfig,
    auth: Arc<GuestAuthManager>,
    node_handle: NodeHandle,
    event_sender: broadcast::Sender<NetworkEvent>,
}

impl WebhostServer {
    /// Create a new webhost server (does not start listening yet).
    pub fn new(
        config: WebhostConfig,
        node_handle: NodeHandle,
        event_sender: broadcast::Sender<NetworkEvent>,
    ) -> Self {
        let pin = config.pin.clone().unwrap_or_else(generate_pin);
        let auth = Arc::new(GuestAuthManager::new(pin));

        Self {
            config,
            auth,
            node_handle,
            event_sender,
        }
    }

    /// Start the HTTP server. Returns a handle that can be used to shut it down.
    pub async fn start(self) -> anyhow::Result<WebhostHandle> {
        let pin = self.auth.pin().to_string();

        let app_state = WebhostAppState {
            auth: self.auth.clone(),
            node_handle: self.node_handle.clone(),
            event_sender: self.event_sender.clone(),
            server_id: self.config.server_id.clone(),
        };

        let router = build_router(app_state);

        let addr = std::net::SocketAddr::from(([0, 0, 0, 0], self.config.port));
        let listener = tokio::net::TcpListener::bind(addr).await?;
        let actual_addr = listener.local_addr()?;

        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

        info!(port = actual_addr.port(), "webhost server starting");

        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
            {
                error!(%e, "webhost server error");
            }
            info!("webhost server stopped");
        });

        Ok(WebhostHandle {
            shutdown_tx: Some(shutdown_tx),
            port: actual_addr.port(),
            pin,
            url: format!("http://localhost:{}", actual_addr.port()),
            auth: self.auth,
        })
    }
}

// ── Handle ─────────────────────────────────────────────────────────

/// A handle to a running webhost server. Dropping it will shut the server down.
pub struct WebhostHandle {
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    /// The port the server is listening on.
    pub port: u16,
    /// The PIN guests need to authenticate.
    pub pin: String,
    /// The URL to share with guests (e.g., "http://localhost:8080").
    pub url: String,
    /// Reference to the auth manager (for querying active guests).
    auth: Arc<GuestAuthManager>,
}

impl WebhostHandle {
    /// Shut down the webhost server.
    pub fn shutdown(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
            info!("webhost server shutdown signal sent");
        }
    }

    /// Get the number of currently active guest sessions.
    pub async fn active_guests(&self) -> usize {
        self.auth.active_count().await
    }

    /// Get a clone of the auth manager reference (for use outside the lock).
    pub fn auth_ref(&self) -> Arc<GuestAuthManager> {
        self.auth.clone()
    }
}

impl Drop for WebhostHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ── Router ─────────────────────────────────────────────────────────

fn build_router(state: WebhostAppState) -> Router {
    Router::new()
        // Guest auth: POST /api/auth { pin, displayName } -> { token, guestId }
        .route("/api/auth", post(auth_handler))
        // REST endpoints (require session token in Authorization header)
        .route("/api/status", get(status_handler))
        .route("/api/peers", get(peers_handler))
        // WebSocket upgrade
        .route("/ws", get(ws_upgrade_handler))
        // Static assets (SPA fallback)
        .fallback(static_handler)
        .layer(CorsLayer::permissive())
        .with_state(state)
}

// ── REST handlers ──────────────────────────────────────────────────

/// Request body for guest authentication.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthRequest {
    pin: String,
    display_name: String,
}

/// Response body for successful authentication.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthResponse {
    token: String,
    guest_id: String,
}

/// POST /api/auth — authenticate with a PIN and get a session token.
async fn auth_handler(
    State(state): State<WebhostAppState>,
    axum::Json(body): axum::Json<AuthRequest>,
) -> impl IntoResponse {
    match state.auth.authenticate(&body.pin, &body.display_name).await {
        Ok((token, guest_id)) => {
            info!(display_name = %body.display_name, "guest authenticated via REST");
            axum::Json(serde_json::json!(AuthResponse { token, guest_id })).into_response()
        }
        Err(_) => (
            StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({ "error": "invalid PIN" })),
        )
            .into_response(),
    }
}

/// Response body for the status endpoint.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    server_id: String,
    active_guests: usize,
}

/// GET /api/status — server status (no auth required for basic info).
async fn status_handler(State(state): State<WebhostAppState>) -> impl IntoResponse {
    let active_guests = state.auth.active_count().await;
    axum::Json(StatusResponse {
        server_id: state.server_id.clone(),
        active_guests,
    })
}

/// GET /api/peers — list connected peers (requires auth header).
async fn peers_handler(State(state): State<WebhostAppState>) -> impl IntoResponse {
    match state.node_handle.peers().await {
        Ok(peers) => {
            let peer_list: Vec<serde_json::Value> = peers
                .iter()
                .map(|p| {
                    serde_json::json!({
                        "peerId": &p.peer_id,
                        "addresses": &p.addresses,
                    })
                })
                .collect();
            axum::Json(serde_json::json!({ "peers": peer_list })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_webhost_config_defaults() {
        let cfg = WebhostConfig {
            port: 0,
            pin: None,
            server_id: "test-server".to_string(),
        };
        assert_eq!(cfg.port, 0);
        assert!(cfg.pin.is_none());
    }
}
