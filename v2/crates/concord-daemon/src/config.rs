use std::path::Path;

use serde::Deserialize;

use concord_core::config::NodeConfig;

/// Top-level daemon configuration, loaded from a TOML file.
#[derive(Debug, Deserialize)]
pub struct DaemonConfig {
    #[serde(default)]
    pub node: NodeConfig,

    #[serde(default)]
    pub logging: LoggingConfig,

    #[serde(default)]
    pub webhost: WebhostConfig,
}

/// Logging configuration.
#[derive(Debug, Deserialize)]
pub struct LoggingConfig {
    /// tracing env-filter string (e.g. "info,concord_net=debug")
    pub filter: String,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            filter: "info".into(),
        }
    }
}

/// Embedded web server configuration.
#[derive(Debug, Deserialize)]
pub struct WebhostConfig {
    pub enabled: bool,
    pub bind_address: String,
    pub port: u16,
}

impl Default for WebhostConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            bind_address: "0.0.0.0".into(),
            port: 8080,
        }
    }
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            node: NodeConfig::default(),
            logging: LoggingConfig::default(),
            webhost: WebhostConfig::default(),
        }
    }
}

impl DaemonConfig {
    /// Load configuration from a TOML file. Returns the default config if the
    /// file does not exist.
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, anyhow::Error> {
        let path = path.as_ref();
        if !path.exists() {
            tracing::warn!(?path, "config file not found, using defaults");
            return Ok(Self::default());
        }
        let contents = std::fs::read_to_string(path)?;
        let config: DaemonConfig = toml::from_str(&contents)?;
        Ok(config)
    }
}
