//! WireGuard / Tailscale / Orrtellite mesh detection.
//!
//! Detects if the local machine is enrolled in a WireGuard mesh VPN (via Tailscale
//! or Headscale/orrtellite). When detected, provides mesh peer addresses that can be
//! used as libp2p dial targets for encrypted tunnel connections.
//!
//! This is the "Phase 1" tunnel integration: Concord rides the existing WireGuard
//! mesh rather than managing WG tunnels directly. The OS-level WireGuard encryption
//! provides defense-in-depth on top of libp2p's QUIC/Noise encryption.

use std::net::Ipv4Addr;

use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

/// Information about the local node's WireGuard mesh status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireGuardStatus {
    /// Whether a WireGuard mesh (Tailscale/Headscale) is active on this machine.
    pub is_active: bool,
    /// Our mesh IP address (e.g., 100.64.0.5). None if not enrolled.
    pub mesh_ip: Option<Ipv4Addr>,
    /// Hostname on the mesh (e.g., "orrion.orrtellite"). None if not enrolled.
    pub mesh_hostname: Option<String>,
    /// Known mesh peer IPs that we can reach via WireGuard.
    pub mesh_peers: Vec<WireGuardPeer>,
}

/// A peer reachable via the WireGuard mesh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireGuardPeer {
    /// Mesh hostname (e.g., "orrgate.orrtellite").
    pub hostname: String,
    /// Mesh IP address (100.64.x.x).
    pub ip: Ipv4Addr,
    /// Whether this peer is currently online/reachable.
    pub online: bool,
}

/// Detect WireGuard mesh status by querying the Tailscale daemon.
///
/// This runs `tailscale status --json` and parses the output. Returns a
/// `WireGuardStatus` with mesh info if Tailscale is running, or a default
/// inactive status if not.
pub fn detect_wireguard_mesh() -> WireGuardStatus {
    let inactive = WireGuardStatus {
        is_active: false,
        mesh_ip: None,
        mesh_hostname: None,
        mesh_peers: Vec::new(),
    };

    // Try to run `tailscale status --json`
    let output = match std::process::Command::new("tailscale")
        .args(["status", "--json"])
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            debug!("tailscale not found or not running: {e}");
            return inactive;
        }
    };

    if !output.status.success() {
        debug!(
            code = ?output.status.code(),
            "tailscale status returned non-zero"
        );
        return inactive;
    }

    let json_str = match std::str::from_utf8(&output.stdout) {
        Ok(s) => s,
        Err(_) => return inactive,
    };

    // Parse the JSON output. We only need a few fields.
    let status: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(e) => {
            warn!("failed to parse tailscale status JSON: {e}");
            return inactive;
        }
    };

    // Get our own mesh IP from the "Self" section
    let self_section = match status.get("Self") {
        Some(s) => s,
        None => return inactive,
    };

    let mesh_ip = self_section
        .get("TailscaleIPs")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<Ipv4Addr>().ok());

    let mesh_hostname = self_section
        .get("DNSName")
        .and_then(|v| v.as_str())
        .map(|s| s.trim_end_matches('.').to_string());

    // Get peers from the "Peer" section
    let mut mesh_peers = Vec::new();
    if let Some(peers) = status.get("Peer").and_then(|v| v.as_object()) {
        for (_key, peer) in peers {
            let hostname = peer
                .get("DNSName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim_end_matches('.')
                .to_string();

            let ip = peer
                .get("TailscaleIPs")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<Ipv4Addr>().ok());

            let online = peer
                .get("Online")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if let Some(ip) = ip {
                mesh_peers.push(WireGuardPeer {
                    hostname,
                    ip,
                    online,
                });
            }
        }
    }

    let is_active = mesh_ip.is_some();
    if is_active {
        info!(
            mesh_ip = ?mesh_ip,
            hostname = ?mesh_hostname,
            peers = mesh_peers.len(),
            online = mesh_peers.iter().filter(|p| p.online).count(),
            "WireGuard mesh detected (orrtellite/Tailscale)"
        );
    }

    WireGuardStatus {
        is_active,
        mesh_ip,
        mesh_hostname,
        mesh_peers,
    }
}

/// Convert a WireGuard mesh peer to a libp2p multiaddr dial target.
/// Uses the mesh IP with the Concord default QUIC port.
pub fn peer_to_multiaddr(peer: &WireGuardPeer, port: u16) -> String {
    format!("/ip4/{}/udp/{}/quic-v1", peer.ip, port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_peer_to_multiaddr() {
        let peer = WireGuardPeer {
            hostname: "orrgate.orrtellite".to_string(),
            ip: Ipv4Addr::new(100, 64, 0, 1),
            online: true,
        };
        assert_eq!(
            peer_to_multiaddr(&peer, 4001),
            "/ip4/100.64.0.1/udp/4001/quic-v1"
        );
    }

    #[test]
    fn test_inactive_when_no_tailscale() {
        // This test will pass on CI/machines without tailscale installed
        // as detect_wireguard_mesh gracefully returns inactive
        let status = detect_wireguard_mesh();
        // We can't assert is_active because it depends on the machine,
        // but the function should not panic
        assert!(status.mesh_peers.len() <= 1000); // sanity bound
    }
}
