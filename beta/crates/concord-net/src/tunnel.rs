//! Tunnel management module.
//!
//! Tracks active peer connections and their types (direct, relayed, mDNS, WireGuard).
//! Provides connection quality information to the mesh and application layers.
//!
//! WireGuard tunnels are detected by address range: if a peer connects from the
//! 100.64.0.0/10 CGNAT range (used by Tailscale/Headscale/orrtellite), the connection
//! is marked as WireGuard. These tunnels are already encrypted at the OS level,
//! providing defense-in-depth on top of libp2p's QUIC/Noise encryption.

use std::collections::HashMap;
use std::net::Ipv4Addr;

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
    /// Connected via WireGuard tunnel (orrtellite/Tailscale mesh VPN).
    /// Detected by 100.64.0.0/10 address range (CGNAT used by Tailscale).
    WireGuard,
}

impl std::fmt::Display for ConnectionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectionType::Direct => write!(f, "direct"),
            ConnectionType::Relayed => write!(f, "relayed"),
            ConnectionType::LocalMdns => write!(f, "local_mdns"),
            ConnectionType::WireGuard => write!(f, "wireguard"),
        }
    }
}

/// Check if an IP address is in the Tailscale/WireGuard CGNAT range (100.64.0.0/10).
/// This range is used by Tailscale, Headscale, and orrtellite for mesh VPN addressing.
pub fn is_wireguard_address(addr_str: &str) -> bool {
    // Extract IP from multiaddr-style strings like "/ip4/100.64.0.5/udp/4001/quic-v1"
    let ip_str = if let Some(rest) = addr_str.strip_prefix("/ip4/") {
        rest.split('/').next().unwrap_or("")
    } else {
        addr_str
    };

    if let Ok(ip) = ip_str.parse::<Ipv4Addr>() {
        let octets = ip.octets();
        // 100.64.0.0/10 = first octet 100, second octet 64-127 (bits: 01xxxxxx)
        octets[0] == 100 && (octets[1] & 0xC0) == 0x40
    } else {
        false
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
    /// Auto-detects connection type:
    /// - WireGuard: address in 100.64.0.0/10 (Tailscale/orrtellite mesh VPN)
    /// - Relayed: address contains `/p2p-circuit/` or explicit flag
    /// - Direct: everything else (standard QUIC)
    pub fn on_connection_established(
        &mut self,
        peer_id: &str,
        address: &str,
        is_relayed: bool,
    ) {
        let connection_type = if is_wireguard_address(address) {
            ConnectionType::WireGuard
        } else if is_relayed || address.contains("/p2p-circuit/") {
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

    /// Number of connections over WireGuard (orrtellite/Tailscale mesh VPN).
    pub fn wireguard_count(&self) -> usize {
        self.connections
            .values()
            .filter(|t| t.connection_type == ConnectionType::WireGuard)
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

    #[test]
    fn test_wireguard_detection() {
        let mut tracker = TunnelTracker::new();
        // 100.64.x.x is the Tailscale/orrtellite CGNAT range
        tracker.on_connection_established(
            "peer-wg",
            "/ip4/100.64.0.5/udp/4001/quic-v1",
            false,
        );
        assert_eq!(tracker.wireguard_count(), 1);
        let tunnel = tracker.get_tunnel("peer-wg").unwrap();
        assert_eq!(tunnel.connection_type, ConnectionType::WireGuard);
    }

    #[test]
    fn test_wireguard_address_range() {
        // Valid Tailscale CGNAT range: 100.64.0.0 - 100.127.255.255
        assert!(is_wireguard_address("/ip4/100.64.0.1/udp/4001/quic-v1"));
        assert!(is_wireguard_address("/ip4/100.100.50.25/udp/4001/quic-v1"));
        assert!(is_wireguard_address("/ip4/100.127.255.255/udp/4001/quic-v1"));
        assert!(is_wireguard_address("100.64.0.1")); // bare IP

        // Outside CGNAT range
        assert!(!is_wireguard_address("/ip4/192.168.1.10/udp/4001/quic-v1"));
        assert!(!is_wireguard_address("/ip4/10.0.0.1/udp/4001/quic-v1"));
        assert!(!is_wireguard_address("/ip4/100.63.255.255/udp/4001/quic-v1")); // below range
        assert!(!is_wireguard_address("/ip4/100.128.0.0/udp/4001/quic-v1")); // above range
        assert!(!is_wireguard_address("not-an-ip"));
    }

    #[test]
    fn test_wireguard_not_overridden_by_relay() {
        let mut tracker = TunnelTracker::new();
        // Even if relayed flag is set, WireGuard address wins
        // (WireGuard tunnels don't need relay detection)
        tracker.on_connection_established(
            "peer-wg-relay",
            "/ip4/100.64.0.10/udp/4001/quic-v1",
            true, // relay flag shouldn't matter for WG addresses
        );
        assert_eq!(
            tracker.get_tunnel("peer-wg-relay").unwrap().connection_type,
            ConnectionType::WireGuard,
        );
    }
}
