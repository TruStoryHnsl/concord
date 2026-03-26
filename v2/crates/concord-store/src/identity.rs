use rusqlite::params;
use tracing::info;

use concord_core::identity::Keypair;

use crate::db::{Database, Result};

impl Database {
    /// Save (or overwrite) the node's identity keypair.
    pub fn save_identity(&self, display_name: &str, keypair: &Keypair) -> Result<()> {
        let key_bytes = keypair.to_bytes();
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT OR REPLACE INTO identity (id, display_name, signing_key, created_at)
             VALUES (1, ?1, ?2, ?3)",
            params![display_name, key_bytes.as_slice(), now],
        )?;
        info!("identity saved");
        Ok(())
    }

    /// Load the stored identity, if one exists.
    /// Returns (display_name, Keypair).
    pub fn load_identity(&self) -> Result<Option<(String, Keypair)>> {
        let mut stmt = self.conn.prepare(
            "SELECT display_name, signing_key FROM identity WHERE id = 1",
        )?;
        let mut rows = stmt.query_map([], |row| {
            let name: String = row.get(0)?;
            let key_bytes: Vec<u8> = row.get(1)?;
            Ok((name, key_bytes))
        })?;

        match rows.next() {
            Some(row) => {
                let (name, key_bytes) = row?;
                let keypair = Keypair::from_bytes(&key_bytes)?;
                Ok(Some((name, keypair)))
            }
            None => Ok(None),
        }
    }

    /// Check whether an identity has been stored.
    pub fn has_identity(&self) -> Result<bool> {
        let count: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM identity WHERE id = 1",
            [],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_and_load_identity() {
        let db = Database::open_in_memory().unwrap();

        assert!(!db.has_identity().unwrap());
        assert!(db.load_identity().unwrap().is_none());

        let kp = Keypair::generate();
        let peer_id = kp.peer_id();
        db.save_identity("TestNode", &kp).unwrap();

        assert!(db.has_identity().unwrap());

        let (name, loaded_kp) = db.load_identity().unwrap().unwrap();
        assert_eq!(name, "TestNode");
        assert_eq!(loaded_kp.peer_id(), peer_id);
    }

    #[test]
    fn overwrite_identity() {
        let db = Database::open_in_memory().unwrap();

        let kp1 = Keypair::generate();
        db.save_identity("First", &kp1).unwrap();

        let kp2 = Keypair::generate();
        db.save_identity("Second", &kp2).unwrap();

        let (name, loaded) = db.load_identity().unwrap().unwrap();
        assert_eq!(name, "Second");
        assert_eq!(loaded.peer_id(), kp2.peer_id());
    }

    #[test]
    fn keypair_roundtrip_sign_verify() {
        let db = Database::open_in_memory().unwrap();

        let kp = Keypair::generate();
        db.save_identity("SignTest", &kp).unwrap();

        let (_, loaded) = db.load_identity().unwrap().unwrap();

        // Sign with loaded keypair, verify the signature matches original
        let message = b"test message";
        let sig_original = kp.sign(message);
        let sig_loaded = loaded.sign(message);
        assert_eq!(sig_original, sig_loaded);
    }
}
