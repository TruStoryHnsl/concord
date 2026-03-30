//! Storage layer for mesh map entries, tombstones, route cache, and engagement counters.

use crate::db::{Database, Result, StoreError};
use concord_core::mesh_map::*;

impl Database {
    // ─── Mesh Map Entries ──────────────────────────────────────────

    /// Insert or update a mesh map entry. Payload is MessagePack-encoded.
    pub fn upsert_mesh_map_entry(&self, entry: &MeshMapEntry) -> Result<()> {
        let payload_bytes =
            rmp_serde::to_vec(&entry.payload).map_err(|e| StoreError::InvalidData(e.to_string()))?;
        let locale_json = serde_json::to_string(&entry.locale_path)?;
        let confidence_str = confidence_to_str(entry.confidence);

        self.conn.execute(
            "INSERT INTO mesh_map_entries
                (address, kind, owner_id, created_at, updated_at, last_verified_at,
                 confidence, ttl_ticks, locale_path, payload, signature)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(address) DO UPDATE SET
                kind = ?2, owner_id = ?3, updated_at = ?5, last_verified_at = ?6,
                confidence = ?7, ttl_ticks = ?8, locale_path = ?9, payload = ?10, signature = ?11",
            rusqlite::params![
                entry.address.as_slice(),
                kind_to_str(&entry.kind),
                entry.owner_id,
                entry.created_at,
                entry.updated_at,
                entry.last_verified_at,
                confidence_str,
                entry.ttl_ticks,
                locale_json,
                payload_bytes,
                entry.signature,
            ],
        )?;
        Ok(())
    }

