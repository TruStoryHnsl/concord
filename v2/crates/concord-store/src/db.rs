use std::path::Path;

use rusqlite::Connection;
use thiserror::Error;
use tracing::info;

#[derive(Error, Debug)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("invalid data: {0}")]
    InvalidData(String),
    #[error("identity error: {0}")]
    Identity(#[from] concord_core::identity::IdentityError),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// SQLite-backed local storage for a Concord node.
pub struct Database {
    pub(crate) conn: Connection,
}

impl Database {
    /// Open (or create) a database at the given path.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Self { conn };
        db.initialize()?;
        info!("database opened and initialized");
        Ok(db)
    }

    /// Open an in-memory database (useful for testing).
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        let db = Self { conn };
        db.initialize()?;
        Ok(db)
    }

    /// Current schema version. Increment when adding migrations.
    const SCHEMA_VERSION: u32 = 3;

    /// Create all required tables and run migrations if needed.
    fn initialize(&self) -> Result<()> {
        // Schema version tracking
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL
            )",
        )?;
        let current_version: u32 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if current_version < Self::SCHEMA_VERSION {
            self.run_migrations(current_version)?;
            self.conn.execute(
                "INSERT INTO schema_version (version) VALUES (?1)",
                rusqlite::params![Self::SCHEMA_VERSION],
            )?;
            info!(
                from = current_version,
                to = Self::SCHEMA_VERSION,
                "database schema migrated"
            );
        }

        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS messages (
                id          TEXT PRIMARY KEY,
                channel_id  TEXT NOT NULL,
                sender_id   TEXT NOT NULL,
                content     TEXT NOT NULL,
                timestamp   INTEGER NOT NULL,
                signature   BLOB,
                alias_id    TEXT,
                alias_name  TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_messages_channel_ts
                ON messages(channel_id, timestamp);

            CREATE TABLE IF NOT EXISTS channels (
                id            TEXT PRIMARY KEY,
                server_id     TEXT NOT NULL,
                name          TEXT NOT NULL,
                channel_type  TEXT NOT NULL DEFAULT 'text'
            );

            CREATE TABLE IF NOT EXISTS servers (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                owner_id    TEXT NOT NULL,
                visibility  TEXT NOT NULL DEFAULT 'private'
            );

            CREATE TABLE IF NOT EXISTS peers (
                peer_id       TEXT PRIMARY KEY,
                display_name  TEXT,
                last_seen     INTEGER,
                trust_score   REAL NOT NULL DEFAULT 0.0,
                addresses     TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS identity (
                id            INTEGER PRIMARY KEY CHECK (id = 1),
                display_name  TEXT NOT NULL,
                signing_key   BLOB NOT NULL,
                created_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS invites (
                code        TEXT PRIMARY KEY,
                server_id   TEXT NOT NULL,
                created_by  TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                max_uses    INTEGER,
                use_count   INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS members (
                server_id   TEXT NOT NULL,
                peer_id     TEXT NOT NULL,
                role        TEXT NOT NULL DEFAULT 'member',
                joined_at   INTEGER NOT NULL,
                PRIMARY KEY (server_id, peer_id)
            );

            CREATE TABLE IF NOT EXISTS attestations (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                attester_id     TEXT NOT NULL,
                subject_id      TEXT NOT NULL,
                attestation_type TEXT NOT NULL DEFAULT 'positive',
                since_timestamp INTEGER NOT NULL,
                reason          TEXT,
                signature       BLOB NOT NULL,
                attester_trust_weight REAL NOT NULL DEFAULT 0.0,
                received_at     INTEGER NOT NULL,
                UNIQUE(attester_id, subject_id)
            );

            CREATE TABLE IF NOT EXISTS aliases (
                id              TEXT PRIMARY KEY,
                root_identity   TEXT NOT NULL,
                display_name    TEXT NOT NULL,
                avatar_seed     TEXT NOT NULL,
                created_at      INTEGER NOT NULL,
                is_active       INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_aliases_root
                ON aliases(root_identity);

            CREATE TABLE IF NOT EXISTS known_aliases (
                alias_id        TEXT PRIMARY KEY,
                root_identity   TEXT NOT NULL,
                display_name    TEXT NOT NULL,
                first_seen      INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_known_aliases_root
                ON known_aliases(root_identity);

            CREATE TABLE IF NOT EXISTS totp_secrets (
                peer_id     TEXT PRIMARY KEY,
                secret      BLOB NOT NULL,
                enabled     INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dm_sessions (
                peer_id         TEXT PRIMARY KEY,
                shared_secret   BLOB NOT NULL,
                send_chain_key  BLOB NOT NULL,
                recv_chain_key  BLOB NOT NULL,
                send_count      INTEGER NOT NULL DEFAULT 0,
                recv_count      INTEGER NOT NULL DEFAULT 0,
                updated_at      INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS direct_messages (
                id                  TEXT PRIMARY KEY,
                peer_id             TEXT NOT NULL,
                sender_id           TEXT NOT NULL,
                content_encrypted   BLOB NOT NULL,
                nonce               BLOB NOT NULL,
                timestamp           INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_direct_messages_peer_ts
                ON direct_messages(peer_id, timestamp);

            CREATE INDEX IF NOT EXISTS idx_attestations_subject
                ON attestations(subject_id);

            CREATE TABLE IF NOT EXISTS webhooks (
                id          TEXT PRIMARY KEY,
                server_id   TEXT NOT NULL,
                channel_id  TEXT NOT NULL,
                name        TEXT NOT NULL,
                token       TEXT NOT NULL UNIQUE,
                avatar_seed TEXT,
                created_by  TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                last_used   INTEGER,
                message_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_webhooks_server
                ON webhooks(server_id);

            CREATE INDEX IF NOT EXISTS idx_webhooks_token
                ON webhooks(token);

            CREATE TABLE IF NOT EXISTS forum_posts (
                id TEXT PRIMARY KEY,
                author_id TEXT NOT NULL,
                alias_name TEXT,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                hop_count INTEGER NOT NULL,
                max_hops INTEGER NOT NULL,
                origin_peer TEXT NOT NULL,
                forum_scope TEXT NOT NULL,
                signature BLOB NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_forum_timestamp
                ON forum_posts(forum_scope, timestamp DESC);

            CREATE TABLE IF NOT EXISTS friends (
                peer_id TEXT PRIMARY KEY,
                display_name TEXT,
                alias_name TEXT,
                added_at INTEGER NOT NULL,
                is_mutual INTEGER NOT NULL DEFAULT 0,
                auto_tunnel INTEGER NOT NULL DEFAULT 1,
                last_online INTEGER
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                participants TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                is_group INTEGER NOT NULL DEFAULT 0,
                name TEXT,
                last_message_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS server_keys (
                server_id TEXT PRIMARY KEY,
                secret_key BLOB NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS peer_verification (
                peer_id             TEXT PRIMARY KEY,
                state               TEXT NOT NULL DEFAULT 'speculative',
                remaining_ttl       INTEGER NOT NULL DEFAULT 0,
                last_confirmed_at   INTEGER,
                confirmed_addresses TEXT NOT NULL DEFAULT '[]',
                updated_at          INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS compute_allocations (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                from_peer       TEXT NOT NULL,
                to_peer         TEXT NOT NULL,
                priority        INTEGER NOT NULL,
                share           REAL NOT NULL,
                announced_at    INTEGER NOT NULL,
                UNIQUE(from_peer, to_peer)
            );

            CREATE INDEX IF NOT EXISTS idx_compute_allocations_to_peer
                ON compute_allocations(to_peer);

            CREATE TABLE IF NOT EXISTS local_compute_priorities (
                peer_id     TEXT PRIMARY KEY,
                priority    INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );
            ",
        )?;
        info!("database schema initialized");
        Ok(())
    }

    /// Run schema migrations from `from_version` to `SCHEMA_VERSION`.
    fn run_migrations(&self, from_version: u32) -> Result<()> {
        // Migration 0 → 1: initial schema (handled by CREATE TABLE IF NOT EXISTS above)
        if from_version < 1 {
            // No additional SQL needed — the CREATE TABLE statements handle v1
            info!("migration 0→1: initial schema");
        }
        // Migration 1 → 2: mesh map tables
        if from_version < 2 {
            self.conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS mesh_map_entries (
                    address         BLOB PRIMARY KEY,
                    kind            TEXT NOT NULL,
                    owner_id        TEXT NOT NULL,
                    created_at      INTEGER NOT NULL,
                    updated_at      INTEGER NOT NULL,
                    last_verified_at INTEGER,
                    confidence      TEXT NOT NULL DEFAULT 'speculative',
                    ttl_ticks       INTEGER NOT NULL DEFAULT 0,
                    locale_path     TEXT NOT NULL DEFAULT '[]',
                    payload         BLOB NOT NULL,
                    signature       BLOB NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_mesh_map_kind ON mesh_map_entries(kind);
                CREATE INDEX IF NOT EXISTS idx_mesh_map_owner ON mesh_map_entries(owner_id);
                CREATE INDEX IF NOT EXISTS idx_mesh_map_updated ON mesh_map_entries(updated_at);
                CREATE INDEX IF NOT EXISTS idx_mesh_map_confidence ON mesh_map_entries(confidence);
                CREATE INDEX IF NOT EXISTS idx_mesh_map_locale ON mesh_map_entries(locale_path);

                CREATE TABLE IF NOT EXISTS mesh_map_tombstones (
                    address         BLOB PRIMARY KEY,
                    tombstoned_at   INTEGER NOT NULL,
                    reason          TEXT NOT NULL DEFAULT 'expired'
                );

                CREATE TABLE IF NOT EXISTS mesh_routes (
                    from_address    BLOB NOT NULL,
                    to_address      BLOB NOT NULL,
                    route_data      BLOB NOT NULL,
                    cost            REAL NOT NULL,
                    computed_at     INTEGER NOT NULL,
                    PRIMARY KEY (from_address, to_address)
                );

                CREATE INDEX IF NOT EXISTS idx_mesh_routes_cost ON mesh_routes(cost);

                CREATE TABLE IF NOT EXISTS engagement_counters (
                    peer_id         TEXT PRIMARY KEY,
                    messages_sent   INTEGER NOT NULL DEFAULT 0,
                    messages_read   INTEGER NOT NULL DEFAULT 0,
                    forum_posts_created INTEGER NOT NULL DEFAULT 0,
                    forum_posts_read INTEGER NOT NULL DEFAULT 0,
                    call_minutes_initiated INTEGER NOT NULL DEFAULT 0,
                    call_minutes_participated INTEGER NOT NULL DEFAULT 0,
                    last_active_at  INTEGER NOT NULL,
                    engagement_score INTEGER NOT NULL DEFAULT 0
                );
                ",
            )?;
            info!("migration 1→2: mesh map tables");
        }
        // Migration 2 → 3: block list
        if from_version < 3 {
            self.conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS blocked_peers (
                    peer_id     TEXT PRIMARY KEY,
                    blocked_at  INTEGER NOT NULL,
                    reason      TEXT NOT NULL DEFAULT ''
                );",
            )?;
            info!("migration 2→3: blocked_peers table");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_and_initialize() {
        let db = Database::open_in_memory().unwrap();
        // Tables should exist — verify by querying sqlite_master
        let count: i32 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('messages','channels','servers','peers','identity','invites','members','attestations','totp_secrets','dm_sessions','direct_messages','aliases','known_aliases','webhooks','forum_posts','friends','conversations','settings','server_keys','mesh_map_entries','mesh_map_tombstones','mesh_routes','engagement_counters','blocked_peers')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 24);
    }
}
