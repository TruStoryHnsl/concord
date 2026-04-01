//! Two-peer integration test.
//!
//! Spawns two Concord nodes in the same process and verifies they:
//! 1. Discover each other via mDNS
//! 2. Exchange a text message via GossipSub
//!
//! Usage:
//!   cargo run -p concord-net --example two_peers

use std::time::Duration;
use tokio::time::timeout;
use tracing::{info, warn};

use concord_core::config::NodeConfig;
use concord_core::types::NodeType;
use concord_net::events::NetworkEvent;
use concord_net::node::Node;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Set up logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "two_peers=info,concord_net=info".into()),
        )
        .init();

    info!("=== Concord two-peer test ===");

    // Create two nodes with random ports
    let config_a = NodeConfig {
        display_name: "Node A".into(),
        node_type: NodeType::User,
        listen_port: 0,
        enable_mdns: true,
        enable_dht: false,
        data_dir: std::env::temp_dir().join("concord-test-a"),
        bootstrap_peers: Vec::new(),
        enable_relay_server: false,
        enable_relay_client: true,
        identity_keypair: None,
    };

    let config_b = NodeConfig {
        display_name: "Node B".into(),
        node_type: NodeType::User,
        listen_port: 0,
        enable_mdns: true,
        enable_dht: false,
        data_dir: std::env::temp_dir().join("concord-test-b"),
        bootstrap_peers: Vec::new(),
        enable_relay_server: false,
        enable_relay_client: true,
        identity_keypair: None,
    };

    let (node_a, handle_a, _sender_a, mut events_a) = Node::new(&config_a).await?;
    let (node_b, handle_b, _sender_b, mut events_b) = Node::new(&config_b).await?;

    info!(
        peer_a = %handle_a.peer_id(),
        peer_b = %handle_b.peer_id(),
        "nodes created"
    );

    // Spawn both node event loops
    let task_a = tokio::spawn(async move { node_a.run().await });
    let task_b = tokio::spawn(async move { node_b.run().await });

    // Give the nodes a moment to start listening
    tokio::time::sleep(Duration::from_millis(500)).await;

    // ---- Step 1: Wait for mDNS discovery ----
    info!("waiting for mDNS peer discovery...");

    let discovery_timeout = Duration::from_secs(15);
    let mut a_discovered_b = false;
    let mut b_discovered_a = false;

    let discovery_result = timeout(discovery_timeout, async {
        loop {
            tokio::select! {
                Ok(event) = events_a.recv() => {
                    if let NetworkEvent::PeerDiscovered { peer_id, .. } = &event {
                        info!(node = "A", discovered = %peer_id, "peer discovered");
                        if peer_id == handle_b.peer_id() {
                            a_discovered_b = true;
                        }
                    }
                }
                Ok(event) = events_b.recv() => {
                    if let NetworkEvent::PeerDiscovered { peer_id, .. } = &event {
                        info!(node = "B", discovered = %peer_id, "peer discovered");
                        if peer_id == handle_a.peer_id() {
                            b_discovered_a = true;
                        }
                    }
                }
            }

            if a_discovered_b && b_discovered_a {
                return true;
            }
        }
    })
    .await;

    match discovery_result {
        Ok(true) => info!("PASS: both nodes discovered each other via mDNS"),
        _ => {
            warn!("FAIL: mDNS discovery timed out after {discovery_timeout:?}");
            warn!("  A discovered B: {a_discovered_b}");
            warn!("  B discovered A: {b_discovered_a}");
            handle_a.shutdown().await?;
            handle_b.shutdown().await?;
            anyhow::bail!("mDNS discovery failed");
        }
    }

    // ---- Step 2: Subscribe to a shared topic ----
    let topic = "concord/test-server/general";
    info!(%topic, "subscribing both nodes to topic");

    handle_a.subscribe(topic).await?;
    handle_b.subscribe(topic).await?;

    // Wait for GossipSub mesh to form. The heartbeat is 1s, and the peers need
    // to be connected and have exchanged subscription info before the mesh forms.
    // 3 seconds gives plenty of margin for: connection establishment + 2 heartbeats.
    info!("waiting for GossipSub mesh to form...");
    tokio::time::sleep(Duration::from_secs(3)).await;

    // ---- Step 3: Send a message from A, receive on B ----
    let test_message = b"Hello from Node A!".to_vec();
    info!("publishing message from Node A...");
    handle_a.publish(topic, test_message.clone()).await?;

    let message_timeout = Duration::from_secs(10);
    let received = timeout(message_timeout, async {
        loop {
            if let Ok(event) = events_b.recv().await {
                if let NetworkEvent::MessageReceived {
                    topic: t,
                    source,
                    data,
                } = event
                {
                    info!(
                        %t,
                        %source,
                        message = %String::from_utf8_lossy(&data),
                        "Node B received message"
                    );
                    if data == test_message {
                        return true;
                    }
                }
            }
        }
    })
    .await;

    match received {
        Ok(true) => info!("PASS: Node B received the message from Node A"),
        _ => {
            warn!("FAIL: message exchange timed out after {message_timeout:?}");
            handle_a.shutdown().await?;
            handle_b.shutdown().await?;
            anyhow::bail!("GossipSub message exchange failed");
        }
    }

    // ---- Step 4: Send a message from B, receive on A ----
    let test_message_2 = b"Hello back from Node B!".to_vec();
    info!("publishing message from Node B...");
    handle_b.publish(topic, test_message_2.clone()).await?;

    let received_2 = timeout(message_timeout, async {
        loop {
            if let Ok(event) = events_a.recv().await {
                if let NetworkEvent::MessageReceived {
                    topic: t,
                    source,
                    data,
                } = event
                {
                    info!(
                        %t,
                        %source,
                        message = %String::from_utf8_lossy(&data),
                        "Node A received message"
                    );
                    if data == test_message_2 {
                        return true;
                    }
                }
            }
        }
    })
    .await;

    match received_2 {
        Ok(true) => info!("PASS: Node A received the message from Node B"),
        _ => {
            warn!("FAIL: reverse message exchange timed out");
            handle_a.shutdown().await?;
            handle_b.shutdown().await?;
            anyhow::bail!("GossipSub reverse message exchange failed");
        }
    }

    // ---- Step 5: Verify peer lists ----
    let peers_a = handle_a.peers().await?;
    let peers_b = handle_b.peers().await?;
    info!(
        peers_a = peers_a.len(),
        peers_b = peers_b.len(),
        "peer lists"
    );

    // ---- Cleanup ----
    info!("shutting down nodes...");
    handle_a.shutdown().await?;
    handle_b.shutdown().await?;

    // Wait for tasks to finish
    let _ = timeout(Duration::from_secs(5), async {
        let _ = task_a.await;
        let _ = task_b.await;
    })
    .await;

    info!("=== All tests passed! ===");
    Ok(())
}
