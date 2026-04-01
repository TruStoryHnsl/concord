//! MultipeerConnectivity transport for iOS/macOS.
//!
//! Bridges Apple's MultipeerConnectivity framework into the Concord
//! transport layer. MPC seamlessly combines BLE (discovery) and WiFi Direct
//! (data transfer), mapping to both the `Ble` and `WifiDirect` transport tiers.
//!
//! This module is only compiled on Apple platforms (iOS + macOS).
//! On iOS, MPC uses the device's BLE and WiFi radios directly — no infrastructure needed.
//!
//! # Architecture
//!
//! ```text
//! Rust (MpcTransport)  ──FFI──>  Swift (ConcordMPCManager)
//!       ↑                              │
//!       └──── C callbacks ◄────────────┘
//! ```
//!
//! Rust calls Swift via `extern "C"` functions (`mpc_init`, `mpc_start`, etc.).
//! Swift calls Rust via registered callback function pointers for async events
//! (peer discovered, data received, etc.).

use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::Mutex;

#[allow(unused_imports)]
use tracing::{debug, info};

use crate::transport::{Transport, TransportError, TransportEvent, TransportTier};

// =============================================================================
// FFI declarations — functions exported by Swift's ConcordMPCManager
// =============================================================================
unsafe extern "C" {
    fn mpc_init(display_name: *const c_char);
    fn mpc_start();
    fn mpc_stop();
    fn mpc_send(peer_name: *const c_char, data: *const u8, data_len: usize) -> bool;
    fn mpc_broadcast(data: *const u8, data_len: usize) -> bool;
    fn mpc_set_callbacks(
        on_discovered: extern "C" fn(*const c_char, *const c_char),
        on_lost: extern "C" fn(*const c_char),
        on_connected: extern "C" fn(*const c_char),
        on_disconnected: extern "C" fn(*const c_char),
        on_data: extern "C" fn(*const c_char, *const u8, usize),
    );
    fn mpc_connected_peers() -> *mut c_char;
    fn mpc_free_string(ptr: *mut c_char);
}

// =============================================================================
// Global event buffer (populated by Swift callbacks, drained by Rust)
// =============================================================================

/// Thread-safe event buffer. Swift callbacks push events here; the Rust layer
/// drains them on each tick of the transport manager.
static EVENT_BUFFER: std::sync::LazyLock<Mutex<Vec<TransportEvent>>> =
    std::sync::LazyLock::new(|| Mutex::new(Vec::new()));

fn push_event(event: TransportEvent) {
    if let Ok(mut buf) = EVENT_BUFFER.lock() {
        buf.push(event);
    }
}

// =============================================================================
// C callback implementations (called by Swift → Rust)
// =============================================================================

extern "C" fn on_peer_discovered(peer_id: *const c_char, _display_name: *const c_char) {
    let id = unsafe { CStr::from_ptr(peer_id) }
        .to_string_lossy()
        .into_owned();
    debug!(peer_id = %id, "MPC: peer discovered");
    push_event(TransportEvent::PeerDiscovered {
        peer_id: id,
        tier: TransportTier::WifiDirect,
        signal_strength: None,
    });
}

extern "C" fn on_peer_lost(peer_id: *const c_char) {
    let id = unsafe { CStr::from_ptr(peer_id) }
        .to_string_lossy()
        .into_owned();
    debug!(peer_id = %id, "MPC: peer lost");
    push_event(TransportEvent::PeerLost {
        peer_id: id,
        tier: TransportTier::WifiDirect,
    });
}

extern "C" fn on_peer_connected(peer_id: *const c_char) {
    let id = unsafe { CStr::from_ptr(peer_id) }
        .to_string_lossy()
        .into_owned();
    info!(peer_id = %id, "MPC: peer connected");
    push_event(TransportEvent::Connected {
        peer_id: id,
        tier: TransportTier::WifiDirect,
    });
}

extern "C" fn on_peer_disconnected(peer_id: *const c_char) {
    let id = unsafe { CStr::from_ptr(peer_id) }
        .to_string_lossy()
        .into_owned();
    info!(peer_id = %id, "MPC: peer disconnected");
    push_event(TransportEvent::PeerLost {
        peer_id: id,
        tier: TransportTier::WifiDirect,
    });
}

