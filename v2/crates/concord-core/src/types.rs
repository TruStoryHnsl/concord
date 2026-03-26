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
