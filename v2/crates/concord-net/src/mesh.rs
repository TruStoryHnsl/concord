//! Mesh Map Manager — the sync protocol and topology management engine.
//!
//! Manages the local mesh map state, handles merge/sync with peers,
//! computes routes, and manages confidence degradation.
//!
//! Integration: The `MeshMapManager` is held by the Node event loop.
//! - On `ConnectionEstablished`: call `on_peer_connected` to trigger sync
//! - On periodic tick (60s): call `tick` for confidence degradation + re-sync
//! - On GossipSub message on `concord/mesh/map-sync`: call `handle_sync_message`
//! - On GossipSub message on `concord/mesh/calls`: call `handle_call_signal`

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use concord_core::mesh_map::*;
use concord_core::wire;
use tracing::{debug, info, warn};

/// GossipSub topic for mesh map synchronization.
pub const TOPIC_MAP_SYNC: &str = "concord/mesh/map-sync";

/// GossipSub topic for call ledger events.
pub const TOPIC_CALLS: &str = "concord/mesh/calls";

/// Minimum interval between syncs with the same peer (seconds).
const SYNC_COOLDOWN_SECS: u64 = 60;

/// Maximum delta entries per sync message.
const MAX_DELTA: usize = MAX_DELTA_ENTRIES;

/// Wire protocol envelope for mesh map messages.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum MeshMapMessage {
    /// "Here's a summary of my map state."
    Digest(MapDigest),
    /// "Here's a request for entries I'm missing."
    DeltaRequest {
        from_peer: String,
        /// Locale hashes we want entries for.
        requested_locales: Vec<MeshAddress>,
        /// Our latest timestamp — send us anything newer.
        since: MeshTimestamp,
    },
    /// "Here are entries you're missing."
    Delta(MapDelta),
}

/// Outbound action requested by the MeshMapManager.
/// The Node event loop processes these by publishing to GossipSub.
#[derive(Debug)]
pub enum MeshMapAction {
    /// Publish a mesh map message to the sync topic.
    PublishSync(Vec<u8>),
    /// Publish a call ledger signal to the calls topic.
    PublishCall(Vec<u8>),
}

/// Minimum interval between syncs with the same friend (seconds).
/// Friends get faster re-sync to ensure real-time data sharing.
const FRIEND_SYNC_COOLDOWN_SECS: u64 = 15;

/// The mesh map manager. Holds local state and drives the sync protocol.
pub struct MeshMapManager {
    /// Our peer ID.
    local_peer_id: String,
    /// Timestamp of last sync per peer (for cooldown).
    last_sync: HashMap<String, Instant>,
    /// Set of peers we've sent a digest to and are awaiting delta.
    pending_syncs: HashSet<String>,
    /// Known friend peer IDs — these get enhanced sync behavior:
    /// - Shorter sync cooldown (eager re-sync)
    /// - Received entries upgraded to TunnelVerified confidence
    friend_ids: HashSet<String>,
}

impl MeshMapManager {
    /// Create a new mesh map manager.
    pub fn new(local_peer_id: String) -> Self {
        Self {
            local_peer_id,
            last_sync: HashMap::new(),
            pending_syncs: HashSet::new(),
            friend_ids: HashSet::new(),
        }
    }

    /// Update the set of known friend peer IDs.
    /// Friends get enhanced sync: shorter cooldown + confidence upgrade on received data.
    pub fn update_friends(&mut self, friend_ids: HashSet<String>) {
        self.friend_ids = friend_ids;
    }

    /// Check if a peer is a friend.
    pub fn is_friend(&self, peer_id: &str) -> bool {
        self.friend_ids.contains(peer_id)
    }

    /// Called when a new peer connection is established.
    /// Returns an action to publish our digest if cooldown has elapsed.
    pub fn on_peer_connected(
        &mut self,
        peer_id: &str,
        entries: &[MeshMapEntry],
    ) -> Option<MeshMapAction> {
        if !self.should_sync(peer_id) {
            return None;
        }
        self.initiate_sync(entries)
    }

