// Simplified E2E encryption module.
//
// Uses X25519 for key exchange and ChaCha20-Poly1305 for symmetric encryption.
// This is a practical starting point — a full Double Ratchet can replace it later.

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use rand::rngs::OsRng;
use thiserror::Error;
use x25519_dalek::{PublicKey, StaticSecret};

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("encryption failed")]
    EncryptionFailed,
    #[error("decryption failed")]
    DecryptionFailed,
    #[error("invalid nonce length: expected 12, got {0}")]
    InvalidNonceLength(usize),
}

/// A simplified E2E encryption session between two peers.
///
/// Uses a shared secret (derived from X25519 key exchange) with
/// ChaCha20-Poly1305 AEAD. Each message gets a unique nonce derived
/// from a monotonic counter.
pub struct E2ESession {
    shared_secret: [u8; 32],
    send_nonce_counter: u64,
    recv_nonce_counter: u64,
}

impl E2ESession {
    /// Create a session from a shared secret (derived from X25519 key exchange).
    pub fn from_shared_secret(secret: [u8; 32]) -> Self {
        Self {
            shared_secret: secret,
            send_nonce_counter: 0,
            recv_nonce_counter: 0,
        }
    }

    /// Get the shared secret bytes (for persistence).
    pub fn shared_secret(&self) -> &[u8; 32] {
        &self.shared_secret
    }

    /// Get the current send counter.
    pub fn send_count(&self) -> u64 {
        self.send_nonce_counter
    }

    /// Get the current recv counter.
    pub fn recv_count(&self) -> u64 {
        self.recv_nonce_counter
    }

    /// Restore a session with specific counter values.
    pub fn with_counters(mut self, send_count: u64, recv_count: u64) -> Self {
        self.send_nonce_counter = send_count;
        self.recv_nonce_counter = recv_count;
        self
    }

    /// Build a 12-byte nonce from a counter value.
    /// First 4 bytes are zero (reserved), last 8 bytes are the counter in big-endian.
    fn nonce_from_counter(counter: u64) -> [u8; 12] {
        let mut nonce = [0u8; 12];
        nonce[4..12].copy_from_slice(&counter.to_be_bytes());
        nonce
    }

    /// Encrypt a plaintext message. Returns (ciphertext, nonce).
    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<(Vec<u8>, [u8; 12]), CryptoError> {
        let cipher =
            ChaCha20Poly1305::new_from_slice(&self.shared_secret).map_err(|_| CryptoError::EncryptionFailed)?;

        let nonce_bytes = Self::nonce_from_counter(self.send_nonce_counter);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| CryptoError::EncryptionFailed)?;

        self.send_nonce_counter += 1;

        Ok((ciphertext, nonce_bytes))
    }

    /// Decrypt a ciphertext with the given nonce.
    pub fn decrypt(
        &mut self,
        ciphertext: &[u8],
        nonce: &[u8; 12],
    ) -> Result<Vec<u8>, CryptoError> {
        let cipher =
            ChaCha20Poly1305::new_from_slice(&self.shared_secret).map_err(|_| CryptoError::DecryptionFailed)?;

        let nonce_obj = Nonce::from_slice(nonce);

        let plaintext = cipher
            .decrypt(nonce_obj, ciphertext)
            .map_err(|_| CryptoError::DecryptionFailed)?;

        self.recv_nonce_counter += 1;

        Ok(plaintext)
    }
}

/// Generate an X25519 keypair for key exchange.
pub fn generate_x25519_keypair() -> (StaticSecret, PublicKey) {
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);
    (secret, public)
}

/// Compute a shared secret from our secret key and their public key.
pub fn compute_shared_secret(
    our_secret: &StaticSecret,
    their_public: &PublicKey,
) -> [u8; 32] {
    let shared = our_secret.diffie_hellman(their_public);
    *shared.as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn x25519_key_exchange_produces_same_shared_secret() {
        let (alice_secret, alice_public) = generate_x25519_keypair();
        let (bob_secret, bob_public) = generate_x25519_keypair();

        let alice_shared = compute_shared_secret(&alice_secret, &bob_public);
        let bob_shared = compute_shared_secret(&bob_secret, &alice_public);

        assert_eq!(alice_shared, bob_shared);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let (alice_secret, alice_public) = generate_x25519_keypair();
        let (bob_secret, bob_public) = generate_x25519_keypair();

        let shared = compute_shared_secret(&alice_secret, &bob_public);

        let mut alice_session = E2ESession::from_shared_secret(shared);
        let mut bob_session = E2ESession::from_shared_secret(
            compute_shared_secret(&bob_secret, &alice_public),
        );

        let plaintext = b"Hello from Alice to Bob!";
        let (ciphertext, nonce) = alice_session.encrypt(plaintext).unwrap();

        let decrypted = bob_session.decrypt(&ciphertext, &nonce).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn multiple_messages_use_different_nonces() {
        let shared = [42u8; 32];
        let mut session = E2ESession::from_shared_secret(shared);

        let (_, nonce1) = session.encrypt(b"msg1").unwrap();
        let (_, nonce2) = session.encrypt(b"msg2").unwrap();

        assert_ne!(nonce1, nonce2);
        assert_eq!(session.send_count(), 2);
    }

    #[test]
    fn wrong_key_fails_decryption() {
        let shared1 = [1u8; 32];
        let shared2 = [2u8; 32];

        let mut sender = E2ESession::from_shared_secret(shared1);
        let mut receiver = E2ESession::from_shared_secret(shared2);

        let (ciphertext, nonce) = sender.encrypt(b"secret").unwrap();
        assert!(receiver.decrypt(&ciphertext, &nonce).is_err());
    }

    #[test]
    fn session_counter_persistence() {
        let shared = [99u8; 32];
        let session = E2ESession::from_shared_secret(shared).with_counters(10, 5);
        assert_eq!(session.send_count(), 10);
        assert_eq!(session.recv_count(), 5);
    }
}
