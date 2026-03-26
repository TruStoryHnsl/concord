use serde::Serialize;

use concord_core::trust::TrustManager;

use crate::AppState;

/* ── Payloads ────────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustPayload {
    pub peer_id: String,
    pub score: f64,
    pub attestation_count: u32,
    pub badge: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttestationPayload {
    pub attester_id: String,
    pub subject_id: String,
    pub since_timestamp: u64,
}

/* ── Commands ────────────────────────────────────────────────── */

/// Get the trust score for a peer.
#[tauri::command]
pub fn get_peer_trust(
    state: tauri::State<'_, AppState>,
    peer_id: String,
) -> Result<TrustPayload, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Try to get existing trust score, fall back to computing it fresh
    let trust_score = db
        .get_trust_score(&peer_id)
        .map_err(|e| e.to_string())?;

    match trust_score {
        Some(ts) => Ok(TrustPayload {
            peer_id: ts.peer_id,
            score: ts.score,
            attestation_count: ts.attestation_count,
            badge: format!("{:?}", ts.badge),
        }),
        None => Ok(TrustPayload {
            peer_id,
            score: 0.0,
            attestation_count: 0,
            badge: "Unverified".to_string(),
        }),
    }
}

/// Create a signed attestation for a peer and broadcast it.
#[tauri::command]
pub async fn attest_peer(
    state: tauri::State<'_, AppState>,
    peer_id: String,
) -> Result<(), String> {
    let trust_manager = TrustManager::new(&state.keypair);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let attestation = trust_manager.create_attestation(&peer_id, now);

    // Store locally
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.store_attestation(&attestation)
            .map_err(|e| e.to_string())?;
    }

    // Broadcast to the mesh
    state
        .node
        .broadcast_attestation(attestation)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get all attestations for a peer.
#[tauri::command]
pub fn get_attestations(
    state: tauri::State<'_, AppState>,
    peer_id: String,
) -> Result<Vec<AttestationPayload>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let attestations = db
        .get_attestations_for(&peer_id)
        .map_err(|e| e.to_string())?;

    Ok(attestations
        .iter()
        .map(|a| AttestationPayload {
            attester_id: a.attester_id.clone(),
            subject_id: a.subject_id.clone(),
            since_timestamp: a.since_timestamp,
        })
        .collect())
}