    /// Periodic tick — call every ~60 seconds.
    /// Returns actions to publish (digest to connected peers).
    pub fn tick(&mut self, entries: &[MeshMapEntry]) -> Vec<MeshMapAction> {
        let mut actions = Vec::new();

        // Build and broadcast our digest for anyone listening
        if let Some(action) = self.build_digest_action(entries) {
            actions.push(action);
        }

        // Clear expired pending syncs
        let now = Instant::now();
        self.pending_syncs.retain(|peer| {
            self.last_sync
                .get(peer)
                .map_or(false, |t| now.duration_since(*t).as_secs() < SYNC_COOLDOWN_SECS * 2)
        });

        actions
    }

    /// Handle an incoming mesh map sync message from GossipSub.
    /// Returns actions to respond with + entries to merge into our local map.
    pub fn handle_sync_message(
        &mut self,
        data: &[u8],
        local_entries: &[MeshMapEntry],
        local_tombstones: &[(MeshAddress, MeshTimestamp)],
    ) -> (Vec<MeshMapAction>, Vec<MeshMapEntry>) {
        let msg: MeshMapMessage = match wire::decode(data) {
            Ok(m) => m,
            Err(e) => {
                warn!("failed to decode mesh map message: {e}");
                return (vec![], vec![]);
            }
        };

        match msg {
            MeshMapMessage::Digest(digest) => {
                self.handle_digest(digest, local_entries, local_tombstones)
            }
            MeshMapMessage::DeltaRequest {
                from_peer,
                requested_locales,
                since,
            } => {
                let actions =
                    self.handle_delta_request(&from_peer, &requested_locales, since, local_entries, local_tombstones);
                (actions, vec![])
            }
            MeshMapMessage::Delta(delta) => self.handle_delta(delta),
        }
    }

    /// Handle an incoming call ledger signal from GossipSub.
    /// Returns the entry to upsert (or tombstone address to apply).
    pub fn handle_call_signal(
        &self,
        data: &[u8],
    ) -> Option<CallSignalResult> {
        let signal: CallLedgerSignal = match wire::decode(data) {
            Ok(s) => s,
            Err(e) => {
                warn!("failed to decode call signal: {e}");
                return None;
            }
        };

        match signal {
            CallLedgerSignal::Created { entry } | CallLedgerSignal::Updated { entry } => {
                if entry.verify_signature() {
                    Some(CallSignalResult::Upsert(entry))
                } else {
                    warn!("call signal with invalid signature, dropping");
                    None
                }
            }
            CallLedgerSignal::Tombstoned { address, at } => {
                Some(CallSignalResult::Tombstone(address, at))
            }
        }
    }

    /// Create a call ledger entry and return the action to publish it.
    pub fn create_call_signal(entry: &MeshMapEntry) -> MeshMapAction {
        let signal = CallLedgerSignal::Created {
            entry: entry.clone(),
        };
        let data = wire::encode(&signal).expect("call signal encoding should not fail");
        MeshMapAction::PublishCall(data)
    }

    /// Create a call concluded signal.
    pub fn conclude_call_signal(entry: &MeshMapEntry) -> MeshMapAction {
        let signal = CallLedgerSignal::Updated {
            entry: entry.clone(),
        };
        let data = wire::encode(&signal).expect("call signal encoding should not fail");
        MeshMapAction::PublishCall(data)
    }

    /// Create a call tombstone signal.
    pub fn tombstone_call_signal(address: MeshAddress, at: MeshTimestamp) -> MeshMapAction {
        let signal = CallLedgerSignal::Tombstoned { address, at };
        let data = wire::encode(&signal).expect("call signal encoding should not fail");
        MeshMapAction::PublishCall(data)
    }

    /// Merge a received entry into our local set.
    /// Returns the winning entry (theirs or ours) if it should be persisted.
    pub fn merge_received_entry(
        &self,
        theirs: &MeshMapEntry,
        ours: Option<&MeshMapEntry>,
    ) -> Option<MeshMapEntry> {
        // Reject entries with invalid signatures
        if !theirs.verify_signature() {
            warn!(
                addr = %address_hex(&theirs.address),
                "received entry with invalid signature, dropping"
            );
            return None;
        }

        match ours {
            Some(local) => {
                let winner = merge_entry(local, theirs);
                // Only persist if the winner is different from what we have
                if winner.updated_at != local.updated_at
                    || winner.confidence != local.confidence
                {
                    Some(winner)
                } else {
                    None
                }
            }
            // New entry we don't have — accept it
            None => Some(theirs.clone()),
        }
    }

    // ─── Private helpers ───────────────────────────────────────────

