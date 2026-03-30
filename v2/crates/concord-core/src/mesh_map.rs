//! Mesh Map — the decentralized database for the Concord network.
//!
//! Every datum in the network is a [`MeshMapEntry`] — the atomic unit of the
//! distributed database. Entries are addressed deterministically via HMAC-SHA256,
//! signed by their owner, and replicated via an eventually-consistent merge protocol.
//!
//! The mesh map stores: node existence, reputation, routing paths, place/server
//! locations, call ledger state, and locale partitions.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::identity::Keypair;
use crate::types::{NodeCapabilities, NodeType};

// ─── Core Types ────────────────────────────────────────────────────────

/// Milliseconds since Unix epoch.
pub type MeshTimestamp = u64;

/// A 32-byte deterministic address in the mesh map address space.
pub type MeshAddress = [u8; 32];

type HmacSha256 = Hmac<Sha256>;

/// Domain separator for address derivation. Versioned to allow future upgrades.
const ADDRESS_DOMAIN: &[u8] = b"concord-mesh-address-v1";

// ─── Confidence Tiers ──────────────────────────────────────────────────

/// How much we trust a mesh map entry's accuracy.
/// Higher tiers always win in merge conflicts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ConfidenceTier {
    /// Only heard about through gossip. Never directly verified.
    Speculative = 0,
    /// Verified by a peer in a local cluster (P2P/mDNS).
    ClusterVerified = 1,
    /// Verified through a tunnel by a server-class node.
    TunnelVerified = 2,
    /// Independently verified by this node directly (probe response received).
    SelfVerified = 3,
}

impl ConfidenceTier {
    /// Weight for merge conflict resolution and routing cost.
    pub fn weight(self) -> f64 {
        match self {
            Self::Speculative => 0.25,
            Self::ClusterVerified => 0.5,
            Self::TunnelVerified => 0.75,
            Self::SelfVerified => 1.0,
        }
    }

    /// Degrade one level. Speculative stays Speculative.
    pub fn degrade(self) -> Self {
        match self {
            Self::SelfVerified => Self::TunnelVerified,
            Self::TunnelVerified => Self::ClusterVerified,
            Self::ClusterVerified => Self::Speculative,
            Self::Speculative => Self::Speculative,
        }
    }
}

// ─── Entry Kind ────────────────────────────────────────────────────────

/// The kind of entity a mesh map entry represents.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EntryKind {
    Node,
    Place,
    CallLedger,
    Locale,
}

// ─── Mesh Map Entry ────────────────────────────────────────────────────

/// A single entry in the mesh map — the atomic unit of the distributed database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshMapEntry {
    /// Deterministic 32-byte address derived from entry identity.
    pub address: MeshAddress,
    /// What kind of entity this entry represents.
    pub kind: EntryKind,
    /// Peer ID of the node that owns this entry.
    pub owner_id: String,
    /// When this entry was first created (unix millis).
    pub created_at: MeshTimestamp,
    /// When this entry was last updated by any source (unix millis).
    pub updated_at: MeshTimestamp,
    /// When this node last verified this entry (unix millis). None = never verified by us.
    pub last_verified_at: Option<MeshTimestamp>,
    /// Confidence tier from our perspective.
    pub confidence: ConfidenceTier,
    /// Heartbeat ticks remaining before confidence degrades. 0 = eligible for degradation.
    pub ttl_ticks: u8,
    /// Hierarchical locale path, e.g. ["r-a7f3", "c-2b", "s-e1"].
    pub locale_path: Vec<String>,
    /// Entry payload (varies by kind).
    pub payload: EntryPayload,
    /// Ed25519 signature over the signing material. Signed by the owner.
    pub signature: Vec<u8>,
}

/// Default TTL ticks before confidence degrades.
pub const DEFAULT_TTL_TICKS: u8 = 5;

/// Stale count threshold before a Speculative entry is tombstoned.
pub const TOMBSTONE_STALE_THRESHOLD: u8 = 10;

// ─── Entry Payloads ────────────────────────────────────────────────────

/// Payload varies by entry kind.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EntryPayload {
    Node(NodePayload),
    Place(PlacePayload),
    CallLedger(CallLedgerPayload),
    Locale(LocalePayload),
}

/// Payload for a Node entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodePayload {
    /// Known multiaddrs for reaching this node.
    pub addresses: Vec<String>,
    /// Display name.
    pub display_name: Option<String>,
    /// Node type (reuses existing NodeType).
    pub node_type: NodeType,
    /// Hardware capabilities (reuses existing NodeCapabilities).
    pub capabilities: Option<NodeCapabilities>,
    /// Engagement profile score (-10 to 10).
    pub engagement_score: Option<i8>,
    /// Real-user-confidence score [0.0, 1.0].
    pub ruc_score: Option<f64>,
    /// Known routes to reach this node.
    pub routes: Vec<MeshRoute>,
    /// Overall trust rating [0.0, 1.0].
    pub trust_rating: Option<f64>,
    /// Whether this is a server-class node.
    pub is_server_class: bool,
    /// Optional physical location (lat, lon) — rounded to ~5 mile accuracy for privacy.
    /// None = node chose not to broadcast location.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<GeoLocation>,
    /// Web portal URL for non-Concord users (e.g., "a1b2c3d4.concorrd.com").
    /// Generated from the node's mesh address. None = portal not enabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub portal_url: Option<String>,
}

