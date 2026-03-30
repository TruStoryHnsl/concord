use anyhow::Result;
use libp2p::{
    dcutr, gossipsub, identify, kad, mdns, noise, relay, swarm::Swarm, yamux, PeerId,
    SwarmBuilder,
};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::Duration;
use tracing::info;

use concord_core::config::NodeConfig;

use crate::behaviour::ConcordBehaviour;

/// Build and configure a libp2p Swarm with the Concord behaviour stack.
///
/// Returns `(Swarm, concord_peer_id)` where `concord_peer_id` is the hex-encoded
/// Ed25519 public key. When `config.identity_keypair` is provided, the swarm uses
/// that key (unifying network and application identity). Otherwise, generates a
/// random identity (backward compat / testing).
pub fn build_swarm(config: &NodeConfig) -> Result<(Swarm<ConcordBehaviour>, String)> {
    // Build the libp2p identity keypair from our Concord identity (if provided)
    let (libp2p_keypair, concord_peer_id) = match config.identity_keypair {
        Some(secret_bytes) => {
            // Convert Concord Ed25519 secret key → libp2p identity keypair
            let mut bytes = secret_bytes;
            let ed25519_secret = libp2p::identity::ed25519::SecretKey::try_from_bytes(&mut bytes)
                .map_err(|e| anyhow::anyhow!("invalid Ed25519 secret key: {e}"))?;
            let ed25519_kp = libp2p::identity::ed25519::Keypair::from(ed25519_secret);

            // Derive the Concord peer_id (hex-encoded public key bytes)
            let pub_bytes = ed25519_kp.public().to_bytes();
            let concord_id: String = pub_bytes.iter().map(|b| format!("{b:02x}")).collect();

            let libp2p_kp = libp2p::identity::Keypair::from(ed25519_kp);
            info!(concord_peer_id = %concord_id, "using persistent identity for swarm");
            (libp2p_kp, concord_id)
        }
        None => {
            // No persistent identity — generate random (testing / backward compat)
            let libp2p_kp = libp2p::identity::Keypair::generate_ed25519();
            // Derive a concord-style peer_id from the random key
            let concord_id = match libp2p_kp.clone().try_into_ed25519() {
                Ok(ed25519_kp) => {
                    let pub_bytes = ed25519_kp.public().to_bytes();
                    pub_bytes.iter().map(|b| format!("{b:02x}")).collect()
                }
                Err(_) => {
                    // Fallback: use libp2p PeerId string if somehow not Ed25519
                    PeerId::from(libp2p_kp.public()).to_string()
                }
            };
            info!(concord_peer_id = %concord_id, "using ephemeral identity for swarm");
            (libp2p_kp, concord_id)
        }
    };

    let swarm = SwarmBuilder::with_existing_identity(libp2p_keypair)
        .with_tokio()
        .with_quic()
        .with_relay_client(noise::Config::new, yamux::Config::default)?
        .with_behaviour(|key, relay_client| {
            let peer_id = PeerId::from(key.public());
            info!(%peer_id, "initializing concord swarm behaviour");

            // mDNS for local peer discovery
            let mdns = mdns::tokio::Behaviour::new(mdns::Config::default(), peer_id)?;

            // GossipSub for pub/sub messaging
            // Use content-addressing so duplicate messages are detected by hash
            let message_id_fn = |message: &gossipsub::Message| {
                let mut hasher = DefaultHasher::new();
                message.data.hash(&mut hasher);
                if let Some(ref source) = message.source {
                    source.to_bytes().hash(&mut hasher);
                }
                gossipsub::MessageId::from(hasher.finish().to_string())
            };

            let gossipsub_config = gossipsub::ConfigBuilder::default()
                .heartbeat_interval(Duration::from_secs(1))
                .validation_mode(gossipsub::ValidationMode::Strict)
                .message_id_fn(message_id_fn)
                .history_length(5)
                .history_gossip(3)
                .build()
                .map_err(|e| anyhow::anyhow!("gossipsub config error: {e}"))?;

            let gossipsub = gossipsub::Behaviour::new(
                gossipsub::MessageAuthenticity::Signed(key.clone()),
                gossipsub_config,
            )
            .map_err(|e| anyhow::anyhow!("gossipsub behaviour error: {e}"))?;

            // Identify for peer metadata exchange
            let identify = identify::Behaviour::new(identify::Config::new(
                "/concord/0.1.0".into(),
                key.public(),
            ));

            // Kademlia DHT for global peer discovery
            let mut kademlia =
                kad::Behaviour::new(peer_id, kad::store::MemoryStore::new(peer_id));
            kademlia.set_mode(Some(kad::Mode::Server));

            // Relay server — allow this node to relay connections for other peers
            let relay_server = relay::Behaviour::new(peer_id, relay::Config::default());

            // DCUtR — direct connection upgrade through relay (hole-punching)
            let dcutr = dcutr::Behaviour::new(peer_id);

            Ok(ConcordBehaviour {
                mdns,
                gossipsub,
                identify,
                kademlia,
                relay_server,
                relay_client,
                dcutr,
            })
        })?
        .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(600)))
        .build();

    info!(port = config.listen_port, "swarm built successfully");
    Ok((swarm, concord_peer_id))
}
