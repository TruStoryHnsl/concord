use rusqlite::params;
use tracing::debug;

use concord_core::trust::{compute_trust_level, TrustAttestation, TrustScore};

use crate::db::{Database, Result};

impl Database {
    /// Store (or replace) an attestation. Replaces any existing attestation
    /// from the same attester for the same subject.
    pub fn store_attestation(&self, att: &TrustAttestation) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO attestations (attester_id, subject_id, since_timestamp, signature, received_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(attester_id, subject_id) DO UPDATE SET
                since_timestamp = ?3,
                signature = ?4,
                received_at = ?5",
            params![
                att.attester_id,
                att.subject_id,
                att.since_timestamp as i64,
                att.signature,
                now,
            ],
        )?;
        debug!(
            attester = %att.attester_id,
            subject = %att.subject_id,
            "attestation stored"
        );
        Ok(())
    }

    /// Get all attestations for a given subject peer.
    pub fn get_attestations_for(&self, subject_id: &str) -> Result<Vec<TrustAttestation>> {
        let mut stmt = self.conn.prepare(
            "SELECT attester_id, subject_id, since_timestamp, signature
             FROM attestations
             WHERE subject_id = ?1
             ORDER BY received_at DESC",
        )?;
        let rows = stmt.query_map(params![subject_id], |row| {
            let attester_id: String = row.get(0)?;
            let subject_id: String = row.get(1)?;
            let since_timestamp: i64 = row.get(2)?;
            let signature: Vec<u8> = row.get(3)?;
            Ok(TrustAttestation {
                attester_id,
                subject_id,
                since_timestamp: since_timestamp as u64,
                signature,
            })
        })?;
        let attestations: Vec<TrustAttestation> =
            rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(attestations)
    }

    /// Count the number of attestations for a subject.
    pub fn get_attestation_count(&self, subject_id: &str) -> Result<u32> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM attestations WHERE subject_id = ?1",
            params![subject_id],
            |row| row.get(0),
        )?;
        Ok(count as u32)
    }

    /// Compute the trust score for a peer, update the peers table, and return the score.
    ///
    /// `identity_age_days` is how many days since the peer's identity was first seen.
    pub fn compute_and_update_trust(
        &self,
        subject_id: &str,
        identity_age_days: u64,
    ) -> Result<TrustScore> {
        let attestation_count = self.get_attestation_count(subject_id)?;
        let badge = compute_trust_level(attestation_count, identity_age_days);

        // Score is a normalized 0.0-1.0 value based on attestations (capped at 20) and age (capped at 365)
        let att_score = (attestation_count as f64 / 20.0).min(1.0);
        let age_score = (identity_age_days as f64 / 365.0).min(1.0);
        let score = (att_score * 0.7 + age_score * 0.3).min(1.0);

        // Update the peer's trust score in the peers table
        self.conn.execute(
            "UPDATE peers SET trust_score = ?1 WHERE peer_id = ?2",
            params![score, subject_id],
        )?;

        let trust_score = TrustScore {
            peer_id: subject_id.to_string(),
            score,
            attestation_count,
            badge,
        };

        debug!(
            peer_id = %subject_id,
            score,
            attestation_count,
            ?badge,
            "trust score computed and updated"
        );

        Ok(trust_score)
    }

    /// Get the cached trust score for a peer. Returns None if no attestations exist.
    pub fn get_trust_score(&self, peer_id: &str) -> Result<Option<TrustScore>> {
        let attestation_count = self.get_attestation_count(peer_id)?;
        if attestation_count == 0 {
            return Ok(None);
        }

        let trust_val: f64 = self.conn.query_row(
            "SELECT trust_score FROM peers WHERE peer_id = ?1",
            params![peer_id],
            |row| row.get(0),
        ).unwrap_or(0.0);

        // We need identity age to compute the badge, but we don't store creation date
        // for peers directly. Use the earliest attestation's since_timestamp as a proxy.
        let earliest_since: i64 = self.conn.query_row(
            "SELECT MIN(since_timestamp) FROM attestations WHERE subject_id = ?1",
            params![peer_id],
            |row| row.get(0),
        ).unwrap_or(0);

        let now = chrono::Utc::now().timestamp() as u64;
        let age_secs = now.saturating_sub(earliest_since as u64);
        let age_days = age_secs / 86400;

        let badge = compute_trust_level(attestation_count, age_days);

        Ok(Some(TrustScore {
            peer_id: peer_id.to_string(),
            score: trust_val,
            attestation_count,
            badge,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_and_retrieve_attestation() {
        let db = Database::open_in_memory().unwrap();

        let att = TrustAttestation {
            attester_id: "attester1".to_string(),
            subject_id: "subject1".to_string(),
            since_timestamp: 1700000000,
            signature: vec![1, 2, 3, 4],
        };
        db.store_attestation(&att).unwrap();

        let attestations = db.get_attestations_for("subject1").unwrap();
        assert_eq!(attestations.len(), 1);
        assert_eq!(attestations[0].attester_id, "attester1");
        assert_eq!(attestations[0].since_timestamp, 1700000000);
    }

    #[test]
    fn attestation_count() {
        let db = Database::open_in_memory().unwrap();

        for i in 0..5 {
            let att = TrustAttestation {
                attester_id: format!("attester{i}"),
                subject_id: "subject1".to_string(),
                since_timestamp: 1700000000,
                signature: vec![i as u8],
            };
            db.store_attestation(&att).unwrap();
        }

        assert_eq!(db.get_attestation_count("subject1").unwrap(), 5);
        assert_eq!(db.get_attestation_count("nonexistent").unwrap(), 0);
    }

    #[test]
    fn upsert_attestation_replaces() {
        let db = Database::open_in_memory().unwrap();

        let att1 = TrustAttestation {
            attester_id: "attester1".to_string(),
            subject_id: "subject1".to_string(),
            since_timestamp: 1700000000,
            signature: vec![1, 2, 3],
        };
        db.store_attestation(&att1).unwrap();

        // Same attester+subject with different timestamp
        let att2 = TrustAttestation {
            attester_id: "attester1".to_string(),
            subject_id: "subject1".to_string(),
            since_timestamp: 1700001000,
            signature: vec![4, 5, 6],
        };
        db.store_attestation(&att2).unwrap();

        // Should still be 1 attestation (upserted)
        assert_eq!(db.get_attestation_count("subject1").unwrap(), 1);
        let attestations = db.get_attestations_for("subject1").unwrap();
        assert_eq!(attestations[0].since_timestamp, 1700001000);
    }

    #[test]
    fn compute_trust_from_stored_attestations() {
        let db = Database::open_in_memory().unwrap();

        // Create a peer first
        db.upsert_peer("subject1", Some("Subject"), &[]).unwrap();

        // Store 5 attestations
        for i in 0..5 {
            let att = TrustAttestation {
                attester_id: format!("attester{i}"),
                subject_id: "subject1".to_string(),
                since_timestamp: 1700000000,
                signature: vec![i as u8],
            };
            db.store_attestation(&att).unwrap();
        }

        // 5 attestations + 30 days -> Established
        let score = db.compute_and_update_trust("subject1", 30).unwrap();
        assert_eq!(score.attestation_count, 5);
        assert_eq!(score.badge, concord_core::types::TrustLevel::Established);
        assert!(score.score > 0.0);
    }

    #[test]
    fn get_trust_score_returns_none_for_unknown() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.get_trust_score("nonexistent").unwrap().is_none());
    }
}