    fn should_sync(&self, peer_id: &str) -> bool {
        let cooldown = if self.friend_ids.contains(peer_id) {
            FRIEND_SYNC_COOLDOWN_SECS
        } else {
            SYNC_COOLDOWN_SECS
        };
        match self.last_sync.get(peer_id) {
            Some(last) => last.elapsed().as_secs() >= cooldown,
            None => true,
        }
    }

    fn initiate_sync(&mut self, entries: &[MeshMapEntry]) -> Option<MeshMapAction> {
        self.build_digest_action(entries)
    }

    fn build_digest_action(&mut self, entries: &[MeshMapEntry]) -> Option<MeshMapAction> {
        let digest = self.build_digest(entries);
        let msg = MeshMapMessage::Digest(digest);
        match wire::encode(&msg) {
            Ok(data) => Some(MeshMapAction::PublishSync(data)),
            Err(e) => {
                warn!("failed to encode map digest: {e}");
                None
            }
        }
    }

    fn build_digest(&self, entries: &[MeshMapEntry]) -> MapDigest {
        let mut locale_map: HashMap<String, (u32, MeshTimestamp)> = HashMap::new();

        for entry in entries {
            let locale_key = entry.locale_path.join("/");
            let stat = locale_map.entry(locale_key).or_insert((0, 0));
            stat.0 += 1;
            if entry.updated_at > stat.1 {
                stat.1 = entry.updated_at;
            }
        }

        let locale_summaries = locale_map
            .into_iter()
            .map(|(path, (count, max_ts))| {
                let parts: Vec<String> = path.split('/').map(String::from).collect();
                LocaleSummary {
                    locale_hash: address_for_locale(&parts),
                    entry_count: count,
                    max_updated_at: max_ts,
                }
            })
            .collect();

        let total_entries = entries.len() as u32;
        let latest_update = entries.iter().map(|e| e.updated_at).max().unwrap_or(0);

        MapDigest {
            peer_id: self.local_peer_id.clone(),
            locale_summaries,
            total_entries,
            latest_update,
        }
    }

    fn handle_digest(
        &mut self,
        remote_digest: MapDigest,
        local_entries: &[MeshMapEntry],
        local_tombstones: &[(MeshAddress, MeshTimestamp)],
    ) -> (Vec<MeshMapAction>, Vec<MeshMapEntry>) {
        let peer = &remote_digest.peer_id;
        self.last_sync.insert(peer.clone(), Instant::now());

        // Build our digest to compare
        let our_digest = self.build_digest(local_entries);

        // Find locales where remote has newer data
        let remote_locale_set: HashMap<MeshAddress, MeshTimestamp> = remote_digest
            .locale_summaries
            .iter()
            .map(|s| (s.locale_hash, s.max_updated_at))
            .collect();

        let our_locale_set: HashMap<MeshAddress, MeshTimestamp> = our_digest
            .locale_summaries
            .iter()
            .map(|s| (s.locale_hash, s.max_updated_at))
            .collect();

        // Request locales where remote is newer or has data we don't
        let mut requested_locales = Vec::new();
        let mut our_since: MeshTimestamp = 0;

        for (hash, remote_ts) in &remote_locale_set {
            let our_ts = our_locale_set.get(hash).copied().unwrap_or(0);
            if *remote_ts > our_ts {
                requested_locales.push(*hash);
                if our_ts > our_since {
                    our_since = our_ts;
                }
            }
        }

        let mut actions = Vec::new();

        // If remote has newer data, request it
        if !requested_locales.is_empty() {
            let request = MeshMapMessage::DeltaRequest {
                from_peer: self.local_peer_id.clone(),
                requested_locales,
                since: our_since,
            };
            if let Ok(data) = wire::encode(&request) {
                actions.push(MeshMapAction::PublishSync(data));
            }
        }

        // Also proactively send entries where WE are newer
        let mut delta_entries = Vec::new();
        for (our_hash, our_ts) in &our_locale_set {
            let remote_ts = remote_locale_set.get(our_hash).copied().unwrap_or(0);
            if *our_ts > remote_ts && delta_entries.len() < MAX_DELTA {
                // Send our entries from this locale that are newer than remote's version
                for entry in local_entries {
                    let entry_locale_hash =
                        address_for_locale(&entry.locale_path);
                    if entry_locale_hash == *our_hash && entry.updated_at > remote_ts {
                        delta_entries.push(entry.clone());
                        if delta_entries.len() >= MAX_DELTA {
                            break;
                        }
                    }
                }
            }
        }

        if !delta_entries.is_empty() || !local_tombstones.is_empty() {
            let delta = MapDelta {
                from_peer: self.local_peer_id.clone(),
                entries: delta_entries,
                tombstones: local_tombstones.to_vec(),
            };
            if let Ok(data) = wire::encode(&MeshMapMessage::Delta(delta)) {
                actions.push(MeshMapAction::PublishSync(data));
            }
        }

        (actions, vec![])
    }

