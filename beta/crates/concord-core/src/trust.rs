use serde::{Deserialize, Serialize};

use crate::identity::Keypair;
use crate::types::TrustLevel;

/// Whether an attestation is positive (vouch) or negative (flag).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttestationType {
    Positive,
    Negative,
}

/// An attestation from one peer vouching for (or flagging) another.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustAttestation {
    pub attester_id: String,
    pub subject_id: String,
    #[serde(default = "default_attestation_type")]
    pub attestation_type: AttestationType,
    pub since_timestamp: u64,
    /// Optional reason (mainly for negative attestations).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub signature: Vec<u8>,
    /// Trust weight of the attester at time of attestation (0.0 if unknown).
    #[serde(default)]
    pub attester_trust_weight: f64,
}

fn default_attestation_type() -> AttestationType {
    AttestationType::Positive
}

/// Computed trust score for a peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScore {
    pub peer_id: String,
    pub score: f64,
    pub attestation_count: u32,
    pub positive_count: u32,
    pub negative_count: u32,
    pub badge: TrustLevel,
}

/// Compute a trust level from attestation count and identity age.
///
/// Thresholds:
/// - Backbone: 20+ attestations and 365+ days
/// - Trusted: 10+ attestations and 90+ days
/// - Established: 5+ attestations and 30+ days
/// - Recognized: 1+ attestation and 7+ days
/// - Unverified: everything else
pub fn compute_trust_level(attestation_count: u32, identity_age_days: u64) -> TrustLevel {
    if attestation_count >= 20 && identity_age_days >= 365 {
        TrustLevel::Backbone
    } else if attestation_count >= 10 && identity_age_days >= 90 {
        TrustLevel::Trusted
    } else if attestation_count >= 5 && identity_age_days >= 30 {
        TrustLevel::Established
    } else if attestation_count >= 1 && identity_age_days >= 7 {
        TrustLevel::Recognized
    } else {
        TrustLevel::Unverified
    }
}

/// Weight multiplier based on an attester's trust level.
///
/// Attestations from highly trusted peers carry more weight than those
/// from unverified accounts.
pub fn attestation_weight(attester_trust: TrustLevel) -> f64 {
    match attester_trust {
        TrustLevel::Backbone => 3.0,
        TrustLevel::Trusted => 2.0,
        TrustLevel::Established => 1.5,
        TrustLevel::Recognized => 1.0,
        TrustLevel::Unverified => 0.5,
    }
}

/// Compute net trust score from positive and negative attestations.
///
/// Returns a value from -1.0 (completely untrusted) to 1.0 (maximally trusted)
/// and the corresponding TrustLevel.
pub fn compute_net_trust(
    positive_count: u32,
    negative_count: u32,
    weighted_positive: f64,
    weighted_negative: f64,
    identity_age_days: u64,
) -> (f64, TrustLevel) {
    let total_weight = weighted_positive + weighted_negative + 1.0;
    let raw_score = (weighted_positive - weighted_negative) / total_weight;
    let score = raw_score.clamp(-1.0, 1.0);

    // Factor in age for level computation — net attestations must be positive
    let net_count = (positive_count as i64 - negative_count as i64).max(0) as u32;
    let badge = if score < -0.3 {
        TrustLevel::Unverified // negative reputation forces Unverified regardless of count
    } else {
        compute_trust_level(net_count, identity_age_days)
    };

    (score, badge)
}

/// Compute trust score with cross-account reputation bleed.
///
/// Algorithm:
/// 1. Start with the individual alias score
/// 2. Compute weighted average of sibling scores (bleed_factor = 0.15)
/// 3. Final = (individual * 0.85) + (sibling_avg * 0.15)
/// 4. If ANY sibling has very negative score (< -0.5), apply penalty to all
pub fn compute_trust_with_bleed(
    individual_score: f64,
    sibling_scores: &[f64],
) -> f64 {
    const BLEED_FACTOR: f64 = 0.15;
    const SEVERE_NEGATIVE_THRESHOLD: f64 = -0.5;
    const SEVERE_PENALTY: f64 = 0.3;

    if sibling_scores.is_empty() {
        return individual_score;
    }

    let sibling_avg: f64 =
        sibling_scores.iter().sum::<f64>() / sibling_scores.len() as f64;

    let mut blended = individual_score * (1.0 - BLEED_FACTOR) + sibling_avg * BLEED_FACTOR;

    // If any sibling has a severely negative score, apply a penalty
    if sibling_scores.iter().any(|&s| s < SEVERE_NEGATIVE_THRESHOLD) {
        blended -= SEVERE_PENALTY;
    }

    blended.clamp(-1.0, 1.0)
}

