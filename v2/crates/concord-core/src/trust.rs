use serde::{Deserialize, Serialize};

use crate::identity::Keypair;
use crate::types::TrustLevel;

/// An attestation from one peer vouching for another.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustAttestation {
    pub attester_id: String,
    pub subject_id: String,
    pub since_timestamp: u64,
    pub signature: Vec<u8>,
}

/// Computed trust score for a peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScore {
    pub peer_id: String,
    pub score: f64,
    pub attestation_count: u32,
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

    /// Create a signed attestation for a peer we've interacted with.
    pub fn create_attestation(
        &self,
        subject_id: &str,
        since_timestamp: u64,
    ) -> TrustAttestation {
        let message =
            Self::attestation_message(&self.local_peer_id, subject_id, since_timestamp);
        let signature = self.local_keypair.sign(&message);

        TrustAttestation {
            attester_id: self.local_peer_id.clone(),
            subject_id: subject_id.to_string(),
            since_timestamp,
            signature,
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
}
