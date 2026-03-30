//! Cluster management: cooperative compute, fluid hypervisor, invisible voting.
//!
//! A cluster is a set of nodes that interlock compute to host a Place.
//! The cluster_ledger (PlacePayload) is the source of truth for membership.
//!
//! **Cooperative compute**: Cluster members share hosting load. The hypervisor
//! coordinates workload distribution. Additional nodes improve stability.
//!
//! **Fluid hypervisor**: Leadership auto-transfers to the optimal node based on
//! real-time performance metrics. Rooms persist at their mesh sub-address even
//! when the original host leaves.
//!
//! **Invisible clusters**: Clusters can vote to become invisible on the mesh map.
//! An invisible node counter remains visible in the forum scope.

use serde::{Deserialize, Serialize};

use crate::mesh_map::{MeshAddress, MeshTimestamp};
use crate::types::NodeType;

/// Check if a node type is allowed to join a cluster.
/// Phantom nodes are read-only scouts — they cannot cluster.
pub fn can_join_cluster(node_type: &NodeType) -> bool {
    !matches!(node_type, NodeType::Phantom)
}

// ─── Cluster State ─────────────────────────────────────────────────

/// The runtime state of a cluster, derived from its members' reports.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterState {
    /// The place this cluster hosts.
    pub place_address: MeshAddress,
    /// Current hypervisor (cluster leader) peer_id.
    pub hypervisor_id: String,
    /// All active cluster members with their performance metrics.
    pub members: Vec<ClusterMember>,
    /// Whether this cluster is invisible on the mesh map.
    pub is_invisible: bool,
    /// When the hypervisor was last elected/transferred (unix millis).
    pub hypervisor_since: MeshTimestamp,
}

/// A node participating in a cluster with its live performance metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterMember {
    pub peer_id: String,
    /// CPU usage [0.0, 1.0]. Lower = more available.
    pub cpu_load: f64,
    /// Available bandwidth in kbps.
    pub bandwidth_kbps: u64,
    /// Uptime in seconds since joining the cluster.
    pub uptime_secs: u64,
    /// Latency to the current hypervisor in ms.
    pub latency_to_hypervisor_ms: u32,
    /// Whether this node is battery-constrained.
    pub battery_constrained: bool,
    /// Compute share assigned by the hypervisor [0.0, 1.0].
    pub assigned_share: f64,
    /// When this member last reported metrics (unix millis).
    pub last_report: MeshTimestamp,
}

// ─── Hypervisor Selection ──────────────────────────────────────────

/// Score a cluster member for hypervisor eligibility.
/// Higher score = better candidate for hypervisor role.
///
/// Factors (weighted):
/// - Low CPU load (30%): more headroom = better leader
/// - High bandwidth (25%): can coordinate more traffic
/// - High uptime (25%): stability = fewer leadership transfers
/// - Low latency to peers (10%): responsive coordination
/// - Not battery-constrained (10%): won't suddenly go offline
pub fn hypervisor_score(member: &ClusterMember) -> f64 {
    let cpu_score = 1.0 - member.cpu_load.clamp(0.0, 1.0);
    let bandwidth_score = (member.bandwidth_kbps as f64 / 100_000.0).min(1.0);
    let uptime_score = (member.uptime_secs as f64 / 86400.0).min(1.0); // cap at 1 day
    let latency_score = 1.0 - (member.latency_to_hypervisor_ms as f64 / 1000.0).min(1.0);
    let battery_score = if member.battery_constrained { 0.0 } else { 1.0 };

    (cpu_score * 0.30)
        + (bandwidth_score * 0.25)
        + (uptime_score * 0.25)
        + (latency_score * 0.10)
        + (battery_score * 0.10)
}

