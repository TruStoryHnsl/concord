use rusqlite::params;
use tracing::debug;

use concord_core::types::Alias;

use crate::db::{Database, Result};

impl Database {
    /// Create a new alias for the local identity.
    pub fn create_alias(&self, alias: &Alias) -> Result<()> {
        self.conn.execute(
            "INSERT INTO aliases (id, root_identity, display_name, avatar_seed, created_at, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                alias.id,
                alias.root_identity,
                alias.display_name,
                alias.avatar_seed,
                alias.created_at.timestamp_millis(),
                alias.is_active as i32,
            ],
        )?;
        debug!(alias_id = %alias.id, "alias created");
        Ok(())
    }

    /// Get all aliases for a root identity.
    pub fn get_aliases(&self, root_identity: &str) -> Result<Vec<Alias>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, root_identity, display_name, avatar_seed, created_at, is_active
             FROM aliases
             WHERE root_identity = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![root_identity], row_to_alias)?;
        let aliases: Vec<Alias> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(aliases)
    }

    /// Get the currently active alias for a root identity.
    pub fn get_active_alias(&self, root_identity: &str) -> Result<Option<Alias>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, root_identity, display_name, avatar_seed, created_at, is_active
             FROM aliases
             WHERE root_identity = ?1 AND is_active = 1
             LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![root_identity], row_to_alias)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Set a specific alias as active, deactivating all others for the same root identity.
    pub fn set_active_alias(&self, root_identity: &str, alias_id: &str) -> Result<()> {
        // Deactivate all
        self.conn.execute(
            "UPDATE aliases SET is_active = 0 WHERE root_identity = ?1",
            params![root_identity],
        )?;
        // Activate the chosen one
        self.conn.execute(
            "UPDATE aliases SET is_active = 1 WHERE id = ?1 AND root_identity = ?2",
            params![alias_id, root_identity],
        )?;
        debug!(alias_id, "alias set as active");
        Ok(())
    }

    /// Update the display name of an alias.
    pub fn update_alias(&self, alias_id: &str, display_name: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE aliases SET display_name = ?1 WHERE id = ?2",
            params![display_name, alias_id],
        )?;
        debug!(alias_id, "alias updated");
        Ok(())
    }

    /// Delete an alias by ID.
    pub fn delete_alias(&self, alias_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM aliases WHERE id = ?1",
            params![alias_id],
        )?;
        debug!(alias_id, "alias deleted");
        Ok(())
    }

    /// Store a known alias from another user (learned from messages or announcements).
    pub fn store_known_alias(
        &self,
        alias_id: &str,
        root_identity: &str,
        display_name: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO known_aliases (alias_id, root_identity, display_name, first_seen)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(alias_id) DO UPDATE SET
                display_name = ?3",
            params![alias_id, root_identity, display_name, now],
        )?;
        debug!(alias_id, root_identity, "known alias stored");
        Ok(())
    }

    /// Get all known aliases for a root identity. Returns (alias_id, display_name) pairs.
    pub fn get_known_aliases(&self, root_identity: &str) -> Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT alias_id, display_name FROM known_aliases
             WHERE root_identity = ?1
             ORDER BY first_seen ASC",
        )?;
        let rows = stmt.query_map(params![root_identity], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let aliases: Vec<(String, String)> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(aliases)
    }

    /// Get the root identity for a given alias ID. Returns None if unknown.
    pub fn get_root_identity_for_alias(&self, alias_id: &str) -> Result<Option<String>> {
        // Check local aliases first
        let result: std::result::Result<String, _> = self.conn.query_row(
            "SELECT root_identity FROM aliases WHERE id = ?1",
            params![alias_id],
            |row| row.get(0),
        );
        if let Ok(root) = result {
            return Ok(Some(root));
        }

        // Then check known aliases
        let result: std::result::Result<String, _> = self.conn.query_row(
            "SELECT root_identity FROM known_aliases WHERE alias_id = ?1",
            params![alias_id],
            |row| row.get(0),
        );
        match result {
            Ok(root) => Ok(Some(root)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}

fn row_to_alias(row: &rusqlite::Row) -> rusqlite::Result<Alias> {
    let millis: i64 = row.get(4)?;
    let created_at = chrono::DateTime::from_timestamp_millis(millis).unwrap_or_default();
    let is_active: i32 = row.get(5)?;
    Ok(Alias {
        id: row.get(0)?,
        root_identity: row.get(1)?,
        display_name: row.get(2)?,
        avatar_seed: row.get(3)?,
        created_at,
        is_active: is_active != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_alias(id: &str, root: &str, name: &str, active: bool) -> Alias {
        Alias {
            id: id.to_string(),
            root_identity: root.to_string(),
            display_name: name.to_string(),
            avatar_seed: format!("seed-{id}"),
            created_at: Utc::now(),
            is_active: active,
        }
    }

    #[test]
    fn create_and_get_aliases() {
        let db = Database::open_in_memory().unwrap();

        let alias1 = make_alias("a1", "root1", "Alice", true);
        let alias2 = make_alias("a2", "root1", "Wonderland", false);
        db.create_alias(&alias1).unwrap();
        db.create_alias(&alias2).unwrap();

        let aliases = db.get_aliases("root1").unwrap();
        assert_eq!(aliases.len(), 2);
        assert_eq!(aliases[0].display_name, "Alice");
        assert_eq!(aliases[1].display_name, "Wonderland");
    }

    #[test]
    fn get_active_alias() {
        let db = Database::open_in_memory().unwrap();

        db.create_alias(&make_alias("a1", "root1", "Alice", true)).unwrap();
        db.create_alias(&make_alias("a2", "root1", "Bob", false)).unwrap();

        let active = db.get_active_alias("root1").unwrap().unwrap();
        assert_eq!(active.id, "a1");
        assert_eq!(active.display_name, "Alice");
    }

    #[test]
    fn switch_active_alias() {
        let db = Database::open_in_memory().unwrap();

        db.create_alias(&make_alias("a1", "root1", "Alice", true)).unwrap();
        db.create_alias(&make_alias("a2", "root1", "Bob", false)).unwrap();

        db.set_active_alias("root1", "a2").unwrap();

        let active = db.get_active_alias("root1").unwrap().unwrap();
        assert_eq!(active.id, "a2");
        assert_eq!(active.display_name, "Bob");

        // Verify previous one is no longer active
        let all = db.get_aliases("root1").unwrap();
        assert!(!all.iter().find(|a| a.id == "a1").unwrap().is_active);
        assert!(all.iter().find(|a| a.id == "a2").unwrap().is_active);
    }

    #[test]
    fn update_alias_name() {
        let db = Database::open_in_memory().unwrap();

        db.create_alias(&make_alias("a1", "root1", "Alice", true)).unwrap();
        db.update_alias("a1", "AliceUpdated").unwrap();

        let aliases = db.get_aliases("root1").unwrap();
        assert_eq!(aliases[0].display_name, "AliceUpdated");
    }

    #[test]
    fn delete_alias() {
        let db = Database::open_in_memory().unwrap();

        db.create_alias(&make_alias("a1", "root1", "Alice", true)).unwrap();
        db.create_alias(&make_alias("a2", "root1", "Bob", false)).unwrap();

        db.delete_alias("a1").unwrap();

        let aliases = db.get_aliases("root1").unwrap();
        assert_eq!(aliases.len(), 1);
        assert_eq!(aliases[0].id, "a2");
    }

    #[test]
    fn known_aliases_crud() {
        let db = Database::open_in_memory().unwrap();

        db.store_known_alias("ka1", "remote-root", "RemoteAlice").unwrap();
        db.store_known_alias("ka2", "remote-root", "RemoteBob").unwrap();

        let known = db.get_known_aliases("remote-root").unwrap();
        assert_eq!(known.len(), 2);
        assert_eq!(known[0].0, "ka1");
        assert_eq!(known[0].1, "RemoteAlice");

        // Update display name via upsert
        db.store_known_alias("ka1", "remote-root", "RemoteAliceUpdated").unwrap();
        let known = db.get_known_aliases("remote-root").unwrap();
        assert_eq!(known[0].1, "RemoteAliceUpdated");
    }

    #[test]
    fn root_identity_lookup() {
        let db = Database::open_in_memory().unwrap();

        // Local alias
        db.create_alias(&make_alias("local-a1", "my-root", "Me", true)).unwrap();
        assert_eq!(
            db.get_root_identity_for_alias("local-a1").unwrap(),
            Some("my-root".to_string())
        );

        // Known alias
        db.store_known_alias("remote-a1", "remote-root", "Them").unwrap();
        assert_eq!(
            db.get_root_identity_for_alias("remote-a1").unwrap(),
            Some("remote-root".to_string())
        );

        // Unknown alias
        assert_eq!(db.get_root_identity_for_alias("unknown").unwrap(), None);
    }

    #[test]
    fn no_aliases_for_unknown_root() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.get_aliases("unknown").unwrap().is_empty());
        assert!(db.get_active_alias("unknown").unwrap().is_none());
        assert!(db.get_known_aliases("unknown").unwrap().is_empty());
    }
}