    /// Get a mesh map entry by address.
    pub fn get_mesh_map_entry(&self, address: &MeshAddress) -> Result<Option<MeshMapEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT address, kind, owner_id, created_at, updated_at, last_verified_at,
                    confidence, ttl_ticks, locale_path, payload, signature
             FROM mesh_map_entries WHERE address = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![address.as_slice()], row_to_entry)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Get all mesh map entries of a given kind.
    pub fn get_mesh_map_entries_by_kind(&self, kind: &EntryKind) -> Result<Vec<MeshMapEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT address, kind, owner_id, created_at, updated_at, last_verified_at,
                    confidence, ttl_ticks, locale_path, payload, signature
             FROM mesh_map_entries WHERE kind = ?1
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(rusqlite::params![kind_to_str(kind)], row_to_entry)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(StoreError::Sqlite)
    }

    /// Get all mesh map entries within a locale (prefix match on locale_path JSON).
    pub fn get_mesh_map_entries_by_locale(&self, locale_prefix: &str) -> Result<Vec<MeshMapEntry>> {
        let pattern = format!("{locale_prefix}%");
        let mut stmt = self.conn.prepare(
            "SELECT address, kind, owner_id, created_at, updated_at, last_verified_at,
                    confidence, ttl_ticks, locale_path, payload, signature
             FROM mesh_map_entries WHERE locale_path LIKE ?1
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(rusqlite::params![pattern], row_to_entry)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(StoreError::Sqlite)
    }

    /// Get all mesh map entries (for digest computation / sync).
    pub fn get_all_mesh_map_entries(&self) -> Result<Vec<MeshMapEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT address, kind, owner_id, created_at, updated_at, last_verified_at,
                    confidence, ttl_ticks, locale_path, payload, signature
             FROM mesh_map_entries ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_entry)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(StoreError::Sqlite)
    }

    /// Get entries updated after a given timestamp (for delta computation).
    pub fn get_mesh_map_entries_since(&self, since: MeshTimestamp) -> Result<Vec<MeshMapEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT address, kind, owner_id, created_at, updated_at, last_verified_at,
                    confidence, ttl_ticks, locale_path, payload, signature
             FROM mesh_map_entries WHERE updated_at > ?1
             ORDER BY updated_at ASC",
        )?;
        let rows = stmt.query_map(rusqlite::params![since], row_to_entry)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(StoreError::Sqlite)
    }

    /// Delete a mesh map entry by address.
    pub fn delete_mesh_map_entry(&self, address: &MeshAddress) -> Result<bool> {
        let count = self
            .conn
            .execute(
                "DELETE FROM mesh_map_entries WHERE address = ?1",
                rusqlite::params![address.as_slice()],
            )?;
        Ok(count > 0)
    }

    /// Get the total count of mesh map entries.
    pub fn mesh_map_entry_count(&self) -> Result<u32> {
        let count: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM mesh_map_entries",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Get the latest updated_at timestamp across all entries.
    pub fn mesh_map_latest_update(&self) -> Result<MeshTimestamp> {
        let ts: MeshTimestamp = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(updated_at), 0) FROM mesh_map_entries",
                [],
                |row| row.get(0),
            )?;
        Ok(ts)
    }

    /// Degrade confidence for entries whose TTL has reached 0.
    /// Returns the number of entries degraded.
    pub fn degrade_mesh_map_confidence(&self) -> Result<u32> {
        // First, decrement all TTLs
        self.conn.execute(
            "UPDATE mesh_map_entries SET ttl_ticks = MAX(0, ttl_ticks - 1)
             WHERE ttl_ticks > 0",
            [],
        )?;

        // Degrade confidence where TTL hit 0
        let degraded = self.conn.execute(
            "UPDATE mesh_map_entries SET
                confidence = CASE confidence
                    WHEN 'self_verified' THEN 'tunnel_verified'
                    WHEN 'tunnel_verified' THEN 'cluster_verified'
                    WHEN 'cluster_verified' THEN 'speculative'
                    ELSE confidence
                END
             WHERE ttl_ticks = 0 AND confidence != 'speculative'",
            [],
        )?;
        Ok(degraded as u32)
    }

    // ─── Tombstones ───────────────���────────────────────────────────

    /// Record a tombstone for a deleted entry.
    pub fn insert_tombstone(&self, address: &MeshAddress, reason: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis() as u64;
        self.conn.execute(
            "INSERT OR REPLACE INTO mesh_map_tombstones (address, tombstoned_at, reason)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![address.as_slice(), now, reason],
        )?;
        Ok(())
    }

    /// Check if an address has been tombstoned.
    pub fn is_tombstoned(&self, address: &MeshAddress) -> Result<bool> {
        let count: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM mesh_map_tombstones WHERE address = ?1",
            rusqlite::params![address.as_slice()],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Get all tombstones since a given timestamp.
    pub fn get_tombstones_since(
        &self,
        since: MeshTimestamp,
    ) -> Result<Vec<(MeshAddress, MeshTimestamp)>> {
        let mut stmt = self.conn.prepare(
            "SELECT address, tombstoned_at FROM mesh_map_tombstones WHERE tombstoned_at > ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![since], |row| {
            let addr_blob: Vec<u8> = row.get(0)?;
            let ts: MeshTimestamp = row.get(1)?;
            let mut addr = [0u8; 32];
            if addr_blob.len() == 32 {
                addr.copy_from_slice(&addr_blob);
            }
            Ok((addr, ts))
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(StoreError::Sqlite)
    }

    /// Clean up old tombstones (older than the given age in milliseconds).
    pub fn cleanup_tombstones(&self, max_age_ms: u64) -> Result<u32> {
        let cutoff = chrono::Utc::now().timestamp_millis() as u64 - max_age_ms;
        let count = self.conn.execute(
            "DELETE FROM mesh_map_tombstones WHERE tombstoned_at < ?1",
            rusqlite::params![cutoff],
        )?;
        Ok(count as u32)
    }

    // ─── Route Cache ��──────────────────────────────────────────────

    /// Cache a computed route between two addresses.
    pub fn cache_route(
        &self,
        from: &MeshAddress,
        to: &MeshAddress,
        route: &MeshRoute,
    ) -> Result<()> {
        let route_bytes =
            rmp_serde::to_vec(route).map_err(|e| StoreError::InvalidData(e.to_string()))?;
        let now = chrono::Utc::now().timestamp_millis() as u64;
        self.conn.execute(
            "INSERT OR REPLACE INTO mesh_routes (from_address, to_address, route_data, cost, computed_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![from.as_slice(), to.as_slice(), route_bytes, route.cost, now],
        )?;
        Ok(())
    }

    /// Get a cached route between two addresses.
    pub fn get_cached_route(
        &self,
        from: &MeshAddress,
        to: &MeshAddress,
    ) -> Result<Option<MeshRoute>> {
        let mut stmt = self.conn.prepare(
            "SELECT route_data FROM mesh_routes WHERE from_address = ?1 AND to_address = ?2",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![from.as_slice(), to.as_slice()], |row| {
            let data: Vec<u8> = row.get(0)?;
            Ok(data)
        })?;
        match rows.next() {
            Some(Ok(data)) => {
                let route: MeshRoute = rmp_serde::from_slice(&data)
                    .map_err(|e| StoreError::InvalidData(e.to_string()))?;
                Ok(Some(route))
            }
            Some(Err(e)) => Err(StoreError::Sqlite(e)),
            None => Ok(None),
        }
    }

    /// Invalidate all cached routes (e.g., after topology change).
    pub fn clear_route_cache(&self) -> Result<()> {
        self.conn.execute("DELETE FROM mesh_routes", [])?;
        Ok(())
    }

    // ─── Engagement Counters ─────��─────────────────────────────────

    /// Ensure an engagement counter row exists for a peer.
    pub fn ensure_engagement_counters(&self, peer_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis() as u64;
        self.conn.execute(
            "INSERT OR IGNORE INTO engagement_counters (peer_id, last_active_at) VALUES (?1, ?2)",
            rusqlite::params![peer_id, now],
        )?;
        Ok(())
    }

    /// Increment a specific engagement counter.
    pub fn increment_engagement(&self, peer_id: &str, field: EngagementField) -> Result<()> {
        self.ensure_engagement_counters(peer_id)?;
        let now = chrono::Utc::now().timestamp_millis() as u64;
        let sql = format!(
            "UPDATE engagement_counters SET {} = {} + 1, last_active_at = ?1 WHERE peer_id = ?2",
            field.column_name(),
            field.column_name()
        );
        self.conn.execute(&sql, rusqlite::params![now, peer_id])?;
        Ok(())
    }

    /// Get engagement counters for a peer.
    pub fn get_engagement_counters(&self, peer_id: &str) -> Result<EngagementCounters> {
        self.ensure_engagement_counters(peer_id)?;
        let counters = self.conn.query_row(
            "SELECT messages_sent, messages_read, forum_posts_created, forum_posts_read,
                    call_minutes_initiated, call_minutes_participated
             FROM engagement_counters WHERE peer_id = ?1",
            rusqlite::params![peer_id],
            |row| {
                Ok(EngagementCounters {
                    messages_sent: row.get(0)?,
                    messages_read: row.get(1)?,
                    forum_posts_created: row.get(2)?,
                    forum_posts_read: row.get(3)?,
                    call_minutes_initiated: row.get(4)?,
                    call_minutes_participated: row.get(5)?,
                })
            },
        )?;
        Ok(counters)
    }

    /// Update the cached engagement score for a peer.
    pub fn update_engagement_score(&self, peer_id: &str, score: i8) -> Result<()> {
        self.conn.execute(
            "UPDATE engagement_counters SET engagement_score = ?1 WHERE peer_id = ?2",
            rusqlite::params![score, peer_id],
        )?;
        Ok(())
    }
}

// ─── Engagement Field Enum ────────��────────────────────────────────────

/// Which engagement counter to increment.
pub enum EngagementField {
    MessagesSent,
    MessagesRead,
    ForumPostsCreated,
    ForumPostsRead,
    CallMinutesInitiated,
    CallMinutesParticipated,
}

impl EngagementField {
    fn column_name(&self) -> &'static str {
        match self {
            Self::MessagesSent => "messages_sent",
            Self::MessagesRead => "messages_read",
            Self::ForumPostsCreated => "forum_posts_created",
            Self::ForumPostsRead => "forum_posts_read",
            Self::CallMinutesInitiated => "call_minutes_initiated",
            Self::CallMinutesParticipated => "call_minutes_participated",
        }
    }
}