    fn handle_delta_request(
        &mut self,
        from_peer: &str,
        requested_locales: &[MeshAddress],
        since: MeshTimestamp,
        local_entries: &[MeshMapEntry],
        local_tombstones: &[(MeshAddress, MeshTimestamp)],
    ) -> Vec<MeshMapAction> {
        self.last_sync.insert(from_peer.to_string(), Instant::now());

        let requested: HashSet<MeshAddress> = requested_locales.iter().copied().collect();

        let delta_entries: Vec<MeshMapEntry> = local_entries
            .iter()
            .filter(|e| {
                let locale_hash = address_for_locale(&e.locale_path);
                requested.contains(&locale_hash) && e.updated_at > since
            })
            .take(MAX_DELTA)
            .cloned()
            .collect();

        // Also include tombstones since the requested timestamp
        let relevant_tombstones: Vec<(MeshAddress, MeshTimestamp)> = local_tombstones
            .iter()
            .filter(|(_, ts)| *ts > since)
            .cloned()
            .collect();

        let mut actions = Vec::new();

        if !delta_entries.is_empty() || !relevant_tombstones.is_empty() {
            let delta = MapDelta {
                from_peer: self.local_peer_id.clone(),
                entries: delta_entries,
                tombstones: relevant_tombstones,
            };
            if let Ok(data) = wire::encode(&MeshMapMessage::Delta(delta)) {
                actions.push(MeshMapAction::PublishSync(data));
            }
        }

        actions
    }

    fn handle_delta(
        &mut self,
        delta: MapDelta,
    ) -> (Vec<MeshMapAction>, Vec<MeshMapEntry>) {
        self.last_sync
            .insert(delta.from_peer.clone(), Instant::now());
        self.pending_syncs.remove(&delta.from_peer);

        let is_friend = self.friend_ids.contains(&delta.from_peer);
        let mut to_merge = Vec::new();

        for mut entry in delta.entries {
            if entry.verify_signature() {
                // Friend-sourced entries get a confidence boost:
                // Speculative → ClusterVerified, ClusterVerified → TunnelVerified
                // (we trust friends' data more than random gossip)
                if is_friend && entry.confidence < ConfidenceTier::TunnelVerified {
                    let upgraded = match entry.confidence {
                        ConfidenceTier::Speculative => ConfidenceTier::ClusterVerified,
                        ConfidenceTier::ClusterVerified => ConfidenceTier::TunnelVerified,
                        other => other,
                    };
                    debug!(
                        addr = %address_hex(&entry.address),
                        from = "friend",
                        old = ?entry.confidence,
                        new = ?upgraded,
                        "upgrading friend-sourced entry confidence"
                    );
                    entry.confidence = upgraded;
                    entry.ttl_ticks = DEFAULT_TTL_TICKS; // refresh TTL
                }
                to_merge.push(entry);
            } else {
                debug!(
                    addr = %address_hex(&entry.address),
                    "dropping delta entry with invalid signature"
                );
            }
        }

        info!(
            from = %delta.from_peer,
            is_friend = is_friend,
            entries = to_merge.len(),
            tombstones = delta.tombstones.len(),
            "received map delta"
        );

        (vec![], to_merge)
    }
}

/// Result of handling a call signal.
pub enum CallSignalResult {
    /// An entry to upsert into the local mesh map.
    Upsert(MeshMapEntry),
    /// An address to tombstone.
    Tombstone(MeshAddress, MeshTimestamp),
}

#[cfg(test)]
mod tests {
    use super::*;
    use concord_core::identity::Keypair;
    use concord_core::types::NodeType;

