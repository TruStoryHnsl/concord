use std::collections::HashMap;

use libp2p::{Multiaddr, PeerId};
use serde::{Deserialize, Serialize};
use tracing::info;

/// Information about a discovered peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub peer_id: String,
    pub addresses: Vec<String>,
    pub display_name: Option<String>,
}

/// Tracks discovered peers from mDNS (and eventually Kademlia).
pub struct DiscoveryState {
    /// Peers found via mDNS on the local network.
    pub local_peers: HashMap<PeerId, Vec<Multiaddr>>,
    /// Peers found via Kademlia DHT (Phase 2).
    pub global_peers: HashMap<PeerId, Vec<Multiaddr>>,
}

impl DiscoveryState {
    pub fn new() -> Self {
        Self {
            local_peers: HashMap::new(),
            global_peers: HashMap::new(),
        }
    }

    /// Handle a set of peers discovered via mDNS.
    /// Returns the list of newly discovered peers (not previously known).
    pub fn on_mdns_discovered(&mut self, peers: Vec<(PeerId, Multiaddr)>) -> Vec<(PeerId, Vec<Multiaddr>)> {
        let mut new_peers = Vec::new();

        for (peer_id, addr) in peers {
            info!(%peer_id, %addr, "mDNS peer discovered");
            let is_new = !self.local_peers.contains_key(&peer_id);
            let addrs = self.local_peers.entry(peer_id).or_default();
            if !addrs.contains(&addr) {
                addrs.push(addr);
            }
            if is_new {
                new_peers.push((peer_id, addrs.clone()));
            }
        }

        new_peers
    }

    /// Handle peers that expired from mDNS.
    /// Returns the list of peers that are completely gone (no addresses left).
    pub fn on_mdns_expired(&mut self, peers: Vec<(PeerId, Multiaddr)>) -> Vec<PeerId> {
        let mut departed = Vec::new();

        for (peer_id, addr) in peers {
            info!(%peer_id, %addr, "mDNS peer expired");
            if let Some(addrs) = self.local_peers.get_mut(&peer_id) {
                addrs.retain(|a| a != &addr);
                if addrs.is_empty() {
                    self.local_peers.remove(&peer_id);
                    departed.push(peer_id);
                }
            }
        }

        departed
    }

    /// Return all known peers as PeerInfo structs.
    pub fn all_peer_info(&self) -> Vec<PeerInfo> {
        let mut result = Vec::new();

        // Collect all unique peer IDs
        let mut seen = std::collections::HashSet::new();

        for (peer_id, addrs) in &self.local_peers {
            if seen.insert(*peer_id) {
                result.push(PeerInfo {
                    peer_id: peer_id.to_string(),
                    addresses: addrs.iter().map(|a| a.to_string()).collect(),
                    display_name: None,
                });
            }
        }

        for (peer_id, addrs) in &self.global_peers {
            if seen.insert(*peer_id) {
                result.push(PeerInfo {
                    peer_id: peer_id.to_string(),
                    addresses: addrs.iter().map(|a| a.to_string()).collect(),
                    display_name: None,
                });
            }
        }

        result
    }

    /// Return all known peer IDs.
    pub fn all_peers(&self) -> Vec<PeerId> {
        let mut peers: Vec<PeerId> = self
            .local_peers
            .keys()
            .chain(self.global_peers.keys())
            .copied()
            .collect();
        peers.sort();
        peers.dedup();
        peers
    }

    /// Number of known peers.
    pub fn peer_count(&self) -> usize {
        self.all_peers().len()
    }
}

impl Default for DiscoveryState {
    fn default() -> Self {
        Self::new()
    }
}
