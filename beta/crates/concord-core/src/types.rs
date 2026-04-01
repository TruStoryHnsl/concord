use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A chat message sent within a channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub channel_id: String,
    pub sender_id: String,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    pub signature: Vec<u8>,
    /// Which alias sent this message (None for legacy messages).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias_id: Option<String>,
    /// Display name of the alias at time of sending.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias_name: Option<String>,
    /// Encrypted message content (when present, `content` is empty on the wire).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_content: Option<Vec<u8>>,
    /// Nonce used for encryption.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nonce: Option<Vec<u8>>,
}

/// An alias (persona) belonging to a user identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alias {
    pub id: String,
    pub root_identity: String,
    pub display_name: String,
    pub avatar_seed: String,
    pub created_at: DateTime<Utc>,
    pub is_active: bool,
}

/// Announcement broadcast when a user creates or updates an alias.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AliasAnnouncement {
    pub alias_id: String,
    pub root_identity: String,
    pub display_name: String,
    pub signature: Vec<u8>,
}

/// A communication channel within a server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub server_id: String,
    pub name: String,
    pub channel_type: ChannelType,
}

/// The kind of channel.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ChannelType {
    Text,
    Voice,
    Video,
}

/// A server (guild) that contains channels.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub visibility: Visibility,
}

/// Server visibility / federation mode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Visibility {
    Public,
    Private,
    Federated,
}

/// A user profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub display_name: String,
    pub trust_level: TrustLevel,
}

/// Trust level assigned to a peer.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum TrustLevel {
    Unverified,
    Recognized,
    Established,
    Trusted,
    Backbone,
}

/// Information about a node in the mesh network.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInfo {
    pub peer_id: String,
    pub display_name: String,
    pub node_type: NodeType,
    pub capabilities: NodeCapabilities,
}

/// The role a node plays in the network.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum NodeType {
    User,
    Backbone,
    Guest,
    /// Read-only scout for mesh map exploration. Cannot cluster or contribute compute.
    Phantom,
}

/// Hardware/resource capabilities reported by a node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeCapabilities {
    pub cpu_cores: u32,
    pub memory_mb: u64,
    pub battery_percent: Option<u8>,
    pub bandwidth_kbps: u64,
}

/// Voice signaling messages exchanged between peers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VoiceSignal {
    /// Peer wants to join a voice channel.
    Join {
        peer_id: String,
        channel_id: String,
        server_id: String,
    },
    /// Peer is leaving a voice channel.
    Leave {
        peer_id: String,
        channel_id: String,
        server_id: String,
    },
    /// SDP Offer from a peer.
    Offer {
        from_peer: String,
        to_peer: String,
        sdp: String,
    },
    /// SDP Answer from a peer.
    Answer {
        from_peer: String,
        to_peer: String,
        sdp: String,
    },
    /// ICE candidate from a peer.
    IceCandidate {
        from_peer: String,
        to_peer: String,
        candidate: String,
        sdp_mid: String,
    },
    /// Peer mute/unmute state change.
    MuteState {
        peer_id: String,
        is_muted: bool,
    },
    /// Peer speaking state change.
    SpeakingState {
        peer_id: String,
        is_speaking: bool,
    },
    /// Encoded audio frame from a peer (Opus-encoded data).
    AudioFrame {
        peer_id: String,
        data: Vec<u8>,
    },
}

/// An encrypted direct message between two peers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectMessage {
    pub id: String,
    pub from_peer: String,
    pub to_peer: String,
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub timestamp: DateTime<Utc>,
}

/// DM signaling messages exchanged between peers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DmSignal {
    /// Key exchange initiation (send our X25519 public key).
    KeyExchange {
        from_peer: String,
        to_peer: String,
        public_key: Vec<u8>,
    },
    /// Encrypted message.
    EncryptedMessage(DirectMessage),
}

// ─── Three Pathways Types ───────────────────────────────────────────

/// A forum post in the mesh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForumPost {
    pub id: String,
    pub author_id: String,
    pub alias_name: Option<String>,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    pub hop_count: u8,
    pub max_hops: u8,
    pub origin_peer: String,
    pub forum_scope: ForumScope,
    pub signature: Vec<u8>,
    /// Encrypted post content (when present, `content` is empty on the wire).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_content: Option<Vec<u8>>,
    /// Nonce used for encryption.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nonce: Option<Vec<u8>>,
}