extern "C" fn on_data_received(peer_id: *const c_char, data: *const u8, data_len: usize) {
    let id = unsafe { CStr::from_ptr(peer_id) }
        .to_string_lossy()
        .into_owned();
    let bytes = unsafe { std::slice::from_raw_parts(data, data_len) }.to_vec();
    debug!(peer_id = %id, len = bytes.len(), "MPC: data received");
    push_event(TransportEvent::DataReceived {
        peer_id: id,
        tier: TransportTier::WifiDirect,
        data: bytes,
    });
}

// =============================================================================
// MpcTransport — implements the Transport trait
// =============================================================================

/// MultipeerConnectivity transport for Apple platforms.
///
/// Provides WiFi Direct-tier connectivity using Apple's MPC framework,
/// which automatically combines BLE discovery with WiFi Direct data transfer.
pub struct MpcTransport {
    local_peer_id: String,
    is_started: bool,
}

impl MpcTransport {
    /// Create a new MPC transport with the given local peer identifier.
    /// The peer_id is used as the MPC display name for discovery.
    pub fn new(local_peer_id: String) -> Self {
        Self {
            local_peer_id,
            is_started: false,
        }
    }

    /// Drain pending events from the global event buffer.
    /// Call this periodically from the transport manager's event loop.
    pub fn drain_events(&self) -> Vec<TransportEvent> {
        EVENT_BUFFER
            .lock()
            .map(|mut buf| buf.drain(..).collect())
            .unwrap_or_default()
    }
}

impl Transport for MpcTransport {
    fn start(&mut self) -> Result<(), TransportError> {
        if self.is_started {
            return Ok(());
        }

        let c_name = CString::new(self.local_peer_id.clone())
            .map_err(|e| TransportError::Platform(e.to_string()))?;

        unsafe {
            // Register Rust callbacks with Swift
            mpc_set_callbacks(
                on_peer_discovered,
                on_peer_lost,
                on_peer_connected,
                on_peer_disconnected,
                on_data_received,
            );

            // Initialize and start the MPC manager
            mpc_init(c_name.as_ptr());
            mpc_start();
        }

        self.is_started = true;
        info!(peer_id = %self.local_peer_id, "MPC transport started");
        Ok(())
    }

    fn stop(&mut self) -> Result<(), TransportError> {
        if !self.is_started {
            return Ok(());
        }

        unsafe {
            mpc_stop();
        }

        self.is_started = false;
        info!("MPC transport stopped");
        Ok(())
    }

    fn send(&self, peer_id: &str, data: &[u8]) -> Result<(), TransportError> {
        if !self.is_started {
            return Err(TransportError::NotStarted);
        }

        let c_peer = CString::new(peer_id)
            .map_err(|e| TransportError::SendFailed(e.to_string()))?;

        let success = unsafe { mpc_send(c_peer.as_ptr(), data.as_ptr(), data.len()) };

        if success {
            Ok(())
        } else {
            Err(TransportError::SendFailed(format!(
                "MPC send to {peer_id} failed"
            )))
        }
    }

    fn broadcast(&self, data: &[u8]) -> Result<(), TransportError> {
        if !self.is_started {
            return Err(TransportError::NotStarted);
        }

        let success = unsafe { mpc_broadcast(data.as_ptr(), data.len()) };

        if success {
            Ok(())
        } else {
            Err(TransportError::SendFailed("MPC broadcast failed".into()))
        }
    }

    fn tier(&self) -> TransportTier {
        TransportTier::WifiDirect
    }

    fn is_available(&self) -> bool {
        self.is_started
    }

    fn connected_peers(&self) -> Vec<String> {
        if !self.is_started {
            return Vec::new();
        }

        let raw = unsafe { mpc_connected_peers() };
        if raw.is_null() {
            return Vec::new();
        }

        let csv = unsafe { CStr::from_ptr(raw) }
            .to_string_lossy()
            .into_owned();
        unsafe { mpc_free_string(raw) };

        if csv.is_empty() {
            Vec::new()
        } else {
            csv.split(',').map(|s| s.to_string()).collect()
        }
    }
}
