use rusqlite::params;
use tracing::debug;

use crate::db::{Database, Result};

/// A record of a known peer in the network.
#[derive(Debug, Clone)]
pub struct PeerRecord {
    pub peer_id: String,
    pub display_name: Option<String>,
    pub last_seen: i64,
    pub trust_score: f64,
    pub addresses: Vec<String>,
}

impl Database {
    /// Insert or update a peer record. Updates display_name, addresses, and last_seen.
    pub fn upsert_peer(
        &self,
        peer_id: &str,
        display_name: Option<&str>,
        addresses: &[String],
    ) -> Result<()> {
        let addrs_json = serde_json::to_string(addresses)?;
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO peers (peer_id, display_name, last_seen, trust_score, addresses)
             VALUES (?1, ?2, ?3, 0.0, ?4)
             ON CONFLICT(peer_id) DO UPDATE SET
                display_name = COALESCE(?2, peers.display_name),
                last_seen = ?3,
                addresses = ?4",
            params![peer_id, display_name, now, addrs_json],
        )?;
        debug!(peer_id, "peer upserted");
        Ok(())
    }

    /// Update the last_seen timestamp for a peer to now.
    pub fn update_peer_seen(&self, peer_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE peers SET last_seen = ?1 WHERE peer_id = ?2",
            params![now, peer_id],
        )?;
        Ok(())
    }

    /// Retrieve a single peer by ID.
    pub fn get_peer(&self, peer_id: &str) -> Result<Option<PeerRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT peer_id, display_name, last_seen, trust_score, addresses
             FROM peers WHERE peer_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![peer_id], row_to_peer)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Retrieve all known peers.
    pub fn get_all_peers(&self) -> Result<Vec<PeerRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT peer_id, display_name, last_seen, trust_score, addresses
             FROM peers ORDER BY last_seen DESC",
        )?;
        let rows = stmt.query_map([], row_to_peer)?;
        let peers: Vec<PeerRecord> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(peers)
    }

    /// Remove peers not seen in `older_than_secs` seconds. Returns the number removed.
    pub fn remove_stale_peers(&self, older_than_secs: i64) -> Result<u32> {
        let cutoff = chrono::Utc::now().timestamp_millis() - (older_than_secs * 1000);
        let deleted = self.conn.execute(
            "DELETE FROM peers WHERE last_seen < ?1",
            params![cutoff],
        )?;
        Ok(deleted as u32)
    }
}

fn row_to_peer(row: &rusqlite::Row) -> rusqlite::Result<PeerRecord> {
    let addrs_json: String = row.get(4)?;
    let addresses: Vec<String> = serde_json::from_str(&addrs_json).unwrap_or_default();
    Ok(PeerRecord {
        peer_id: row.get(0)?,
        display_name: row.get(1)?,
        last_seen: row.get(2)?,
        trust_score: row.get(3)?,
        addresses,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_and_get_peer() {
        let db = Database::open_in_memory().unwrap();

        let addrs = vec!["/ip4/192.168.1.1/tcp/9990".to_string()];
        db.upsert_peer("peer1", Some("Alice"), &addrs).unwrap();

        let peer = db.get_peer("peer1").unwrap().unwrap();
        assert_eq!(peer.peer_id, "peer1");
        assert_eq!(peer.display_name.as_deref(), Some("Alice"));
        assert_eq!(peer.addresses, addrs);
        assert!(peer.last_seen > 0);
        assert_eq!(peer.trust_score, 0.0);
    }

    #[test]
    fn upsert_updates_existing() {
        let db = Database::open_in_memory().unwrap();

        let addrs1 = vec!["/ip4/1.2.3.4/tcp/9990".to_string()];
        db.upsert_peer("peer1", Some("Alice"), &addrs1).unwrap();

        let addrs2 = vec!["/ip4/5.6.7.8/tcp/9990".to_string()];
        db.upsert_peer("peer1", Some("Alice Updated"), &addrs2).unwrap();

        let peer = db.get_peer("peer1").unwrap().unwrap();
        assert_eq!(peer.display_name.as_deref(), Some("Alice Updated"));
        assert_eq!(peer.addresses, addrs2);
    }

    #[test]
    fn get_all_peers() {
        let db = Database::open_in_memory().unwrap();

        db.upsert_peer("p1", Some("A"), &[]).unwrap();
        db.upsert_peer("p2", Some("B"), &[]).unwrap();
        db.upsert_peer("p3", None, &[]).unwrap();

        let all = db.get_all_peers().unwrap();
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn unknown_peer_returns_none() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.get_peer("nonexistent").unwrap().is_none());
    }

    #[test]
    fn remove_stale_peers() {
        let db = Database::open_in_memory().unwrap();

        // Insert a peer then manually backdate its last_seen
        db.upsert_peer("stale", Some("Old"), &[]).unwrap();
        db.conn
            .execute(
                "UPDATE peers SET last_seen = ?1 WHERE peer_id = 'stale'",
                params![0i64], // epoch = very old
            )
            .unwrap();

        db.upsert_peer("fresh", Some("New"), &[]).unwrap();

        let removed = db.remove_stale_peers(1).unwrap(); // anything older than 1 second
        assert_eq!(removed, 1);

        assert!(db.get_peer("stale").unwrap().is_none());
        assert!(db.get_peer("fresh").unwrap().is_some());
    }
}
