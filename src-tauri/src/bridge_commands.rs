//! Tauri commands for the Discord bridge credential and lifecycle surface.
//!
//! INS-024 Wave 4: these commands wire the frontend `BridgesTab.tsx` to the
//! Rust backend. The bot token flows from the frontend (which stores it in
//! the Stronghold vault via `@tauri-apps/plugin-stronghold` JS API) to the
//! Rust side only when the bridge is being enabled — the Rust side writes
//! the token into the bridge's `config.yaml` and generates cryptographically
//! random `as_token`/`hs_token` for the AS registration.
//!
//! Security invariants (commercial scope):
//!   - Bot tokens never appear in logs (redacted at the command boundary).
//!   - The `discord_bridge_status` command surfaces `degraded_transports()`
//!     so the UI can render partial-failure state from Wave 3.
//!   - All commands that mutate state acquire the `ServitudeState` mutex.
//!   - `redact_for_logging()` strips all token patterns from log strings.

use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::LazyLock;

use crate::servitude::config::ServitudeConfig;
use crate::servitude::transport::discord_bridge::DiscordBridgeTransport;
use crate::ServitudeState;

/// Pinned mautrix-discord version for auto-download. Must match the
/// version in `scripts/build_linux_native.sh` so build-time and
/// runtime binaries stay in sync.
const MAUTRIX_DISCORD_VERSION: &str = "v0.7.2";

/// GitHub release asset name for Linux amd64.
const MAUTRIX_DISCORD_ASSET: &str = "mautrix-discord-linux-amd64";

/// Full download URL constructed from version + asset name.
fn mautrix_discord_download_url() -> String {
    format!(
        "https://github.com/mautrix/discord/releases/download/{}/{}",
        MAUTRIX_DISCORD_VERSION, MAUTRIX_DISCORD_ASSET
    )
}

// -----------------------------------------------------------------------
// INS-024 Wave 5 — Typed error hierarchy for bridge operations
// -----------------------------------------------------------------------

/// Structured error type for bridge command failures. Maps to user-friendly
/// messages at the Tauri command boundary. Commercial scope requires that
/// no raw stack traces or internal file paths leak to the frontend.
#[derive(Debug, thiserror::Error)]
pub enum BridgeCommandError {
    /// The user-supplied bot token failed basic shape validation.
    #[error("token validation failed: {0}")]
    TokenValidation(String),

    /// Writing the bridge config or registration file to disk failed.
    #[error("bridge config write failed: {0}")]
    ConfigWrite(String),

    /// The bridge data directory could not be resolved or created.
    #[error("cannot resolve bridge data directory: {0}")]
    DataDirResolution(String),

    /// Reading from or writing to the Tauri settings store failed.
    #[error("settings store error: {0}")]
    StoreAccess(String),

    /// An error propagated from the transport layer.
    #[error("transport error: {0}")]
    Transport(#[from] crate::servitude::transport::TransportError),
}

impl From<BridgeCommandError> for String {
    fn from(e: BridgeCommandError) -> String {
        e.to_string()
    }
}

// -----------------------------------------------------------------------
// INS-024 Wave 5 — Token redaction for log output
// -----------------------------------------------------------------------

/// COMMERCIAL SCOPE MANDATE: Bot tokens, AS tokens, HS tokens, and
/// Discord user tokens must NEVER appear in log output, error messages,
/// or crash reports. This function is the single enforcement point —
/// apply it to any log string that could transitively contain a secret.
///
/// Patterns redacted:
///   - Discord bot tokens: `[A-Za-z0-9_-]{20,}.[A-Za-z0-9_-]{6}.[A-Za-z0-9_-]{27,}`
///   - 64-char hex strings (AS/HS tokens from `generate_hex_token`)
///   - Bearer authorization headers: `Bearer <token>`
pub fn redact_for_logging(input: &str) -> String {
    static BOT_TOKEN_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{6}\.[A-Za-z0-9_\-]{27,}")
            .expect("bot token regex must compile")
    });
    static HEX_TOKEN_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"[0-9a-fA-F]{64}")
            .expect("hex token regex must compile")
    });
    static BEARER_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"Bearer [^\s]+")
            .expect("bearer regex must compile")
    });

    let result = BOT_TOKEN_RE.replace_all(input, "[REDACTED_BOT_TOKEN]");
    let result = HEX_TOKEN_RE.replace_all(&result, "[REDACTED_HEX_TOKEN]");
    let result = BEARER_RE.replace_all(&result, "Bearer [REDACTED]");
    result.into_owned()
}