// ─── Helpers ───────────────────────────────────────────────────────────

fn confidence_to_str(c: ConfidenceTier) -> &'static str {
    match c {
        ConfidenceTier::Speculative => "speculative",
        ConfidenceTier::ClusterVerified => "cluster_verified",
        ConfidenceTier::TunnelVerified => "tunnel_verified",
        ConfidenceTier::SelfVerified => "self_verified",
    }
}

fn str_to_confidence(s: &str) -> ConfidenceTier {
    match s {
        "self_verified" => ConfidenceTier::SelfVerified,
        "tunnel_verified" => ConfidenceTier::TunnelVerified,
        "cluster_verified" => ConfidenceTier::ClusterVerified,
        _ => ConfidenceTier::Speculative,
    }
}

fn kind_to_str(k: &EntryKind) -> &'static str {
    match k {
        EntryKind::Node => "node",
        EntryKind::Place => "place",
        EntryKind::CallLedger => "call_ledger",
        EntryKind::Locale => "locale",
    }
}

fn str_to_kind(s: &str) -> EntryKind {
    match s {
        "node" => EntryKind::Node,
        "place" => EntryKind::Place,
        "call_ledger" => EntryKind::CallLedger,
        _ => EntryKind::Locale,
    }
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<MeshMapEntry> {
    let addr_blob: Vec<u8> = row.get(0)?;
    let mut address = [0u8; 32];
    if addr_blob.len() == 32 {
        address.copy_from_slice(&addr_blob);
    }

    let kind_str: String = row.get(1)?;
    let confidence_str: String = row.get(6)?;
    let locale_json: String = row.get(8)?;
    let payload_bytes: Vec<u8> = row.get(9)?;

    let locale_path: Vec<String> = serde_json::from_str(&locale_json).unwrap_or_default();
    let payload: EntryPayload = rmp_serde::from_slice(&payload_bytes).unwrap_or_else(|_| {
        EntryPayload::Node(NodePayload {
            addresses: vec![],
            display_name: None,
            node_type: concord_core::types::NodeType::User,
            capabilities: None,
            engagement_score: None,
            ruc_score: None,
            routes: vec![],
            trust_rating: None,
            is_server_class: false,
            location: None,
            portal_url: None,
        })
    });

    Ok(MeshMapEntry {
        address,
        kind: str_to_kind(&kind_str),
        owner_id: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        last_verified_at: row.get(5)?,
        confidence: str_to_confidence(&confidence_str),
        ttl_ticks: row.get(7)?,
        locale_path,
        payload,
        signature: row.get(10)?,
    })
}

// ─── Place Helpers ─────────────────────────────────────────────────

impl Database {
    /// Get all Place entries from the mesh map.
    pub fn get_places(&self) -> Result<Vec<MeshMapEntry>> {
        self.get_mesh_map_entries_by_kind(&EntryKind::Place)
    }

    /// Get a Place entry by its place_id.
    pub fn get_place_by_id(&self, place_id: &str) -> Result<Option<MeshMapEntry>> {
        let address = address_for_place(place_id);
        self.get_mesh_map_entry(&address)
    }
}

// ─── Block List ────────────────────────────────────────────────────

/// A blocked peer record.
pub struct BlockedPeer {
    pub peer_id: String,
    pub blocked_at: u64,
    pub reason: String,
}

impl Database {
    /// Block a peer. Idempotent — re-blocking updates the reason.
    pub fn block_peer(&self, peer_id: &str, reason: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis() as u64;
        self.conn.execute(
            "INSERT INTO blocked_peers (peer_id, blocked_at, reason)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(peer_id) DO UPDATE SET reason = ?3, blocked_at = ?2",
            rusqlite::params![peer_id, now, reason],
        )?;
        Ok(())
    }

    /// Unblock a peer.
    pub fn unblock_peer(&self, peer_id: &str) -> Result<bool> {
        let count = self.conn.execute(
            "DELETE FROM blocked_peers WHERE peer_id = ?1",
            rusqlite::params![peer_id],
        )?;
        Ok(count > 0)
    }

    /// Check if a peer is blocked.
    pub fn is_peer_blocked(&self, peer_id: &str) -> Result<bool> {
        let count: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM blocked_peers WHERE peer_id = ?1",
            rusqlite::params![peer_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Get all blocked peers.
    pub fn get_blocked_peers(&self) -> Result<Vec<BlockedPeer>> {
        let mut stmt = self.conn.prepare(
            "SELECT peer_id, blocked_at, reason FROM blocked_peers ORDER BY blocked_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(BlockedPeer {
                peer_id: row.get(0)?,
                blocked_at: row.get(1)?,
                reason: row.get(2)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(StoreError::Sqlite)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use concord_core::types::NodeType;

    fn test_node_entry(peer_id: &str) -> MeshMapEntry {
        MeshMapEntry {
            address: address_for_node(peer_id),
            kind: EntryKind::Node,
            owner_id: peer_id.to_string(),
            created_at: 1000,
            updated_at: 2000,
            last_verified_at: Some(1500),
            confidence: ConfidenceTier::ClusterVerified,
            ttl_ticks: DEFAULT_TTL_TICKS,
            locale_path: vec!["r-test".to_string(), "c-test".to_string()],
            payload: EntryPayload::Node(NodePayload {
                addresses: vec!["/ip4/127.0.0.1/tcp/5000".to_string()],
                display_name: Some("TestNode".to_string()),
                node_type: NodeType::User,
                capabilities: None,
                engagement_score: Some(3),
                ruc_score: Some(0.85),
                routes: vec![],
                trust_rating: Some(0.9),
                is_server_class: false,
                location: None,
                portal_url: None,
            }),
            signature: vec![0u8; 64],
        }
    }

    #[test]
    fn upsert_and_get_entry() {
        let db = Database::open_in_memory().unwrap();
        let entry = test_node_entry("peer_abc");
        db.upsert_mesh_map_entry(&entry).unwrap();

        let retrieved = db.get_mesh_map_entry(&entry.address).unwrap().unwrap();
        assert_eq!(retrieved.owner_id, "peer_abc");
        assert_eq!(retrieved.confidence, ConfidenceTier::ClusterVerified);
        assert_eq!(retrieved.ttl_ticks, DEFAULT_TTL_TICKS);
    }

    #[test]
    fn get_entries_by_kind() {
        let db = Database::open_in_memory().unwrap();
        db.upsert_mesh_map_entry(&test_node_entry("peer_1")).unwrap();
        db.upsert_mesh_map_entry(&test_node_entry("peer_2")).unwrap();

        let nodes = db.get_mesh_map_entries_by_kind(&EntryKind::Node).unwrap();
        assert_eq!(nodes.len(), 2);

        let places = db.get_mesh_map_entries_by_kind(&EntryKind::Place).unwrap();
        assert_eq!(places.len(), 0);
    }

    #[test]
    fn delete_and_tombstone() {
        let db = Database::open_in_memory().unwrap();
        let entry = test_node_entry("peer_del");
        let addr = entry.address;
        db.upsert_mesh_map_entry(&entry).unwrap();

        assert!(!db.is_tombstoned(&addr).unwrap());
        db.delete_mesh_map_entry(&addr).unwrap();
        db.insert_tombstone(&addr, "test_removal").unwrap();

        assert!(db.get_mesh_map_entry(&addr).unwrap().is_none());
        assert!(db.is_tombstoned(&addr).unwrap());
    }

    #[test]
    fn engagement_counter_lifecycle() {
        let db = Database::open_in_memory().unwrap();
        db.increment_engagement("me", EngagementField::MessagesSent).unwrap();
        db.increment_engagement("me", EngagementField::MessagesSent).unwrap();
        db.increment_engagement("me", EngagementField::MessagesRead).unwrap();

        let counters = db.get_engagement_counters("me").unwrap();
        assert_eq!(counters.messages_sent, 2);
        assert_eq!(counters.messages_read, 1);

        let score = compute_engagement_score(&counters);
        db.update_engagement_score("me", score).unwrap();
    }

    #[test]
    fn entry_count_and_latest_update() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(db.mesh_map_entry_count().unwrap(), 0);
        assert_eq!(db.mesh_map_latest_update().unwrap(), 0);

        db.upsert_mesh_map_entry(&test_node_entry("p1")).unwrap();
        assert_eq!(db.mesh_map_entry_count().unwrap(), 1);
        assert_eq!(db.mesh_map_latest_update().unwrap(), 2000);
    }

    #[test]
    fn route_cache_roundtrip() {
        let db = Database::open_in_memory().unwrap();
        let from = address_for_node("a");
        let to = address_for_node("b");
        let route = MeshRoute {
            hops: vec![RouteHop {
                peer_id: "relay".to_string(),
                transport_tier: 3,
                estimated_latency_ms: 10,
            }],
            cost: 0.65,
            last_confirmed: 5000,
            discovered_by: "a".to_string(),
        };

        db.cache_route(&from, &to, &route).unwrap();
        let cached = db.get_cached_route(&from, &to).unwrap().unwrap();
        assert_eq!(cached.hops.len(), 1);
        assert!((cached.cost - 0.65).abs() < f64::EPSILON);
    }

    #[test]
    fn block_peer_lifecycle() {
        let db = Database::open_in_memory().unwrap();
        assert!(!db.is_peer_blocked("bad_peer").unwrap());

        db.block_peer("bad_peer", "spammer").unwrap();
        assert!(db.is_peer_blocked("bad_peer").unwrap());

        let blocked = db.get_blocked_peers().unwrap();
        assert_eq!(blocked.len(), 1);
        assert_eq!(blocked[0].peer_id, "bad_peer");
        assert_eq!(blocked[0].reason, "spammer");

        db.unblock_peer("bad_peer").unwrap();
        assert!(!db.is_peer_blocked("bad_peer").unwrap());
        assert_eq!(db.get_blocked_peers().unwrap().len(), 0);
    }

    #[test]
    fn block_peer_idempotent() {
        let db = Database::open_in_memory().unwrap();
        db.block_peer("peer_x", "reason1").unwrap();
        db.block_peer("peer_x", "reason2").unwrap(); // updates reason
        let blocked = db.get_blocked_peers().unwrap();
        assert_eq!(blocked.len(), 1);
        assert_eq!(blocked[0].reason, "reason2");
    }

    #[test]
    fn get_places_empty() {
        let db = Database::open_in_memory().unwrap();
        let places = db.get_places().unwrap();
        assert_eq!(places.len(), 0);
    }

    #[test]
    fn store_and_get_place() {
        let db = Database::open_in_memory().unwrap();
        let kp = concord_core::identity::Keypair::generate();
        let entry = concord_core::mesh_map::mint_place(
            &kp,
            "My Place",
            concord_core::mesh_map::GovernanceModel::Private,
            concord_core::mesh_map::OwnershipMode::Unencrypted,
            "public",
        );
        let place_id = match &entry.payload {
            EntryPayload::Place(pp) => pp.place_id.clone(),
            _ => panic!("expected place payload"),
        };

        db.upsert_mesh_map_entry(&entry).unwrap();

        let places = db.get_places().unwrap();
        assert_eq!(places.len(), 1);

        let retrieved = db.get_place_by_id(&place_id).unwrap().unwrap();
        assert_eq!(retrieved.owner_id, kp.peer_id());
    }
}