/// Optional physical location, rounded for privacy.
/// Accuracy is ~5 miles (lat/lon rounded to 1 decimal place).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoLocation {
    /// Latitude rounded to 1 decimal place (~5 mile accuracy).
    pub lat: f64,
    /// Longitude rounded to 1 decimal place (~5 mile accuracy).
    pub lon: f64,
}

impl GeoLocation {
    /// Create a new location, automatically rounding for privacy.
    pub fn new(lat: f64, lon: f64) -> Self {
        Self {
            lat: (lat * 10.0).round() / 10.0,
            lon: (lon * 10.0).round() / 10.0,
        }
    }
}

/// Payload for a Place (server / cluster_ledger) entry.
/// A Place is the Concord equivalent of a server — it has a dedicated mesh address,
/// supports clustering (multiple nodes hosting it), and has governance rules.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlacePayload {
    /// Unique place ID (UUID, set at mint time).
    pub place_id: String,
    /// Human-readable name.
    pub name: String,
    /// Who minted this place (peer_id of the original owner).
    pub owner_id: String,
    /// Governance model determines how admin decisions are made.
    pub governance: GovernanceModel,
    /// Ownership encryption mode. Encrypted = permanent owner, Unencrypted = committee-changeable.
    pub encryption_mode: OwnershipMode,
    /// Public, Private, or Federated visibility.
    pub visibility: String,
    /// Current member count.
    pub member_count: u32,
    /// Peer IDs of nodes currently clustered on (hosting) this place.
    pub hosting_nodes: Vec<String>,
    /// Channel IDs within this place.
    pub channel_ids: Vec<String>,
    /// When this place was minted (unix millis).
    pub minted_at: MeshTimestamp,
    /// Default whitelist: peer_ids allowed to join without invite.
    pub whitelist: Vec<String>,
    /// Monotonic version counter. Starts at 1 on mint. Increments on each re-mint.
    /// Used with owner signature to enforce charter immutability.
    #[serde(default = "default_charter_version")]
    pub version: u64,
    /// Compressed history from previous charter versions (on re-mint).
    /// None for the original mint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prior_history: Option<Vec<u8>>,
}

fn default_charter_version() -> u64 {
    1
}

/// How governance decisions are made at a Place.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum GovernanceModel {
    /// Owner has absolute control. Admin hierarchy is authoritarian.
    Private,
    /// Responsibility-based hierarchy. Communal voting can override admin.
    Public,
}

/// Ownership encryption mode for a Place.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum OwnershipMode {
    /// Ownership is permanent, only transferable via re-mint.
    Encrypted,
    /// Ownership is flexible, committee-changeable.
    Unencrypted,
}

/// Role within a Place.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum PlaceRole {
    Guest = 0,
    Member = 1,
    Moderator = 2,
    Admin = 3,
    Owner = 4,
}

/// A membership record for a node in a place's cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceMembership {
    /// The place's mesh address.
    pub place_address: MeshAddress,
    /// The member's peer_id.
    pub peer_id: String,
    /// Role in this place.
    pub role: PlaceRole,
    /// When they joined (unix millis).
    pub joined_at: MeshTimestamp,
    /// Whether this node is actively hosting (contributing compute to the cluster).
    pub is_hosting: bool,
}

/// Payload for a temporary call ledger.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallLedgerPayload {
    pub call_id: String,
    pub participants: Vec<String>,
    pub call_type: CallType,
    pub started_at: MeshTimestamp,
    /// Auto-expire if never concluded (default 4 hours).
    pub expires_at: MeshTimestamp,
    /// Peer ID of the node hosting this call.
    pub hosting_node: String,
    pub status: CallStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CallType {
    Voice,
    Video,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CallStatus {
    Active,
    Concluded,
    Expired,
}

/// Payload for a Locale partition node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalePayload {
    /// Human-readable label.
    pub label: String,
    /// Number of entries within this locale.
    pub entry_count: u32,
    /// Depth in the hierarchy (0 = root).
    pub depth: u8,
    /// Parent locale address, if not root.
    pub parent: Option<MeshAddress>,
}

// ─── Routing ───────────────────────────────────────────────────────────

/// A route to reach a target node, stored as a sequence of hops.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshRoute {
    /// Ordered sequence of hops from source to destination.
    pub hops: Vec<RouteHop>,
    /// Total estimated cost (lower is better). Computed via path-of-least-action.
    pub cost: f64,
    /// When this route was last confirmed reachable (unix millis).
    pub last_confirmed: MeshTimestamp,
    /// Peer ID of the node that discovered this route.
    pub discovered_by: String,
}

/// A single hop in a route.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteHop {
    /// Peer ID of the intermediate node.
    pub peer_id: String,
    /// Transport tier ordinal (0=BLE, 1=WiFiDirect, 2=WiFiAp, 3=LAN, 4=Tunnel).
    pub transport_tier: u8,
    /// Estimated one-way latency in milliseconds.
    pub estimated_latency_ms: u32,
}

// ─── Sync Protocol Types ───────────────────────────────────────────────

/// Compact summary of a node's map state. Exchanged during sync handshake.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapDigest {
    /// Our peer ID.
    pub peer_id: String,
    /// Per-locale summary for quick staleness detection.
    pub locale_summaries: Vec<LocaleSummary>,
    /// Total entry count across all locales.
    pub total_entries: u32,
    /// Highest updated_at across all entries.
    pub latest_update: MeshTimestamp,
}