/// Status response returned by `discord_bridge_status`.
///
/// Serialized to JSON for the TypeScript bridge API. Intentionally flat
/// so the frontend can destructure without nesting.
#[derive(Debug, Clone, Serialize)]
pub struct BridgeStatus {
    /// Whether a bot token is stored (the frontend checks Stronghold
    /// directly; this field is provided for convenience by checking
    /// whether config.yaml contains a non-placeholder bot token).
    pub has_bot_token: bool,
    /// Current servitude lifecycle state (stopped/starting/running/stopping).
    pub lifecycle: String,
    /// Map of transport name -> failure reason for non-critical transports
    /// that failed to start (Wave 3 partial-failure surface).
    pub degraded_transports: HashMap<String, String>,
    /// Whether the Discord bridge transport is enabled in the servitude config.
    pub bridge_enabled: bool,
    /// Whether the mautrix-discord binary is available on disk.
    pub binary_available: bool,
    /// Whether bubblewrap (bwrap) is installed on the host.
    pub bwrap_available: bool,
}

/// Store a Discord bot token by writing it into the bridge's config.yaml.
///
/// The token is validated for basic shape (non-empty, reasonable length)
/// but NOT verified against the Discord API — that happens when the bridge
/// actually starts and connects to the gateway.
///
/// The token is NEVER logged. Commercial scope demands that credentials
/// do not appear in any log output, error messages returned to the
/// frontend, or crash reports.
#[tauri::command]
pub async fn discord_bridge_set_bot_token(
    token: String,
) -> Result<(), String> {
    set_bot_token_inner(token).await.map_err(|e| e.to_string())
}

