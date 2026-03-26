use rusqlite::params;
use tracing::debug;

use crate::db::{Database, Result};

impl Database {
    /// Save a TOTP secret for a peer (the local node).
    pub fn save_totp_secret(&self, peer_id: &str, secret: &[u8]) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO totp_secrets (peer_id, secret, enabled, created_at)
             VALUES (?1, ?2, 0, ?3)
             ON CONFLICT(peer_id) DO UPDATE SET
                secret = ?2,
                enabled = 0,
                created_at = ?3",
            params![peer_id, secret, now],
        )?;
        debug!(peer_id, "TOTP secret saved");
        Ok(())
    }

    /// Retrieve the TOTP secret for a peer.
    pub fn get_totp_secret(&self, peer_id: &str) -> Result<Option<Vec<u8>>> {
        let mut stmt = self
            .conn
            .prepare("SELECT secret FROM totp_secrets WHERE peer_id = ?1")?;
        let mut rows = stmt.query_map(params![peer_id], |row| {
            let secret: Vec<u8> = row.get(0)?;
            Ok(secret)
        })?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Enable TOTP for a peer (after successful verification).
    pub fn enable_totp(&self, peer_id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE totp_secrets SET enabled = 1 WHERE peer_id = ?1",
            params![peer_id],
        )?;
        debug!(peer_id, "TOTP enabled");
        Ok(())
    }

    /// Check if TOTP is enabled for a peer.
    pub fn is_totp_enabled(&self, peer_id: &str) -> Result<bool> {
        let enabled: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE((SELECT enabled FROM totp_secrets WHERE peer_id = ?1), 0)",
                params![peer_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok(enabled != 0)
    }

    /// Disable TOTP for a peer (remove the record entirely).
    pub fn disable_totp(&self, peer_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM totp_secrets WHERE peer_id = ?1",
            params![peer_id],
        )?;
        debug!(peer_id, "TOTP disabled");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_and_get_totp_secret() {
        let db = Database::open_in_memory().unwrap();

        let secret = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
        db.save_totp_secret("peer1", &secret).unwrap();

        let loaded = db.get_totp_secret("peer1").unwrap().unwrap();
        assert_eq!(loaded, secret);
    }

    #[test]
    fn totp_not_found_returns_none() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.get_totp_secret("nonexistent").unwrap().is_none());
    }

    #[test]
    fn enable_disable_totp() {
        let db = Database::open_in_memory().unwrap();

        let secret = vec![1; 20];
        db.save_totp_secret("peer1", &secret).unwrap();

        // Not enabled by default
        assert!(!db.is_totp_enabled("peer1").unwrap());

        db.enable_totp("peer1").unwrap();
        assert!(db.is_totp_enabled("peer1").unwrap());

        db.disable_totp("peer1").unwrap();
        assert!(!db.is_totp_enabled("peer1").unwrap());
        // Secret should be gone too
        assert!(db.get_totp_secret("peer1").unwrap().is_none());
    }

    #[test]
    fn is_totp_enabled_for_unknown_peer() {
        let db = Database::open_in_memory().unwrap();
        assert!(!db.is_totp_enabled("unknown").unwrap());
    }
}
