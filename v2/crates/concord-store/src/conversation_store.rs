use rusqlite::params;
use tracing::debug;

use concord_core::types::DirectConversation;

use crate::db::{Database, Result};

impl Database {
    /// Create a new conversation.
    pub fn create_conversation(&self, conv: &DirectConversation) -> Result<()> {
        let participants_json = serde_json::to_string(&conv.participants)?;
        self.conn.execute(
            "INSERT OR IGNORE INTO conversations (id, participants, created_at, is_group, name, last_message_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                conv.id,
                participants_json,
                conv.created_at.timestamp_millis(),
                conv.is_group as i32,
                conv.name,
                conv.created_at.timestamp_millis(),
            ],
        )?;
        debug!(id = %conv.id, "conversation created");
        Ok(())
    }

    /// Get a conversation by ID.
    pub fn get_conversation(&self, conv_id: &str) -> Result<Option<DirectConversation>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, participants, created_at, is_group, name
             FROM conversations WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![conv_id], row_to_conversation)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Get all conversations, ordered by last_message_at descending.
    pub fn get_conversations(&self) -> Result<Vec<DirectConversation>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, participants, created_at, is_group, name
             FROM conversations ORDER BY last_message_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_conversation)?;
        let convs: Vec<DirectConversation> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(convs)
    }

    /// Get or create a 1-on-1 DM conversation between two peers.
    /// The conversation ID is deterministic: sorted peer_ids joined with underscore.
    pub fn get_or_create_dm(
        &self,
        peer_id: &str,
        my_peer_id: &str,
    ) -> Result<DirectConversation> {
        // Deterministic ID from sorted peer IDs
        let mut peers = vec![peer_id.to_string(), my_peer_id.to_string()];
        peers.sort();
        let conv_id = format!("dm_{}_{}", peers[0], peers[1]);

        if let Some(conv) = self.get_conversation(&conv_id)? {
            return Ok(conv);
        }

        let conv = DirectConversation {
            id: conv_id,
            participants: peers,
            created_at: chrono::Utc::now(),
            is_group: false,
            name: None,
        };
        self.create_conversation(&conv)?;
        Ok(conv)
    }

    /// Add a participant to an existing conversation.
    pub fn add_participant(&self, conv_id: &str, peer_id: &str) -> Result<()> {
        if let Some(mut conv) = self.get_conversation(conv_id)? {
            if !conv.participants.contains(&peer_id.to_string()) {
                conv.participants.push(peer_id.to_string());
                let participants_json = serde_json::to_string(&conv.participants)?;
                self.conn.execute(
                    "UPDATE conversations SET participants = ?1, is_group = ?2 WHERE id = ?3",
                    params![
                        participants_json,
                        (conv.participants.len() > 2) as i32,
                        conv_id,
                    ],
                )?;
                debug!(conv_id, peer_id, "participant added to conversation");
            }
        }
        Ok(())
    }

    /// Update the last_message_at timestamp for a conversation.
    pub fn update_last_message(&self, conv_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE conversations SET last_message_at = ?1 WHERE id = ?2",
            params![now, conv_id],
        )?;
        Ok(())
    }
}

