//! MCP method dispatch.
//!
//! The wire shapes here were confirmed empirically, not guessed: a throwaway
//! logging server registered in a scratch project captured Claude Code 2.1.283
//! opening with `initialize` at protocol `2025-11-25`, then
//! `notifications/initialized`, `tools/list`, and a `tools/call` that completed.
//! Revision `2026-07-28` drops the handshake in favour of `server/discover`, so
//! both eras are answered — installed clients span them.

use super::server::{error_response, result_response, INVALID_PARAMS, METHOD_NOT_FOUND};
use super::session::Session;
use super::{log, tools};
use serde_json::{json, Value};

/// Newest first. The first entry is what we answer with when a client asks for
/// something we do not know.
pub const SUPPORTED: [&str; 5] = [
    "2026-07-28",
    "2025-11-25",
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
];

const SERVER_NAME: &str = "versorium";

fn server_info() -> Value {
    json!({ "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") })
}

fn instructions(session: &Session) -> String {
    let writable = if session.may_write() {
        "This client may write; every write returns a diff preview first and needs confirm: true to apply."
    } else {
        "This client is read-only. Write tools will refuse until the author grants write access in Settings → MCP."
    };
    format!(
        "Versorium exposes one novel: chapters as Markdown, a codex of characters and places, \
         the git history and a character-level ops log. Offsets are UTF-16 code units into a \
         chapter body, excluding frontmatter. {writable}"
    )
}

fn capabilities() -> Value {
    json!({ "tools": { "listChanged": false } })
}

/// Tool definitions as `tools/list` returns them.
fn tool_entries() -> Vec<Value> {
    tools::catalog()
        .into_iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.input_schema,
                "annotations": {
                    "readOnlyHint": tool.scope == super::session::Scope::Read,
                    "destructiveHint": tool.destructive,
                    "openWorldHint": false,
                },
            })
        })
        .collect()
}

/// A tool that ran and failed is reported in the RESULT with `isError`, not as a
/// JSON-RPC error: the call itself succeeded, the operation did not, and the
/// model needs to read the reason to recover.
fn tool_failure(code: &str) -> Value {
    json!({
        "content": [{ "type": "text", "text": format!("{}: {}", code, crate::i18n::t("en", code)) }],
        "isError": true,
    })
}

