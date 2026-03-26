// Webhook endpoint module.
//
// Handles incoming HTTP POST requests from external integrations (bots, CI, RSS,
// monitoring, etc.) and publishes them as messages on the appropriate GossipSub
// channel topic. Authentication is via the webhook token in the URL path — no
// PIN required.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{debug, warn};

use concord_store::Database;

use crate::server::WebhostAppState;

// ── Rate limiter ────────────────────────────────────────────────────

/// Simple in-memory rate limiter: max 60 messages per minute per webhook.
pub struct RateLimiter {
    buckets: Mutex<HashMap<String, Vec<Instant>>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Returns `true` if the request is allowed, `false` if rate-limited.
    pub async fn check(&self, webhook_id: &str) -> bool {
        let mut buckets = self.buckets.lock().await;
        let now = Instant::now();
        let window = std::time::Duration::from_secs(60);

        let entries = buckets.entry(webhook_id.to_string()).or_default();

        // Remove entries older than the window.
        entries.retain(|t| now.duration_since(*t) < window);

        if entries.len() >= 60 {
            return false;
        }

        entries.push(now);
        true
    }
}

// ── Shared webhook state ────────────────────────────────────────────

/// Extended state for webhook handling, wrapping the base app state.
#[derive(Clone)]
pub struct WebhookState {
    pub app_state: WebhostAppState,
    pub db: Arc<std::sync::Mutex<Database>>,
    pub rate_limiter: Arc<RateLimiter>,
}

// ── Request / Response types ────────────────────────────────────────

/// The JSON body expected from webhook callers.
#[derive(Debug, Deserialize)]
pub struct WebhookPayload {
    /// The message content to post.
    pub content: String,
    /// Optional override for the display name (otherwise uses the webhook name).
    pub username: Option<String>,
}

/// Successful response from the webhook endpoint.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookResponse {
    pub message_id: String,
    pub channel_id: String,
}

/// Error response from the webhook endpoint.
#[derive(Debug, Serialize)]
pub struct WebhookErrorResponse {
    pub error: String,
}

// ── Handler ─────────────────────────────────────────────────────────

/// POST /api/webhook/{token}
///
/// Receives a message from an external integration and publishes it to the
/// webhook's target channel on the GossipSub mesh.
pub async fn webhook_handler(
    Path(token): Path<String>,
    State(state): State<WebhookState>,
    axum::Json(body): axum::Json<WebhookPayload>,
) -> impl IntoResponse {
    // 1. Look up webhook by token.
    let webhook = {
        let db = match state.db.lock() {
            Ok(db) => db,
            Err(e) => {
                warn!(%e, "failed to lock database for webhook");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    axum::Json(serde_json::json!(WebhookErrorResponse {
                        error: "internal error".to_string(),
                    })),
                )
                    .into_response();
            }
        };
        match db.get_webhook_by_token(&token) {
            Ok(Some(wh)) => wh,
            Ok(None) => {
                return (
                    StatusCode::NOT_FOUND,
                    axum::Json(serde_json::json!(WebhookErrorResponse {
                        error: "invalid webhook token".to_string(),
                    })),
                )
                    .into_response();
            }
            Err(e) => {
                warn!(%e, "database error looking up webhook");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    axum::Json(serde_json::json!(WebhookErrorResponse {
                        error: "internal error".to_string(),
                    })),
                )
                    .into_response();
            }
        }
    };

    // 2. Rate limit check.
    if !state.rate_limiter.check(&webhook.id).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            axum::Json(serde_json::json!(WebhookErrorResponse {
                error: "rate limit exceeded (max 60 messages/minute)".to_string(),
            })),
        )
            .into_response();
    }

    // 3. Validate content.
    if body.content.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!(WebhookErrorResponse {
                error: "content must not be empty".to_string(),
            })),
        )
            .into_response();
    }

    // 4. Build a Concord message with bot sender.
    let display_name = body.username.unwrap_or_else(|| webhook.name.clone());
    let sender_id = format!("bot:{}", webhook.name);
    let msg_id = uuid_v4();

    let message = concord_core::types::Message {
        id: msg_id.clone(),
        channel_id: webhook.channel_id.clone(),
        sender_id,
        content: body.content,
        timestamp: chrono::Utc::now(),
        signature: Vec::new(), // bots don't sign
        alias_id: None,
        alias_name: Some(display_name),
    };

    // 5. Encode and publish to GossipSub.
    let topic = format!("concord/{}/{}", webhook.server_id, webhook.channel_id);

    match concord_core::wire::encode(&message) {
        Ok(data) => {
            if let Err(e) = state.app_state.node_handle.publish(&topic, data).await {
                warn!(%e, "failed to publish webhook message");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    axum::Json(serde_json::json!(WebhookErrorResponse {
                        error: "failed to publish message".to_string(),
                    })),
                )
                    .into_response();
            }
        }
        Err(e) => {
            warn!(%e, "failed to encode webhook message");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!(WebhookErrorResponse {
                    error: "failed to encode message".to_string(),
                })),
            )
                .into_response();
        }
    }

    // 6. Store the message locally.
    {
        let db = match state.db.lock() {
            Ok(db) => db,
            Err(e) => {
                warn!(%e, "failed to lock database for storing webhook message");
                // Message was already published; return success anyway.
                return axum::Json(serde_json::json!(WebhookResponse {
                    message_id: msg_id,
                    channel_id: webhook.channel_id,
                }))
                .into_response();
            }
        };
        if let Err(e) = db.insert_message(&message) {
            warn!(%e, "failed to store webhook message locally");
        }
        if let Err(e) = db.increment_webhook_usage(&webhook.id) {
            warn!(%e, "failed to increment webhook usage counter");
        }
    }

    debug!(webhook_id = %webhook.id, msg_id = %msg_id, "webhook message published");

    // 7. Broadcast the message event so WebSocket guests and the Tauri app see it.
    let _ = state.app_state.event_sender.send(
        concord_net::events::NetworkEvent::ConcordMessageReceived {
            message,
        },
    );

    axum::Json(serde_json::json!(WebhookResponse {
        message_id: msg_id,
        channel_id: webhook.channel_id,
    }))
    .into_response()
}

/// Generate a simple UUID-v4-like string.
fn uuid_v4() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: [u8; 16] = rng.r#gen();
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rate_limiter_allows_under_limit() {
        let limiter = RateLimiter::new();
        for _ in 0..60 {
            assert!(limiter.check("wh1").await);
        }
    }

    #[tokio::test]
    async fn rate_limiter_blocks_over_limit() {
        let limiter = RateLimiter::new();
        for _ in 0..60 {
            assert!(limiter.check("wh1").await);
        }
        // 61st should be blocked
        assert!(!limiter.check("wh1").await);
    }

    #[tokio::test]
    async fn rate_limiter_independent_per_webhook() {
        let limiter = RateLimiter::new();
        for _ in 0..60 {
            assert!(limiter.check("wh1").await);
        }
        // wh2 should still be allowed
        assert!(limiter.check("wh2").await);
        // wh1 should be blocked
        assert!(!limiter.check("wh1").await);
    }
}