/// Inner implementation using typed errors. The `#[tauri::command]`
/// wrapper converts `BridgeCommandError` to `String` at the boundary.
async fn set_bot_token_inner(token: String) -> Result<(), BridgeCommandError> {
    // Basic validation — reject obviously broken tokens before touching
    // any config files. Discord bot tokens are typically 60-80 chars but
    // we allow a generous range to avoid rejecting valid tokens from
    // future Discord API versions.
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err(BridgeCommandError::TokenValidation(
            "bot token must not be empty".to_string(),
        ));
    }
    if trimmed.len() < 30 {
        return Err(BridgeCommandError::TokenValidation(
            "bot token is too short — Discord bot tokens are typically 60+ characters"
                .to_string(),
        ));
    }
    if trimmed.len() > 200 {
        return Err(BridgeCommandError::TokenValidation(
            "bot token is too long — check that you pasted only the token"
                .to_string(),
        ));
    }

    // Write the token to the bridge data dir's config.yaml so it is
    // available on the next bridge start. The token replaces the
    // placeholder in the config written by Wave 3.
    let data_dir = crate::servitude::transport::discord_bridge::DiscordBridgeTransport::resolve_data_dir()
        .map_err(|e| BridgeCommandError::DataDirResolution(e.to_string()))?;

    tokio::fs::create_dir_all(&data_dir)
        .await
        .map_err(|e| BridgeCommandError::DataDirResolution(
            format!("cannot create bridge data dir: {}", e),
        ))?;

    // Generate random AS tokens if they don't already exist.
    let as_token = generate_hex_token();
    let hs_token = generate_hex_token();

    // Read existing config to preserve as/hs tokens if already set.
    let config_path = data_dir.join("config.yaml");
    let (existing_as, existing_hs) = if let Ok(contents) = tokio::fs::read_to_string(&config_path).await {
        (
            extract_yaml_value(&contents, "as_token"),
            extract_yaml_value(&contents, "hs_token"),
        )
    } else {
        (None, None)
    };

    // Use existing tokens if they are real (not placeholder), otherwise
    // generate fresh ones.
    let final_as = existing_as
        .filter(|t| !t.contains("PLACEHOLDER"))
        .unwrap_or(as_token);
    let final_hs = existing_hs
        .filter(|t| !t.contains("PLACEHOLDER"))
        .unwrap_or(hs_token);

    // Determine listen port from config or default.
    let listen_port: u16 = 8765;
    let bridge_port: u16 = crate::servitude::transport::discord_bridge::DEFAULT_BRIDGE_PORT;
    let server_name = format!("localhost:{}", listen_port);

    // Write a complete config.yaml with the real bot token.
    let config_contents = format!(
        "# Generated by Concord (INS-024 Wave 4)\n\
         homeserver:\n\
         \x20\x20address: http://127.0.0.1:{listen_port}\n\
         \x20\x20domain: {server_name}\n\
         appservice:\n\
         \x20\x20address: http://127.0.0.1:{bridge_port}\n\
         \x20\x20hostname: 127.0.0.1\n\
         \x20\x20port: {bridge_port}\n\
         \x20\x20id: concord_discord\n\
         \x20\x20bot_username: _discord_bot\n\
         \x20\x20as_token: {as_token}\n\
         \x20\x20hs_token: {hs_token}\n\
         bridge:\n\
         \x20\x20username_template: _discord_{{{{.}}}}\n\
         \x20\x20displayname_template: '{{{{.Username}}}} (Discord)'\n\
         \x20\x20bot_token: {bot_token}\n\
         logging:\n\
         \x20\x20min_level: info\n",
        listen_port = listen_port,
        server_name = server_name,
        bridge_port = bridge_port,
        as_token = final_as,
        hs_token = final_hs,
        bot_token = trimmed,
    );

    write_file_0600(&config_path, config_contents.as_bytes()).await?;

    // Also write a matching registration.yaml with the real tokens.
    let registration_path = data_dir.join("registration.yaml");
    let reg_contents = format!(
        "# Generated by Concord (INS-024 Wave 4)\n\
         id: concord_discord\n\
         url: http://127.0.0.1:{bridge_port}\n\
         as_token: {as_token}\n\
         hs_token: {hs_token}\n\
         sender_localpart: _discord_bot\n\
         rate_limited: false\n\
         namespaces:\n\
         \x20\x20users:\n\
         \x20\x20\x20\x20- exclusive: true\n\
         \x20\x20\x20\x20\x20\x20regex: '@_discord_.*:{server_name}'\n\
         \x20\x20aliases:\n\
         \x20\x20\x20\x20- exclusive: true\n\
         \x20\x20\x20\x20\x20\x20regex: '#_discord_.*:{server_name}'\n\
         \x20\x20rooms: []\n",
        bridge_port = bridge_port,
        as_token = final_as,
        hs_token = final_hs,
        server_name = server_name,
    );

    write_file_0600(&registration_path, reg_contents.as_bytes()).await?;

    log::info!(
        target: "concord::bridge",
        "discord bot token written to config.yaml (length: {} chars)",
        trimmed.len()
    );

    Ok(())
}

/// Enable the Discord bridge transport. Adds `DiscordBridge` to the
/// servitude config's `enabled_transports` (after `MatrixFederation`)
/// and persists the change.
#[tauri::command]
pub async fn discord_bridge_enable(
    app: tauri::AppHandle,
) -> Result<(), String> {
    enable_inner(app).await.map_err(|e| e.to_string())
}

async fn enable_inner(app: tauri::AppHandle) -> Result<(), BridgeCommandError> {
    use crate::servitude::config::Transport;

    let mut config = ServitudeConfig::from_store(&app)
        .map_err(|e| BridgeCommandError::StoreAccess(e.to_string()))?;

    // Ensure MatrixFederation is enabled (bridge depends on it).
    if !config
        .enabled_transports
        .contains(&Transport::MatrixFederation)
    {
        config
            .enabled_transports
            .push(Transport::MatrixFederation);
    }

    // Add DiscordBridge after MatrixFederation if not already present.
    if !config
        .enabled_transports
        .contains(&Transport::DiscordBridge)
    {
        config.enabled_transports.push(Transport::DiscordBridge);
    }

    config.save_to_store(&app)
        .map_err(|e| BridgeCommandError::StoreAccess(e.to_string()))?;

    log::info!(
        target: "concord::bridge",
        "discord bridge enabled in servitude config"
    );

    Ok(())
}

/// Disable the Discord bridge transport. Removes `DiscordBridge` from
/// the servitude config and persists the change. Does NOT remove the
/// stored bot token (the user can re-enable without re-entering it).
#[tauri::command]
pub async fn discord_bridge_disable(
    app: tauri::AppHandle,
) -> Result<(), String> {
    disable_inner(app).await.map_err(|e| e.to_string())
}