pub fn handle(session: &mut Session, method: &str, params: Value, id: Value) -> Option<Value> {
    match method {
        // Legacy handshake (2025-11-25 and earlier).
        "initialize" => {
            let asked = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or(SUPPORTED[1]);
            // Echo the client's version when we speak it; otherwise answer with
            // ours and let the client decide whether it can continue.
            let agreed = if SUPPORTED.contains(&asked) { asked } else { SUPPORTED[1] };
            Some(result_response(
                id,
                json!({
                    "protocolVersion": agreed,
                    "capabilities": capabilities(),
                    "serverInfo": server_info(),
                    "instructions": instructions(session),
                }),
            ))
        }
        // Modern discovery (2026-07-28+), which replaced the handshake.
        "server/discover" => Some(result_response(
            id,
            json!({
                "resultType": "discover",
                "supported": SUPPORTED,
                "serverInfo": server_info(),
                "capabilities": capabilities(),
                "instructions": instructions(session),
            }),
        )),
        "ping" => Some(result_response(id, json!({}))),
        "tools/list" => Some(result_response(id, json!({ "tools": tool_entries() }))),
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or_default();
            if name.is_empty() {
                return Some(error_response(id, INVALID_PARAMS, "Missing tool name", None));
            }
            // An unknown tool is a protocol-level error: the client asked for
            // something that was never advertised.
            if tools::find(name).is_none() {
                log::append(
                    &session.log_path(),
                    &log::entry(session.client(), name, "read", "error", "unknown tool".into()),
                );
                return Some(error_response(
                    id,
                    METHOD_NOT_FOUND,
                    &format!("Unknown tool: {name}"),
                    None,
                ));
            }
            let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            Some(result_response(
                id,
                match tools::call(session, name, &arguments) {
                    Ok(output) => json!({ "content": [{ "type": "text", "text": output.text }] }),
                    Err(code) => tool_failure(&code),
                },
            ))
        }
        // Notifications carry no id and must never be answered.
        _ if method.starts_with("notifications/") => None,
        _ => Some(error_response(id, METHOD_NOT_FOUND, "Method not found", None)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> (tempfile::TempDir, Session) {
        let dir = tempfile::tempdir().unwrap();
        let session = Session::new("claude-code".into(), dir.path().join("settings.json"));
        (dir, session)
    }

    /// The exact opening message Claude Code 2.1.283 sent to a probe server.
    fn real_initialize() -> Value {
        json!({
            "protocolVersion": "2025-11-25",
            "capabilities": { "roots": { "listChanged": true }, "elicitation": {} },
            "clientInfo": { "name": "claude-code", "version": "2.1.283" }
        })
    }

    #[test]
    fn answers_the_handshake_a_real_client_sends() {
        let (_dir, mut s) = session();
        let reply = handle(&mut s, "initialize", real_initialize(), json!(0)).unwrap();
        assert_eq!(reply["jsonrpc"], "2.0");
        assert_eq!(reply["id"], 0);
        let result = &reply["result"];
        assert_eq!(result["protocolVersion"], "2025-11-25", "the client's version is echoed");
        assert!(result["capabilities"]["tools"].is_object());
        assert_eq!(result["serverInfo"]["name"], "versorium");
        assert!(result["instructions"].as_str().unwrap().contains("read-only"));
    }

    #[test]
    fn an_unknown_protocol_version_gets_ours_rather_than_silence() {
        let (_dir, mut s) = session();
        let reply = handle(&mut s, "initialize", json!({ "protocolVersion": "1999-01-01" }), json!(1)).unwrap();
        assert_eq!(reply["result"]["protocolVersion"], "2025-11-25");
    }

    #[test]
    fn modern_clients_get_discovery_instead_of_a_handshake() {
        let (_dir, mut s) = session();
        let reply = handle(&mut s, "server/discover", json!({}), json!(1)).unwrap();
        let result = &reply["result"];
        assert_eq!(result["supported"][0], "2026-07-28");
        assert_eq!(result["resultType"], "discover");
        assert_eq!(result["serverInfo"]["name"], "versorium");
    }

    #[test]
    fn a_notification_is_never_answered() {
        let (_dir, mut s) = session();
        assert!(handle(&mut s, "notifications/initialized", json!(null), Value::Null).is_none());
        assert!(handle(&mut s, "notifications/cancelled", json!({}), Value::Null).is_none());
    }

    #[test]
    fn every_catalogued_tool_is_advertised_with_a_schema_and_hints() {
        let (_dir, mut s) = session();
        let reply = handle(&mut s, "tools/list", json!(null), json!(2)).unwrap();
        let listed = reply["result"]["tools"].as_array().unwrap();
        assert_eq!(listed.len(), tools::catalog().len());
        for tool in listed {
            assert!(tool["name"].as_str().is_some_and(|n| !n.is_empty()));
            assert!(tool["description"].as_str().is_some_and(|d| !d.is_empty()));
            assert_eq!(tool["inputSchema"]["type"], "object");
            assert!(tool["annotations"]["readOnlyHint"].is_boolean());
        }
        // Read tools are advertised read-only; write tools are not.
        let by_name = |name: &str| listed.iter().find(|t| t["name"] == name).unwrap().clone();
        assert_eq!(by_name("read_document")["annotations"]["readOnlyHint"], true);
        assert_eq!(by_name("write_document")["annotations"]["readOnlyHint"], false);
    }

    #[test]
    fn a_refused_write_is_a_tool_error_not_a_protocol_error() {
        let (_dir, mut s) = session();
        // No grant: the tool runs and refuses. The CALL succeeded, so the model
        // must see the reason in the result rather than a transport failure.
        let reply = handle(
            &mut s,
            "tools/call",
            json!({ "name": "write_document", "arguments": { "file": "manuscript/ch-01.md", "content": "x" } }),
            json!(3),
        )
        .unwrap();
        assert!(reply.get("error").is_none(), "must not be a JSON-RPC error");
        assert_eq!(reply["result"]["isError"], true);
        let text = reply["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("write_not_allowed"));
    }

    #[test]
    fn an_unadvertised_tool_is_a_protocol_error() {
        let (_dir, mut s) = session();
        let reply = handle(&mut s, "tools/call", json!({ "name": "rm_rf" }), json!(4)).unwrap();
        assert_eq!(reply["error"]["code"], METHOD_NOT_FOUND);
    }

    #[test]
    fn an_unknown_method_is_reported_and_the_stream_survives() {
        let (_dir, mut s) = session();
        let reply = handle(&mut s, "resources/list", json!({}), json!(5)).unwrap();
        assert_eq!(reply["error"]["code"], METHOD_NOT_FOUND);
    }
}