/// Summary of entries within a single locale.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocaleSummary {
    /// Hash of the locale path (for comparison without sending full path).
    pub locale_hash: MeshAddress,
    /// Number of entries in this locale.
    pub entry_count: u32,
    /// Most recent updated_at within this locale.
    pub max_updated_at: MeshTimestamp,
}

/// A set of entries the remote peer needs. Capped per message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapDelta {
    /// Who sent this delta.
    pub from_peer: String,
    /// Entries to upsert on the receiving side.
    pub entries: Vec<MeshMapEntry>,
    /// Addresses of entries we've tombstoned (expired, concluded, etc.).
    pub tombstones: Vec<(MeshAddress, MeshTimestamp)>,
}

/// Maximum entries per delta message.
pub const MAX_DELTA_ENTRIES: usize = 200;

/// Wire messages for call ledger events on GossipSub.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CallLedgerSignal {
    Created { entry: MeshMapEntry },
    Updated { entry: MeshMapEntry },
    Tombstoned { address: MeshAddress, at: MeshTimestamp },
}

// ─── Address Derivation ────────────────────────────────────────────────

fn hmac_address(input: &str) -> MeshAddress {
    let mut mac = HmacSha256::new_from_slice(ADDRESS_DOMAIN)
        .expect("HMAC key length is always valid");
    mac.update(input.as_bytes());
    let result = mac.finalize().into_bytes();
    let mut addr = [0u8; 32];
    addr.copy_from_slice(&result);
    addr
}

/// Derive a deterministic address for a Node entry from its peer ID.
pub fn address_for_node(peer_id: &str) -> MeshAddress {
    hmac_address(&format!("node:{peer_id}"))
}

/// Derive a deterministic address for a Place entry from its server ID.
pub fn address_for_place(server_id: &str) -> MeshAddress {
    hmac_address(&format!("place:{server_id}"))
}

/// Derive a deterministic address for a CallLedger from its call UUID.
pub fn address_for_call(call_id: &str) -> MeshAddress {
    hmac_address(&format!("call:{call_id}"))
}

/// Derive a deterministic address for a Locale partition from its path.
pub fn address_for_locale(locale_path: &[String]) -> MeshAddress {
    let path = locale_path.join("/");
    hmac_address(&format!("locale:{path}"))
}

/// Format a MeshAddress as hex for display/logging.
pub fn address_hex(addr: &MeshAddress) -> String {
    addr.iter().map(|b| format!("{b:02x}")).collect()
}

// ─── Signing & Verification ────────────────────────────────────────────

impl MeshMapEntry {
    /// Compute the signing material for this entry.
    /// Signs over: address || kind || owner_id || updated_at || payload_hash
    fn signing_material(&self) -> Vec<u8> {
        let payload_bytes = rmp_serde::to_vec(&self.payload).unwrap_or_default();
        let payload_hash = {
            use sha2::Digest;
            let mut hasher = Sha256::new();
            hasher.update(&payload_bytes);
            hasher.finalize()
        };

        let mut material = Vec::new();
        material.extend_from_slice(&self.address);
        material.extend_from_slice(&rmp_serde::to_vec(&self.kind).unwrap_or_default());
        material.extend_from_slice(self.owner_id.as_bytes());
        material.extend_from_slice(&self.updated_at.to_le_bytes());
        material.extend_from_slice(&payload_hash);
        material
    }

    /// Sign this entry with the given keypair. Sets the signature field.
    pub fn sign(&mut self, keypair: &Keypair) {
        let material = self.signing_material();
        self.signature = keypair.sign(&material);
    }

    /// Verify this entry's signature against the owner's public key.
    /// Returns true if the signature is valid.
    pub fn verify_signature(&self) -> bool {
        if self.signature.len() != 64 {
            return false;
        }
        let owner_bytes = match crate::identity::peer_id_to_public_key_bytes(&self.owner_id) {
            Ok(b) => b,
            Err(_) => return false,
        };
        let mut sig_arr = [0u8; 64];
        sig_arr.copy_from_slice(&self.signature);
        let material = self.signing_material();
        Keypair::verify(&owner_bytes, &material, &sig_arr).is_ok()
    }
}

// ─── Merge Logic ───────────────────────────────────────────────────────

/// Merge two versions of the same entry. Returns the winning version.
///
/// Rules:
/// 1. Higher ConfidenceTier always wins.
/// 2. Same tier: more recent `updated_at` wins.
/// 3. Tie on both: keep `ours` (local preference prevents oscillation).
pub fn merge_entry(ours: &MeshMapEntry, theirs: &MeshMapEntry) -> MeshMapEntry {
    debug_assert_eq!(ours.address, theirs.address);

    // ── Charter immutability enforcement for Place entries ──
    // Places (charters) have special merge rules:
    // 1. Only the current owner can update a charter
    // 2. Version must be monotonically increasing (no rollbacks)
    if ours.kind == EntryKind::Place {
        if let (EntryPayload::Place(our_place), EntryPayload::Place(their_place)) =
            (&ours.payload, &theirs.payload)
        {
            // Reject if not signed by the current owner
            if theirs.owner_id != our_place.owner_id {
                return ours.clone();
            }
            // Reject if version doesn't advance (prevents replay attacks)
            if their_place.version <= our_place.version {
                return ours.clone();
            }
            // Valid re-mint: higher version from the owner — accept it
            return theirs.clone();
        }
    }

    // ── Standard LWW merge for all other entry types ──
    if theirs.confidence > ours.confidence {
        return theirs.clone();
    }
    if ours.confidence > theirs.confidence {
        return ours.clone();
    }
    // Same confidence tier — most recent wins.
    if theirs.updated_at > ours.updated_at {
        return theirs.clone();
    }
    // Tie or ours is newer — keep ours.
    ours.clone()
}

