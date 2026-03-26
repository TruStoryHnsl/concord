//! Transport abstraction layer for infrastructure-free mesh networking.
//!
//! Concord's local mesh operates WITHOUT any existing network infrastructure.
//! Devices communicate directly via radio (Bluetooth LE, WiFi Direct, WiFi AP)
//! and only use IP networks for LAN convenience or QUIC tunnels to non-local nodes.
//!
//! # Transport Tiers
//!
//! | Tier | Technology | Bandwidth | Range | Capabilities |
//! |------|-----------|-----------|-------|-------------|
//! | BLE | Bluetooth Low Energy | ~200 kbps | ~30m | Discovery + text chat |
//! | WiFiDirect | WiFi P2P | ~250 Mbps | ~60m | Text, voice, video |
//! | WiFiAp | Device hotspot | varies | ~50m | Mesh extension, full capability |
//! | Lan | mDNS over IP | full | LAN | When devices share a network |
//! | Tunnel | QUIC over internet | full | global | Non-local (only internet-dependent path) |
//!
//! # Platform Implementations
//!
//! Each transport tier requires platform-native code:
//! - **iOS**: MultipeerConnectivity (handles BLE + WiFi seamlessly)
//! - **Android**: Nearby Connections API (BLE + WiFi Direct + WiFi Aware)
//! - **Linux**: BlueZ (D-Bus) for BLE, wpa_supplicant for WiFi Direct
//! - **macOS**: CoreBluetooth + MultipeerConnectivity
//! - **Windows**: Windows.Devices.Bluetooth + WiFi Direct APIs
//!
//! These are implemented as Tauri v2 plugins that bridge native APIs into the
//! Rust transport layer. libp2p sits above this — custom transports feed
//! connections from radio-level links up to GossipSub/Kademlia.

use std::fmt;

use serde::{Deserialize, Serialize};

/// The capability tier of a transport connection.
///
/// The app automatically selects the best available transport and degrades
/// gracefully. BLE-only = text mode. WiFi Direct = full voice/video.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum TransportTier {
    /// Bluetooth Low Energy — discovery and text chat only (~200 kbps).
    Ble,
    /// WiFi Direct — full bandwidth for text, voice, and video (~250 Mbps).
    WifiDirect,
    /// Device WiFi AP — device broadcasts its own hotspot to extend the mesh.
    WifiAp,
    /// LAN — standard IP network (mDNS discovery). Requires existing infrastructure.
    Lan,
    /// QUIC tunnel — non-local connections over the internet. The ONLY
    /// infrastructure-dependent transport.
    Tunnel,
}

impl TransportTier {
    /// Whether this transport requires existing network infrastructure.
    pub fn requires_infrastructure(&self) -> bool {
        matches!(self, TransportTier::Lan | TransportTier::Tunnel)
    }

    /// Whether this transport supports voice/video (sufficient bandwidth).
    pub fn supports_media(&self) -> bool {
        !matches!(self, TransportTier::Ble)
    }

    /// Approximate maximum bandwidth in kbps.
    pub fn max_bandwidth_kbps(&self) -> u32 {
        match self {
            TransportTier::Ble => 200,
            TransportTier::WifiDirect => 250_000,
            TransportTier::WifiAp => 100_000,
            TransportTier::Lan => 1_000_000,
            TransportTier::Tunnel => 100_000, // varies, conservative estimate
        }
    }
}

impl fmt::Display for TransportTier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TransportTier::Ble => write!(f, "Bluetooth"),
            TransportTier::WifiDirect => write!(f, "WiFi Direct"),
            TransportTier::WifiAp => write!(f, "WiFi AP"),
            TransportTier::Lan => write!(f, "LAN"),
            TransportTier::Tunnel => write!(f, "Tunnel"),
        }
    }
}

/// Events emitted by a transport implementation.
#[derive(Debug, Clone)]
pub enum TransportEvent {
    /// A new peer was discovered on this transport.
    PeerDiscovered {
        peer_id: String,
        tier: TransportTier,
        signal_strength: Option<i8>,
    },
    /// A peer is no longer reachable on this transport.
    PeerLost {
        peer_id: String,
        tier: TransportTier,
    },
    /// A connection was established with a peer.
    Connected {
        peer_id: String,
        tier: TransportTier,
    },
    /// Data received from a peer on this transport.
    DataReceived {
        peer_id: String,
        tier: TransportTier,
        data: Vec<u8>,
    },
    /// The transport's availability changed (e.g., Bluetooth was toggled off).
    AvailabilityChanged {
        tier: TransportTier,
        available: bool,
    },
}

