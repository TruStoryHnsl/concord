/// Event name constants for Tauri event bus communication between
/// the Rust backend and the frontend.

/// Emitted when a new chat message arrives on a subscribed channel.
pub const NEW_MESSAGE: &str = "concord://new-message";

/// Emitted when a new peer is discovered on the local mesh (mDNS) or DHT.
pub const PEER_DISCOVERED: &str = "concord://peer-discovered";

/// Emitted when a previously connected peer leaves or becomes unreachable.
pub const PEER_DEPARTED: &str = "concord://peer-departed";

/// Emitted when the local node's connectivity status changes (online/offline/relay).
pub const NODE_STATUS_CHANGED: &str = "concord://node-status-changed";

/// Emitted when a new participant joins the current voice channel.
pub const VOICE_PARTICIPANT_JOINED: &str = "concord://voice-participant-joined";

/// Emitted when a participant leaves the current voice channel.
pub const VOICE_PARTICIPANT_LEFT: &str = "concord://voice-participant-left";

/// Emitted when voice channel state changes (join, leave, mute, deafen).
pub const VOICE_STATE_CHANGED: &str = "concord://voice-state-changed";

/// Emitted when a tunnel (connection) to a peer is established.
pub const TUNNEL_ESTABLISHED: &str = "concord://tunnel-established";

/// Emitted when a tunnel (connection) to a peer is closed.
pub const TUNNEL_CLOSED: &str = "concord://tunnel-closed";

/// Emitted when a trust attestation is received from the mesh.
pub const ATTESTATION_RECEIVED: &str = "concord://attestation-received";

/// Emitted when an encrypted DM is received from a peer.
pub const DM_RECEIVED: &str = "concord://dm-received";
