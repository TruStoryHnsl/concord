use hmac::{Hmac, Mac};
use rand::RngCore;
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

/// Generate a 20-byte random TOTP secret.
pub fn generate_totp_secret() -> Vec<u8> {
    let mut secret = vec![0u8; 20];
    rand::rngs::OsRng.fill_bytes(&mut secret);
    secret
}

/// Compute a 6-digit TOTP code for the given secret and time step.
///
/// `time_step` is typically `unix_timestamp / 30`.
pub fn compute_totp(secret: &[u8], time_step: u64) -> u32 {
    let time_bytes = time_step.to_be_bytes();

    let mut mac =
        HmacSha1::new_from_slice(secret).expect("HMAC-SHA1 accepts any key length");
    mac.update(&time_bytes);
    let result = mac.finalize().into_bytes();

    // Dynamic truncation (RFC 4226)
    let offset = (result[19] & 0x0f) as usize;
    let code = ((result[offset] as u32 & 0x7f) << 24)
        | ((result[offset + 1] as u32) << 16)
        | ((result[offset + 2] as u32) << 8)
        | (result[offset + 3] as u32);

    code % 1_000_000
}

/// Verify a TOTP code against the secret, allowing `window` steps
/// before and after the current time step.
pub fn verify_totp(secret: &[u8], code: u32, window: u32) -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let current_step = now / 30;

    for i in 0..=window {
        if compute_totp(secret, current_step + i as u64) == code {
            return true;
        }
        if i > 0 && current_step >= i as u64 {
            if compute_totp(secret, current_step - i as u64) == code {
                return true;
            }
        }
    }
    false
}

/// Verify a TOTP code against a specific time step (useful for testing).
pub fn verify_totp_at(secret: &[u8], code: u32, time_step: u64, window: u32) -> bool {
    for i in 0..=window {
        if compute_totp(secret, time_step + i as u64) == code {
            return true;
        }
        if i > 0 && time_step >= i as u64 {
            if compute_totp(secret, time_step - i as u64) == code {
                return true;
            }
        }
    }
    false
}

/// Encode a secret as base32 (for QR code URIs).
pub fn secret_to_base32(secret: &[u8]) -> String {
    data_encoding::BASE32_NOPAD.encode(secret)
}

/// Generate an `otpauth://` URI suitable for QR code generation.
pub fn totp_uri(secret: &[u8], account: &str, issuer: &str) -> String {
    let encoded_secret = secret_to_base32(secret);
    format!(
        "otpauth://totp/{issuer}:{account}?secret={encoded_secret}&issuer={issuer}&digits=6&period=30"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn totp_generation_deterministic() {
        let secret = b"12345678901234567890";
        let code1 = compute_totp(secret, 1000);
        let code2 = compute_totp(secret, 1000);
        assert_eq!(code1, code2);
        // Code should be 6 digits max
        assert!(code1 < 1_000_000);
    }

    #[test]
    fn totp_different_steps_differ() {
        let secret = b"12345678901234567890";
        let code1 = compute_totp(secret, 1000);
        let code2 = compute_totp(secret, 1001);
        // Extremely unlikely to collide
        assert_ne!(code1, code2);
    }

    #[test]
    fn totp_verify_at_exact_step() {
        let secret = generate_totp_secret();
        let step = 50000u64;
        let code = compute_totp(&secret, step);
        assert!(verify_totp_at(&secret, code, step, 0));
    }

    #[test]
    fn totp_verify_within_window() {
        let secret = generate_totp_secret();
        let step = 50000u64;
        let code = compute_totp(&secret, step);
        // Should verify within a window of 1
        assert!(verify_totp_at(&secret, code, step + 1, 1));
        assert!(verify_totp_at(&secret, code, step - 1, 1));
    }

    #[test]
    fn totp_reject_outside_window() {
        let secret = generate_totp_secret();
        let step = 50000u64;
        let code = compute_totp(&secret, step);
        // Should NOT verify 5 steps away with window=1
        assert!(!verify_totp_at(&secret, code, step + 5, 1));
    }

    #[test]
    fn totp_uri_format() {
        let secret = b"12345678901234567890";
        let uri = totp_uri(secret, "user@example.com", "Concord");
        assert!(uri.starts_with("otpauth://totp/Concord:user@example.com?"));
        assert!(uri.contains("secret="));
        assert!(uri.contains("issuer=Concord"));
        assert!(uri.contains("digits=6"));
        assert!(uri.contains("period=30"));
    }

    #[test]
    fn base32_roundtrip() {
        let secret = generate_totp_secret();
        let encoded = secret_to_base32(&secret);
        let decoded = data_encoding::BASE32_NOPAD
            .decode(encoded.as_bytes())
            .unwrap();
        assert_eq!(secret, decoded);
    }

    /// RFC 6238 test vector: SHA1 secret "12345678901234567890", time=59 -> step=1
    #[test]
    fn rfc6238_test_vector() {
        let secret = b"12345678901234567890";
        let step = 59u64 / 30; // step = 1
        let code = compute_totp(secret, step);
        // RFC 6238 appendix B: for time=59, TOTP is 287082
        assert_eq!(code, 287082);
    }
}