// ─── Path-of-Least-Action Routing ─────────────────────────────────────

/// Compute the cost of a single hop. Lower is better.
///
/// The cost function combines latency, transport quality, and confidence
/// into a single scalar. This is the "action" that Dijkstra's minimizes.
pub fn hop_cost(hop: &RouteHop, confidence: ConfidenceTier) -> f64 {
    // Base: latency normalized to seconds
    let latency_cost = hop.estimated_latency_ms as f64 / 1000.0;

    // Transport tier penalty (lower = better infrastructure)
    let transport_penalty = match hop.transport_tier {
        0 => 5.0,  // BLE: slow, limited bandwidth
        1 => 1.0,  // WiFiDirect: good
        2 => 0.8,  // WiFiAp: good
        3 => 0.5,  // LAN: excellent
        4 => 1.5,  // Tunnel: good but adds internet dependency
        _ => 10.0, // unknown transport
    };

    // Confidence multiplier: verified routes are cheaper to use
    let confidence_mult = match confidence {
        ConfidenceTier::SelfVerified => 0.5,
        ConfidenceTier::TunnelVerified => 0.7,
        ConfidenceTier::ClusterVerified => 0.9,
        ConfidenceTier::Speculative => 1.5,
    };

    // Fixed per-hop penalty discourages long paths
    let hop_penalty = 0.1;

    (latency_cost + transport_penalty + hop_penalty) * confidence_mult
}

/// Compute the total cost of a route.
pub fn route_cost(route: &MeshRoute, default_confidence: ConfidenceTier) -> f64 {
    route
        .hops
        .iter()
        .map(|hop| hop_cost(hop, default_confidence))
        .sum()
}

// ─── Locale Assignment ─────────────────────────────────────────────────

/// Compute a locale path from observed network topology.
///
/// Three-level hierarchy:
/// - Region: RTT-based grouping (latency bucket + bootstrap peer set)
/// - Cluster: topology-based (mDNS-visible peer set)
/// - Subnet: XOR-distance within cluster (from peer_id)
///
/// Each level is an equivalence class — nodes that observe the same network
/// conditions independently compute the same locale path.
pub fn compute_locale(
    local_peers: &[String],
    tunnel_rtts: &[(String, u32)],
    our_peer_id: &str,
) -> Vec<String> {
    let region = compute_region(tunnel_rtts);
    let cluster = compute_cluster(local_peers, our_peer_id);
    let subnet = compute_subnet(our_peer_id, &cluster);
    vec![region, cluster, subnet]
}

fn compute_region(tunnel_rtts: &[(String, u32)]) -> String {
    if tunnel_rtts.is_empty() {
        return "r-local".to_string();
    }
    let mut rtts: Vec<u32> = tunnel_rtts.iter().map(|(_, r)| *r).collect();
    rtts.sort();
    let median = rtts[rtts.len() / 2];
    let bucket = match median {
        0..=50 => "near",
        51..=150 => "mid",
        151..=500 => "far",
        _ => "remote",
    };
    // Hash the bucket + sorted reachable peers for a stable region ID
    let mut peers: Vec<&str> = tunnel_rtts.iter().map(|(p, _)| p.as_str()).collect();
    peers.sort();
    let input = format!("{bucket}:{}", peers.join(","));
    let hash = hmac_address(&format!("region:{input}"));
    format!("r-{}", hex_short(&hash))
}

fn compute_cluster(local_peers: &[String], our_peer_id: &str) -> String {
    if local_peers.is_empty() {
        let hash = hmac_address(&format!("cluster-singleton:{our_peer_id}"));
        return format!("c-{}", hex_short(&hash));
    }
    let mut sorted: Vec<&str> = local_peers.iter().map(|s| s.as_str()).collect();
    sorted.push(our_peer_id);
    sorted.sort();
    sorted.dedup();
    let input = sorted.join(",");
    let hash = hmac_address(&format!("cluster:{input}"));
    format!("c-{}", hex_short(&hash))
}

fn compute_subnet(our_peer_id: &str, cluster: &str) -> String {
    let hash = hmac_address(&format!("subnet:{our_peer_id}:{cluster}"));
    // 2 bytes = 4 hex chars = 65536 possible subnets
    format!("s-{:02x}{:02x}", hash[0], hash[1])
}

/// First 4 bytes of an address as hex (8 chars) for short display.
fn hex_short(addr: &MeshAddress) -> String {
    format!("{:02x}{:02x}{:02x}{:02x}", addr[0], addr[1], addr[2], addr[3])
}

// ─── Engagement Profile ────────────────────────────────────────────────

/// Raw activity counters tracked locally per node. Never published to the mesh.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EngagementCounters {
    pub messages_sent: u64,
    pub messages_read: u64,
    pub forum_posts_created: u64,
    pub forum_posts_read: u64,
    pub call_minutes_initiated: u64,
    pub call_minutes_participated: u64,
}

