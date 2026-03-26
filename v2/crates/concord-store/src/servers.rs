use rusqlite::params;
use tracing::debug;

use concord_core::types::{Channel, ChannelType, Server, Visibility};

use crate::db::{Database, Result};

impl Database {
    /// Store a server record.
    pub fn create_server(&self, server: &Server) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO servers (id, name, owner_id, visibility)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                server.id,
                server.name,
                server.owner_id,
                visibility_to_str(&server.visibility),
            ],
        )?;
        debug!(server_id = %server.id, "server stored");
        Ok(())
    }

    /// Retrieve a server by ID.
    pub fn get_server(&self, server_id: &str) -> Result<Option<Server>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, owner_id, visibility FROM servers WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![server_id], row_to_server)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Retrieve all servers.
    pub fn get_all_servers(&self) -> Result<Vec<Server>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, owner_id, visibility FROM servers ORDER BY name",
        )?;
        let rows = stmt.query_map([], row_to_server)?;
        let servers: Vec<Server> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(servers)
    }

    /// Store a channel record.
    pub fn create_channel(&self, channel: &Channel) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO channels (id, server_id, name, channel_type)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                channel.id,
                channel.server_id,
                channel.name,
                channel_type_to_str(&channel.channel_type),
            ],
        )?;
        debug!(channel_id = %channel.id, "channel stored");
        Ok(())
    }

    /// Retrieve all channels belonging to a server.
    pub fn get_channels(&self, server_id: &str) -> Result<Vec<Channel>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, server_id, name, channel_type FROM channels WHERE server_id = ?1 ORDER BY name",
        )?;
        let rows = stmt.query_map(params![server_id], row_to_channel)?;
        let channels: Vec<Channel> = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(channels)
    }
}

fn visibility_to_str(v: &Visibility) -> &'static str {
    match v {
        Visibility::Public => "public",
        Visibility::Private => "private",
        Visibility::Federated => "federated",
    }
}

fn str_to_visibility(s: &str) -> Visibility {
    match s {
        "public" => Visibility::Public,
        "federated" => Visibility::Federated,
        _ => Visibility::Private,
    }
}

/// Public wrapper for use by other store modules.
pub(crate) fn str_to_visibility_pub(s: &str) -> Visibility {
    str_to_visibility(s)
}

fn channel_type_to_str(ct: &ChannelType) -> &'static str {
    match ct {
        ChannelType::Text => "text",
        ChannelType::Voice => "voice",
        ChannelType::Video => "video",
    }
}

fn str_to_channel_type(s: &str) -> ChannelType {
    match s {
        "voice" => ChannelType::Voice,
        "video" => ChannelType::Video,
        _ => ChannelType::Text,
    }
}

fn row_to_server(row: &rusqlite::Row) -> rusqlite::Result<Server> {
    let vis_str: String = row.get(3)?;
    Ok(Server {
        id: row.get(0)?,
        name: row.get(1)?,
        owner_id: row.get(2)?,
        visibility: str_to_visibility(&vis_str),
    })
}

fn row_to_channel(row: &rusqlite::Row) -> rusqlite::Result<Channel> {
    let ct_str: String = row.get(3)?;
    Ok(Channel {
        id: row.get(0)?,
        server_id: row.get(1)?,
        name: row.get(2)?,
        channel_type: str_to_channel_type(&ct_str),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_and_get_server() {
        let db = Database::open_in_memory().unwrap();

        let server = Server {
            id: "s1".into(),
            name: "Test Server".into(),
            owner_id: "owner1".into(),
            visibility: Visibility::Public,
        };
        db.create_server(&server).unwrap();

        let loaded = db.get_server("s1").unwrap().unwrap();
        assert_eq!(loaded.id, "s1");
        assert_eq!(loaded.name, "Test Server");
        assert_eq!(loaded.owner_id, "owner1");
        assert_eq!(loaded.visibility, Visibility::Public);
    }

    #[test]
    fn get_all_servers() {
        let db = Database::open_in_memory().unwrap();

        for (id, name) in [("s1", "Alpha"), ("s2", "Beta"), ("s3", "Charlie")] {
            db.create_server(&Server {
                id: id.into(),
                name: name.into(),
                owner_id: "owner".into(),
                visibility: Visibility::Private,
            })
            .unwrap();
        }

        let servers = db.get_all_servers().unwrap();
        assert_eq!(servers.len(), 3);
        // Should be ordered by name
        assert_eq!(servers[0].name, "Alpha");
        assert_eq!(servers[1].name, "Beta");
        assert_eq!(servers[2].name, "Charlie");
    }

    #[test]
    fn create_and_get_channels() {
        let db = Database::open_in_memory().unwrap();

        let server = Server {
            id: "s1".into(),
            name: "Test".into(),
            owner_id: "owner".into(),
            visibility: Visibility::Private,
        };
        db.create_server(&server).unwrap();

        let ch_text = Channel {
            id: "c1".into(),
            server_id: "s1".into(),
            name: "general".into(),
            channel_type: ChannelType::Text,
        };
        let ch_voice = Channel {
            id: "c2".into(),
            server_id: "s1".into(),
            name: "voice-lobby".into(),
            channel_type: ChannelType::Voice,
        };
        db.create_channel(&ch_text).unwrap();
        db.create_channel(&ch_voice).unwrap();

        let channels = db.get_channels("s1").unwrap();
        assert_eq!(channels.len(), 2);
        assert_eq!(channels[0].name, "general");
        assert_eq!(channels[0].channel_type, ChannelType::Text);
        assert_eq!(channels[0].server_id, "s1");
        assert_eq!(channels[1].name, "voice-lobby");
        assert_eq!(channels[1].channel_type, ChannelType::Voice);
    }

    #[test]
    fn unknown_server_returns_none() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.get_server("nonexistent").unwrap().is_none());
    }

    #[test]
    fn channels_isolated_by_server() {
        let db = Database::open_in_memory().unwrap();

        db.create_channel(&Channel {
            id: "c1".into(),
            server_id: "s1".into(),
            name: "ch1".into(),
            channel_type: ChannelType::Text,
        })
        .unwrap();
        db.create_channel(&Channel {
            id: "c2".into(),
            server_id: "s2".into(),
            name: "ch2".into(),
            channel_type: ChannelType::Text,
        })
        .unwrap();

        assert_eq!(db.get_channels("s1").unwrap().len(), 1);
        assert_eq!(db.get_channels("s2").unwrap().len(), 1);
        assert_eq!(db.get_channels("s3").unwrap().len(), 0);
    }

    #[test]
    fn visibility_roundtrip() {
        let db = Database::open_in_memory().unwrap();

        for vis in [Visibility::Public, Visibility::Private, Visibility::Federated] {
            let id = format!("s-{:?}", vis);
            db.create_server(&Server {
                id: id.clone(),
                name: "Test".into(),
                owner_id: "o".into(),
                visibility: vis.clone(),
            })
            .unwrap();
            let loaded = db.get_server(&id).unwrap().unwrap();
            assert_eq!(loaded.visibility, vis);
        }
    }
}
