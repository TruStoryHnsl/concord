use rusqlite::params;

use crate::db::{Database, Result};

impl Database {
    /// Get a setting value by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT value FROM settings WHERE key = ?1",
        )?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Set a setting value by key (upsert).
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_missing_setting_returns_none() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.get_setting("nonexistent").unwrap().is_none());
    }

    #[test]
    fn set_and_get_setting() {
        let db = Database::open_in_memory().unwrap();
        db.set_setting("local_forum_range", "3").unwrap();
        assert_eq!(db.get_setting("local_forum_range").unwrap().as_deref(), Some("3"));
    }

    #[test]
    fn update_setting() {
        let db = Database::open_in_memory().unwrap();
        db.set_setting("theme", "dark").unwrap();
        db.set_setting("theme", "light").unwrap();
        assert_eq!(db.get_setting("theme").unwrap().as_deref(), Some("light"));
    }

    #[test]
    fn multiple_settings() {
        let db = Database::open_in_memory().unwrap();
        db.set_setting("key1", "val1").unwrap();
        db.set_setting("key2", "val2").unwrap();
        assert_eq!(db.get_setting("key1").unwrap().as_deref(), Some("val1"));
        assert_eq!(db.get_setting("key2").unwrap().as_deref(), Some("val2"));
    }
}