impl EngagementCounters {
    /// Compute the raw posting-to-reading ratio in [0.0, 1.0].
    /// 0.0 = pure reader, 0.5 = balanced, 1.0 = pure poster.
    pub fn posting_ratio(&self) -> f64 {
        let produced = self.messages_sent as f64
            + self.forum_posts_created as f64 * 2.0 // forum posts weighted more
            + self.call_minutes_initiated as f64 * 0.5;
        let consumed = self.messages_read as f64
            + self.forum_posts_read as f64
            + self.call_minutes_participated as f64 * 0.5;
        let total = produced + consumed;
        if total < 1.0 {
            return 0.5; // no data → assume balanced
        }
        produced / total
    }
}

/// Map a posting ratio [0.0, 1.0] to engagement score [-10, +10].
///
/// Uses tanh compression so moderate imbalances produce mild scores.
/// Only extreme ratios (10:1) hit the endpoints.
pub fn ratio_to_engagement_score(ratio: f64) -> i8 {
    let raw = (ratio - 0.5) * 20.0;
    let compressed = raw.tanh() * 10.0;
    compressed.round().clamp(-10.0, 10.0) as i8
}

/// Compute engagement score from raw counters.
pub fn compute_engagement_score(counters: &EngagementCounters) -> i8 {
    ratio_to_engagement_score(counters.posting_ratio())
}

/// Compute the approximate locale median engagement from local map data.
/// Only considers entries with confidence >= ClusterVerified.
pub fn compute_locale_median_engagement(entries: &[MeshMapEntry]) -> f64 {
    let mut scores: Vec<i8> = entries
        .iter()
        .filter(|e| e.kind == EntryKind::Node)
        .filter(|e| e.confidence >= ConfidenceTier::ClusterVerified)
        .filter_map(|e| match &e.payload {
            EntryPayload::Node(np) => np.engagement_score,
            _ => None,
        })
        .collect();

    if scores.is_empty() {
        return 0.0;
    }
    scores.sort();
    let mid = scores.len() / 2;
    if scores.len() % 2 == 0 {
        (scores[mid - 1] as f64 + scores[mid] as f64) / 2.0
    } else {
        scores[mid] as f64
    }
}

// ─── Web Portal URL ────────────────────────────────────────────────────

/// The domain used for web portal hosting. PLACEHOLDER — reassess before distribution.
pub const PORTAL_DOMAIN: &str = "concorrd.com";

/// Generate a web portal URL for a node based on its mesh address.
/// Returns a subdomain like "a1b2c3d4.concorrd.com".
pub fn portal_url_for_node(peer_id: &str) -> String {
    let addr = address_for_node(peer_id);
    let subdomain = hex_short(&addr);
    format!("{subdomain}.{PORTAL_DOMAIN}")
}

// ─── Node Prominence ───────────────────────────────────────────────────

/// Compute a node's prominence score from its mesh map data.
/// Higher prominence = more visible in forums, higher in node lists.
///
/// Factors:
/// - trust_rating (0.0-1.0): weighted 40%
/// - is_server_class: +0.2 bonus (servers are infrastructure)
/// - engagement_score magnitude: weighted 10% (active participants rank higher)
/// - route_count: weighted 10% (well-connected nodes rank higher)
/// - confidence tier: weighted 20% (verified nodes rank higher)
pub fn compute_prominence(entry: &MeshMapEntry) -> f64 {
    let (trust, engagement, routes, is_server) = match &entry.payload {
        EntryPayload::Node(np) => (
            np.trust_rating.unwrap_or(0.0),
            np.engagement_score.unwrap_or(0).unsigned_abs() as f64 / 10.0,
            np.routes.len().min(10) as f64 / 10.0,
            np.is_server_class,
        ),
        _ => return 0.0,
    };

    let confidence_factor = entry.confidence.weight();
    let server_bonus = if is_server { 0.2 } else { 0.0 };

    (trust * 0.4)
        + (confidence_factor * 0.2)
        + (engagement * 0.1)
        + (routes * 0.1)
        + server_bonus
}

// ─── Self-Registration ─────────────────────────────────────────────────

/// Build a mesh map entry for the local node (self-registration).
/// This entry announces the node's existence on the mesh.
pub fn build_self_registration(
    keypair: &Keypair,
    display_name: &str,
    node_type: NodeType,
    listen_addresses: &[String],
    locale_path: Vec<String>,
) -> MeshMapEntry {
    let peer_id = keypair.peer_id();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as MeshTimestamp;

    let mut entry = MeshMapEntry {
        address: address_for_node(&peer_id),
        kind: EntryKind::Node,
        owner_id: peer_id,
        created_at: now,
        updated_at: now,
        last_verified_at: Some(now),
        confidence: ConfidenceTier::SelfVerified,
        ttl_ticks: DEFAULT_TTL_TICKS,
        locale_path,
        payload: EntryPayload::Node(NodePayload {
            addresses: listen_addresses.to_vec(),
            display_name: Some(display_name.to_string()),
            is_server_class: node_type == NodeType::Backbone,
            node_type,
            capabilities: None,
            engagement_score: None,
            ruc_score: None,
            routes: vec![],
            trust_rating: None,
            location: None,
            portal_url: Some(portal_url_for_node(&keypair.peer_id())),
        }),
        signature: vec![],
    };
    entry.sign(keypair);
    entry
}

// ─── Place Minting ─────────────────────────────────────────────────────

