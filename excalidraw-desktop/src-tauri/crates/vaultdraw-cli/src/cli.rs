//! Argument definitions (clap derive).

use clap::{Args, Parser, Subcommand};
use clap_complete::Shell;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "vaultdraw", version, about = "Control a running Vaultdraw from the command line", propagate_version = true)]
pub struct Cli {
    /// Print stable JSON (the raw result) instead of human text
    #[arg(long, global = true)]
    pub json: bool,
    /// Control socket path (default: $VAULTDRAW_SOCKET, else the instance's socket)
    #[arg(long, global = true, value_name = "PATH")]
    pub socket: Option<PathBuf>,
    /// Print the JSON-RPC request line instead of sending it
    #[arg(long, global = true)]
    pub print_request: bool,
    /// Seconds to wait for the app's reply
    #[arg(long, global = true, value_name = "SECS", default_value_t = 30)]
    pub timeout: u64,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Is the app running: version, vault, active drawing
    Status,
    /// CLI and API versions (plus the app's, when it is running)
    Version,
    /// List every method of the control API
    Methods,
    /// Send JSON-RPC lines from stdin and print the reply lines (debugging)
    Raw,
    /// Palette commands: list them, run one
    Cmd(CmdArgs),
    /// Print a shell completion script
    Completions {
        #[arg(value_enum)]
        shell: CompletionShell,
    },
    /// Print the vaultdraw(1) man page
    #[command(hide = true)]
    Man,
}

#[derive(Args, Debug)]
#[command(args_conflicts_with_subcommands = true, subcommand_required = false, arg_required_else_help = true)]
pub struct CmdArgs {
    #[command(subcommand)]
    pub action: Option<CmdAction>,
    /// Command id to run (short form of `cmd run <id>`)
    #[arg(value_name = "ID")]
    pub id: Option<String>,
}

#[derive(Subcommand, Debug)]
pub enum CmdAction {
    /// List palette commands (works without the app, from its snapshot)
    List {
        /// One command id per line (for shell completion)
        #[arg(long)]
        ids: bool,
    },
    /// Run a palette command by id
    Run {
        #[arg(value_name = "ID")]
        id: String,
    },
}

#[derive(clap::ValueEnum, Clone, Copy, Debug)]
pub enum CompletionShell {
    Bash,
    Zsh,
    Fish,
    Elvish,
    Nushell,
}

impl CompletionShell {
    pub fn generate(self, cmd: &mut clap::Command, out: &mut dyn std::io::Write) {
        let name = "vaultdraw";
        match self {
            Self::Bash => clap_complete::generate(Shell::Bash, cmd, name, out),
            Self::Zsh => clap_complete::generate(Shell::Zsh, cmd, name, out),
            Self::Fish => clap_complete::generate(Shell::Fish, cmd, name, out),
            Self::Elvish => clap_complete::generate(Shell::Elvish, cmd, name, out),
            Self::Nushell => clap_complete::generate(clap_complete_nushell::Nushell, cmd, name, out),
        }
    }
}
