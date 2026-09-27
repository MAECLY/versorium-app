//! Versorium's MCP server (spec §7).
//!
//! One binary, two entry points: with no arguments it launches the desktop app,
//! with `versorium mcp` it becomes a stdio MCP server for whichever agent the
//! user wired it into. The server is READ-ONLY until Settings → MCP grants a
//! specific client write access.

pub mod clients;
pub mod dispatch;
pub mod log;
pub mod query;
pub mod server;
pub mod session;
pub mod tools;
pub mod write;

/// How the MCP process was invoked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliOptions {
    /// Identifies the calling agent for permissions and the tool log. It comes
    /// from the config the user approved (`--client <id>`), not from the wire,
    /// so a client cannot claim someone else's write grant by renaming itself.
    pub client: String,
}

pub const DEFAULT_CLIENT: &str = "unknown";

/// Serve MCP over stdio until the client closes the stream. Returns the process
/// exit code.
pub fn serve_stdio(options: CliOptions) -> i32 {
    server::serve(options, std::io::stdin().lock(), std::io::stdout().lock())
}

/// `Some(options)` when argv asks for the MCP server, `None` to start the GUI.
pub fn parse_cli<I, S>(args: I) -> Option<CliOptions>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut args = args.into_iter().map(|a| a.as_ref().to_string()).skip(1);
    if args.next().as_deref() != Some("mcp") {
        return None;
    }
    let mut client = DEFAULT_CLIENT.to_string();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--client" => {
                if let Some(value) = args.next().filter(|v| !v.is_empty()) {
                    client = value;
                }
            }
            other => {
                if let Some(value) = other.strip_prefix("--client=").filter(|v| !v.is_empty()) {
                    client = value.to_string();
                }
            }
        }
    }
    Some(CliOptions { client })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(args: &[&str]) -> Option<CliOptions> {
        parse_cli(args.iter().copied())
    }

    #[test]
    fn only_the_mcp_subcommand_starts_the_server() {
        assert!(opts(&["versorium"]).is_none());
        assert!(opts(&["versorium", "--help"]).is_none());
        assert!(opts(&["versorium", "open", "./book"]).is_none());
        assert_eq!(opts(&["versorium", "mcp"]).unwrap().client, DEFAULT_CLIENT);
    }

    #[test]
    fn client_identity_comes_from_the_command_line() {
        assert_eq!(opts(&["versorium", "mcp", "--client", "codex"]).unwrap().client, "codex");
        assert_eq!(opts(&["versorium", "mcp", "--client=claude-code"]).unwrap().client, "claude-code");
        // An empty or missing value falls back rather than granting a blank id.
        assert_eq!(opts(&["versorium", "mcp", "--client"]).unwrap().client, DEFAULT_CLIENT);
        assert_eq!(opts(&["versorium", "mcp", "--client="]).unwrap().client, DEFAULT_CLIENT);
    }
}
