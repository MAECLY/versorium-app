//! MCP method dispatch.
//!
//! The wire shapes here were confirmed empirically, not guessed: a throwaway
//! logging server registered in a scratch project captured Claude Code 2.1.283
//! opening with `initialize` at protocol `2025-11-25`, then
//! `notifications/initialized`, `tools/list`, and a `tools/call` that completed.
//! Revision `2026-07-28` drops the handshake in favour of `server/discover`, so
//! both eras are answered — installed clients span them.

use super::server::{error_response, result_response, INVALID_PARAMS, METHOD_NOT_FOUND};
use super::session::{Era, Session};
use super::{log, tools};
use serde_json::{json, Value};

/// Newest first. `2025-03-26` is deliberately absent: it is the one revision
/// that requires receivers to accept JSON-RPC batch arrays, which the transport
/// rejects — advertising it would be a promise we do not keep.
pub const SUPPORTED: [&str; 4] = ["2026-07-28", "2025-11-25", "2025-06-18", "2024-11-05"];

/// Preferred legacy answer when a client asks for a revision we do not speak.
const LEGACY_PREFERRED: &str = "2025-11-25";
const SERVER_NAME: &str = "versorium";
const PROTOCOL_META: &str = "io.modelcontextprotocol/protocolVersion";
const SERVER_INFO_META: &str = "io.modelcontextprotocol/serverInfo";
/// `UnsupportedProtocolVersionError`.
const UNSUPPORTED_VERSION: i64 = -32022;

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

/// The tool list is fixed at compile time, but it is described per client (the
/// write grant changes nothing in the list itself), so it is safe to cache
/// privately for a short while.
fn cacheable(mut result: Value) -> Value {
    result["ttlMs"] = json!(300_000);
    result["cacheScope"] = json!("private");
    result
}

/// Modern results must declare `resultType`; legacy ones have no such field and
/// would be answering a client that has never heard of it.
fn for_era(era: Option<Era>, mut result: Value) -> Value {
    if era == Some(Era::Modern) {
        result["resultType"] = json!("complete");
        result["_meta"] = json!({ SERVER_INFO_META: server_info() });
    }
    result
}