/// Manages trust attestations for the local node.
pub struct TrustManager {
    local_keypair: Keypair,
    local_peer_id: String,
}

impl TrustManager {
    /// Create a new TrustManager from the local keypair.
    pub fn new(keypair: &Keypair) -> Self {
        Self {
            local_peer_id: keypair.peer_id(),
            local_keypair: keypair.clone(),
        }
    }

    /// Get the local peer ID.
    pub fn peer_id(&self) -> &str {
        &self.local_peer_id
    }

    /// Build the message that gets signed for an attestation.
    fn attestation_message(attester_id: &str, subject_id: &str, since_timestamp: u64) -> Vec<u8> {
        format!("{attester_id}:{subject_id}:{since_timestamp}").into_bytes()
    }

    /// Create a signed positive attestation for a peer we've interacted with.
    pub fn create_attestation(
        &self,
        subject_id: &str,
        since_timestamp: u64,
    ) -> TrustAttestation {
        self.create_typed_attestation(subject_id, AttestationType::Positive, since_timestamp, None)
    }

    /// Create a signed negative attestation (report/flag) for a peer.
    pub fn create_negative_attestation(
        &self,
        subject_id: &str,
        since_timestamp: u64,
        reason: Option<String>,
    ) -> TrustAttestation {
        self.create_typed_attestation(subject_id, AttestationType::Negative, since_timestamp, reason)
    }

    /// Create a signed attestation of a given type.
    pub fn create_typed_attestation(
        &self,
        subject_id: &str,
        attestation_type: AttestationType,
        since_timestamp: u64,
        reason: Option<String>,
    ) -> TrustAttestation {
        let message =
            Self::attestation_message(&self.local_peer_id, subject_id, since_timestamp);
        let signature = self.local_keypair.sign(&message);

        TrustAttestation {
            attester_id: self.local_peer_id.clone(),
            subject_id: subject_id.to_string(),
            attestation_type,
            since_timestamp,
            reason,
            signature,
            attester_trust_weight: 0.0, // filled in by caller if known
        }
    }

    /// Verify an attestation's signature using the attester's public key bytes.
    ///
    /// Returns `true` if the signature is valid.
    pub fn verify_attestation_with_key(
        attestation: &TrustAttestation,
        attester_public_key: &[u8; 32],
    ) -> bool {
        let message = Self::attestation_message(
            &attestation.attester_id,
            &attestation.subject_id,
            attestation.since_timestamp,
        );

        if attestation.signature.len() != 64 {
            return false;
        }

        let mut sig_bytes = [0u8; 64];
        sig_bytes.copy_from_slice(&attestation.signature);

        Keypair::verify(attester_public_key, &message, &sig_bytes).is_ok()
    }

    /// Verify an attestation that was signed by the local node.
    pub fn verify_own_attestation(&self, attestation: &TrustAttestation) -> bool {
        if attestation.attester_id != self.local_peer_id {
            return false;
        }
        let pub_bytes = {
            let pk_hex = &self.local_peer_id;
            match hex_decode(pk_hex) {
                Some(bytes) if bytes.len() == 32 => {
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&bytes);
                    arr
                }
                _ => return false,
            }
        };
        Self::verify_attestation_with_key(attestation, &pub_bytes)
    }
}

fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trust_levels() {
        assert_eq!(compute_trust_level(0, 0), TrustLevel::Unverified);
        assert_eq!(compute_trust_level(1, 7), TrustLevel::Recognized);
        assert_eq!(compute_trust_level(5, 30), TrustLevel::Established);
        assert_eq!(compute_trust_level(10, 90), TrustLevel::Trusted);
        assert_eq!(compute_trust_level(25, 400), TrustLevel::Backbone);
    }

    #[test]
    fn create_and_verify_attestation() {
        let keypair = Keypair::generate();
        let manager = TrustManager::new(&keypair);

        let attestation = manager.create_attestation("some-peer-id", 1700000000);

        // Verify using the attester's public key
        let pub_bytes = {
            let hex = keypair.peer_id();
            let bytes = hex_decode(&hex).unwrap();
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            arr
        };
        assert!(TrustManager::verify_attestation_with_key(
            &attestation,
            &pub_bytes
        ));
    }

    #[test]
    fn verify_own_attestation() {
        let keypair = Keypair::generate();
        let manager = TrustManager::new(&keypair);

        let attestation = manager.create_attestation("peer-abc", 1700000000);
        assert!(manager.verify_own_attestation(&attestation));
    }

    #[test]
    fn tampered_attestation_fails_verification() {
        let keypair = Keypair::generate();
        let manager = TrustManager::new(&keypair);

        let mut attestation = manager.create_attestation("peer-abc", 1700000000);
        // Tamper with the subject
        attestation.subject_id = "peer-xyz".to_string();

        assert!(!manager.verify_own_attestation(&attestation));
    }

    #[test]
    fn wrong_key_fails_verification() {
        let keypair1 = Keypair::generate();
        let keypair2 = Keypair::generate();

        let manager1 = TrustManager::new(&keypair1);
        let attestation = manager1.create_attestation("peer-abc", 1700000000);

        // Try to verify with a different key
        let pub_bytes = {
            let hex = keypair2.peer_id();
            let bytes = hex_decode(&hex).unwrap();
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            arr
        };
        assert!(!TrustManager::verify_attestation_with_key(
            &attestation,
            &pub_bytes
        ));
    }

    #[test]
    fn negative_attestation_creation() {
        let keypair = Keypair::generate();
        let manager = TrustManager::new(&keypair);

        let attestation = manager.create_negative_attestation(
            "bad-peer",
            1700000000,
            Some("spamming".to_string()),
        );
        assert_eq!(attestation.attestation_type, AttestationType::Negative);
        assert_eq!(attestation.reason, Some("spamming".to_string()));
        assert!(manager.verify_own_attestation(&attestation));
    }

    #[test]
    fn attestation_weight_values() {
        assert_eq!(attestation_weight(TrustLevel::Backbone), 3.0);
        assert_eq!(attestation_weight(TrustLevel::Trusted), 2.0);
        assert_eq!(attestation_weight(TrustLevel::Established), 1.5);
        assert_eq!(attestation_weight(TrustLevel::Recognized), 1.0);
        assert_eq!(attestation_weight(TrustLevel::Unverified), 0.5);
    }

    #[test]
    fn net_trust_positive_only() {
        // 10 positive attestations, 0 negative, weighted_pos = 15.0
        let (score, badge) = compute_net_trust(10, 0, 15.0, 0.0, 90);
        assert!(score > 0.0);
        assert_eq!(badge, TrustLevel::Trusted);
    }

    #[test]
    fn net_trust_negative_only() {
        // 0 positive, 5 negative, weighted_neg = 7.5
        let (score, badge) = compute_net_trust(0, 5, 0.0, 7.5, 90);
        assert!(score < 0.0);
        assert_eq!(badge, TrustLevel::Unverified);
    }

    #[test]
    fn net_trust_mixed() {
        // 10 positive (weight 15), 3 negative (weight 4.5)
        let (score, _badge) = compute_net_trust(10, 3, 15.0, 4.5, 90);
        // Net is positive but reduced
        assert!(score > 0.0);
        assert!(score < 1.0);
    }

    #[test]
    fn net_trust_score_clamped() {
        let (score, _) = compute_net_trust(100, 0, 300.0, 0.0, 999);
        assert!(score <= 1.0);
        let (score, _) = compute_net_trust(0, 100, 0.0, 300.0, 999);
        assert!(score >= -1.0);
    }

    #[test]
    fn bleed_no_siblings() {
        let result = compute_trust_with_bleed(0.8, &[]);
        assert!((result - 0.8).abs() < f64::EPSILON);
    }

    #[test]
    fn bleed_positive_siblings() {
        // Individual score 0.5, sibling average 0.9
        let result = compute_trust_with_bleed(0.5, &[0.9, 0.9]);
        // 0.5 * 0.85 + 0.9 * 0.15 = 0.425 + 0.135 = 0.56
        assert!((result - 0.56).abs() < 0.001);
    }

    #[test]
    fn bleed_severe_negative_sibling_penalty() {
        // Individual has good score, but one sibling is very bad
        let result = compute_trust_with_bleed(0.8, &[0.7, -0.6]);
        // sibling_avg = (0.7 + -0.6) / 2 = 0.05
        // blended = 0.8 * 0.85 + 0.05 * 0.15 = 0.68 + 0.0075 = 0.6875
        // penalty = -0.3 => 0.3875
        assert!(result < 0.5);
        assert!(result > 0.0);
    }

    #[test]
    fn bleed_result_clamped() {
        let result = compute_trust_with_bleed(-0.9, &[-0.8, -0.7]);
        assert!(result >= -1.0);
    }
}
