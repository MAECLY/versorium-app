//! Drives the shipped binary the way an agent does: spawn `versorium mcp`,
//! speak JSON-RPC over its stdin/stdout, and read what comes back.
//!
//! Unit tests cover the dispatch logic; this covers the wiring around it —
//! argv parsing, that stdout carries nothing but MCP frames, and that the
//! read-only default survives into the real process.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

fn talk(data_dir: &std::path::Path, requests: &[Value]) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_versorium"))
        .args(["mcp", "--client", "claude-code"])
        .env(versorium_lib::paths::DATA_DIR_ENV, data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn versorium mcp");

    {
        let stdin = child.stdin.as_mut().expect("stdin");
        for request in requests {
            writeln!(stdin, "{}", serde_json::to_string(request).unwrap()).unwrap();
        }
    }
    // Closing stdin is the documented shutdown signal; the server must exit.
    drop(child.stdin.take());

    let stdout = child.stdout.take().expect("stdout");
    let replies: Vec<Value> = BufReader::new(stdout)
        .lines()
        .map_while(Result::ok)
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(&l).unwrap_or_else(|e| panic!("stdout was not an MCP frame: {l} ({e})")))
        .collect();
    let status = child.wait().expect("wait");
    assert!(status.success(), "server exited with {status}");
    replies
}

fn initialize() -> Value {
    json!({
        "jsonrpc": "2.0", "id": 0, "method": "initialize",
        "params": { "protocolVersion": "2025-11-25", "capabilities": {},
                    "clientInfo": { "name": "claude-code", "version": "2.1.283" } }
    })
}

#[test]
fn the_binary_serves_the_handshake_and_exits_on_eof() {
    let dir = tempfile::tempdir().unwrap();
    let replies = talk(dir.path(), &[initialize()]);
    assert_eq!(replies.len(), 1);
    let result = &replies[0]["result"];
    assert_eq!(result["protocolVersion"], "2025-11-25");
    assert_eq!(result["serverInfo"]["name"], "versorium");
    assert!(result["capabilities"]["tools"].is_object());
}

#[test]
fn a_notification_produces_no_frame_on_stdout() {
    let dir = tempfile::tempdir().unwrap();
    let replies = talk(
        dir.path(),
        &[
            initialize(),
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
        ],
    );
    // Exactly two: the notification is answered with silence.
    assert_eq!(replies.len(), 2);
    assert_eq!(replies[1]["id"], 1);
}

#[test]
fn the_shipped_server_is_read_only_until_granted() {
    let dir = tempfile::tempdir().unwrap();
    let replies = talk(
        dir.path(),
        &[
            initialize(),
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                    "params": { "name": "write_document",
                                "arguments": { "file": "manuscript/ch-01.md", "content": "x", "confirm": true } } }),
        ],
    );
    let call = &replies[1]["result"];
    assert_eq!(call["isError"], true);
    let text = call["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("write_not_allowed"), "got: {text}");
    // The message has to tell the model where the permission lives.
    assert!(text.contains("Settings"), "got: {text}");
    assert!(dir.path().join("mcp-log.jsonl").exists(), "the refusal is logged");
}

#[test]
fn every_advertised_tool_has_a_schema() {
    let dir = tempfile::tempdir().unwrap();
    let replies = talk(
        dir.path(),
        &[initialize(), json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" })],
    );
    let tools = replies[1]["result"]["tools"].as_array().unwrap();
    assert!(tools.len() >= 15);
    for tool in tools {
        assert_eq!(tool["inputSchema"]["type"], "object", "{}", tool["name"]);
    }
}