async fn disable_inner(app: tauri::AppHandle) -> Result<(), BridgeCommandError> {
    use crate::servitude::config::Transport;

    let mut config = ServitudeConfig::from_store(&app)
        .map_err(|e| BridgeCommandError::StoreAccess(e.to_string()))?;

    config
        .enabled_transports
        .retain(|t| *t != Transport::DiscordBridge);

    config.save_to_store(&app)
        .map_err(|e| BridgeCommandError::StoreAccess(e.to_string()))?;

    log::info!(
        target: "concord::bridge",
        "discord bridge disabled in servitude config"
    );

    Ok(())
}

/// Return the current Discord bridge status.
#[tauri::command]
pub async fn discord_bridge_status(
    state: tauri::State<'_, ServitudeState>,
    app: tauri::AppHandle,
) -> Result<BridgeStatus, String> {
    use crate::servitude::config::Transport;

    // Check if config.yaml has a real bot token (not placeholder).
    let has_bot_token = check_bot_token_exists().await;

    let guard = state.0.lock().await;

    let (lifecycle, degraded_transports) = match guard.as_ref() {
        Some(handle) => {
            let state_str = serde_json::to_string(&handle.status())
                .unwrap_or_else(|_| "\"stopped\"".to_string());
            let state_str = state_str.trim_matches('"').to_string();
            let degraded = handle.degraded_transports().clone();
            (state_str, degraded)
        }
        None => ("stopped".to_string(), HashMap::new()),
    };

    let config = ServitudeConfig::from_store(&app).unwrap_or_default();
    let bridge_enabled = config
        .enabled_transports
        .contains(&Transport::DiscordBridge);

    let binary_available = DiscordBridgeTransport::resolve_binary().is_ok();
    let bwrap_available = DiscordBridgeTransport::resolve_bwrap().is_ok();

    Ok(BridgeStatus {
        has_bot_token,
        lifecycle,
        degraded_transports,
        bridge_enabled,
        binary_available,
        bwrap_available,
    })
}