/// Modern requests carry their protocol version in `_meta`; that is also how a
/// dual-era server tells the eras apart, since legacy never sends it.
fn modern_version(params: &Value) -> Option<&str> {
    params.get("_meta")?.get(PROTOCOL_META)?.as_str()
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

/// Latch and return the era a request belongs to. Modern requests announce
/// themselves in `_meta`; anything else inherits whatever the client opened
/// with, which for a legacy client is the `initialize` it already sent.
fn era_of(session: &mut Session, params: &Value) -> Option<Era> {
    if modern_version(params).is_some() {
        return Some(session.latch_era(Era::Modern));
    }
    session.era()
}

/// A modern client naming a revision we do not speak gets the error the spec
/// defines for exactly that, listing what we do support.
fn unsupported_version(params: &Value, id: &Value) -> Option<Value> {
    let asked = modern_version(params)?;
    if SUPPORTED.contains(&asked) {
        return None;
    }
    Some(error_response(
        id.clone(),
        UNSUPPORTED_VERSION,
        "Unsupported protocol version",
        Some(json!({ "supported": SUPPORTED, "requested": asked })),
    ))
}

pub fn handle(session: &mut Session, method: &str, params: Value, id: Value) -> Option<Value> {
    match method {
        // The handshake is what marks a client as legacy.
        "initialize" => {
            session.latch_era(Era::Legacy);
            let asked = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or(LEGACY_PREFERRED);
            // Legacy negotiation answers a version we DO speak rather than an
            // error; the client then decides whether it can live with it.
            let agreed = if SUPPORTED.contains(&asked) { asked } else { LEGACY_PREFERRED };
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
        // Modern discovery replaced the handshake in 2026-07-28. Legacy clients
        // never send it, so answering it is the era-detection front door.
        "server/discover" => {
            session.latch_era(Era::Modern);
            Some(result_response(
                id,
                for_era(
                    Some(Era::Modern),
                    cacheable(json!({
                        "supportedVersions": SUPPORTED,
                        "capabilities": capabilities(),
                        "instructions": instructions(session),
                    })),
                ),
            ))
        }
        // Removed in 2026-07-28; still answered for legacy clients.
        "ping" => Some(result_response(id, json!({}))),
        "tools/list" => {
            let era = era_of(session, &params);
            Some(result_response(
                id,
                match era {
                    Some(Era::Modern) => for_era(era, cacheable(json!({ "tools": tool_entries() }))),
                    _ => json!({ "tools": tool_entries() }),
                },
            ))
        }
        "tools/call" => {
            let era = era_of(session, &params);
            if let Some(reply) = unsupported_version(&params, &id) {
                return Some(reply);
            }
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or_default();
            if name.is_empty() {
                return Some(error_response(id, INVALID_PARAMS, "Missing tool name", None));
            }
            // Finding the tool failed, so this is a protocol error rather than a
            // tool that ran and failed.
            if tools::find(name).is_none() {
                log::append(
                    &session.log_path(),
                    &log::entry(session.client(), name, "read", "error", "unknown tool".into()),
                );
                return Some(error_response(
                    id,
                    INVALID_PARAMS,
                    &format!("Unknown tool: {name}"),
                    None,
                ));
            }
            let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            Some(result_response(
                id,
                for_era(era, match tools::call(session, name, &arguments) {
                    Ok(output) => {
                        // The text already carries the same JSON, so a client
                        // that ignores structuredContent loses nothing.
                        let mut result = json!({ "content": [{ "type": "text", "text": output.text }] });
                        if let Some(structured) = output.structured {
                            result["structuredContent"] = structured;
                        }
                        result
                    }
                    Err(code) => tool_failure(&code),
                }),
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

    /// A real project on disk so list-shaped tools have something to return.
    fn fixture_project(dir: &tempfile::TempDir) -> std::path::PathBuf {
        let project = crate::commands::project::create_project(
            crate::commands::project::CreateProjectArgs {
                path: dir.path().to_path_buf(),
                title: "Dispatch Fixture".into(),
                language: "es".into(),
            },
        )
        .unwrap();
        let root = std::path::PathBuf::from(&project.path);
        let chapter = root.join(&project.chapters[0].file);
        let body = std::fs::read_to_string(&chapter).unwrap();
        std::fs::write(&chapter, format!("{body}El invierno fue largo.")).unwrap();
        root
    }

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

    /// `_meta` as a modern client actually sends it.
    fn modern(mut params: Value, version: &str) -> Value {
        params["_meta"] = json!({
            "io.modelcontextprotocol/protocolVersion": version,
            "io.modelcontextprotocol/clientCapabilities": {},
        });
        params
    }

    #[test]
    fn modern_clients_get_discovery_instead_of_a_handshake() {
        let (_dir, mut s) = session();
        let reply = handle(&mut s, "server/discover", modern(json!({}), "2026-07-28"), json!(1)).unwrap();
        let result = &reply["result"];
        // Field names the modern schema fixes: supportedVersions, not
        // "supported"; serverInfo lives in _meta, not at the top level.
        assert_eq!(result["supportedVersions"][0], "2026-07-28");
        assert_eq!(result["resultType"], "complete");
        assert_eq!(result["_meta"]["io.modelcontextprotocol/serverInfo"]["name"], "versorium");
        assert!(result.get("serverInfo").is_none());
        assert!(result["ttlMs"].is_number());
        assert_eq!(result["cacheScope"], "private");
    }

    #[test]
    fn we_never_advertise_a_revision_we_cannot_serve() {
        // 2025-03-26 is the only revision requiring JSON-RPC batch support, and
        // the transport rejects batch arrays.
        assert!(!SUPPORTED.contains(&"2025-03-26"));
    }

    #[test]
    fn a_legacy_result_carries_no_modern_fields() {
        let (_dir, mut s) = session();
        handle(&mut s, "initialize", real_initialize(), json!(0));
        let reply = handle(&mut s, "tools/list", json!(null), json!(1)).unwrap();
        let result = &reply["result"];
        assert!(result["tools"].is_array());
        // A 2025-11-25 client has never heard of these.
        assert!(result.get("resultType").is_none());
        assert!(result.get("ttlMs").is_none());
        assert!(result.get("_meta").is_none());
    }

    #[test]
    fn a_modern_tool_call_declares_its_result_type_but_is_not_cacheable() {
        let (_dir, mut s) = session();
        let reply = handle(
            &mut s,
            "tools/call",
            modern(json!({ "name": "get_app_state" }), "2026-07-28"),
            json!(2),
        )
        .unwrap();
        let result = &reply["result"];
        assert_eq!(result["resultType"], "complete");
        // Only list-shaped results carry caching hints.
        assert!(result.get("ttlMs").is_none());
    }

    #[test]
    fn a_modern_client_asking_for_an_unknown_revision_is_told_what_we_speak() {
        let (_dir, mut s) = session();
        let reply = handle(
            &mut s,
            "tools/call",
            modern(json!({ "name": "get_app_state" }), "1900-01-01"),
            json!(3),
        )
        .unwrap();
        assert_eq!(reply["error"]["code"], UNSUPPORTED_VERSION);
        assert_eq!(reply["error"]["data"]["requested"], "1900-01-01");
        assert_eq!(reply["error"]["data"]["supported"][0], "2026-07-28");
    }

    #[test]
    fn the_era_a_client_opened_with_survives_the_stream() {
        let (_dir, mut s) = session();
        handle(&mut s, "initialize", real_initialize(), json!(0));
        // A stray _meta later must not silently promote a legacy client.
        handle(&mut s, "tools/list", modern(json!({}), "2026-07-28"), json!(1));
        assert_eq!(s.era(), Some(Era::Legacy));
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
    fn every_structured_result_is_an_object() {
        // Claude Code rejects a bare array here with `expected: "record"`, so a
        // list-shaped tool must still hand back an object.
        let (_dir, mut s) = session();
        s.open(&fixture_project(&_dir)).unwrap();
        for (tool, args) in [
            ("list_projects", json!({})),
            ("list_documents", json!({})),
            ("search", json!({ "query": "invierno" })),
            ("git_log", json!({})),
            ("codex_search", json!({})),
            ("get_app_state", json!({})),
        ] {
            let reply = handle(&mut s, "tools/call", json!({ "name": tool, "arguments": args }), json!(1)).unwrap();
            let result = &reply["result"];
            if let Some(structured) = result.get("structuredContent") {
                assert!(structured.is_object(), "{tool} returned a non-object structuredContent");
            }
        }
    }

    #[test]
    fn a_structured_result_is_also_offered_as_text() {
        let (_dir, mut s) = session();
        let reply = handle(&mut s, "tools/call", json!({ "name": "get_app_state" }), json!(6)).unwrap();
        let result = &reply["result"];
        let text = result["content"][0]["text"].as_str().unwrap();
        // Both views must agree, so a client may use either.
        assert_eq!(
            serde_json::from_str::<Value>(text).unwrap(),
            result["structuredContent"],
        );
        assert_eq!(result["structuredContent"]["client"], "claude-code");
    }

    #[test]
    fn an_unadvertised_tool_is_a_protocol_error() {
        let (_dir, mut s) = session();
        // Failing to FIND a tool is a protocol error (-32602), distinct from
        // -32601 which means the method itself does not exist.
        let reply = handle(&mut s, "tools/call", json!({ "name": "rm_rf" }), json!(4)).unwrap();
        assert_eq!(reply["error"]["code"], INVALID_PARAMS);
    }

    #[test]
    fn an_unknown_method_is_reported_and_the_stream_survives() {
        let (_dir, mut s) = session();
        let reply = handle(&mut s, "resources/list", json!({}), json!(5)).unwrap();
        assert_eq!(reply["error"]["code"], METHOD_NOT_FOUND);
    }
}
