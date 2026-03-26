use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::types::NodeType;

/// Configuration for a Concord node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeConfig {
    pub display_name: String,
    pub node_type: NodeType,
    pub listen_port: u16,
    pub enable_mdns: bool,
    pub enable_dht: bool,
    pub data_dir: PathBuf,
    /// Multiaddrs of known bootstrap nodes for Kademlia DHT discovery.
    #[serde(default)]
    pub bootstrap_peers: Vec<String>,
    /// Whether this node should act as a relay server for other peers.
    #[serde(default)]
    pub enable_relay_server: bool,
    /// Whether this node should use relay clients for NAT traversal.
    #[serde(default = "default_true")]
    pub enable_relay_client: bool,
}

fn default_true() -> bool {
    true
}

impl Default for NodeConfig {
    fn default() -> Self {
        Self {
            display_name: "Concord Node".into(),
            node_type: NodeType::User,
            listen_port: 9990,
            enable_mdns: true,
            enable_dht: true,
            data_dir: dirs_default_data(),
            bootstrap_peers: Vec::new(),
            enable_relay_server: false,
            enable_relay_client: true,
        }
    }
}

fn dirs_default_data() -> PathBuf {
    if let Some(data) = std::env::var_os("XDG_DATA_HOME") {
        PathBuf::from(data).join("concord")
    } else if let Some(home) = std::env::var_os("HOME") {
        PathBuf::from(home).join(".local/share/concord")
    } else {
        PathBuf::from("./concord-data")
    }
}
