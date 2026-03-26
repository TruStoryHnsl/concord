use std::collections::HashMap;

use tracing::debug;

/// Manages WebRTC signaling handshake state.
///
/// Tracks pending SDP offers and ICE candidates for peer connections.
/// The actual SDP content is placeholder for now — real str0m integration
/// will generate proper SDP from the Rtc instance.
pub struct SignalingManager {
    /// Pending SDP offers keyed by peer_id.
    pending_offers: HashMap<String, String>,
    /// Collected ICE candidates keyed by peer_id.
    ice_candidates: HashMap<String, Vec<(String, String)>>,
}

impl SignalingManager {
    pub fn new() -> Self {
        Self {
            pending_offers: HashMap::new(),
            ice_candidates: HashMap::new(),
        }
    }

    /// Create an SDP offer for the given peer.
    ///
    /// Returns a placeholder SDP string. When str0m is fully integrated,
    /// this will generate a real SDP from the Rtc session.
    pub fn create_offer(&mut self, for_peer: &str) -> String {
        let sdp = format!(
            "v=0\r\n\
             o=concord 0 0 IN IP4 0.0.0.0\r\n\
             s=concord-voice\r\n\
             t=0 0\r\n\
             m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n\
             a=rtpmap:111 opus/48000/2\r\n\
             a=sendrecv\r\n"
        );
        self.pending_offers.insert(for_peer.to_string(), sdp.clone());
        debug!(peer = %for_peer, "created SDP offer");
        sdp
    }

    /// Handle an incoming SDP offer from a peer and create an answer.
    ///
    /// Returns a placeholder SDP answer. When str0m is fully integrated,
    /// this will apply the remote offer to an Rtc session and generate
    /// a proper answer.
    pub fn handle_offer(&mut self, from_peer: &str, sdp: &str) -> String {
        debug!(peer = %from_peer, sdp_len = sdp.len(), "handling SDP offer");
        self.pending_offers
            .insert(from_peer.to_string(), sdp.to_string());

        // Generate a placeholder answer
        format!(
            "v=0\r\n\
             o=concord 0 0 IN IP4 0.0.0.0\r\n\
             s=concord-voice\r\n\
             t=0 0\r\n\
             m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n\
             a=rtpmap:111 opus/48000/2\r\n\
             a=sendrecv\r\n"
        )
    }

    /// Handle an incoming SDP answer from a peer.
    ///
    /// Completes the offer/answer exchange. When str0m is fully integrated,
    /// this will apply the remote answer to the Rtc session.
    pub fn handle_answer(&mut self, from_peer: &str, sdp: &str) {
        debug!(peer = %from_peer, sdp_len = sdp.len(), "handling SDP answer");
        // Remove the pending offer now that we have an answer
        self.pending_offers.remove(from_peer);
    }

    /// Handle an incoming ICE candidate from a peer.
    ///
    /// Stores the candidate. When str0m is fully integrated, this will
    /// add the candidate to the Rtc session for connectivity checking.
    pub fn handle_ice_candidate(&mut self, from_peer: &str, candidate: &str, sdp_mid: &str) {
        debug!(
            peer = %from_peer,
            candidate_len = candidate.len(),
            %sdp_mid,
            "handling ICE candidate"
        );
        self.ice_candidates
            .entry(from_peer.to_string())
            .or_default()
            .push((candidate.to_string(), sdp_mid.to_string()));
    }

    /// Check if we have a pending offer for the given peer.
    pub fn has_pending_offer(&self, peer_id: &str) -> bool {
        self.pending_offers.contains_key(peer_id)
    }

    /// Clear all state for a disconnected peer.
    pub fn clear_peer(&mut self, peer_id: &str) {
        self.pending_offers.remove(peer_id);
        self.ice_candidates.remove(peer_id);
    }
}

impl Default for SignalingManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offer_answer_flow() {
        let mut mgr = SignalingManager::new();

        // Peer A creates offer for peer B
        let offer = mgr.create_offer("peer-b");
        assert!(!offer.is_empty());
        assert!(mgr.has_pending_offer("peer-b"));

        // Peer B handles offer and creates answer
        let mut mgr_b = SignalingManager::new();
        let answer = mgr_b.handle_offer("peer-a", &offer);
        assert!(!answer.is_empty());

        // Peer A handles answer
        mgr.handle_answer("peer-b", &answer);
        assert!(!mgr.has_pending_offer("peer-b"));
    }

    #[test]
    fn ice_candidates_collected() {
        let mut mgr = SignalingManager::new();
        mgr.handle_ice_candidate("peer-a", "candidate:1 1 UDP 2122194687 ...", "audio");
        mgr.handle_ice_candidate("peer-a", "candidate:2 1 UDP 2122194686 ...", "audio");
        assert_eq!(mgr.ice_candidates["peer-a"].len(), 2);
    }

    #[test]
    fn clear_peer_removes_state() {
        let mut mgr = SignalingManager::new();
        mgr.create_offer("peer-x");
        mgr.handle_ice_candidate("peer-x", "candidate:1 ...", "audio");
        assert!(mgr.has_pending_offer("peer-x"));

        mgr.clear_peer("peer-x");
        assert!(!mgr.has_pending_offer("peer-x"));
        assert!(!mgr.ice_candidates.contains_key("peer-x"));
    }
}
