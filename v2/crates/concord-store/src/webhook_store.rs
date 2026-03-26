use rusqlite::params;
use tracing::debug;

use crate::db::{Database, Result};

/// A stored webhook record.
#[derive(Debug, Clone)]
pub struct WebhookRecord {
    pub id: String,
    pub server_id: String,
    pub channel_id: String,
    pub name: String,
    pub token: String,
    pub avatar_seed: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub last_used: Option<i64>,
    pub message_count: i64,
}

impl Database {
    /// Create a new webhook.
    pub fn create_webhook(&self, webhook: &WebhookRecord) -> Result<()> {
        self.conn.execute(
            "INSERT INTO webhooks (id, server_id, channel_id, name, token, avatar_seed, created_by, created_at, last_used, message_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                webhook.id,
                webhook.server_id,
                webhook.channel_id,
                webhook.name,
                webhook.token,
                webhook.avatar_seed,
                webhook.created_by,
                webhook.created_at,
                webhook.last_used,
                webhook.message_count,
            ],
        )?;
        debug!(webhook_id = %webhook.id, name = %webhook.name, "webhook created");
        Ok(())
    }

    /// Look up a webhook by its unique token.
    pub fn get_webhook_by_token(&self, token: &str) -> Result<Option<WebhookRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, server_id, channel_id, name, token, avatar_seed, created_by, created_at, last_used, message_count
             FROM webhooks WHERE token = ?1",
        )?;
        let mut rows = stmt.query_map(params![token], row_to_webhook)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Get all webhooks for a specific channel.
    pub fn get_webhooks_for_channel(
        &self,
        server_id: &str,
        channel_id: &str,
    ) -> Result<Vec<WebhookRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, server_id, channel_id, name, token, avatar_seed, created_by, created_at, last_used, message_count
             FROM webhooks WHERE server_id = ?1 AND channel_id = ?2
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![server_id, channel_id], row_to_webhook)?;
        let webhooks: Vec<WebhookRecord> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(webhooks)
    }

    /// Get all webhooks for a server.
    pub fn get_webhooks_for_server(&self, server_id: &str) -> Result<Vec<WebhookRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, server_id, channel_id, name, token, avatar_seed, created_by, created_at, last_used, message_count
             FROM webhooks WHERE server_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![server_id], row_to_webhook)?;
        let webhooks: Vec<WebhookRecord> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(webhooks)
    }

    /// Delete a webhook by ID.
    pub fn delete_webhook(&self, webhook_id: &str) -> Result<bool> {
        let deleted = self.conn.execute(
            "DELETE FROM webhooks WHERE id = ?1",
            params![webhook_id],
        )?;
        debug!(webhook_id, "webhook deleted");
        Ok(deleted > 0)
    }

    /// Increment the usage counter and update last_used timestamp.
    pub fn increment_webhook_usage(&self, webhook_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "UPDATE webhooks SET message_count = message_count + 1, last_used = ?1 WHERE id = ?2",
            params![now, webhook_id],
        )?;
        debug!(webhook_id, "webhook usage incremented");
        Ok(())
    }
}

