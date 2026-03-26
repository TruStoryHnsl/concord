use rusqlite::params;
use tracing::debug;

use concord_core::types::ForumPost;

use crate::db::{Database, Result};

impl Database {
    /// Store a forum post. Ignores duplicates (by id).
    pub fn store_forum_post(&self, post: &ForumPost) -> Result<()> {
        let scope_str = match post.forum_scope {
            concord_core::types::ForumScope::Local => "local",
            concord_core::types::ForumScope::Global => "global",
        };
        self.conn.execute(
            "INSERT OR IGNORE INTO forum_posts (id, author_id, alias_name, content, timestamp, hop_count, max_hops, origin_peer, forum_scope, signature)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                post.id,
                post.author_id,
                post.alias_name,
                post.content,
                post.timestamp.timestamp_millis(),
                post.hop_count as i64,
                post.max_hops as i64,
                post.origin_peer,
                scope_str,
                post.signature,
            ],
        )?;
        debug!(id = %post.id, scope = scope_str, "forum post stored");
        Ok(())
    }

    /// Get forum posts by scope, ordered by timestamp descending.
    /// If `before` is provided, only returns posts with timestamp < before.
    pub fn get_forum_posts(
        &self,
        scope: &str,
        limit: u32,
        before: Option<i64>,
    ) -> Result<Vec<ForumPost>> {
        let (sql, params_vec): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(before_ts) = before {
            (
                "SELECT id, author_id, alias_name, content, timestamp, hop_count, max_hops, origin_peer, forum_scope, signature
                 FROM forum_posts
                 WHERE forum_scope = ?1 AND timestamp < ?2
                 ORDER BY timestamp DESC
                 LIMIT ?3",
                vec![
                    Box::new(scope.to_string()) as Box<dyn rusqlite::types::ToSql>,
                    Box::new(before_ts),
                    Box::new(limit),
                ],
            )
        } else {
            (
                "SELECT id, author_id, alias_name, content, timestamp, hop_count, max_hops, origin_peer, forum_scope, signature
                 FROM forum_posts
                 WHERE forum_scope = ?1
                 ORDER BY timestamp DESC
                 LIMIT ?2",
                vec![
                    Box::new(scope.to_string()) as Box<dyn rusqlite::types::ToSql>,
                    Box::new(limit),
                ],
            )
        };

        let mut stmt = self.conn.prepare(sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_refs.as_slice(), row_to_forum_post)?;
        let posts: Vec<ForumPost> = rows
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(posts)
    }

    /// Check if a forum post already exists (for deduplication).
    pub fn has_forum_post(&self, post_id: &str) -> Result<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM forum_posts WHERE id = ?1",
            params![post_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }
}

