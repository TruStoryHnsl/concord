mod config;
mod admin;

use clap::{Parser, Subcommand};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "concordd", version, about = "Concord daemon — decentralized chat server")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Path to configuration file
    #[arg(short, long, default_value = "concordd.toml")]
    config: String,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the Concord daemon
    Start,
    /// Show daemon status
    Status,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Start => {
            println!("Concord Server v0.1.0");
            tracing::info!(config = %cli.config, "starting concordd");

            let daemon_config = config::DaemonConfig::load(&cli.config).unwrap_or_default();
            tracing::info!(
                name = %daemon_config.node.display_name,
                port = daemon_config.node.listen_port,
                "configuration loaded"
            );

            // The event loop will go here once concord-net is wired up.
            tracing::info!("daemon ready (no-op stub — networking not yet wired)");
            tokio::signal::ctrl_c().await?;
            tracing::info!("shutting down");
        }
        Commands::Status => {
            println!("Concord Server v0.1.0");
            println!("Status: not yet implemented");
        }
    }

    Ok(())
}
