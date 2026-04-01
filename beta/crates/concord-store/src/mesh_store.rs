use crate::db::Database;
use anyhow::Result;
use concord_core::types::{ComputeEntry, VerificationState, VerificationTag, DEFAULT_VERIFICATION_TTL};

impl Database {
    /// Insert or update a peer's verification tag.
    pub fn upsert_verification_tag(
        &self,
        peer_id: &str,
        state: &str,
        remaining_ttl: u8,
        last_confirmed_at: Option<u64>,
        confirmed_addresses: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO peer_verification (peer_id, state, remaining_ttl, last_confirmed_at, confirmed_addresses, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(peer_id) DO UPDATE SET
                state = ?2, remaining_ttl = ?3, last_confirmed_at = COALESCE(?4, last_confirmed_at),
                confirmed_addresses = ?5, updated_at = ?6",
            rusqlite::params![peer_id, state, remaining_ttl, last_confirmed_at, confirmed_addresses, now],
        )?;
        Ok(())
    }

    /// Mark a peer as verified (probe response received). Resets TTL.
    pub fn mark_peer_verified(&self, peer_id: &str, addresses: &[String]) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis() as u64;
        let addr_json = serde_json::to_string(addresses).unwrap_or_else(|_| "[]".to_string());
        self.upsert_verification_tag(
            peer_id,
            "verified",
            DEFAULT_VERIFICATION_TTL,
            Some(now),
            &addr_json,
        )
    }

    /// Ensure a peer has a verification record (speculative by default).
    pub fn ensure_verification_tag(&self, peer_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT OR IGNORE INTO peer_verification (peer_id, state, remaining_ttl, confirmed_addresses, updated_at)
             VALUES (?1, 'speculative', 0, '[]', ?2)",
            rusqlite::params![peer_id, now],
        )?;
        Ok(())
    }

    /// Decrement TTL for all verified peers. Transition verified→stale when TTL hits 0.
    pub fn decrement_verification_ttl_all(&self) -> Result<u32> {
        let now = chrono::Utc::now().timestamp_millis();
        let count = self.conn.execute(
            "UPDATE peer_verification SET
                remaining_ttl = MAX(0, remaining_ttl - 1),
                state = CASE
                    WHEN state = 'verified' AND remaining_ttl <= 1 THEN 'stale'
                    ELSE state
                END,
                updated_at = ?1
             WHERE state = 'verified'",
            rusqlite::params![now],
        )?;
        Ok(count as u32)
    }

    /// Get all verification tags.
    pub fn get_all_verification_tags(&self) -> Result<Vec<VerificationTag>> {
        let mut stmt = self.conn.prepare(
            "SELECT peer_id, state, remaining_ttl, last_confirmed_at, confirmed_addresses
             FROM peer_verification"
        )?;
        let rows = stmt.query_map([], |row| {
            let state_str: String = row.get(0)?;
            let _ = state_str; // peer_id
            let state_val: String = row.get(1)?;
            let state = match state_val.as_str() {
                "verified" => VerificationState::Verified,
                "stale" => VerificationState::Stale,
                _ => VerificationState::Speculative,
            };
            let addr_json: String = row.get(4)?;
            let confirmed_addresses: Vec<String> =
                serde_json::from_str(&addr_json).unwrap_or_default();
            Ok(VerificationTag {
                peer_id: row.get(0)?,
                state,
                remaining_ttl: row.get::<_, u8>(2)?,
                last_confirmed_at: row.get(3)?,
                confirmed_addresses,
            })
        })?;
        let mut tags = Vec::new();
        for row in rows {
            tags.push(row?);
        }
        Ok(tags)
    }

    /// Store received compute allocations from a peer.
    pub fn store_received_compute_allocations(
        &self,
        from_peer: &str,
        entries: &[ComputeEntry],
        timestamp: u64,
    ) -> Result<()> {
        // Delete old allocations from this peer
        self.conn.execute(
            "DELETE FROM compute_allocations WHERE from_peer = ?1",
            rusqlite::params![from_peer],
        )?;
        // Insert new ones
        let mut stmt = self.conn.prepare(
            "INSERT INTO compute_allocations (from_peer, to_peer, priority, share, announced_at)
             VALUES (?1, ?2, ?3, ?4, ?5)"
        )?;
        for entry in entries {
            stmt.execute(rusqlite::params![
                from_peer, entry.peer_id, entry.priority, entry.share, timestamp
            ])?;
        }
        Ok(())
    }

    /// Get the total compute weight allocated to a peer by all other peers.
    pub fn get_received_compute_weight(&self, peer_id: &str) -> Result<f64> {
        let weight: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM(share), 0.0) FROM compute_allocations WHERE to_peer = ?1",
            rusqlite::params![peer_id],
            |row| row.get(0),
        )?;
        Ok(weight)
    }

    /// Set the local node's compute priority list.
    pub fn set_local_compute_priorities(&self, entries: &[(String, u8)]) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute("DELETE FROM local_compute_priorities", [])?;
        let mut stmt = self.conn.prepare(
            "INSERT INTO local_compute_priorities (peer_id, priority, updated_at) VALUES (?1, ?2, ?3)"
        )?;
        for (peer_id, priority) in entries {
            stmt.execute(rusqlite::params![peer_id, priority, now])?;
        }
        Ok(())
    }

    /// Get the local node's compute priority list.
    pub fn get_local_compute_priorities(&self) -> Result<Vec<(String, u8)>> {
        let mut stmt = self.conn.prepare(
            "SELECT peer_id, priority FROM local_compute_priorities ORDER BY priority ASC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u8>(1)?))
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }
}

/// Compute triangular distribution shares from a priority-ranked list.
/// Rank 1 = highest priority, gets largest share.
pub fn compute_allocation_shares(priorities: &[(String, u8)]) -> Vec<ComputeEntry> {
    let n = priorities.len() as u32;
    if n == 0 {
        return Vec::new();
    }
    let total_weight: u32 = (1..=n).sum(); // N*(N+1)/2
    priorities
        .iter()
        .map(|(peer_id, priority)| {
            let rank = *priority as u32;
            let share = (n - rank + 1) as f64 / total_weight as f64;
            ComputeEntry {
                peer_id: peer_id.clone(),
                priority: *priority,
                share,
            }
        })
        .collect()
}