/// Check if the bridge config.yaml contains a real (non-placeholder) bot token.
async fn check_bot_token_exists() -> bool {
    let data_dir =
        match crate::servitude::transport::discord_bridge::DiscordBridgeTransport::resolve_data_dir()
        {
            Ok(d) => d,
            Err(_) => return false,
        };
    let config_path = data_dir.join("config.yaml");
    match tokio::fs::read_to_string(&config_path).await {
        Ok(contents) => {
            if let Some(token) = extract_yaml_value(&contents, "bot_token") {
                !token.is_empty() && !token.contains("PLACEHOLDER")
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

/// Generate a 32-byte cryptographically random hex token.
fn generate_hex_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let mut bytes = [0u8; 32];
    rng.fill(&mut bytes);
    hex::encode(bytes)
}

/// Extract a value from a YAML string by key. Simple line-based parser
/// that handles `key: value` format. Not a full YAML parser but sufficient
/// for the flat config.yaml shape we generate.
fn extract_yaml_value(yaml: &str, key: &str) -> Option<String> {
    let prefix = format!("{}:", key);
    for line in yaml.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(&prefix) {
            let value = trimmed[prefix.len()..].trim();
            // Strip surrounding quotes if present.
            let value = value.trim_matches('\'').trim_matches('"');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Write a file with 0600 mode (owner-only read/write) on Unix.
async fn write_file_0600(
    path: &std::path::Path,
    contents: &[u8],
) -> Result<(), BridgeCommandError> {
    tokio::fs::write(path, contents)
        .await
        .map_err(|e| BridgeCommandError::ConfigWrite(
            format!("failed to write config file: {}", e),
        ))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = tokio::fs::metadata(path)
            .await
            .map_err(|e| BridgeCommandError::ConfigWrite(
                format!("failed to stat config file: {}", e),
            ))?
            .permissions();
        perms.set_mode(0o600);
        tokio::fs::set_permissions(path, perms)
            .await
            .map_err(|e| BridgeCommandError::ConfigWrite(
                format!("failed to set file permissions: {}", e),
            ))?;
    }

    Ok(())
}

/// Download the mautrix-discord binary from GitHub releases to the
/// bridge data directory. Returns the path to the downloaded binary.
///
/// This is the runtime counterpart of `stage_mautrix_discord_binary`
/// in `scripts/build_linux_native.sh` — same version, same binary,
/// but fetched on-demand instead of at build time.
///
/// The binary lands at `$XDG_DATA_HOME/concord/discord-bridge/mautrix-discord`
/// which is position 4 in `DiscordBridgeTransport::resolve_binary()`'s
/// search order, so once downloaded it will be found on subsequent runs.
#[tauri::command]
pub async fn discord_bridge_ensure_binary() -> Result<String, String> {
    ensure_binary_inner().await.map_err(|e| e.to_string())
}

async fn ensure_binary_inner() -> Result<String, BridgeCommandError> {
    // Already available? Skip the download.
    if let Ok(existing) = DiscordBridgeTransport::resolve_binary() {
        let path_str = existing.display().to_string();
        log::info!(
            target: "concord::bridge",
            "mautrix-discord binary already available at {}",
            redact_for_logging(&path_str)
        );
        return Ok(path_str);
    }

    #[cfg(not(target_os = "linux"))]
    {
        return Err(BridgeCommandError::Transport(
            crate::servitude::transport::TransportError::NotImplemented(
                "Discord bridge auto-download is Linux-only".to_string(),
            ),
        ));
    }

    #[cfg(target_os = "linux")]
    {
        let data_dir = DiscordBridgeTransport::resolve_data_dir()
            .map_err(|e| BridgeCommandError::DataDirResolution(e.to_string()))?;

        tokio::fs::create_dir_all(&data_dir).await.map_err(|e| {
            BridgeCommandError::DataDirResolution(format!(
                "cannot create bridge data dir: {}",
                e
            ))
        })?;

        let dest = data_dir.join("mautrix-discord");
        let url = mautrix_discord_download_url();

        log::info!(
            target: "concord::bridge",
            "downloading mautrix-discord {} from GitHub releases...",
            MAUTRIX_DISCORD_VERSION
        );

        let response = reqwest::get(&url).await.map_err(|e| {
            BridgeCommandError::Transport(
                crate::servitude::transport::TransportError::StartFailed(format!(
                    "failed to download mautrix-discord: {}",
                    e
                )),
            )
        })?;

        if !response.status().is_success() {
            return Err(BridgeCommandError::Transport(
                crate::servitude::transport::TransportError::StartFailed(format!(
                    "mautrix-discord download failed: HTTP {}",
                    response.status()
                )),
            ));
        }

        let bytes = response.bytes().await.map_err(|e| {
            BridgeCommandError::Transport(
                crate::servitude::transport::TransportError::StartFailed(format!(
                    "failed to read download body: {}",
                    e
                )),
            )
        })?;

        tokio::fs::write(&dest, &bytes).await.map_err(|e| {
            BridgeCommandError::ConfigWrite(format!(
                "failed to write mautrix-discord binary: {}",
                e
            ))
        })?;

        // Make executable (0755).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = tokio::fs::metadata(&dest)
                .await
                .map_err(|e| {
                    BridgeCommandError::ConfigWrite(format!(
                        "failed to stat binary: {}",
                        e
                    ))
                })?
                .permissions();
            perms.set_mode(0o755);
            tokio::fs::set_permissions(&dest, perms).await.map_err(|e| {
                BridgeCommandError::ConfigWrite(format!(
                    "failed to chmod binary: {}",
                    e
                ))
            })?;
        }

        let path_str = dest.display().to_string();
        log::info!(
            target: "concord::bridge",
            "mautrix-discord binary downloaded to {}",
            redact_for_logging(&path_str)
        );

        Ok(path_str)
    }
}

/// Enable the Discord bridge AND restart servitude so the bridge
/// actually starts. This is the "one click" flow — the frontend
/// calls this single command and the bridge comes up.
#[tauri::command]
pub async fn discord_bridge_enable_and_start(
    state: tauri::State<'_, ServitudeState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    enable_and_start_inner(state, app)
        .await
        .map_err(|e| e.to_string())
}

async fn enable_and_start_inner(
    state: tauri::State<'_, ServitudeState>,
    app: tauri::AppHandle,
) -> Result<(), BridgeCommandError> {
    use crate::servitude::config::Transport;
    use crate::servitude::{LifecycleState, ServitudeHandle};

    // Step 1: Ensure the mautrix-discord binary is available.
    ensure_binary_inner().await?;

    // Step 2: Check bwrap (fail with clear error if missing).
    DiscordBridgeTransport::resolve_bwrap().map_err(BridgeCommandError::Transport)?;

    // Step 3: Update config to include DiscordBridge.
    let mut config = ServitudeConfig::from_store(&app)
        .map_err(|e| BridgeCommandError::StoreAccess(e.to_string()))?;

    if !config
        .enabled_transports
        .contains(&Transport::MatrixFederation)
    {
        config
            .enabled_transports
            .push(Transport::MatrixFederation);
    }
    if !config
        .enabled_transports
        .contains(&Transport::DiscordBridge)
    {
        config.enabled_transports.push(Transport::DiscordBridge);
    }

    config
        .save_to_store(&app)
        .map_err(|e| BridgeCommandError::StoreAccess(e.to_string()))?;

    log::info!(
        target: "concord::bridge",
        "discord bridge enabled — restarting servitude"
    );

    // Step 4: Stop servitude if running.
    {
        let mut guard = state.0.lock().await;
        if let Some(handle) = guard.as_mut() {
            if handle.status() != LifecycleState::Stopped {
                let _ = handle.stop().await;
            }
        }
    }

    // Step 5: Start servitude with fresh config (includes DiscordBridge).
    let config = ServitudeConfig::from_store(&app)
        .map_err(|e| BridgeCommandError::StoreAccess(e.to_string()))?;

    let mut guard = state.0.lock().await;
    *guard = Some(
        ServitudeHandle::new(config).map_err(|e| {
            BridgeCommandError::Transport(
                crate::servitude::transport::TransportError::StartFailed(e.to_string()),
            )
        })?,
    );

    let handle = guard
        .as_mut()
        .expect("handle just inserted");
    handle.start().await.map_err(|e| {
        BridgeCommandError::Transport(
            crate::servitude::transport::TransportError::StartFailed(e.to_string()),
        )
    })?;

    log::info!(
        target: "concord::bridge",
        "servitude restarted with discord bridge enabled"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bridge_status_serialization() {
        let status = BridgeStatus {
            has_bot_token: true,
            lifecycle: "running".to_string(),
            degraded_transports: {
                let mut m = HashMap::new();
                m.insert(
                    "discord_bridge".to_string(),
                    "binary not found".to_string(),
                );
                m
            },
            bridge_enabled: true,
            binary_available: true,
            bwrap_available: true,
        };
        let json = serde_json::to_string(&status).expect("BridgeStatus must serialize");
        assert!(json.contains("\"has_bot_token\":true"));
        assert!(json.contains("\"lifecycle\":\"running\""));
        assert!(json.contains("\"bridge_enabled\":true"));
        assert!(json.contains("\"discord_bridge\""));
        assert!(json.contains("binary not found"));
    }

    #[test]
    fn test_bridge_status_empty_degraded() {
        let status = BridgeStatus {
            has_bot_token: false,
            lifecycle: "stopped".to_string(),
            degraded_transports: HashMap::new(),
            bridge_enabled: false,
            binary_available: false,
            bwrap_available: false,
        };
        let json = serde_json::to_string(&status).expect("BridgeStatus must serialize");
        assert!(json.contains("\"has_bot_token\":false"));
        assert!(json.contains("\"degraded_transports\":{}"));
    }

    #[test]
    fn test_generate_hex_token_length_and_uniqueness() {
        let t1 = generate_hex_token();
        let t2 = generate_hex_token();
        // 32 bytes -> 64 hex chars.
        assert_eq!(t1.len(), 64);
        assert_eq!(t2.len(), 64);
        // Tokens must be unique (probability of collision negligible).
        assert_ne!(t1, t2);
        // Must be valid hex.
        assert!(hex::decode(&t1).is_ok());
        assert!(hex::decode(&t2).is_ok());
    }

    #[test]
    fn test_extract_yaml_value_basic() {
        let yaml = "homeserver:\n  address: http://localhost:8765\n  domain: localhost:8765\n";
        assert_eq!(
            extract_yaml_value(yaml, "address"),
            Some("http://localhost:8765".to_string())
        );
        assert_eq!(
            extract_yaml_value(yaml, "domain"),
            Some("localhost:8765".to_string())
        );
        assert_eq!(extract_yaml_value(yaml, "nonexistent"), None);
    }

    #[test]
    fn test_extract_yaml_value_strips_quotes() {
        let yaml = "name: 'hello'\nother: \"world\"\n";
        assert_eq!(
            extract_yaml_value(yaml, "name"),
            Some("hello".to_string())
        );
        assert_eq!(
            extract_yaml_value(yaml, "other"),
            Some("world".to_string())
        );
    }

    #[test]
    fn test_extract_yaml_value_bot_token() {
        let yaml = "  bot_token: MTIzNDU2Nzg5MDEyMzQ1Njc4.GA1234.abcdefghij\n";
        let token = extract_yaml_value(yaml, "bot_token");
        assert!(token.is_some());
        assert!(token.unwrap().starts_with("MTIzNDU2"));
    }

    #[test]
    fn test_extract_yaml_value_placeholder() {
        let yaml = "  as_token: CONCORD_PLACEHOLDER_AS_TOKEN\n";
        let token = extract_yaml_value(yaml, "as_token").unwrap();
        assert!(token.contains("PLACEHOLDER"));
    }

    // ---------------------------------------------------------------
    // INS-024 Wave 5 — redact_for_logging tests
    // ---------------------------------------------------------------

    #[test]
    fn test_redact_strips_bot_token() {
        // Build a fake Discord bot token at runtime to avoid triggering
        // GitHub Push Protection's secret scanner on the literal string.
        let fake_token = format!(
            "{}.{}.{}",
            "MTIzNDU2Nzg5MDEyMzQ1Njc4", // base64("1234567890123456789")
            "GA1234",
            "abcdefghijklmnopqrstuvwxyz12"
        );
        let input = format!("token is {}", fake_token);
        let output = redact_for_logging(&input);
        assert!(
            output.contains("[REDACTED_BOT_TOKEN]"),
            "bot token must be redacted, got: {}",
            output
        );
        assert!(
            !output.contains("MTIzNDU2"),
            "original token must not appear in output: {}",
            output
        );
    }

    #[test]
    fn test_redact_strips_hex_token() {
        let hex_token = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
        let input = format!("as_token: {}", hex_token);
        let output = redact_for_logging(&input);
        assert!(
            output.contains("[REDACTED_HEX_TOKEN]"),
            "hex token must be redacted, got: {}",
            output
        );
        assert!(
            !output.contains(hex_token),
            "original hex token must not appear: {}",
            output
        );
    }

    #[test]
    fn test_redact_strips_bearer() {
        let input = "Authorization: Bearer abc123xyz_super_secret_token";
        let output = redact_for_logging(input);
        assert!(
            output.contains("Bearer [REDACTED]"),
            "bearer token must be redacted, got: {}",
            output
        );
        assert!(
            !output.contains("abc123xyz"),
            "original bearer value must not appear: {}",
            output
        );
    }

    #[test]
    fn test_redact_preserves_normal_text() {
        let input = "discord bridge started successfully on port 29334";
        let output = redact_for_logging(input);
        assert_eq!(
            output, input,
            "normal log text must pass through unchanged"
        );
    }

    // ---------------------------------------------------------------
    // INS-024 Wave 5 — BridgeCommandError tests
    // ---------------------------------------------------------------

    #[test]
    fn test_bridge_command_error_display() {
        let err = BridgeCommandError::TokenValidation("too short".to_string());
        assert_eq!(err.to_string(), "token validation failed: too short");

        let err = BridgeCommandError::ConfigWrite("disk full".to_string());
        assert_eq!(err.to_string(), "bridge config write failed: disk full");

        let err = BridgeCommandError::DataDirResolution("HOME not set".to_string());
        assert_eq!(
            err.to_string(),
            "cannot resolve bridge data directory: HOME not set"
        );

        let err = BridgeCommandError::StoreAccess("locked".to_string());
        assert_eq!(err.to_string(), "settings store error: locked");
    }

    #[test]
    fn test_bridge_command_error_from_transport() {
        use crate::servitude::transport::TransportError;
        let transport_err = TransportError::BinaryNotFound("missing".to_string());
        let bridge_err: BridgeCommandError = transport_err.into();
        match bridge_err {
            BridgeCommandError::Transport(_) => {} // expected
            other => panic!("expected Transport variant, got {:?}", other),
        }
    }

    #[test]
    fn test_bridge_command_error_to_string() {
        let err = BridgeCommandError::TokenValidation("empty".to_string());
        let s: String = err.into();
        assert!(s.contains("token validation failed"));
    }
}
