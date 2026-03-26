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
/// Uses QUIC transport for encrypted, multiplexed connections.
/// Includes relay client transport for NAT traversal via relays.
/// Configures mDNS for LAN discovery, GossipSub for pub/sub, Identify for
/// peer metadata exchange, Kademlia for DHT discovery, Relay for NAT
/// traversal, and DCUtR for hole-punching.
pub fn build_swarm(config: &NodeConfig) -> Result<Swarm<ConcordBehaviour>> {
    let _ = config; // config is used for logging below

    let swarm = SwarmBuilder::with_new_identity()
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
        .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    info!(port = config.listen_port, "swarm built successfully");
    Ok(swarm)
}
