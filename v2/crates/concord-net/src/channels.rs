use libp2p::gossipsub;

/// Convert a server/channel pair into a gossipsub topic.
///
/// Topic format: `concord/<server_id>/<channel_id>`
///
/// Each channel maps to exactly one gossipsub topic, so subscribing to a
/// channel is equivalent to joining the corresponding pub/sub topic.
pub fn channel_to_topic(server_id: &str, channel_id: &str) -> gossipsub::IdentTopic {
    let topic_str = format!("concord/{server_id}/{channel_id}");
    gossipsub::IdentTopic::new(topic_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn topic_format() {
        let topic = channel_to_topic("srv-abc123", "ch-general");
        assert!(!topic.hash().as_str().is_empty());
    }
}
