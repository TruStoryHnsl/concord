use serde::Serialize;
use uuid::Uuid;

use concord_core::totp;
use concord_core::types::Alias;

use crate::AppState;

/* ── Payloads ────────────────────────────────────────────────── */

/// Identity info returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityInfo {
    pub peer_id: String,
    pub display_name: String,
    pub active_alias: Option<AliasPayload>,
}

/// Alias payload returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AliasPayload {
    pub id: String,
    pub display_name: String,
    pub is_active: bool,
    pub created_at: i64,
}

impl From<&Alias> for AliasPayload {
    fn from(a: &Alias) -> Self {
        Self {
            id: a.id.clone(),
            display_name: a.display_name.clone(),
            is_active: a.is_active,
            created_at: a.created_at.timestamp_millis(),
        }
    }
}

/// TOTP setup payload returned when the user sets up 2FA.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpSetupPayload {
    pub secret_base32: String,
    pub uri: String,
}

/* ── Commands ────────────────────────────────────────────────── */

/// Returns the local node's identity.
#[tauri::command]
pub fn get_identity(state: tauri::State<'_, AppState>) -> Result<IdentityInfo, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let active_alias = db
        .get_active_alias(&state.peer_id)
        .map_err(|e| e.to_string())?
        .map(|a| AliasPayload::from(&a));
    Ok(IdentityInfo {
        peer_id: state.peer_id.clone(),
        display_name: state.display_name.clone(),
        active_alias,
    })
}

/// Get all aliases for the local identity.
#[tauri::command]
pub fn get_aliases(state: tauri::State<'_, AppState>) -> Result<Vec<AliasPayload>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let aliases = db
        .get_aliases(&state.peer_id)
        .map_err(|e| e.to_string())?;
    Ok(aliases.iter().map(AliasPayload::from).collect())
}

/// Create a new alias for the local identity.
#[tauri::command]
pub fn create_alias(
    state: tauri::State<'_, AppState>,
    display_name: String,
) -> Result<AliasPayload, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let alias_id = Uuid::new_v4().to_string();
    let alias = Alias {
        id: alias_id.clone(),
        root_identity: state.peer_id.clone(),
        display_name,
        avatar_seed: Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now(),
        is_active: false,
    };
    db.create_alias(&alias).map_err(|e| e.to_string())?;
    Ok(AliasPayload::from(&alias))
}

/// Switch to a different alias.
#[tauri::command]
pub fn switch_alias(
    state: tauri::State<'_, AppState>,
    alias_id: String,
) -> Result<AliasPayload, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_active_alias(&state.peer_id, &alias_id)
        .map_err(|e| e.to_string())?;
    let alias = db
        .get_active_alias(&state.peer_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "alias not found".to_string())?;
    Ok(AliasPayload::from(&alias))
}

/// Update an alias's display name.
#[tauri::command]
pub fn update_alias(
    state: tauri::State<'_, AppState>,
    alias_id: String,
    display_name: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_alias(&alias_id, &display_name)
        .map_err(|e| e.to_string())?;
    // Also update the known alias record so remote peers see the new name
    db.store_known_alias(&alias_id, &state.peer_id, &display_name)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete an alias. Cannot delete the last alias.
#[tauri::command]
pub fn delete_alias(
    state: tauri::State<'_, AppState>,
    alias_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let aliases = db
        .get_aliases(&state.peer_id)
        .map_err(|e| e.to_string())?;
    if aliases.len() <= 1 {
        return Err("cannot delete the last alias".to_string());
    }
    let was_active = aliases.iter().any(|a| a.id == alias_id && a.is_active);
    db.delete_alias(&alias_id).map_err(|e| e.to_string())?;
    // If we deleted the active alias, activate the first remaining one
    if was_active {
        let remaining = db
            .get_aliases(&state.peer_id)
            .map_err(|e| e.to_string())?;
        if let Some(first) = remaining.first() {
            db.set_active_alias(&state.peer_id, &first.id)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Generate a TOTP secret and return the setup info (secret + otpauth:// URI).
/// The secret is saved but NOT enabled until `enable_totp` is called.
#[tauri::command]
pub fn setup_totp(state: tauri::State<'_, AppState>) -> Result<TotpSetupPayload, String> {
    let secret = totp::generate_totp_secret();

    // Save the secret (not yet enabled)
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.save_totp_secret(&state.peer_id, &secret)
            .map_err(|e| e.to_string())?;
    }

    let secret_base32 = totp::secret_to_base32(&secret);
    let uri = totp::totp_uri(&secret, &state.peer_id, "Concord");

    Ok(TotpSetupPayload {
        secret_base32,
        uri,
    })
}

/// Verify a TOTP code against the stored secret.
#[tauri::command]
pub fn verify_totp_code(
    state: tauri::State<'_, AppState>,
    code: u32,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let secret = db
        .get_totp_secret(&state.peer_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no TOTP secret configured".to_string())?;

    Ok(totp::verify_totp(&secret, code, 1))
}

/// Verify the code then enable TOTP 2FA. Requires a valid code to confirm
/// the user has configured their authenticator app correctly.
#[tauri::command]
pub fn enable_totp(
    state: tauri::State<'_, AppState>,
    code: u32,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let secret = db
        .get_totp_secret(&state.peer_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no TOTP secret configured — call setup_totp first".to_string())?;

    if !totp::verify_totp(&secret, code, 1) {
        return Err("invalid TOTP code".to_string());
    }

    db.enable_totp(&state.peer_id)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Verify the code then disable TOTP 2FA.
#[tauri::command]
pub fn disable_totp(
    state: tauri::State<'_, AppState>,
    code: u32,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let secret = db
        .get_totp_secret(&state.peer_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "TOTP is not configured".to_string())?;

    if !totp::verify_totp(&secret, code, 1) {
        return Err("invalid TOTP code".to_string());
    }

    db.disable_totp(&state.peer_id)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Check if TOTP 2FA is currently enabled.
#[tauri::command]
pub fn is_totp_enabled(
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.is_totp_enabled(&state.peer_id)
        .map_err(|e| e.to_string())
}