/// Mint a new Place, returning a signed mesh map entry.
/// The minter becomes the owner.
pub fn mint_place(
    keypair: &Keypair,
    name: &str,
    governance: GovernanceModel,
    encryption_mode: OwnershipMode,
    visibility: &str,
) -> MeshMapEntry {
    let owner_id = keypair.peer_id();
    let place_id = format!("place-{}", &owner_id[..16]);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as MeshTimestamp;

    let mut entry = MeshMapEntry {
        address: address_for_place(&place_id),
        kind: EntryKind::Place,
        owner_id: owner_id.clone(),
        created_at: now,
        updated_at: now,
        last_verified_at: Some(now),
        confidence: ConfidenceTier::SelfVerified,
        ttl_ticks: DEFAULT_TTL_TICKS,
        locale_path: vec![],
        payload: EntryPayload::Place(PlacePayload {
            place_id,
            name: name.to_string(),
            owner_id,
            governance,
            encryption_mode,
            visibility: visibility.to_string(),
            member_count: 1, // owner is first member
            hosting_nodes: vec![keypair.peer_id()],
            channel_ids: vec![],
            minted_at: now,
            whitelist: vec![],
            version: 1,
            prior_history: None,
        }),
        signature: vec![],
    };
    entry.sign(keypair);
    entry
}

