//! Tauri commands for the Discord bridge control surface (INS-024 Wave 4).
//!
//! This module provides the Rust-side handlers for the four commands consumed
//! by `client/src/api/bridges.ts`:
//!
//!   * `discord_bridge_status` — returns the current [`BridgeStatus`] struct.
//!   * `discord_bridge_set_bot_token` — validates and persists a Discord bot token.
//!   * `discord_bridge_enable` — marks the bridge as enabled in the settings store.
//!   * `discord_bridge_disable` — marks the bridge as disabled.
//!
//! ## Credential storage
//!
//! Bot tokens are stored in the `tauri-plugin-store` `settings.json` under the
//! `bridge_credentials` key. This is NOT hardware-protected — it is equivalent
//! in security posture to the existing `server_url` and `servitude` keys that
//! live in the same file. A proper stronghold swap (DBus-independent, KDF-derived
//! key) is tracked as INS-024 Wave 5.
//!
//! We deliberately do NOT use `tauri-plugin-stronghold` here because stronghold's
//! KDF requires a master passphrase on every app start, which the current
//! `BridgesTab.tsx` UI does not prompt for. Stronghold wiring is the Wave 5
//! hardening task.
//!
//! ## RBAC
//!
//! These are Tauri commands — they are only accessible from the native app shell.
//! The web-deployment bridge admin path uses `server/routers/admin_bridges.py`
//! with its own ADMIN_USER_IDS RBAC gate. No additional RBAC is needed here.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::servitude::{ServitudeHandle, transport::TransportRuntime};

/// Store key for bridge credentials (bot token, enabled flag).
const BRIDGE_CREDS_KEY: &str = "bridge_credentials";

/// Store file (shared with servitude + server_url).
const SETTINGS_STORE: &str = "settings.json";

/// Minimum length for a Discord bot token. Discord bot tokens are base64url
/// strings in the format `<snowflake_b64>.<hmac_part>`. The shortest valid
/// token we've observed is ~59 characters; 50 is a conservative lower bound.
const BOT_TOKEN_MIN_LEN: usize = 50;

/// Maximum length for a Discord bot token. Tokens are generally ≤100
/// characters; 200 is a generous upper bound that rejects clearly wrong
/// pastes (e.g., pasting an entire config file).
const BOT_TOKEN_MAX_LEN: usize = 200;

/// Bridge status returned by `discord_bridge_status`.
///
/// Matches the TypeScript interface in `client/src/api/bridges.ts`:
/// ```typescript
/// export interface BridgeStatus {
///   has_bot_token: boolean;
///   lifecycle: string;
///   degraded_transports: Record<string, string>;
///   bridge_enabled: boolean;
///   binary_available: bool;
///   bwrap_available: bool;
/// }
/// ```
#[derive(Debug, Serialize, Deserialize)]
pub struct BridgeStatus {
    /// Whether a Discord bot token has been persisted to the store.
    pub has_bot_token: bool,
    /// Current lifecycle state of the servitude handle ("stopped", "starting",
    /// "running", "stopping"). "unknown" when no handle exists.
    pub lifecycle: String,
    /// Non-critical transports that failed to start, keyed by transport name.
    /// Empty when no degraded transports exist.
    pub degraded_transports: std::collections::HashMap<String, String>,
    /// Whether the Discord bridge is marked enabled in the settings store.
    pub bridge_enabled: bool,
    /// Whether the `mautrix-discord` binary is discoverable on this machine.
    pub binary_available: bool,
    /// Whether `bwrap` (bubblewrap) is discoverable on this machine.
    pub bwrap_available: bool,
}

/// Persisted credential shape in the settings store.
#[derive(Debug, Serialize, Deserialize, Default)]
struct BridgeCredentials {
    /// Discord bot token (NOT hardware-protected in Wave 4).
    #[serde(default)]
    bot_token: Option<String>,
    /// Whether the user has enabled the Discord bridge.
    #[serde(default)]
    enabled: bool,
}

// ---- Helper: load/save credentials ----