fn row_to_forum_post(row: &rusqlite::Row) -> rusqlite::Result<ForumPost> {
    let ts_millis: i64 = row.get(4)?;
    let hop_count: i64 = row.get(5)?;
    let max_hops: i64 = row.get(6)?;
    let scope_str: String = row.get(8)?;

    let forum_scope = match scope_str.as_str() {
        "global" => concord_core::types::ForumScope::Global,
        _ => concord_core::types::ForumScope::Local,
    };

    Ok(ForumPost {
        id: row.get(0)?,
        author_id: row.get(1)?,
        alias_name: row.get(2)?,
        content: row.get(3)?,
        timestamp: chrono::DateTime::from_timestamp_millis(ts_millis)
            .unwrap_or_default(),
        hop_count: hop_count as u8,
        max_hops: max_hops as u8,
        origin_peer: row.get(7)?,
        forum_scope,
        signature: row.get(9)?,
        // Stored posts are decrypted locally; encryption fields are wire-only.
        encrypted_content: None,
        nonce: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use concord_core::types::ForumScope;

    fn make_post(id: &str, scope: ForumScope, ts_offset_ms: i64) -> ForumPost {
        ForumPost {
            id: id.to_string(),
            author_id: "author1".to_string(),
            alias_name: Some("Alice".to_string()),
            content: format!("Post {id}"),
            timestamp: chrono::DateTime::from_timestamp_millis(
                Utc::now().timestamp_millis() + ts_offset_ms,
            )
            .unwrap_or_default(),
            hop_count: 1,
            max_hops: 3,
            origin_peer: "peer1".to_string(),
            forum_scope: scope,
            signature: vec![0u8; 64],
            encrypted_content: None,
            nonce: None,
        }
    }

    #[test]
    fn store_and_retrieve_forum_post() {
        let db = Database::open_in_memory().unwrap();
        let post = make_post("fp1", ForumScope::Local, 0);
        db.store_forum_post(&post).unwrap();

        let posts = db.get_forum_posts("local", 50, None).unwrap();
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "fp1");
        assert_eq!(posts[0].author_id, "author1");
        assert_eq!(posts[0].alias_name.as_deref(), Some("Alice"));
        assert_eq!(posts[0].content, "Post fp1");
        assert_eq!(posts[0].hop_count, 1);
        assert_eq!(posts[0].max_hops, 3);
        assert_eq!(posts[0].forum_scope, ForumScope::Local);
    }

    #[test]
    fn store_global_forum_post() {
        let db = Database::open_in_memory().unwrap();
        let post = make_post("gp1", ForumScope::Global, 0);
        db.store_forum_post(&post).unwrap();

        // Should not appear in local scope
        let local = db.get_forum_posts("local", 50, None).unwrap();
        assert_eq!(local.len(), 0);

        // Should appear in global scope
        let global = db.get_forum_posts("global", 50, None).unwrap();
        assert_eq!(global.len(), 1);
        assert_eq!(global[0].id, "gp1");
        assert_eq!(global[0].forum_scope, ForumScope::Global);
    }

    #[test]
    fn forum_post_dedup() {
        let db = Database::open_in_memory().unwrap();
        let post = make_post("dup1", ForumScope::Local, 0);
        db.store_forum_post(&post).unwrap();
        db.store_forum_post(&post).unwrap(); // duplicate — should be ignored

        let posts = db.get_forum_posts("local", 50, None).unwrap();
        assert_eq!(posts.len(), 1);
    }

    #[test]
    fn has_forum_post() {
        let db = Database::open_in_memory().unwrap();
        assert!(!db.has_forum_post("nope").unwrap());

        let post = make_post("exists1", ForumScope::Local, 0);
        db.store_forum_post(&post).unwrap();
        assert!(db.has_forum_post("exists1").unwrap());
    }

    #[test]
    fn forum_posts_ordered_by_timestamp_desc() {
        let db = Database::open_in_memory().unwrap();

        let p1 = make_post("old", ForumScope::Local, -2000);
        let p2 = make_post("mid", ForumScope::Local, -1000);
        let p3 = make_post("new", ForumScope::Local, 0);
        db.store_forum_post(&p1).unwrap();
        db.store_forum_post(&p2).unwrap();
        db.store_forum_post(&p3).unwrap();

        let posts = db.get_forum_posts("local", 50, None).unwrap();
        assert_eq!(posts.len(), 3);
        assert_eq!(posts[0].id, "new");
        assert_eq!(posts[1].id, "mid");
        assert_eq!(posts[2].id, "old");
    }

    #[test]
    fn forum_posts_limit() {
        let db = Database::open_in_memory().unwrap();

        for i in 0..10 {
            let post = make_post(&format!("p{i}"), ForumScope::Local, i * 1000);
            db.store_forum_post(&post).unwrap();
        }

        let posts = db.get_forum_posts("local", 3, None).unwrap();
        assert_eq!(posts.len(), 3);
    }

    #[test]
    fn forum_posts_before_filter() {
        let db = Database::open_in_memory().unwrap();

        let p1 = ForumPost {
            id: "early".to_string(),
            author_id: "a".to_string(),
            alias_name: None,
            content: "early".to_string(),
            timestamp: chrono::DateTime::from_timestamp_millis(1000).unwrap(),
            hop_count: 0,
            max_hops: 3,
            origin_peer: "p".to_string(),
            forum_scope: ForumScope::Local,
            signature: vec![0],
            encrypted_content: None,
            nonce: None,
        };
        let p2 = ForumPost {
            id: "late".to_string(),
            author_id: "a".to_string(),
            alias_name: None,
            content: "late".to_string(),
            timestamp: chrono::DateTime::from_timestamp_millis(5000).unwrap(),
            hop_count: 0,
            max_hops: 3,
            origin_peer: "p".to_string(),
            forum_scope: ForumScope::Local,
            signature: vec![0],
            encrypted_content: None,
            nonce: None,
        };
        db.store_forum_post(&p1).unwrap();
        db.store_forum_post(&p2).unwrap();

        // before=3000 should only return the early post
        let posts = db.get_forum_posts("local", 50, Some(3000)).unwrap();
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "early");
    }
}