fn row_to_webhook(row: &rusqlite::Row) -> rusqlite::Result<WebhookRecord> {
    Ok(WebhookRecord {
        id: row.get(0)?,
        server_id: row.get(1)?,
        channel_id: row.get(2)?,
        name: row.get(3)?,
        token: row.get(4)?,
        avatar_seed: row.get(5)?,
        created_by: row.get(6)?,
        created_at: row.get(7)?,
        last_used: row.get(8)?,
        message_count: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_webhook(id: &str, server: &str, channel: &str, name: &str, token: &str) -> WebhookRecord {
        WebhookRecord {
            id: id.to_string(),
            server_id: server.to_string(),
            channel_id: channel.to_string(),
            name: name.to_string(),
            token: token.to_string(),
            avatar_seed: Some(format!("seed-{id}")),
            created_by: "owner1".to_string(),
            created_at: 1_700_000_000,
            last_used: None,
            message_count: 0,
        }
    }

    #[test]
    fn create_and_get_by_token() {
        let db = Database::open_in_memory().unwrap();
        let wh = make_webhook("wh1", "srv1", "ch1", "GitHub CI", "tok-abc123");
        db.create_webhook(&wh).unwrap();

        let found = db.get_webhook_by_token("tok-abc123").unwrap().unwrap();
        assert_eq!(found.id, "wh1");
        assert_eq!(found.name, "GitHub CI");
        assert_eq!(found.server_id, "srv1");
        assert_eq!(found.channel_id, "ch1");
        assert_eq!(found.message_count, 0);
        assert!(found.last_used.is_none());
    }

    #[test]
    fn get_by_token_not_found() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.get_webhook_by_token("nonexistent").unwrap().is_none());
    }

    #[test]
    fn get_webhooks_for_channel() {
        let db = Database::open_in_memory().unwrap();
        db.create_webhook(&make_webhook("wh1", "srv1", "ch1", "Hook A", "tok1")).unwrap();
        db.create_webhook(&make_webhook("wh2", "srv1", "ch1", "Hook B", "tok2")).unwrap();
        db.create_webhook(&make_webhook("wh3", "srv1", "ch2", "Hook C", "tok3")).unwrap();

        let hooks = db.get_webhooks_for_channel("srv1", "ch1").unwrap();
        assert_eq!(hooks.len(), 2);
        assert_eq!(hooks[0].name, "Hook A");
        assert_eq!(hooks[1].name, "Hook B");

        let hooks = db.get_webhooks_for_channel("srv1", "ch2").unwrap();
        assert_eq!(hooks.len(), 1);
        assert_eq!(hooks[0].name, "Hook C");
    }

    #[test]
    fn get_webhooks_for_server() {
        let db = Database::open_in_memory().unwrap();
        db.create_webhook(&make_webhook("wh1", "srv1", "ch1", "Hook A", "tok1")).unwrap();
        db.create_webhook(&make_webhook("wh2", "srv1", "ch2", "Hook B", "tok2")).unwrap();
        db.create_webhook(&make_webhook("wh3", "srv2", "ch3", "Hook C", "tok3")).unwrap();

        let hooks = db.get_webhooks_for_server("srv1").unwrap();
        assert_eq!(hooks.len(), 2);

        let hooks = db.get_webhooks_for_server("srv2").unwrap();
        assert_eq!(hooks.len(), 1);
        assert_eq!(hooks[0].name, "Hook C");
    }

    #[test]
    fn delete_webhook() {
        let db = Database::open_in_memory().unwrap();
        db.create_webhook(&make_webhook("wh1", "srv1", "ch1", "Hook A", "tok1")).unwrap();

        assert!(db.delete_webhook("wh1").unwrap());
        assert!(!db.delete_webhook("wh1").unwrap()); // already deleted
        assert!(db.get_webhook_by_token("tok1").unwrap().is_none());
    }

    #[test]
    fn increment_usage() {
        let db = Database::open_in_memory().unwrap();
        db.create_webhook(&make_webhook("wh1", "srv1", "ch1", "Hook A", "tok1")).unwrap();

        db.increment_webhook_usage("wh1").unwrap();
        db.increment_webhook_usage("wh1").unwrap();
        db.increment_webhook_usage("wh1").unwrap();

        let wh = db.get_webhook_by_token("tok1").unwrap().unwrap();
        assert_eq!(wh.message_count, 3);
        assert!(wh.last_used.is_some());
    }

    #[test]
    fn unique_token_constraint() {
        let db = Database::open_in_memory().unwrap();
        db.create_webhook(&make_webhook("wh1", "srv1", "ch1", "Hook A", "same-token")).unwrap();

        let result = db.create_webhook(&make_webhook("wh2", "srv1", "ch1", "Hook B", "same-token"));
        assert!(result.is_err(), "duplicate token should fail");
    }

    #[test]
    fn webhooks_for_empty_server() {
        let db = Database::open_in_memory().unwrap();
        let hooks = db.get_webhooks_for_server("nonexistent").unwrap();
        assert!(hooks.is_empty());
    }

    #[test]
    fn webhooks_for_empty_channel() {
        let db = Database::open_in_memory().unwrap();
        let hooks = db.get_webhooks_for_channel("srv1", "nonexistent").unwrap();
        assert!(hooks.is_empty());
    }

    #[test]
    fn webhook_without_avatar_seed() {
        let db = Database::open_in_memory().unwrap();
        let mut wh = make_webhook("wh1", "srv1", "ch1", "No Avatar", "tok1");
        wh.avatar_seed = None;
        db.create_webhook(&wh).unwrap();

        let found = db.get_webhook_by_token("tok1").unwrap().unwrap();
        assert!(found.avatar_seed.is_none());
    }
}
