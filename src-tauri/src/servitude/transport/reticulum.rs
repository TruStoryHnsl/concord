//! Feature-gated Reticulum transport scaffold.
//!
//! Main-build Reticulum is intentionally additive: discovery + encrypted link
//! establishment + small Concord envelopes ride alongside Matrix federation,
//! not instead of it. The implementation stays behind the Cargo `reticulum`
//! feature flag so the default build never pulls the dependency surface in.
//!
//! This file is only the scaffold seam. Real runtime wiring lands in a later
//! wave; until then `start()` reports `NotImplemented("reticulum")`.

use async_trait::async_trait;

use crate::servitude::config::ServitudeConfig;

use super::{Transport, TransportError};

#[derive(Debug, Clone)]
pub struct ReticulumTransport {
    display_name: String,
    listen_port: u16,
}

impl ReticulumTransport {
    pub fn from_config(config: &ServitudeConfig) -> Self {
        Self {
            display_name: config.display_name.clone(),
            listen_port: config.listen_port as u16,
        }
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn listen_port(&self) -> u16 {
        self.listen_port
    }
}

#[async_trait]
impl Transport for ReticulumTransport {
    fn name(&self) -> &'static str {
        "reticulum"
    }

    async fn start(&mut self) -> Result<(), TransportError> {
        Err(TransportError::NotImplemented("reticulum"))
    }

    async fn stop(&mut self) -> Result<(), TransportError> {
        Ok(())
    }

    async fn is_healthy(&self) -> bool {
        false
    }
}