fn load_creds(app: &AppHandle) -> BridgeCredentials {
    let Ok(store) = app.store(SETTINGS_STORE) else {
        return BridgeCredentials::default();
    };
    store
        .get(BRIDGE_CREDS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn save_creds(app: &AppHandle, creds: &BridgeCredentials) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    let v = serde_json::to_value(creds).map_err(|e| e.to_string())?;
    store.set(BRIDGE_CREDS_KEY, v);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Helper: binary availability probes ----

fn is_binary_available() -> bool {
    crate::servitude::transport::discord_bridge::DiscordBridgeTransport::resolve_bridge_binary()
        .is_ok()
}

fn is_bwrap_available() -> bool {
    crate::servitude::transport::discord_bridge::DiscordBridgeTransport::resolve_bwrap().is_ok()
}

// ---- Helper: resolve data directory for bridge ----

fn bridge_data_dir() -> PathBuf {
    crate::servitude::transport::discord_bridge::DiscordBridgeTransport::resolve_data_dir()
        .unwrap_or_else(|_| PathBuf::from("/tmp/concord/discord_bridge"))
}

// ---- Tauri commands ----

/// Return the current Discord bridge status.
///
/// This command is safe to call at any time and is idempotent. The frontend
/// polls it on a 5-second interval via `BridgesTab.tsx`.
#[tauri::command]
pub async fn discord_bridge_status(
    app: AppHandle,
    state: tauri::State<'_, crate::ServitudeState>,
) -> Result<BridgeStatus, String> {
    let creds = load_creds(&app);

    let (lifecycle, degraded) = {
        let guard = state.0.lock().await;
        match guard.as_ref() {
            Some(handle) => {
                let lc = format!("{:?}", handle.status()).to_lowercase();
                let deg = handle.degraded_transports().clone();
                (lc, deg)
            }
            None => ("stopped".to_string(), std::collections::HashMap::new()),
        }
    };

    Ok(BridgeStatus {
        has_bot_token: creds.bot_token.is_some(),
        lifecycle,
        degraded_transports: degraded,
        bridge_enabled: creds.enabled,
        binary_available: is_binary_available(),
        bwrap_available: is_bwrap_available(),
    })
}

/// Store a Discord bot token.
///
/// Validates the token for basic shape (length 50–200 characters, non-empty).
/// Does NOT validate that the token is actually accepted by the Discord API —
/// that verification happens when the bridge is started.
#[tauri::command]
pub async fn discord_bridge_set_bot_token(
    app: AppHandle,
    token: String,
) -> Result<(), String> {
    validate_bot_token(&token)?;
    let mut creds = load_creds(&app);
    creds.bot_token = Some(token);
    save_creds(&app, &creds)
}

/// Mark the Discord bridge as enabled.
///
/// Does NOT start the bridge immediately — the bridge starts on the next
/// `servitude_start` call. This command only persists the intent.
#[tauri::command]
pub async fn discord_bridge_enable(app: AppHandle) -> Result<(), String> {
    let mut creds = load_creds(&app);
    creds.enabled = true;
    save_creds(&app, &creds)
}

/// Mark the Discord bridge as disabled.
///
/// Does NOT stop a running bridge — the bridge will stop on the next
/// `servitude_stop` call. This command only persists the intent.
#[tauri::command]
pub async fn discord_bridge_disable(app: AppHandle) -> Result<(), String> {
    let mut creds = load_creds(&app);
    creds.enabled = false;
    save_creds(&app, &creds)
}

// ---- Validation ----

/// Validate a Discord bot token for basic shape.
pub fn validate_bot_token(token: &str) -> Result<(), String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err("bot token must not be empty".to_string());
    }
    if trimmed.len() < BOT_TOKEN_MIN_LEN {
        return Err(format!(
            "bot token is too short ({} chars); Discord bot tokens are at least {} characters",
            trimmed.len(),
            BOT_TOKEN_MIN_LEN
        ));
    }
    if trimmed.len() > BOT_TOKEN_MAX_LEN {
        return Err(format!(
            "bot token is too long ({} chars); expected at most {} characters",
            trimmed.len(),
            BOT_TOKEN_MAX_LEN
        ));
    }
    Ok(())
}

// ---- Unit tests ----

#[cfg(test)]
mod tests {
    use super::*;

    /// BridgeStatus must serialize to JSON with all expected fields present.
    #[test]
    fn test_bridge_status_struct_serializes_correctly() {
        let status = BridgeStatus {
            has_bot_token: true,
            lifecycle: "running".to_string(),
            degraded_transports: [("discord_bridge".to_string(), "bwrap not found".to_string())]
                .into_iter()
                .collect(),
            bridge_enabled: true,
            binary_available: false,
            bwrap_available: false,
        };

        let json = serde_json::to_string(&status).expect("BridgeStatus must serialize");

        assert!(
            json.contains("has_bot_token"),
            "JSON must contain has_bot_token"
        );
        assert!(
            json.contains("lifecycle"),
            "JSON must contain lifecycle"
        );
        assert!(
            json.contains("degraded_transports"),
            "JSON must contain degraded_transports"
        );
        assert!(
            json.contains("bridge_enabled"),
            "JSON must contain bridge_enabled"
        );
        assert!(
            json.contains("binary_available"),
            "JSON must contain binary_available"
        );
        assert!(
            json.contains("bwrap_available"),
            "JSON must contain bwrap_available"
        );

        // Confirm the lifecycle value comes through.
        assert!(json.contains("running"), "lifecycle must be 'running'");
    }

    /// A very short token must be rejected.
    #[test]
    fn test_set_bot_token_rejects_short_token() {
        let short = "A".repeat(10);
        let err = validate_bot_token(&short).expect_err("10-char token must be rejected");
        assert!(err.contains("too short"), "error must mention 'too short'");
    }

    /// A token of valid length must pass validation.
    #[test]
    fn test_set_bot_token_accepts_valid_token() {
        // Craft a token of length 70 — well within 50–200.
        let token = "A".repeat(70);
        validate_bot_token(&token).expect("70-char token must be accepted");
    }

    /// An empty token must be rejected.
    #[test]
    fn test_set_bot_token_rejects_empty_token() {
        let err = validate_bot_token("").expect_err("empty token must be rejected");
        assert!(err.contains("must not be empty"), "error must mention empty");
    }

    /// A token over the maximum length must be rejected.
    #[test]
    fn test_set_bot_token_rejects_too_long_token() {
        let too_long = "B".repeat(201);
        let err = validate_bot_token(&too_long).expect_err("201-char token must be rejected");
        assert!(err.contains("too long"), "error must mention 'too long'");
    }

    /// Whitespace-only token must be rejected.
    #[test]
    fn test_set_bot_token_rejects_whitespace_only() {
        let err = validate_bot_token("   ").expect_err("whitespace token must be rejected");
        assert!(
            err.contains("must not be empty"),
            "error must mention empty"
        );
    }
}