/// Trait that all transport implementations must satisfy.
///
/// Each platform provides concrete implementations:
/// - `BleTransport` — Bluetooth LE discovery and messaging
/// - `WifiDirectTransport` — WiFi P2P for high-bandwidth local connections
/// - `WifiApTransport` — device broadcasts WiFi to extend the mesh
/// - `LanTransport` — mDNS over existing IP network (wraps libp2p mDNS)
/// - `TunnelTransport` — QUIC over internet (wraps libp2p QUIC)
///
/// Platform-native transports (BLE, WiFi Direct, WiFi AP) are implemented
/// as Tauri v2 plugins that bridge native APIs into this Rust trait.
pub trait Transport: Send + Sync {
    /// Start the transport, begin discovery and accept connections.
    fn start(&mut self) -> Result<(), TransportError>;

    /// Stop the transport.
    fn stop(&mut self) -> Result<(), TransportError>;

    /// Send data to a specific peer.
    fn send(&self, peer_id: &str, data: &[u8]) -> Result<(), TransportError>;

    /// Broadcast data to all reachable peers on this transport.
    fn broadcast(&self, data: &[u8]) -> Result<(), TransportError>;

    /// The transport tier this implementation provides.
    fn tier(&self) -> TransportTier;

    /// Whether this transport is currently available and active.
    fn is_available(&self) -> bool;

    /// List of currently connected peer IDs on this transport.
    fn connected_peers(&self) -> Vec<String>;
}

/// Errors from transport operations.
#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("transport not available on this platform")]
    NotAvailable,
    #[error("transport not started")]
    NotStarted,
    #[error("peer not found: {0}")]
    PeerNotFound(String),
    #[error("send failed: {0}")]
    SendFailed(String),
    #[error("bluetooth error: {0}")]
    Bluetooth(String),
    #[error("wifi direct error: {0}")]
    WifiDirect(String),
    #[error("platform error: {0}")]
    Platform(String),
}

/// Manages all available transports and selects the best one for each peer.
///
/// The TransportManager runs all transport tiers simultaneously and:
/// 1. Discovers peers across all available radio interfaces
/// 2. Automatically upgrades connections (BLE discovery → WiFi Direct data)
/// 3. Degrades gracefully when transports become unavailable
/// 4. Reports the best available tier for each peer to the upper layers
pub struct TransportManager {
    transports: Vec<Box<dyn Transport>>,
}

impl TransportManager {
    pub fn new() -> Self {
        Self {
            transports: Vec::new(),
        }
    }

    /// Register a transport implementation.
    pub fn register(&mut self, transport: Box<dyn Transport>) {
        self.transports.push(transport);
    }

    /// Start all registered transports.
    pub fn start_all(&mut self) -> Vec<TransportError> {
        let mut errors = Vec::new();
        for t in &mut self.transports {
            if let Err(e) = t.start() {
                errors.push(e);
            }
        }
        errors
    }

    /// Get the best available transport tier for a specific peer.
    pub fn best_tier_for_peer(&self, peer_id: &str) -> Option<TransportTier> {
        self.transports
            .iter()
            .filter(|t| t.is_available() && t.connected_peers().contains(&peer_id.to_string()))
            .map(|t| t.tier())
            .max() // Higher tiers = more bandwidth
    }

    /// Send data to a peer using the best available transport.
    pub fn send_best(&self, peer_id: &str, data: &[u8]) -> Result<(), TransportError> {
        // Find the highest-bandwidth transport that can reach this peer
        let transport = self
            .transports
            .iter()
            .filter(|t| t.is_available() && t.connected_peers().contains(&peer_id.to_string()))
            .max_by_key(|t| t.tier().max_bandwidth_kbps())
            .ok_or_else(|| TransportError::PeerNotFound(peer_id.to_string()))?;

        transport.send(peer_id, data)
    }
}

impl Default for TransportManager {
    fn default() -> Self {
        Self::new()
    }
}
