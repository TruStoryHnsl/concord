use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum IdentityError {
    #[error("invalid key bytes: expected 32 bytes, got {0}")]
    InvalidKeyLength(usize),
    #[error("signature verification failed")]
    VerificationFailed(#[from] ed25519_dalek::SignatureError),
}

/// A cryptographic identity backed by an Ed25519 signing key.
#[derive(Debug, Clone)]
pub struct Keypair {
    signing_key: SigningKey,
}

impl Keypair {
    /// Generate a new random keypair.
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        Self { signing_key }
    }

    /// Derive the peer ID from the public key (hex-encoded).
    pub fn peer_id(&self) -> String {
        let verifying_key = self.signing_key.verifying_key();
        hex_encode(verifying_key.as_bytes())
    }

    /// Sign a message, returning the 64-byte signature.
    pub fn sign(&self, message: &[u8]) -> Vec<u8> {
        let signature = self.signing_key.sign(message);
        signature.to_bytes().to_vec()
    }

    /// Verify a signature against a public key and message.
    pub fn verify(
        public_key_bytes: &[u8; 32],
        message: &[u8],
        signature_bytes: &[u8; 64],
    ) -> Result<(), IdentityError> {
        let verifying_key = VerifyingKey::from_bytes(public_key_bytes)?;
        let signature = ed25519_dalek::Signature::from_bytes(signature_bytes);
        verifying_key.verify(message, &signature)?;
        Ok(())
    }

    /// Serialize the signing key to 32 bytes.
    pub fn to_bytes(&self) -> [u8; 32] {
        self.signing_key.to_bytes()
    }

    /// Restore a keypair from 32 secret key bytes.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, IdentityError> {
        if bytes.len() != 32 {
            return Err(IdentityError::InvalidKeyLength(bytes.len()));
        }
        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(bytes);
        let signing_key = SigningKey::from_bytes(&key_bytes);
        Ok(Self { signing_key })
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_and_sign_verify() {
        let kp = Keypair::generate();
        let message = b"hello concord";
        let sig = kp.sign(message);

        let pub_bytes = {
            let vk = kp.signing_key.verifying_key();
            *vk.as_bytes()
        };
        let sig_bytes: [u8; 64] = sig.try_into().unwrap();
        Keypair::verify(&pub_bytes, message, &sig_bytes).unwrap();
    }

    #[test]
    fn roundtrip_bytes() {
        let kp = Keypair::generate();
        let bytes = kp.to_bytes();
        let restored = Keypair::from_bytes(&bytes).unwrap();
        assert_eq!(kp.peer_id(), restored.peer_id());
    }
}