/// Select the optimal hypervisor from a set of cluster members.
/// Returns the peer_id of the best candidate, or None if no members.
pub fn select_hypervisor(members: &[ClusterMember]) -> Option<String> {
    members
        .iter()
        .max_by(|a, b| {
            hypervisor_score(a)
                .partial_cmp(&hypervisor_score(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|m| m.peer_id.clone())
}

/// Check if a hypervisor transfer should happen.
/// Transfer triggers when a non-hypervisor node scores significantly higher
/// than the current hypervisor (hysteresis prevents flapping).
const TRANSFER_HYSTERESIS: f64 = 0.15;

pub fn should_transfer_hypervisor(
    current_hypervisor: &ClusterMember,
    best_candidate: &ClusterMember,
) -> bool {
    let current_score = hypervisor_score(current_hypervisor);
    let candidate_score = hypervisor_score(best_candidate);
    // Only transfer if the candidate is significantly better
    candidate_score > current_score + TRANSFER_HYSTERESIS
}

// ─── Cooperative Compute ───────────────────────────────────────────

/// Distribute compute shares across cluster members.
/// The hypervisor gets a larger share. Distribution uses inverse CPU load
/// weighting so idle nodes take on more work.
pub fn distribute_compute(members: &[ClusterMember]) -> Vec<(String, f64)> {
    if members.is_empty() {
        return vec![];
    }
    if members.len() == 1 {
        return vec![(members[0].peer_id.clone(), 1.0)];
    }

    // Weight by available capacity: (1 - cpu_load) * bandwidth_factor
    let weights: Vec<f64> = members
        .iter()
        .map(|m| {
            let capacity = (1.0 - m.cpu_load.clamp(0.0, 1.0)).max(0.01);
            let bw_factor = (m.bandwidth_kbps as f64 / 10_000.0).min(2.0).max(0.1);
            let battery_factor = if m.battery_constrained { 0.3 } else { 1.0 };
            capacity * bw_factor * battery_factor
        })
        .collect();

    let total_weight: f64 = weights.iter().sum();
    if total_weight <= 0.0 {
        // Equal distribution fallback
        let share = 1.0 / members.len() as f64;
        return members.iter().map(|m| (m.peer_id.clone(), share)).collect();
    }

    members
        .iter()
        .zip(weights.iter())
        .map(|(m, w)| (m.peer_id.clone(), w / total_weight))
        .collect()
}

// ─── Invisible Cluster Voting ──────────────────────────────────────

/// Result of an invisibility vote within a cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvisibilityVote {
    pub place_address: MeshAddress,
    pub voter_id: String,
    pub wants_invisible: bool,
    pub cast_at: MeshTimestamp,
}

/// Tally invisibility votes. Requires simple majority of cluster members.
pub fn tally_invisibility(votes: &[InvisibilityVote], total_members: u32) -> bool {
    if total_members == 0 {
        return false;
    }
    let yes_count = votes.iter().filter(|v| v.wants_invisible).count() as u32;
    // Simple majority of ALL members (not just voters)
    yes_count > total_members / 2
}

// ─── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_member(peer_id: &str, cpu: f64, bw: u64, uptime: u64, battery: bool) -> ClusterMember {
        ClusterMember {
            peer_id: peer_id.to_string(),
            cpu_load: cpu,
            bandwidth_kbps: bw,
            uptime_secs: uptime,
            latency_to_hypervisor_ms: 20,
            battery_constrained: battery,
            assigned_share: 0.0,
            last_report: 0,
        }
    }

    #[test]
    fn hypervisor_idle_server_wins() {
        let server = make_member("server", 0.1, 100_000, 86400, false);
        let phone = make_member("phone", 0.8, 10_000, 3600, true);
        assert!(
            hypervisor_score(&server) > hypervisor_score(&phone),
            "idle server should score higher than loaded phone"
        );
    }

    #[test]
    fn select_hypervisor_picks_best() {
        let members = vec![
            make_member("a", 0.9, 1000, 100, false),
            make_member("b", 0.1, 100_000, 86400, false),
            make_member("c", 0.5, 50_000, 3600, true),
        ];
        let best = select_hypervisor(&members).unwrap();
        assert_eq!(best, "b", "low-load high-bandwidth node should be selected");
    }

    #[test]
    fn select_hypervisor_empty() {
        assert!(select_hypervisor(&[]).is_none());
    }

    #[test]
    fn transfer_hysteresis_prevents_flapping() {
        let current = make_member("current", 0.3, 80_000, 86400, false);
        let slightly_better = make_member("challenger", 0.25, 85_000, 86400, false);
        // Slightly better shouldn't trigger transfer (within hysteresis)
        assert!(
            !should_transfer_hypervisor(&current, &slightly_better),
            "small improvement should not trigger transfer"
        );
    }

    #[test]
    fn transfer_triggers_when_significantly_better() {
        let current = make_member("current", 0.8, 10_000, 100, true);
        let much_better = make_member("challenger", 0.1, 100_000, 86400, false);
        assert!(
            should_transfer_hypervisor(&current, &much_better),
            "large improvement should trigger transfer"
        );
    }

    #[test]
    fn distribute_compute_single_node() {
        let members = vec![make_member("solo", 0.5, 50_000, 1000, false)];
        let shares = distribute_compute(&members);
        assert_eq!(shares.len(), 1);
        assert!((shares[0].1 - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn distribute_compute_idle_gets_more() {
        let members = vec![
            make_member("busy", 0.9, 50_000, 1000, false),
            make_member("idle", 0.1, 50_000, 1000, false),
        ];
        let shares = distribute_compute(&members);
        let busy_share = shares.iter().find(|(id, _)| id == "busy").unwrap().1;
        let idle_share = shares.iter().find(|(id, _)| id == "idle").unwrap().1;
        assert!(
            idle_share > busy_share,
            "idle node ({idle_share}) should get more compute than busy ({busy_share})"
        );
    }

    #[test]
    fn distribute_compute_battery_gets_less() {
        let members = vec![
            make_member("plugged", 0.3, 50_000, 1000, false),
            make_member("battery", 0.3, 50_000, 1000, true),
        ];
        let shares = distribute_compute(&members);
        let plugged = shares.iter().find(|(id, _)| id == "plugged").unwrap().1;
        let battery = shares.iter().find(|(id, _)| id == "battery").unwrap().1;
        assert!(
            plugged > battery,
            "plugged node ({plugged}) should get more than battery ({battery})"
        );
    }

    #[test]
    fn distribute_compute_shares_sum_to_one() {
        let members = vec![
            make_member("a", 0.2, 80_000, 5000, false),
            make_member("b", 0.5, 40_000, 2000, false),
            make_member("c", 0.8, 20_000, 500, true),
        ];
        let shares = distribute_compute(&members);
        let total: f64 = shares.iter().map(|(_, s)| s).sum();
        assert!(
            (total - 1.0).abs() < 1e-10,
            "shares must sum to 1.0, got {total}"
        );
    }

    #[test]
    fn invisibility_vote_majority_yes() {
        let votes = vec![
            InvisibilityVote { place_address: [0; 32], voter_id: "a".into(), wants_invisible: true, cast_at: 0 },
            InvisibilityVote { place_address: [0; 32], voter_id: "b".into(), wants_invisible: true, cast_at: 0 },
            InvisibilityVote { place_address: [0; 32], voter_id: "c".into(), wants_invisible: false, cast_at: 0 },
        ];
        assert!(tally_invisibility(&votes, 3));
    }

    #[test]
    fn invisibility_vote_not_majority() {
        let votes = vec![
            InvisibilityVote { place_address: [0; 32], voter_id: "a".into(), wants_invisible: true, cast_at: 0 },
            InvisibilityVote { place_address: [0; 32], voter_id: "b".into(), wants_invisible: false, cast_at: 0 },
            InvisibilityVote { place_address: [0; 32], voter_id: "c".into(), wants_invisible: false, cast_at: 0 },
        ];
        assert!(!tally_invisibility(&votes, 3));
    }

    #[test]
    fn invisibility_requires_majority_of_all_members() {
        // 1 yes out of 4 total members = not majority even though only 1 voted
        let votes = vec![
            InvisibilityVote { place_address: [0; 32], voter_id: "a".into(), wants_invisible: true, cast_at: 0 },
        ];
        assert!(!tally_invisibility(&votes, 4));
    }

    #[test]
    fn phantom_cannot_cluster() {
        assert!(!can_join_cluster(&NodeType::Phantom));
    }

    #[test]
    fn user_can_cluster() {
        assert!(can_join_cluster(&NodeType::User));
    }

    #[test]
    fn backbone_can_cluster() {
        assert!(can_join_cluster(&NodeType::Backbone));
    }

    #[test]
    fn guest_can_cluster() {
        assert!(can_join_cluster(&NodeType::Guest));
    }
}
