use rusqlite::params;
use tracing::debug;

use crate::db::{Database, Result};

/// A friend record stored locally.
#[derive(Debug, Clone)]
pub struct FriendRecord {
    pub peer_id: String,
    pub display_name: Option<String>,
    pub alias_name: Option<String>,
    pub added_at: i64,
    pub is_mutual: bool,
    pub auto_tunnel: bool,
    pub last_online: Option<i64>,
}

impl Database {
    /// Add a friend. If the friend already exists, this is a no-op.
    pub fn add_friend(&self, peer_id: &str, display_name: Option<&str>) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT OR IGNORE INTO friends (peer_id, display_name, added_at, is_mutual, auto_tunnel)
             VALUES (?1, ?2, ?3, 0, 1)",
            params![peer_id, display_name, now],
        )?;
        debug!(peer_id, "friend added");
        Ok(())
    }

    /// Remove a friend by peer_id.
    pub fn remove_friend(&self, peer_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM friends WHERE peer_id = ?1",
            params![peer_id],
        )?;
        debug!(peer_id, "friend removed");
        Ok(())
    }

    /// Get all friends.
    pub fn get_friends(&self) -> Result<Vec<FriendRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT peer_id, display_name, alias_name, added_at, is_mutual, auto_tunnel, last_online
             FROM friends ORDER BY added_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_friend)?;
        let friends: Vec<FriendRecord> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(friends)
    }

    /// Check if a peer is a friend.
    pub fn is_friend(&self, peer_id: &str) -> Result<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM friends WHERE peer_id = ?1",
            params![peer_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Update a friend's last_online timestamp.
    pub fn update_friend_online(&self, peer_id: &str, timestamp: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE friends SET last_online = ?1 WHERE peer_id = ?2",
            params![timestamp, peer_id],
        )?;
        Ok(())
    }

    /// Get all friends that have a last_online timestamp (i.e., have been seen).
    pub fn get_online_friends(&self) -> Result<Vec<FriendRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT peer_id, display_name, alias_name, added_at, is_mutual, auto_tunnel, last_online
             FROM friends WHERE last_online IS NOT NULL ORDER BY last_online DESC",
        )?;
        let rows = stmt.query_map([], row_to_friend)?;
        let friends: Vec<FriendRecord> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(friends)
    }

    /// Set a friend as mutual (both sides have confirmed).
    pub fn set_friend_mutual(&self, peer_id: &str, is_mutual: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE friends SET is_mutual = ?1 WHERE peer_id = ?2",
            params![is_mutual as i32, peer_id],
        )?;
        Ok(())
    }

    /// Set auto-tunnel preference for a friend.
    pub fn set_friend_auto_tunnel(&self, peer_id: &str, auto_tunnel: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE friends SET auto_tunnel = ?1 WHERE peer_id = ?2",
            params![auto_tunnel as i32, peer_id],
        )?;
        Ok(())
    }
}

fn row_to_friend(row: &rusqlite::Row) -> rusqlite::Result<FriendRecord> {
    Ok(FriendRecord {
        peer_id: row.get(0)?,
        display_name: row.get(1)?,
        alias_name: row.get(2)?,
        added_at: row.get(3)?,
        is_mutual: row.get::<_, i32>(4)? != 0,
        auto_tunnel: row.get::<_, i32>(5)? != 0,
        last_online: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_and_get_friend() {
        let db = Database::open_in_memory().unwrap();
        db.add_friend("peer1", Some("Alice")).unwrap();

        let friends = db.get_friends().unwrap();
        assert_eq!(friends.len(), 1);
        assert_eq!(friends[0].peer_id, "peer1");
        assert_eq!(friends[0].display_name.as_deref(), Some("Alice"));
        assert!(!friends[0].is_mutual);
        assert!(friends[0].auto_tunnel);
        assert!(friends[0].last_online.is_none());
    }

    #[test]
    fn add_friend_no_display_name() {
        let db = Database::open_in_memory().unwrap();
        db.add_friend("peer2", None).unwrap();

        let friends = db.get_friends().unwrap();
        assert_eq!(friends.len(), 1);
        assert!(friends[0].display_name.is_none());
    }

    #[test]
    fn add_friend_duplicate_is_noop() {
        let db = Database::open_in_memory().unwrap();
        db.add_friend("peer1", Some("Alice")).unwrap();
        db.add_friend("peer1", Some("Alice v2")).unwrap(); // should be ignored

        let friends = db.get_friends().unwrap();
        assert_eq!(friends.len(), 1);
        // Original display_name should be preserved since INSERT OR IGNORE
        assert_eq!(friends[0].display_name.as_deref(), Some("Alice"));
    }

    #[test]
    fn remove_friend() {
        let db = Database::open_in_memory().unwrap();
        db.add_friend("peer1", Some("Alice")).unwrap();
        assert!(db.is_friend("peer1").unwrap());

        db.remove_friend("peer1").unwrap();
        assert!(!db.is_friend("peer1").unwrap());
        assert_eq!(db.get_friends().unwrap().len(), 0);
    }

    #[test]
    fn is_friend() {
        let db = Database::open_in_memory().unwrap();
        assert!(!db.is_friend("peer1").unwrap());

        db.add_friend("peer1", None).unwrap();
        assert!(db.is_friend("peer1").unwrap());
    }

    #[test]
    fn update_friend_online() {
        let db = Database::open_in_memory().unwrap();
        db.add_friend("peer1", None).unwrap();
        db.update_friend_online("peer1", 123456).unwrap();

        let friends = db.get_friends().unwrap();
        assert_eq!(friends[0].last_online, Some(123456));
    }

    #[test]
    fn get_online_friends() {
        let db = Database::open_in_memory().unwrap();
        db.add_friend("peer1", Some("Alice")).unwrap();
        db.add_friend("peer2", Some("Bob")).unwrap();

        // Only peer1 has been online
        db.update_friend_online("peer1", 999).unwrap();

        let online = db.get_online_friends().unwrap();
        assert_eq!(online.len(), 1);
        assert_eq!(online[0].peer_id, "peer1");
    }

    #[test]
    fn set_friend_mutual() {
        let db = Database::open_in_memory().unwrap();
        db.add_friend("peer1", None).unwrap();
        assert!(!db.get_friends().unwrap()[0].is_mutual);

        db.set_friend_mutual("peer1", true).unwrap();
        assert!(db.get_friends().unwrap()[0].is_mutual);

        db.set_friend_mutual("peer1", false).unwrap();
        assert!(!db.get_friends().unwrap()[0].is_mutual);
    }

    #[test]
    fn set_friend_auto_tunnel() {
        let db = Database::open_in_memory().unwrap();
        db.add_friend("peer1", None).unwrap();
        assert!(db.get_friends().unwrap()[0].auto_tunnel);

        db.set_friend_auto_tunnel("peer1", false).unwrap();
        assert!(!db.get_friends().unwrap()[0].auto_tunnel);
    }

    #[test]
    fn multiple_friends() {
        let db = Database::open_in_memory().unwrap();
        db.add_friend("peer1", Some("Alice")).unwrap();
        db.add_friend("peer2", Some("Bob")).unwrap();
        db.add_friend("peer3", Some("Charlie")).unwrap();

        let friends = db.get_friends().unwrap();
        assert_eq!(friends.len(), 3);
    }
}
