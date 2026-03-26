use libp2p::{dcutr, gossipsub, identify, kad, mdns, relay, swarm::NetworkBehaviour};

/// The composed network behaviour for a Concord node.
///
/// Combines the essential libp2p protocols for mesh networking:
/// - mDNS for LAN peer discovery
/// - GossipSub for pub/sub messaging across channels
/// - Identify for exchanging peer metadata on connect
/// - Kademlia DHT for global peer discovery
/// - Relay server for relaying connections on behalf of NAT'd peers
/// - Relay client for connecting through relays when behind NAT
/// - DCUtR for direct connection upgrade through relay (hole-punching)
#[derive(NetworkBehaviour)]
#[behaviour(to_swarm = "ConcordBehaviourEvent")]
pub struct ConcordBehaviour {
    pub mdns: mdns::tokio::Behaviour,
    pub gossipsub: gossipsub::Behaviour,
    pub identify: identify::Behaviour,
    pub kademlia: kad::Behaviour<kad::store::MemoryStore>,
    pub relay_server: relay::Behaviour,
    pub relay_client: relay::client::Behaviour,
    pub dcutr: dcutr::Behaviour,
}

/// Events emitted by the composed behaviour.
///
/// The `#[derive(NetworkBehaviour)]` macro generates this enum automatically,
/// but we define it explicitly for clarity and to allow pattern matching in
/// the node event loop.
#[derive(Debug)]
pub enum ConcordBehaviourEvent {
    Mdns(mdns::Event),
    Gossipsub(gossipsub::Event),
    Identify(identify::Event),
    Kademlia(kad::Event),
    RelayServer(relay::Event),
    RelayClient(relay::client::Event),
    Dcutr(dcutr::Event),
}

impl From<mdns::Event> for ConcordBehaviourEvent {
    fn from(event: mdns::Event) -> Self {
        ConcordBehaviourEvent::Mdns(event)
    }
}

impl From<gossipsub::Event> for ConcordBehaviourEvent {
    fn from(event: gossipsub::Event) -> Self {
        ConcordBehaviourEvent::Gossipsub(event)
    }
}

impl From<identify::Event> for ConcordBehaviourEvent {
    fn from(event: identify::Event) -> Self {
        ConcordBehaviourEvent::Identify(event)
    }
}

impl From<kad::Event> for ConcordBehaviourEvent {
    fn from(event: kad::Event) -> Self {
        ConcordBehaviourEvent::Kademlia(event)
    }
}

impl From<relay::Event> for ConcordBehaviourEvent {
    fn from(event: relay::Event) -> Self {
        ConcordBehaviourEvent::RelayServer(event)
    }
}

impl From<relay::client::Event> for ConcordBehaviourEvent {
    fn from(event: relay::client::Event) -> Self {
        ConcordBehaviourEvent::RelayClient(event)
    }
}

impl From<dcutr::Event> for ConcordBehaviourEvent {
    fn from(event: dcutr::Event) -> Self {
        ConcordBehaviourEvent::Dcutr(event)
    }
}
