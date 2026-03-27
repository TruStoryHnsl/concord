//! Message history synchronization.
//!
//! When a peer reconnects after being offline, it exchanges vector clocks
//! with connected peers to identify and recover missed messages.
//!
//! Protocol:
//! 1. On ConnectionEstablished, check if we should sync with this peer
//! 2. Send a SyncRequest with our vector clock (channel_id → latest timestamp)
//! 3. The remote peer computes which messages we're missing and sends a SyncResponse
//! 4. We store the received messages and emit a SyncCompleted event

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tracing::{debug, info};

/// How recently we must have synced with a peer to skip re-syncing.
const SYNC_COOLDOWN: Duration = Duration::from_secs(60);

/// Maximum messages to send in a single sync response.
const MAX_SYNC_MESSAGES: u32 = 500;

/// Manages message synchronization state between peers.
pub struct SyncManager {
    /// Tracks when we last synced with each peer to avoid redundant syncs.
    synced_peers: HashMap<String, Instant>,
}

impl SyncManager {
    pub fn new() -> Self {
        Self {
            synced_peers: HashMap::new(),
        }
    }

    /// Check if we should initiate sync with a peer.
    /// Returns false if we synced with them recently (within cooldown).
    pub fn should_sync_with(&self, peer_id: &str) -> bool {
        match self.synced_peers.get(peer_id) {
            Some(last_sync) => last_sync.elapsed() >= SYNC_COOLDOWN,
            None => true,
        }
    }

    /// Mark that we've completed a sync with a peer.
    pub fn mark_synced(&mut self, peer_id: &str) {
        self.synced_peers.insert(peer_id.to_string(), Instant::now());
    }

    /// Given a remote peer's vector clock and a function to query our local messages,
    /// compute the messages the remote peer is missing.
    ///
    /// `local_query` takes (channel_id, after_timestamp, limit) and returns messages.
    pub fn compute_missing_for_peer<F>(
        &self,
        our_clock: &HashMap<String, i64>,
        remote_clock: &HashMap<String, i64>,
        local_query: F,
    ) -> Vec<concord_core::types::Message>
    where
        F: Fn(&str, i64, u32) -> Vec<concord_core::types::Message>,
    {
        let mut missing = Vec::new();

        for (channel_id, &our_latest) in our_clock {
            let remote_latest = remote_clock.get(channel_id).copied().unwrap_or(0);
            if our_latest > remote_latest {
                // We have newer messages in this channel than the remote peer
                let budget = MAX_SYNC_MESSAGES.saturating_sub(missing.len() as u32);
                if budget == 0 {
                    break;
                }
                let channel_messages = local_query(channel_id, remote_latest, budget);
                debug!(
                    channel = %channel_id,
                    remote_latest,
                    our_latest,
                    sending = channel_messages.len(),
                    "sync: sending missing messages"
                );
                missing.extend(channel_messages);
            }
        }

        missing
    }

    /// Given messages received from a sync response, deduplicate against what we already have.
    /// Returns only the messages we should store (new ones).
    pub fn filter_new_messages<F>(
        &self,
        messages: &[concord_core::types::Message],
        has_message: F,
    ) -> Vec<concord_core::types::Message>
    where
        F: Fn(&str) -> bool,
    {
        messages
            .iter()
            .filter(|msg| !has_message(&msg.id))
            .cloned()
            .collect()
    }
}

impl Default for SyncManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;

    #[test]
    fn should_sync_with_unknown_peer() {
        let mgr = SyncManager::new();
        assert!(mgr.should_sync_with("peer_a"));
    }

    #[test]
    fn should_not_sync_within_cooldown() {
        let mut mgr = SyncManager::new();
        mgr.mark_synced("peer_a");
        assert!(!mgr.should_sync_with("peer_a"));
    }

    #[test]
    fn should_sync_after_cooldown() {
        let mut mgr = SyncManager::new();
        // Manually set a past sync time
        mgr.synced_peers.insert(
            "peer_a".to_string(),
            Instant::now() - Duration::from_secs(120),
        );
        assert!(mgr.should_sync_with("peer_a"));
    }

    #[test]
    fn compute_missing_finds_gaps() {
        let mgr = SyncManager::new();
        let mut our_clock = HashMap::new();
        our_clock.insert("general".to_string(), 1000i64);
        our_clock.insert("random".to_string(), 2000i64);

        let mut remote_clock = HashMap::new();
        remote_clock.insert("general".to_string(), 500i64); // remote is behind
        // remote doesn't have "random" at all

        let query = |channel: &str, after_ts: i64, _limit: u32| -> Vec<concord_core::types::Message> {
            // Simulate returning messages after the given timestamp
            let count = match channel {
                "general" => 3,
                "random" => 5,
                _ => 0,
            };
            (0..count)
                .map(|i| concord_core::types::Message {
                    id: format!("{channel}-msg-{i}"),
                    channel_id: channel.to_string(),
                    sender_id: "test".to_string(),
                    content: format!("message {i}"),
                    timestamp: chrono::Utc::now(),
                    signature: vec![],
                    alias_id: None,
                    alias_name: None,
                    encrypted_content: None,
                    nonce: None,
                })
                .collect()
        };

        let missing = mgr.compute_missing_for_peer(&our_clock, &remote_clock, query);
        assert_eq!(missing.len(), 8); // 3 from general + 5 from random
    }

    #[test]
    fn compute_missing_respects_limit() {
        let mgr = SyncManager::new();
        let mut our_clock = HashMap::new();
        // Add many channels to exceed the limit
        for i in 0..100 {
            our_clock.insert(format!("ch-{i}"), 1000);
        }
        let remote_clock = HashMap::new(); // remote has nothing

        let query = |channel: &str, _after_ts: i64, limit: u32| -> Vec<concord_core::types::Message> {
            // Each channel returns 10 messages
            let count = limit.min(10) as usize;
            (0..count)
                .map(|i| concord_core::types::Message {
                    id: format!("{channel}-msg-{i}"),
                    channel_id: channel.to_string(),
                    sender_id: "test".to_string(),
                    content: format!("msg {i}"),
                    timestamp: chrono::Utc::now(),
                    signature: vec![],
                    alias_id: None,
                    alias_name: None,
                    encrypted_content: None,
                    nonce: None,
                })
                .collect()
        };

        let missing = mgr.compute_missing_for_peer(&our_clock, &remote_clock, query);
        assert!(missing.len() <= 500); // MAX_SYNC_MESSAGES
    }

    #[test]
    fn filter_new_messages_deduplicates() {
        let mgr = SyncManager::new();
        let messages = vec![
            concord_core::types::Message {
                id: "msg-1".to_string(),
                channel_id: "ch".to_string(),
                sender_id: "peer".to_string(),
                content: "hello".to_string(),
                timestamp: chrono::Utc::now(),
                signature: vec![],
                alias_id: None,
                alias_name: None,
                encrypted_content: None,
                nonce: None,
            },
            concord_core::types::Message {
                id: "msg-2".to_string(),
                channel_id: "ch".to_string(),
                sender_id: "peer".to_string(),
                content: "world".to_string(),
                timestamp: chrono::Utc::now(),
                signature: vec![],
                alias_id: None,
                alias_name: None,
                encrypted_content: None,
                nonce: None,
            },
        ];

        // We already have msg-1
        let has_msg = |id: &str| -> bool { id == "msg-1" };
        let new_msgs = mgr.filter_new_messages(&messages, has_msg);
        assert_eq!(new_msgs.len(), 1);
        assert_eq!(new_msgs[0].id, "msg-2");
    }
}
