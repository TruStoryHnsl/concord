use rusqlite::params;
use tracing::debug;

use concord_core::types::Server;

use crate::db::{Database, Result};

/// A stored invite record.
#[derive(Debug, Clone)]
pub struct InviteRecord {
    pub code: String,
    pub server_id: String,
    pub created_by: String,
    pub created_at: i64,
    pub max_uses: Option<u32>,
    pub use_count: u32,
}

/// A stored member record.
#[derive(Debug, Clone)]
pub struct MemberRecord {
    pub server_id: String,
    pub peer_id: String,
    pub role: String,
    pub joined_at: i64,
}

impl Database {
    // ── Invites ──────────────────────────────────────────────────────

    /// Create a new invite code for a server.
    pub fn create_invite(
        &self,
        code: &str,
        server_id: &str,
        created_by: &str,
        max_uses: Option<u32>,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "INSERT OR IGNORE INTO invites (code, server_id, created_by, created_at, max_uses, use_count)
             VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            params![code, server_id, created_by, now, max_uses.map(|u| u as i64)],
        )?;
        debug!(%code, %server_id, "invite created");
        Ok(())
    }

    /// Retrieve an invite by its code.
    pub fn get_invite(&self, code: &str) -> Result<Option<InviteRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT code, server_id, created_by, created_at, max_uses, use_count
             FROM invites WHERE code = ?1",
        )?;
        let mut rows = stmt.query_map(params![code], |row| {
            Ok(InviteRecord {
                code: row.get(0)?,
                server_id: row.get(1)?,
                created_by: row.get(2)?,
                created_at: row.get(3)?,
                max_uses: row.get::<_, Option<i64>>(4)?.map(|v| v as u32),
                use_count: row.get::<_, i64>(5)? as u32,
            })
        })?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Use an invite: increment use_count and return the server_id if the invite is valid.
    /// Returns `None` if the invite does not exist or has been exhausted.
    pub fn use_invite(&self, code: &str) -> Result<Option<String>> {
        let invite = match self.get_invite(code)? {
            Some(inv) => inv,
            None => return Ok(None),
        };

        // Check if invite is exhausted
        if let Some(max) = invite.max_uses {
            if invite.use_count >= max {
                return Ok(None);
            }
        }

        self.conn.execute(
            "UPDATE invites SET use_count = use_count + 1 WHERE code = ?1",
            params![code],
        )?;
        debug!(%code, "invite used");
        Ok(Some(invite.server_id))
    }

    // ── Members ─────────────────────────────────────────────────────

    /// Add a member to a server.
    pub fn add_member(&self, server_id: &str, peer_id: &str, role: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "INSERT OR IGNORE INTO members (server_id, peer_id, role, joined_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![server_id, peer_id, role, now],
        )?;
        debug!(%server_id, %peer_id, %role, "member added");
        Ok(())
    }

    /// Remove a member from a server.
    pub fn remove_member(&self, server_id: &str, peer_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM members WHERE server_id = ?1 AND peer_id = ?2",
            params![server_id, peer_id],
        )?;
        debug!(%server_id, %peer_id, "member removed");
        Ok(())
    }

    /// Get all members of a server.
    pub fn get_members(&self, server_id: &str) -> Result<Vec<MemberRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT server_id, peer_id, role, joined_at
             FROM members WHERE server_id = ?1 ORDER BY joined_at",
        )?;
        let rows = stmt.query_map(params![server_id], |row| {
            Ok(MemberRecord {
                server_id: row.get(0)?,
                peer_id: row.get(1)?,
                role: row.get(2)?,
                joined_at: row.get(3)?,
            })
        })?;
        let members: Vec<MemberRecord> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(members)
    }

    /// Check if a peer is a member of a server.
    pub fn is_member(&self, server_id: &str, peer_id: &str) -> Result<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM members WHERE server_id = ?1 AND peer_id = ?2",
            params![server_id, peer_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Get all servers the local user is a member of (joined via the members table).
    pub fn get_user_servers(&self, peer_id: &str) -> Result<Vec<Server>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.name, s.owner_id, s.visibility
             FROM servers s
             INNER JOIN members m ON s.id = m.server_id
             WHERE m.peer_id = ?1
             ORDER BY s.name",
        )?;
        let rows = stmt.query_map(params![peer_id], |row| {
            let vis_str: String = row.get(3)?;
            Ok(Server {
                id: row.get(0)?,
                name: row.get(1)?,
                owner_id: row.get(2)?,
                visibility: crate::servers::str_to_visibility_pub(&vis_str),
            })
        })?;
        let servers: Vec<Server> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(servers)
    }

    /// Get the member count for a server.
    pub fn get_member_count(&self, server_id: &str) -> Result<u32> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM members WHERE server_id = ?1",
            params![server_id],
            |row| row.get(0),
        )?;
        Ok(count as u32)
    }

    /// Get the first invite code for a server (if any).
    pub fn get_server_invite(&self, server_id: &str) -> Result<Option<InviteRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT code, server_id, created_by, created_at, max_uses, use_count
             FROM invites WHERE server_id = ?1 LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![server_id], |row| {
            Ok(InviteRecord {
                code: row.get(0)?,
                server_id: row.get(1)?,
                created_by: row.get(2)?,
                created_at: row.get(3)?,
                max_uses: row.get::<_, Option<i64>>(4)?.map(|v| v as u32),
                use_count: row.get::<_, i64>(5)? as u32,
            })
        })?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use concord_core::types::{Server, Visibility};

    fn setup_db() -> Database {
        let db = Database::open_in_memory().unwrap();
        db.create_server(&Server {
            id: "srv1".into(),
            name: "Test Server".into(),
            owner_id: "owner1".into(),
            visibility: Visibility::Private,
        })
        .unwrap();
        db
    }

    // ── Invite tests ────────────────────────────────────────────────

    #[test]
    fn create_and_get_invite() {
        let db = setup_db();
        db.create_invite("abc123", "srv1", "owner1", None).unwrap();

        let invite = db.get_invite("abc123").unwrap().unwrap();
        assert_eq!(invite.code, "abc123");
        assert_eq!(invite.server_id, "srv1");
        assert_eq!(invite.created_by, "owner1");
        assert_eq!(invite.max_uses, None);
        assert_eq!(invite.use_count, 0);
    }

    #[test]
    fn use_invite_returns_server_id() {
        let db = setup_db();
        db.create_invite("inv1", "srv1", "owner1", None).unwrap();

        let server_id = db.use_invite("inv1").unwrap().unwrap();
        assert_eq!(server_id, "srv1");

        // use_count should be incremented
        let invite = db.get_invite("inv1").unwrap().unwrap();
        assert_eq!(invite.use_count, 1);
    }

    #[test]
    fn use_invite_respects_max_uses() {
        let db = setup_db();
        db.create_invite("inv2", "srv1", "owner1", Some(2)).unwrap();

        // First two uses succeed
        assert!(db.use_invite("inv2").unwrap().is_some());
        assert!(db.use_invite("inv2").unwrap().is_some());

        // Third use fails (exhausted)
        assert!(db.use_invite("inv2").unwrap().is_none());
    }

    #[test]
    fn use_nonexistent_invite_returns_none() {
        let db = setup_db();
        assert!(db.use_invite("nope").unwrap().is_none());
    }

    // ── Member tests ────────────────────────────────────────────────

    #[test]
    fn add_and_get_members() {
        let db = setup_db();
        db.add_member("srv1", "peer-a", "owner").unwrap();
        db.add_member("srv1", "peer-b", "member").unwrap();

        let members = db.get_members("srv1").unwrap();
        assert_eq!(members.len(), 2);
        assert_eq!(members[0].peer_id, "peer-a");
        assert_eq!(members[0].role, "owner");
        assert_eq!(members[1].peer_id, "peer-b");
        assert_eq!(members[1].role, "member");
    }

    #[test]
    fn remove_member() {
        let db = setup_db();
        db.add_member("srv1", "peer-a", "owner").unwrap();
        db.add_member("srv1", "peer-b", "member").unwrap();

        db.remove_member("srv1", "peer-b").unwrap();

        let members = db.get_members("srv1").unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].peer_id, "peer-a");
    }

    #[test]
    fn is_member_check() {
        let db = setup_db();
        db.add_member("srv1", "peer-a", "owner").unwrap();

        assert!(db.is_member("srv1", "peer-a").unwrap());
        assert!(!db.is_member("srv1", "peer-unknown").unwrap());
    }

    #[test]
    fn get_user_servers_returns_joined_servers() {
        let db = Database::open_in_memory().unwrap();

        // Create three servers
        for (id, name) in [("s1", "Alpha"), ("s2", "Beta"), ("s3", "Gamma")] {
            db.create_server(&Server {
                id: id.into(),
                name: name.into(),
                owner_id: "owner".into(),
                visibility: Visibility::Private,
            })
            .unwrap();
        }

        // peer-a is a member of s1 and s3 but not s2
        db.add_member("s1", "peer-a", "owner").unwrap();
        db.add_member("s3", "peer-a", "member").unwrap();
        db.add_member("s2", "peer-b", "member").unwrap();

        let servers = db.get_user_servers("peer-a").unwrap();
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "Alpha");
        assert_eq!(servers[1].name, "Gamma");
    }

    #[test]
    fn member_count() {
        let db = setup_db();
        assert_eq!(db.get_member_count("srv1").unwrap(), 0);

        db.add_member("srv1", "peer-a", "owner").unwrap();
        db.add_member("srv1", "peer-b", "member").unwrap();
        assert_eq!(db.get_member_count("srv1").unwrap(), 2);
    }
}
