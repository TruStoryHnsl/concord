pub mod transport;
pub mod behaviour;
pub mod swarm;
pub mod discovery;
pub mod mesh;
pub mod channels;
pub mod tunnel;
pub mod wireguard;
pub mod sync;
pub mod events;
pub mod node;

#[cfg(any(target_os = "ios", target_os = "macos"))]
pub mod mpc_transport;

pub use transport::{Transport, TransportEvent, TransportTier};
pub use behaviour::ConcordBehaviour;
pub use swarm::build_swarm;
pub use discovery::{DiscoveryState, PeerInfo};
pub use channels::channel_to_topic;
pub use events::NetworkEvent;
pub use node::{Node, NodeHandle, NodeCommand};
pub use tunnel::{ConnectionType, TunnelInfo, TunnelTracker};
pub use sync::SyncManager;
pub use mesh::{MeshMapManager, MeshMapAction, MeshMapMessage, CallSignalResult, TOPIC_MAP_SYNC, TOPIC_CALLS};
