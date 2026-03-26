use serde::{de::DeserializeOwned, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum WireError {
    #[error("failed to encode MessagePack: {0}")]
    Encode(#[from] rmp_serde::encode::Error),
    #[error("failed to decode MessagePack: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
}

/// Serialize a value to MessagePack bytes.
pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, WireError> {
    rmp_serde::to_vec(value).map_err(WireError::from)
}

/// Deserialize a value from MessagePack bytes.
pub fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, WireError> {
    rmp_serde::from_slice(bytes).map_err(WireError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct TestMsg {
        text: String,
        count: u32,
    }

    #[test]
    fn roundtrip() {
        let msg = TestMsg {
            text: "hello".into(),
            count: 42,
        };
        let bytes = encode(&msg).unwrap();
        let decoded: TestMsg = decode(&bytes).unwrap();
        assert_eq!(msg, decoded);
    }
}