fn row_to_conversation(row: &rusqlite::Row) -> rusqlite::Result<DirectConversation> {
    let participants_json: String = row.get(1)?;
    let participants: Vec<String> = serde_json::from_str(&participants_json).unwrap_or_default();
    let ts_millis: i64 = row.get(2)?;
    let is_group: i32 = row.get(3)?;

    Ok(DirectConversation {
        id: row.get(0)?,
        participants,
        created_at: chrono::DateTime::from_timestamp_millis(ts_millis).unwrap_or_default(),
        is_group: is_group != 0,
        name: row.get(4)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_conv(id: &str, peers: &[&str], is_group: bool, name: Option<&str>) -> DirectConversation {
        DirectConversation {
            id: id.to_string(),
            participants: peers.iter().map(|s| s.to_string()).collect(),
            created_at: Utc::now(),
            is_group,
            name: name.map(|s| s.to_string()),
        }
    }

    #[test]
    fn create_and_get_conversation() {
        let db = Database::open_in_memory().unwrap();
        let conv = make_conv("conv1", &["peer1", "peer2"], false, None);
        db.create_conversation(&conv).unwrap();

        let loaded = db.get_conversation("conv1").unwrap().unwrap();
        assert_eq!(loaded.id, "conv1");
        assert_eq!(loaded.participants, vec!["peer1", "peer2"]);
        assert!(!loaded.is_group);
        assert!(loaded.name.is_none());
    }

    #[test]
    fn create_group_conversation() {
        let db = Database::open_in_memory().unwrap();
        let conv = make_conv("grp1", &["peer1", "peer2", "peer3"], true, Some("My Group"));
        db.create_conversation(&conv).unwrap();

        let loaded = db.get_conversation("grp1").unwrap().unwrap();
        assert!(loaded.is_group);
        assert_eq!(loaded.name.as_deref(), Some("My Group"));
        assert_eq!(loaded.participants.len(), 3);
    }

    #[test]
    fn get_nonexistent_conversation() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.get_conversation("nope").unwrap().is_none());
    }

    #[test]
    fn get_conversations_list() {
        let db = Database::open_in_memory().unwrap();
        let c1 = make_conv("conv1", &["a", "b"], false, None);
        let c2 = make_conv("conv2", &["a", "c"], false, None);
        db.create_conversation(&c1).unwrap();
        db.create_conversation(&c2).unwrap();

        let all = db.get_conversations().unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn get_or_create_dm() {
        let db = Database::open_in_memory().unwrap();

        // First call creates the DM
        let conv = db.get_or_create_dm("peer_b", "peer_a").unwrap();
        assert_eq!(conv.participants, vec!["peer_a", "peer_b"]); // sorted
        assert!(!conv.is_group);

        // Second call with reversed order returns the same conversation
        let conv2 = db.get_or_create_dm("peer_a", "peer_b").unwrap();
        assert_eq!(conv.id, conv2.id);

        // Only one conversation exists
        assert_eq!(db.get_conversations().unwrap().len(), 1);
    }

    #[test]
    fn add_participant_to_conversation() {
        let db = Database::open_in_memory().unwrap();
        let conv = make_conv("conv1", &["peer1", "peer2"], false, None);
        db.create_conversation(&conv).unwrap();

        db.add_participant("conv1", "peer3").unwrap();

        let loaded = db.get_conversation("conv1").unwrap().unwrap();
        assert_eq!(loaded.participants.len(), 3);
        assert!(loaded.participants.contains(&"peer3".to_string()));
        assert!(loaded.is_group); // upgraded to group
    }

    #[test]
    fn add_duplicate_participant_is_noop() {
        let db = Database::open_in_memory().unwrap();
        let conv = make_conv("conv1", &["peer1", "peer2"], false, None);
        db.create_conversation(&conv).unwrap();

        db.add_participant("conv1", "peer2").unwrap(); // already there

        let loaded = db.get_conversation("conv1").unwrap().unwrap();
        assert_eq!(loaded.participants.len(), 2);
    }

    #[test]
    fn update_last_message() {
        let db = Database::open_in_memory().unwrap();
        let conv = make_conv("conv1", &["peer1", "peer2"], false, None);
        db.create_conversation(&conv).unwrap();

        db.update_last_message("conv1").unwrap();
        // Verify it still exists and is valid
        let loaded = db.get_conversation("conv1").unwrap().unwrap();
        assert_eq!(loaded.id, "conv1");
    }

    #[test]
    fn conversation_duplicate_create_is_noop() {
        let db = Database::open_in_memory().unwrap();
        let conv = make_conv("conv1", &["peer1", "peer2"], false, None);
        db.create_conversation(&conv).unwrap();
        db.create_conversation(&conv).unwrap(); // should not error

        assert_eq!(db.get_conversations().unwrap().len(), 1);
    }
}
