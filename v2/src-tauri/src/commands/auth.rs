use serde::Serialize;

use concord_core::totp;

use crate::AppState;

/* ── Payloads ────────────────────────────────────────────────── */

/// Identity info returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityInfo {
    pub peer_id: String,
    pub display_name: String,
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
    Ok(IdentityInfo {
        peer_id: state.peer_id.clone(),
        display_name: state.display_name.clone(),
    })
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