/// Whether a forum post is local (hop-limited) or global (unlimited propagation).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ForumScope {
    Local,
    Global,
}

/// Signals exchanged on the friend-specific GossipSub topics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FriendSignal {
    /// Friend request.
    Request { from_peer: String, display_name: String },
    /// Accept friend request.
    Accept { from_peer: String },
    /// Presence heartbeat (sent every 30s to friends).
    Presence { peer_id: String, status: PresenceStatus },
    /// Ledger sync request/response between friends.
    LedgerSync { peer_id: String, data: Vec<u8> },
}

/// Online presence status for a peer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PresenceStatus {
    Online,
    Away,
    DoNotDisturb,
    Offline,
}

/// A direct conversation between nodes (expandable to group).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectConversation {
    pub id: String,
    pub participants: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub is_group: bool,
    pub name: Option<String>,
}

/// Encrypted envelope for transmitting secrets (e.g., server keys via invites).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    pub recipient_peer_id: String,
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    /// X25519 ephemeral public key of the sender.
    pub sender_public_key: Vec<u8>,
}

// ─── Sync Protocol Types ────────────────────────────────────────────

/// Sync protocol messages exchanged between peers to synchronize
/// message history after reconnection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncMessage {
    /// Request: "Here's what I have, send me what I'm missing."
    SyncRequest {
        peer_id: String,
        /// channel_id → newest message timestamp (unix millis).
        vector_clock: HashMap<String, i64>,
    },
    /// Response: "Here are the messages you're missing."
    SyncResponse {
        peer_id: String,
        messages: Vec<Message>,
    },
}

/// Server key exchange signals for distributing encryption keys to joining members.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServerSignal {
    /// A newly joined member requests the server encryption key.
    KeyRequest {
        peer_id: String,
        x25519_public_key: Vec<u8>,
    },
    /// A member responds with the server key encrypted to the requester.
    KeyResponse {
        to_peer: String,
        encrypted_key: crate::crypto::EncryptedEnvelope,
    },
}

// ─── Verification & Compute Types ───────────────────────────────────

/// Verification state of a mesh node from this node's local perspective.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum VerificationState {
    /// Recently probed and confirmed responsive. TTL > 0.
    Verified,
    /// Previously verified but TTL expired.
    Stale,
    /// Only known from gossip/mDNS; never probed.
    Speculative,
}

/// Verification tag stored per peer. Freshness measured in heartbeat ticks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationTag {
    pub peer_id: String,
    pub state: VerificationState,
    /// Remaining TTL in heartbeat ticks. Resets on confirmed probe response.
    pub remaining_ttl: u8,
    /// Unix millis when last confirmed.
    pub last_confirmed_at: Option<u64>,
    /// Peer's addresses at time of last confirmation.
    pub confirmed_addresses: Vec<String>,
}

/// Default heartbeat ticks a Verified tag stays fresh.
pub const DEFAULT_VERIFICATION_TTL: u8 = 5;

/// GossipSub message for probing peers to confirm liveness.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NodeProbeMessage {
    /// "Are you there? Send me your current info."
    Probe {
        from_peer: String,
        sent_at: u64,
    },
    /// "Yes, here's my current info."
    ProbeResponse {
        from_peer: String,
        to_peer: String,
        sent_at: u64,
        node_info: NodeInfo,
    },
}

/// A node's processing power allocation across followed nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputeAllocationMessage {
    pub from_peer: String,
    pub allocations: Vec<ComputeEntry>,
    pub timestamp: u64,
    pub signature: Vec<u8>,
}

/// A single allocation entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputeEntry {
    pub peer_id: String,
    /// Priority rank, 1 = highest.
    pub priority: u8,
    /// Computed share [0.0, 1.0] via triangular distribution.
    pub share: f64,
}

/// Enriched node record for the frontend mesh map.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshNodeRecord {
    pub peer_id: String,
    pub display_name: Option<String>,
    pub addresses: Vec<String>,
    pub verification_state: VerificationState,
    pub remaining_ttl: u8,
    pub last_confirmed_at: Option<u64>,
    pub received_compute_weight: f64,
    pub connection_type: Option<String>,
    pub rtt_ms: Option<u32>,
    pub last_seen: i64,
}