    fn signed_test_entry(keypair: &Keypair, peer_id: &str, updated_at: MeshTimestamp) -> MeshMapEntry {
        let mut entry = MeshMapEntry {
            address: address_for_node(peer_id),
            kind: EntryKind::Node,
            owner_id: keypair.peer_id(),
            created_at: 0,
            updated_at,
            last_verified_at: None,
            confidence: ConfidenceTier::ClusterVerified,
            ttl_ticks: DEFAULT_TTL_TICKS,
            locale_path: vec!["r-test".to_string(), "c-test".to_string()],
            payload: EntryPayload::Node(NodePayload {
                addresses: vec![],
                display_name: None,
                node_type: NodeType::User,
                capabilities: None,
                engagement_score: None,
                ruc_score: None,
                routes: vec![],
                trust_rating: None,
                is_server_class: false,
                location: None,
                portal_url: None,
            }),
            signature: vec![],
        };
        entry.sign(keypair);
        entry
    }

    #[test]
    fn merge_accepts_valid_entry() {
        let kp = Keypair::generate();
        let manager = MeshMapManager::new("local".to_string());
        let entry = signed_test_entry(&kp, "remote", 100);

        let result = manager.merge_received_entry(&entry, None);
        assert!(result.is_some(), "valid new entry should be accepted");
    }

    #[test]
    fn merge_rejects_invalid_signature() {
        let manager = MeshMapManager::new("local".to_string());
        let entry = MeshMapEntry {
            address: address_for_node("bad"),
            kind: EntryKind::Node,
            owner_id: "wrong_owner".to_string(),
            created_at: 0,
            updated_at: 100,
            last_verified_at: None,
            confidence: ConfidenceTier::Speculative,
            ttl_ticks: 0,
            locale_path: vec![],
            payload: EntryPayload::Node(NodePayload {
                addresses: vec![],
                display_name: None,
                node_type: NodeType::User,
                capabilities: None,
                engagement_score: None,
                ruc_score: None,
                routes: vec![],
                trust_rating: None,
                is_server_class: false,
                location: None,
                portal_url: None,
            }),
            signature: vec![0; 64], // invalid signature
        };

        let result = manager.merge_received_entry(&entry, None);
        assert!(result.is_none(), "invalid signature should be rejected");
    }

    #[test]
    fn digest_reflects_entries() {
        let manager = MeshMapManager::new("local".to_string());
        let kp = Keypair::generate();
        let entries = vec![
            signed_test_entry(&kp, "a", 100),
            signed_test_entry(&kp, "b", 200),
        ];

        let digest = manager.build_digest(&entries);
        assert_eq!(digest.total_entries, 2);
        assert_eq!(digest.latest_update, 200);
        assert_eq!(digest.peer_id, "local");
    }

    #[test]
    fn sync_cooldown_works() {
        let mut manager = MeshMapManager::new("local".to_string());
        let entries = vec![];

        // First sync should succeed
        let action = manager.on_peer_connected("peer_a", &entries);
        assert!(action.is_some());

        // Insert a recent sync record
        manager
            .last_sync
            .insert("peer_a".to_string(), Instant::now());

        // Second sync within cooldown should be skipped
        let action = manager.on_peer_connected("peer_a", &entries);
        assert!(action.is_none());
    }

    #[test]
    fn call_signal_roundtrip() {
        let kp = Keypair::generate();
        let mut entry = MeshMapEntry {
            address: address_for_call("test-call-123"),
            kind: EntryKind::CallLedger,
            owner_id: kp.peer_id(),
            created_at: 1000,
            updated_at: 1000,
            last_verified_at: None,
            confidence: ConfidenceTier::SelfVerified,
            ttl_ticks: DEFAULT_TTL_TICKS,
            locale_path: vec![],
            payload: EntryPayload::CallLedger(CallLedgerPayload {
                call_id: "test-call-123".to_string(),
                participants: vec![kp.peer_id()],
                call_type: CallType::Voice,
                started_at: 1000,
                expires_at: 1000 + 4 * 3600 * 1000,
                hosting_node: kp.peer_id(),
                status: CallStatus::Active,
            }),
            signature: vec![],
        };
        entry.sign(&kp);

        let action = MeshMapManager::create_call_signal(&entry);
        match action {
            MeshMapAction::PublishCall(data) => {
                let manager = MeshMapManager::new("local".to_string());
                let result = manager.handle_call_signal(&data);
                assert!(result.is_some());
            }
            _ => panic!("expected PublishCall action"),
        }
    }
}
