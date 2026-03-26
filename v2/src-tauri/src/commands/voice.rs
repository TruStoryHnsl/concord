use serde::Serialize;
use tauri::State;

use crate::AppState;

/* ── Payloads ────────────────────────────────────────────────── */

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatePayload {
    pub is_in_voice: bool,
    pub channel_id: Option<String>,
    pub server_id: Option<String>,
    pub is_muted: bool,
    pub is_deafened: bool,
    pub participants: Vec<ParticipantPayload>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantPayload {
    pub peer_id: String,
    pub is_muted: bool,
    pub is_speaking: bool,
}

/* ── Commands ────────────────────────────────────────────────── */

/// Join a voice channel. The media engine establishes a WebRTC session
/// with the channel's SFU host (or directly for small groups).
#[tauri::command]
pub async fn join_voice(
    state: State<'_, AppState>,
    server_id: String,
    channel_id: String,
) -> Result<VoiceStatePayload, String> {
    let peer_id = state.peer_id.clone();

    // TODO: Wire to VoiceEngineHandle once concord-media is integrated.
    // For now return a synthetic "connected" state so the frontend can
    // be developed in parallel.
    Ok(VoiceStatePayload {
        is_in_voice: true,
        channel_id: Some(channel_id),
        server_id: Some(server_id),
        is_muted: false,
        is_deafened: false,
        participants: vec![ParticipantPayload {
            peer_id,
            is_muted: false,
            is_speaking: false,
        }],
    })
}

/// Leave the currently connected voice channel.
#[tauri::command]
pub async fn leave_voice(
    _state: State<'_, AppState>,
) -> Result<(), String> {
    // TODO: Wire to VoiceEngineHandle.
    Ok(())
}

/// Toggle local microphone mute. Returns the new muted state.
#[tauri::command]
pub async fn toggle_mute(
    _state: State<'_, AppState>,
) -> Result<bool, String> {
    // TODO: Wire to VoiceEngineHandle to actually mute the capture track.
    // For now toggle is handled purely in the frontend store; this command
    // will later synchronize with the media engine.
    Ok(true)
}

/// Toggle deafen (mute all incoming audio). Returns the new deafened state.
#[tauri::command]
pub async fn toggle_deafen(
    _state: State<'_, AppState>,
) -> Result<bool, String> {
    // TODO: Wire to VoiceEngineHandle.
    Ok(false)
}

/// Query the current voice connection state.
#[tauri::command]
pub async fn get_voice_state(
    _state: State<'_, AppState>,
) -> Result<VoiceStatePayload, String> {
    // TODO: Read from VoiceEngineHandle.
    Ok(VoiceStatePayload {
        is_in_voice: false,
        channel_id: None,
        server_id: None,
        is_muted: false,
        is_deafened: false,
        participants: vec![],
    })
}
