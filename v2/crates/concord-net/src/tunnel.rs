//! QUIC tunnel management module.
//!
//! Tracks active peer connections and their types (direct, relayed, mDNS).
//! Provides connection quality information to the mesh and application layers.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// The type of connection established with a peer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConnectionType {
    /// Direct QUIC connection (no intermediaries).
    Direct,
    /// Connection routed through a relay node (p2p-circuit).
    Relayed,
    /// Discovered and connected via mDNS on the local network.
    LocalMdns,
}

impl std::fmt::Display for ConnectionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectionType::Direct => write!(f, "direct"),
            ConnectionType::Relayed => write!(f, "relayed"),
            ConnectionType::LocalMdns => write!(f, "local_mdns"),
        }
    }
}

/// Information about an active tunnel/connection to a peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelInfo {
    pub peer_id: String,
    pub connection_type: ConnectionType,
    pub remote_address: String,
    pub established_at: i64,
    pub rtt_ms: Option<u32>,
}

/// Tracks active connections and their quality metrics.
pub struct TunnelTracker {
    connections: HashMap<String, TunnelInfo>,
}

impl TunnelTracker {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    /// Record a new connection being established.
    ///
    /// Detects whether the connection is relayed by checking if the address
    /// contains `/p2p-circuit/`.
    pub fn on_connection_established(
        &mut self,
        peer_id: &str,
        address: &str,
        is_relayed: bool,
    ) {
        let connection_type = if is_relayed || address.contains("/p2p-circuit/") {
            ConnectionType::Relayed
        } else {
            ConnectionType::Direct
        };

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let info = TunnelInfo {
            peer_id: peer_id.to_string(),
            connection_type,
            remote_address: address.to_string(),
            established_at: now,
            rtt_ms: None,
        };

        self.connections.insert(peer_id.to_string(), info);
    }

    /// Mark a peer's connection as mDNS-local.
    /// Called when we know a peer was discovered via mDNS.
    pub fn mark_as_local_mdns(&mut self, peer_id: &str) {
        if let Some(info) = self.connections.get_mut(peer_id) {
            info.connection_type = ConnectionType::LocalMdns;
        }
    }

    /// Record a connection being closed.
    pub fn on_connection_closed(&mut self, peer_id: &str) {
        self.connections.remove(peer_id);
    }

    /// Get tunnel info for a specific peer.
    pub fn get_tunnel(&self, peer_id: &str) -> Option<&TunnelInfo> {
        self.connections.get(peer_id)
    }

    /// Get all active tunnel connections.
    pub fn all_tunnels(&self) -> Vec<TunnelInfo> {
        self.connections.values().cloned().collect()
    }

    /// Number of active connections.
    pub fn active_count(&self) -> usize {
        self.connections.len()
    }

    /// Number of connections going through a relay.
    pub fn relayed_count(&self) -> usize {
        self.connections
            .values()
            .filter(|t| t.connection_type == ConnectionType::Relayed)
            .count()
    }
}

impl Default for TunnelTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_direct_connection() {
        let mut tracker = TunnelTracker::new();
        tracker.on_connection_established(
            "peer-abc",
            "/ip4/192.168.1.5/udp/9990/quic-v1",
            false,
        );
        assert_eq!(tracker.active_count(), 1);
        assert_eq!(tracker.relayed_count(), 0);
        let tunnel = tracker.get_tunnel("peer-abc").unwrap();
        assert_eq!(tunnel.connection_type, ConnectionType::Direct);
    }

    #[test]
    fn test_relayed_connection() {
        let mut tracker = TunnelTracker::new();
        tracker.on_connection_established(
            "peer-relay",
            "/ip4/1.2.3.4/udp/4001/quic-v1/p2p/QmRelay/p2p-circuit/p2p/QmTarget",
            false,
        );
        assert_eq!(tracker.active_count(), 1);
        assert_eq!(tracker.relayed_count(), 1);
        let tunnel = tracker.get_tunnel("peer-relay").unwrap();
        assert_eq!(tunnel.connection_type, ConnectionType::Relayed);
    }

    #[test]
    fn test_explicit_relayed_flag() {
        let mut tracker = TunnelTracker::new();
        tracker.on_connection_established("peer-x", "/ip4/10.0.0.1/udp/5000/quic-v1", true);
        assert_eq!(tracker.relayed_count(), 1);
    }

    #[test]
    fn test_mark_as_local_mdns() {
        let mut tracker = TunnelTracker::new();
        tracker.on_connection_established(
            "peer-local",
            "/ip4/192.168.1.10/udp/9990/quic-v1",
            false,
        );
        assert_eq!(
            tracker.get_tunnel("peer-local").unwrap().connection_type,
            ConnectionType::Direct,
        );
        tracker.mark_as_local_mdns("peer-local");
        assert_eq!(
            tracker.get_tunnel("peer-local").unwrap().connection_type,
            ConnectionType::LocalMdns,
        );
    }

    #[test]
    fn test_connection_closed() {
        let mut tracker = TunnelTracker::new();
        tracker.on_connection_established(
            "peer-gone",
            "/ip4/10.0.0.1/udp/5000/quic-v1",
            false,
        );
        assert_eq!(tracker.active_count(), 1);
        tracker.on_connection_closed("peer-gone");
        assert_eq!(tracker.active_count(), 0);
        assert!(tracker.get_tunnel("peer-gone").is_none());
    }

    #[test]
    fn test_all_tunnels() {
        let mut tracker = TunnelTracker::new();
        tracker.on_connection_established("peer-a", "/ip4/10.0.0.1/udp/5000/quic-v1", false);
        tracker.on_connection_established("peer-b", "/ip4/10.0.0.2/udp/5000/quic-v1", true);
        let tunnels = tracker.all_tunnels();
        assert_eq!(tunnels.len(), 2);
    }
}
