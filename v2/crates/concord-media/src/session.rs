use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// State of a single participant in a voice channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticipantState {
    pub peer_id: String,
    pub is_muted: bool,
    pub is_speaking: bool,
    pub joined_at: i64,
}

/// Manages voice state for a single voice channel connection.
pub struct VoiceSession {
    pub channel_id: String,
    pub server_id: String,
    pub local_peer_id: String,
    pub participants: HashMap<String, ParticipantState>,
    pub is_muted: bool,
    pub is_deafened: bool,
    active: bool,
}

impl VoiceSession {
    /// Create a new voice session for the given channel.
    pub fn new(channel_id: String, server_id: String, local_peer_id: String) -> Self {
        Self {
            channel_id,
            server_id,
            local_peer_id,
            participants: HashMap::new(),
            is_muted: false,
            is_deafened: false,
            active: false,
        }
    }

    /// Mark the session as active and add ourselves to the participant list.
    pub fn join(&mut self) {
        self.active = true;
        let now = chrono::Utc::now().timestamp();
        self.participants.insert(
            self.local_peer_id.clone(),
            ParticipantState {
                peer_id: self.local_peer_id.clone(),
                is_muted: self.is_muted,
                is_speaking: false,
                joined_at: now,
            },
        );
    }

    /// Mark the session as inactive and clear all participants.
    pub fn leave(&mut self) {
        self.active = false;
        self.participants.clear();
    }

    /// Add a remote participant to the session.
    pub fn add_participant(&mut self, peer_id: &str) {
        let now = chrono::Utc::now().timestamp();
        self.participants.insert(
            peer_id.to_string(),
            ParticipantState {
                peer_id: peer_id.to_string(),
                is_muted: false,
                is_speaking: false,
                joined_at: now,
            },
        );
    }

    /// Remove a participant from the session.
    pub fn remove_participant(&mut self, peer_id: &str) {
        self.participants.remove(peer_id);
    }

    /// Set the local mute state.
    pub fn set_muted(&mut self, muted: bool) {
        self.is_muted = muted;
        // Update our own participant state
        if let Some(p) = self.participants.get_mut(&self.local_peer_id) {
            p.is_muted = muted;
        }
    }

    /// Set the local deafened state. Deafening also mutes.
    pub fn set_deafened(&mut self, deafened: bool) {
        self.is_deafened = deafened;
        if deafened {
            self.set_muted(true);
        }
    }

    /// Update a remote participant's mute state.
    pub fn update_participant_mute(&mut self, peer_id: &str, muted: bool) {
        if let Some(p) = self.participants.get_mut(peer_id) {
            p.is_muted = muted;
        }
    }

    /// Update a remote participant's speaking state.
    pub fn update_participant_speaking(&mut self, peer_id: &str, speaking: bool) {
        if let Some(p) = self.participants.get_mut(peer_id) {
            p.is_speaking = speaking;
        }
    }

    /// Whether this session is currently active (joined to a channel).
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Get a list of all current participants.
    pub fn participant_list(&self) -> Vec<&ParticipantState> {
        self.participants.values().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_adds_local_participant() {
        let mut session = VoiceSession::new(
            "ch-1".to_string(),
            "srv-1".to_string(),
            "local-peer".to_string(),
        );
        assert!(!session.is_active());
        assert!(session.participants.is_empty());

        session.join();
        assert!(session.is_active());
        assert_eq!(session.participants.len(), 1);
        assert!(session.participants.contains_key("local-peer"));
    }

    #[test]
    fn leave_clears_participants() {
        let mut session = VoiceSession::new(
            "ch-1".to_string(),
            "srv-1".to_string(),
            "local-peer".to_string(),
        );
        session.join();
        session.add_participant("remote-peer");
        assert_eq!(session.participants.len(), 2);

        session.leave();
        assert!(!session.is_active());
        assert!(session.participants.is_empty());
    }

    #[test]
    fn mute_updates_local_participant() {
        let mut session = VoiceSession::new(
            "ch-1".to_string(),
            "srv-1".to_string(),
            "local-peer".to_string(),
        );
        session.join();
        assert!(!session.is_muted);

        session.set_muted(true);
        assert!(session.is_muted);
        assert!(session.participants["local-peer"].is_muted);
    }

    #[test]
    fn deafen_also_mutes() {
        let mut session = VoiceSession::new(
            "ch-1".to_string(),
            "srv-1".to_string(),
            "local-peer".to_string(),
        );
        session.join();

        session.set_deafened(true);
        assert!(session.is_deafened);
        assert!(session.is_muted);
    }

    #[test]
    fn remote_participant_state_updates() {
        let mut session = VoiceSession::new(
            "ch-1".to_string(),
            "srv-1".to_string(),
            "local-peer".to_string(),
        );
        session.join();
        session.add_participant("remote-1");

        session.update_participant_mute("remote-1", true);
        assert!(session.participants["remote-1"].is_muted);

        session.update_participant_speaking("remote-1", true);
        assert!(session.participants["remote-1"].is_speaking);

        session.remove_participant("remote-1");
        assert!(!session.participants.contains_key("remote-1"));
    }
}