/// Re-mint an existing charter (Place) to transfer ownership or update settings.
/// Compresses the current charter payload into `prior_history`, increments version,
/// and signs with the current owner's keypair. Returns None if the entry is not a Place.
pub fn remint_place(
    keypair: &Keypair,
    existing: &MeshMapEntry,
    new_owner_id: Option<&str>,
    new_name: Option<&str>,
) -> Option<MeshMapEntry> {
    let current_place = match &existing.payload {
        EntryPayload::Place(pp) => pp,
        _ => return None,
    };

    // Only the current owner can re-mint
    if keypair.peer_id() != current_place.owner_id {
        return None;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as MeshTimestamp;

    // Compress current payload into prior_history (zero-loss)
    let compressed_history = rmp_serde::to_vec(&current_place).ok()?;

    let owner_id = new_owner_id
        .map(|s| s.to_string())
        .unwrap_or_else(|| current_place.owner_id.clone());

    let mut new_payload = current_place.clone();
    new_payload.version += 1;
    new_payload.prior_history = Some(compressed_history);
    new_payload.owner_id = owner_id.clone();
    if let Some(name) = new_name {
        new_payload.name = name.to_string();
    }

    let mut entry = MeshMapEntry {
        address: existing.address,
        kind: EntryKind::Place,
        owner_id,
        created_at: existing.created_at,
        updated_at: now,
        last_verified_at: Some(now),
        confidence: ConfidenceTier::SelfVerified,
        ttl_ticks: DEFAULT_TTL_TICKS,
        locale_path: existing.locale_path.clone(),
        payload: EntryPayload::Place(new_payload),
        signature: vec![],
    };
    entry.sign(keypair);
    Some(entry)
}

// ─── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_determinism() {
        let a1 = address_for_node("abc123");
        let a2 = address_for_node("abc123");
        assert_eq!(a1, a2, "same input must produce same address");
    }

    #[test]
    fn address_domain_separation() {
        let node_addr = address_for_node("abc123");
        let place_addr = address_for_place("abc123");
        assert_ne!(
            node_addr, place_addr,
            "different kinds with same ID must produce different addresses"
        );
    }

    #[test]
    fn confidence_ordering() {
        assert!(ConfidenceTier::SelfVerified > ConfidenceTier::TunnelVerified);
        assert!(ConfidenceTier::TunnelVerified > ConfidenceTier::ClusterVerified);
        assert!(ConfidenceTier::ClusterVerified > ConfidenceTier::Speculative);
    }

    #[test]
    fn confidence_degrade() {
        assert_eq!(
            ConfidenceTier::SelfVerified.degrade(),
            ConfidenceTier::TunnelVerified
        );
        assert_eq!(
            ConfidenceTier::Speculative.degrade(),
            ConfidenceTier::Speculative
        );
    }

    #[test]
    fn merge_higher_confidence_wins() {
        let base = make_test_entry(ConfidenceTier::Speculative, 100);
        let better = make_test_entry(ConfidenceTier::TunnelVerified, 50); // older but higher confidence
        let winner = merge_entry(&base, &better);
        assert_eq!(winner.confidence, ConfidenceTier::TunnelVerified);
    }

    #[test]
    fn merge_same_confidence_newer_wins() {
        let older = make_test_entry(ConfidenceTier::ClusterVerified, 100);
        let newer = make_test_entry(ConfidenceTier::ClusterVerified, 200);
        let winner = merge_entry(&older, &newer);
        assert_eq!(winner.updated_at, 200);
    }

    #[test]
    fn merge_tie_keeps_ours() {
        let ours = make_test_entry(ConfidenceTier::ClusterVerified, 100);
        let theirs = make_test_entry(ConfidenceTier::ClusterVerified, 100);
        let winner = merge_entry(&ours, &theirs);
        // Should keep ours (local preference)
        assert_eq!(winner.updated_at, ours.updated_at);
    }

    #[test]
    fn hop_cost_verified_cheaper() {
        let hop = RouteHop {
            peer_id: "test".to_string(),
            transport_tier: 3, // LAN
            estimated_latency_ms: 5,
        };
        let cost_verified = hop_cost(&hop, ConfidenceTier::SelfVerified);
        let cost_speculative = hop_cost(&hop, ConfidenceTier::Speculative);
        assert!(
            cost_verified < cost_speculative,
            "verified routes must be cheaper"
        );
    }

    #[test]
    fn engagement_score_balanced() {
        let counters = EngagementCounters {
            messages_sent: 100,
            messages_read: 100,
            ..Default::default()
        };
        let score = compute_engagement_score(&counters);
        assert_eq!(score, 0, "equal send/read should score 0");
    }

    #[test]
    fn engagement_score_extreme_producer() {
        let counters = EngagementCounters {
            messages_sent: 1000,
            messages_read: 1,
            ..Default::default()
        };
        let score = compute_engagement_score(&counters);
        assert!(score > 8, "extreme producer should score near +10, got {score}");
    }

    #[test]
    fn engagement_score_extreme_consumer() {
        let counters = EngagementCounters {
            messages_sent: 1,
            messages_read: 1000,
            ..Default::default()
        };
        let score = compute_engagement_score(&counters);
        assert!(
            score < -8,
            "extreme consumer should score near -10, got {score}"
        );
    }

    #[test]
    fn engagement_score_no_data() {
        let counters = EngagementCounters::default();
        let score = compute_engagement_score(&counters);
        assert_eq!(score, 0, "no data should default to balanced");
    }

    #[test]
    fn locale_singleton_cluster() {
        let locale = compute_locale(&[], &[], "my_peer_id");
        assert_eq!(locale.len(), 3);
        assert!(locale[0].starts_with("r-"));
        assert!(locale[1].starts_with("c-"));
        assert!(locale[2].starts_with("s-"));
    }

    #[test]
    fn locale_same_inputs_same_output() {
        let peers = vec!["peer_a".to_string(), "peer_b".to_string()];
        let rtts = vec![("bootstrap1".to_string(), 30)];
        let l1 = compute_locale(&peers, &rtts, "my_peer");
        let l2 = compute_locale(&peers, &rtts, "my_peer");
        assert_eq!(l1, l2, "same inputs must produce same locale");
    }

    #[test]
    fn sign_and_verify_entry() {
        let kp = Keypair::generate();
        let mut entry = make_test_entry(ConfidenceTier::SelfVerified, 100);
        entry.owner_id = kp.peer_id();
        entry.sign(&kp);
        assert!(entry.verify_signature(), "signature must verify for owner");
    }

    #[test]
    fn verify_rejects_tampered_entry() {
        let kp = Keypair::generate();
        let mut entry = make_test_entry(ConfidenceTier::SelfVerified, 100);
        entry.owner_id = kp.peer_id();
        entry.sign(&kp);
        // Tamper with the entry after signing
        entry.updated_at = 999;
        assert!(
            !entry.verify_signature(),
            "tampered entry must fail verification"
        );
    }

    // Test helper
    fn make_test_entry(confidence: ConfidenceTier, updated_at: MeshTimestamp) -> MeshMapEntry {
        let addr = address_for_node("test_peer");
        MeshMapEntry {
            address: addr,
            kind: EntryKind::Node,
            owner_id: "test_peer".to_string(),
            created_at: 0,
            updated_at,
            last_verified_at: None,
            confidence,
            ttl_ticks: DEFAULT_TTL_TICKS,
            locale_path: vec![],
            payload: EntryPayload::Node(NodePayload {
                addresses: vec![],
                display_name: None,
                node_type: NodeType::User,
                capabilities: None,
                engagement_score: None,
                ruc_score: None,
                routes: vec![],
                trust_rating: None,
                is_server_class: false,
                location: None,
                portal_url: None,
            }),
            signature: vec![],
        }
    }

    #[test]
    fn self_registration_produces_valid_entry() {
        let kp = Keypair::generate();
        let entry = build_self_registration(
            &kp,
            "TestNode",
            NodeType::User,
            &["/ip4/127.0.0.1/tcp/5000".to_string()],
            vec!["r-test".to_string()],
        );
        assert_eq!(entry.kind, EntryKind::Node);
        assert_eq!(entry.owner_id, kp.peer_id());
        assert_eq!(entry.confidence, ConfidenceTier::SelfVerified);
        assert!(entry.verify_signature(), "self-registration must have valid signature");
        assert_eq!(entry.address, address_for_node(&kp.peer_id()));
    }

    #[test]
    fn mint_place_produces_valid_entry() {
        let kp = Keypair::generate();
        let entry = mint_place(
            &kp,
            "Test Place",
            GovernanceModel::Private,
            OwnershipMode::Unencrypted,
            "public",
        );
        assert_eq!(entry.kind, EntryKind::Place);
        assert_eq!(entry.owner_id, kp.peer_id());
        assert!(entry.verify_signature(), "minted place must have valid signature");
        match &entry.payload {
            EntryPayload::Place(pp) => {
                assert_eq!(pp.name, "Test Place");
                assert_eq!(pp.owner_id, kp.peer_id());
                assert_eq!(pp.governance, GovernanceModel::Private);
                assert_eq!(pp.member_count, 1);
                assert_eq!(pp.hosting_nodes.len(), 1);
            }
            _ => panic!("expected Place payload"),
        }
    }

    #[test]
    fn geo_location_rounds_to_five_miles() {
        let loc = GeoLocation::new(37.7749295, -122.4194155);
        assert_eq!(loc.lat, 37.8);
        assert_eq!(loc.lon, -122.4);
    }

    #[test]
    fn portal_url_deterministic() {
        let url1 = portal_url_for_node("peer_abc");
        let url2 = portal_url_for_node("peer_abc");
        assert_eq!(url1, url2);
        assert!(url1.ends_with(".concorrd.com"));
    }

    #[test]
    fn portal_url_unique_per_node() {
        let url1 = portal_url_for_node("peer_a");
        let url2 = portal_url_for_node("peer_b");
        assert_ne!(url1, url2);
    }

    #[test]
    fn self_registration_includes_portal_url() {
        let kp = Keypair::generate();
        let entry = build_self_registration(&kp, "Node", NodeType::User, &[], vec![]);
        match &entry.payload {
            EntryPayload::Node(np) => {
                assert!(np.portal_url.is_some());
                assert!(np.portal_url.as_ref().unwrap().ends_with(".concorrd.com"));
            }
            _ => panic!("expected Node payload"),
        }
    }

    #[test]
    fn prominence_trusted_server_higher() {
        let kp = Keypair::generate();
        let mut server_entry = build_self_registration(
            &kp, "Server", NodeType::Backbone, &[], vec![],
        );
        // Give the server high trust
        if let EntryPayload::Node(ref mut np) = server_entry.payload {
            np.trust_rating = Some(0.9);
            np.is_server_class = true;
        }
        server_entry.confidence = ConfidenceTier::SelfVerified;

        let kp2 = Keypair::generate();
        let user_entry = build_self_registration(
            &kp2, "User", NodeType::User, &[], vec![],
        );

        let server_prominence = compute_prominence(&server_entry);
        let user_prominence = compute_prominence(&user_entry);
        assert!(
            server_prominence > user_prominence,
            "trusted server ({server_prominence}) should rank higher than new user ({user_prominence})"
        );
    }

    #[test]
    fn prominence_non_node_returns_zero() {
        let kp = Keypair::generate();
        let entry = mint_place(&kp, "Place", GovernanceModel::Private, OwnershipMode::Unencrypted, "public");
        assert_eq!(compute_prominence(&entry), 0.0);
    }

    #[test]
    fn place_role_ordering() {
        assert!(PlaceRole::Owner > PlaceRole::Admin);
        assert!(PlaceRole::Admin > PlaceRole::Moderator);
        assert!(PlaceRole::Moderator > PlaceRole::Member);
        assert!(PlaceRole::Member > PlaceRole::Guest);
    }

    #[test]
    fn charter_immutability_rejects_non_owner_update() {
        let owner_kp = Keypair::generate();
        let attacker_kp = Keypair::generate();

        let original = mint_place(&owner_kp, "My Place", GovernanceModel::Private, OwnershipMode::Encrypted, "public");

        // Attacker tries to overwrite the charter
        let mut fake = original.clone();
        fake.owner_id = attacker_kp.peer_id();
        fake.updated_at = original.updated_at + 1000;
        if let EntryPayload::Place(ref mut pp) = fake.payload {
            pp.version = 2;
            pp.name = "Hijacked".to_string();
        }
        fake.sign(&attacker_kp);

        let result = merge_entry(&original, &fake);
        // Should keep the original — attacker is not the owner
        assert_eq!(result.owner_id, owner_kp.peer_id());
    }

    #[test]
    fn charter_immutability_rejects_version_rollback() {
        let kp = Keypair::generate();
        let original = mint_place(&kp, "Place", GovernanceModel::Private, OwnershipMode::Unencrypted, "public");
        let reminted = remint_place(&kp, &original, None, Some("Updated")).unwrap();

        // Try to merge the old version (v1) over the new one (v2) — should be rejected
        let result = merge_entry(&reminted, &original);
        match &result.payload {
            EntryPayload::Place(pp) => {
                assert_eq!(pp.version, 2, "should keep the higher version");
                assert_eq!(pp.name, "Updated");
            }
            _ => panic!("expected Place payload"),
        }
    }

    #[test]
    fn charter_remint_increments_version() {
        let kp = Keypair::generate();
        let original = mint_place(&kp, "V1", GovernanceModel::Private, OwnershipMode::Unencrypted, "public");
        let reminted = remint_place(&kp, &original, None, Some("V2")).unwrap();

        match &reminted.payload {
            EntryPayload::Place(pp) => {
                assert_eq!(pp.version, 2);
                assert_eq!(pp.name, "V2");
                assert!(pp.prior_history.is_some(), "should have compressed history");
            }
            _ => panic!("expected Place payload"),
        }
        assert!(reminted.verify_signature());
    }

    #[test]
    fn charter_remint_by_non_owner_fails() {
        let owner_kp = Keypair::generate();
        let other_kp = Keypair::generate();
        let original = mint_place(&owner_kp, "Place", GovernanceModel::Private, OwnershipMode::Unencrypted, "public");

        let result = remint_place(&other_kp, &original, None, Some("Hijack"));
        assert!(result.is_none(), "non-owner should not be able to remint");
    }

    #[test]
    fn charter_valid_remint_accepted_by_merge() {
        let kp = Keypair::generate();
        let original = mint_place(&kp, "Place", GovernanceModel::Private, OwnershipMode::Unencrypted, "public");
        let reminted = remint_place(&kp, &original, None, Some("Updated")).unwrap();

        // Merge should accept the valid re-mint (higher version, same owner)
        let result = merge_entry(&original, &reminted);
        match &result.payload {
            EntryPayload::Place(pp) => {
                assert_eq!(pp.version, 2);
                assert_eq!(pp.name, "Updated");
            }
            _ => panic!("expected Place payload"),
        }
    }
}
