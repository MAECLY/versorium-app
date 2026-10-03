//! JSON-RPC transport for the stdio MCP server.
//!
//! Framing rules the spec makes non-negotiable for stdio:
//!   * one JSON-RPC message per line, and a message MUST NOT contain an
//!     embedded newline — so everything is serialized compact, never pretty;
//!   * stdout carries MCP messages and nothing else. Diagnostics go to stderr,
//!     which the client may ignore;
//!   * EOF on stdin is the primary graceful-shutdown signal: exit promptly.
//!
//! Method dispatch lives in `dispatch`, which this layer calls per line.

use serde_json::{json, Value};
use std::io::{BufRead, Write};

/// JSON-RPC 2.0 codes MCP uses.
pub const PARSE_ERROR: i64 = -32700;
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;

pub fn error_response(id: Value, code: i64, message: &str, data: Option<Value>) -> Value {
    let mut error = json!({ "code": code, "message": message });
    if let Some(data) = data {
        error["data"] = data;
    }
    json!({ "jsonrpc": "2.0", "id": id, "error": error })
}

pub fn result_response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// What the transport should do with one decoded line.
enum Handled {
    /// Write this message back.
    Reply(Value),
    /// A notification, or a response we owe nothing for.
    Silent,
}

fn handle_line(line: &str, dispatch: &mut dyn FnMut(&str, Value, Value) -> Option<Value>) -> Handled {
    let parsed: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        // No id is recoverable from unparseable input, so it is reported as null.
        Err(_) => return Handled::Reply(error_response(Value::Null, PARSE_ERROR, "Parse error", None)),
    };

    // Batches were mandatory only in 2025-03-26, which this server does not
    // advertise; a top-level array is therefore an invalid request.
    let Some(object) = parsed.as_object() else {
        return Handled::Reply(error_response(Value::Null, INVALID_REQUEST, "Invalid Request", None));
    };

    // A response from the client (has result/error) is not ours to answer.
    if object.contains_key("result") || object.contains_key("error") {
        return Handled::Silent;
    }

    let Some(method) = object.get("method").and_then(|m| m.as_str()) else {
        let id = object.get("id").cloned().unwrap_or(Value::Null);
        return Handled::Reply(error_response(id, INVALID_REQUEST, "Invalid Request", None));
    };
    let params = object.get("params").cloned().unwrap_or(Value::Null);
    // Absent id means notification: the spec forbids replying to one at all.
    let is_notification = !object.contains_key("id");
    let id = object.get("id").cloned().unwrap_or(Value::Null);

    match dispatch(method, params, id) {
        Some(_) if is_notification => Handled::Silent,
        Some(message) => Handled::Reply(message),
        None => Handled::Silent,
    }
}

/// Read lines until EOF. `dispatch` returns the message to send, or `None` for
/// notifications it absorbed.
/// Handle exactly one JSON-RPC message.
///
/// `Some` is the reply to send, `None` means the message was a notification or a
/// response — nothing is owed. Exists so the HTTP transport reuses the same
/// parse and error rules as stdio rather than growing its own.
pub fn handle_one(
    text: &str,
    dispatch: &mut dyn FnMut(&str, Value, Value) -> Option<Value>,
) -> Option<Value> {
    match handle_line(text, dispatch) {
        Handled::Reply(message) => Some(message),
        Handled::Silent => None,
    }
}

pub fn serve_with<R, W, F>(input: R, mut output: W, mut dispatch: F) -> i32
where
    R: BufRead,
    W: Write,
    F: FnMut(&str, Value, Value) -> Option<Value>,
{
    for line in input.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        if let Handled::Reply(message) = handle_line(&line, &mut dispatch) {
            // to_string, never to_string_pretty: a newline inside the frame
            // would split one message into two.
            let Ok(encoded) = serde_json::to_string(&message) else { continue };
            if writeln!(output, "{encoded}").is_err() || output.flush().is_err() {
                return 1;
            }
        }
    }
    0
}

pub fn serve(options: super::CliOptions, input: impl BufRead, output: impl Write) -> i32 {
    let mut session = super::session::Session::new(
        options.client,
        match crate::paths::settings_path() {
            Ok(path) => path,
            Err(_) => {
                eprintln!("versorium: cannot locate the settings file");
                return 1;
            }
        },
    );
    serve_with(input, output, |method, params, id| {
        super::dispatch::handle(&mut session, method, params, id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Echoes the method name so the transport's own behaviour is what is tested.
    fn echo(method: &str, _params: Value, id: Value) -> Option<Value> {
        if method == "swallow" {
            return None;
        }
        Some(result_response(id, json!({ "method": method })))
    }

    fn run(input: &str) -> Vec<Value> {
        let mut out = Vec::new();
        assert_eq!(serve_with(Cursor::new(input), &mut out, echo), 0);
        String::from_utf8(out)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    #[test]
    fn one_message_per_line_and_never_pretty_printed() {
        let mut out = Vec::new();
        serve_with(
            Cursor::new(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#),
            &mut out,
            |_, _, id| Some(result_response(id, json!({ "nested": { "a": [1, 2] } }))),
        );
        let text = String::from_utf8(out).unwrap();
        assert_eq!(text.lines().count(), 1, "a frame must not contain a newline");
        assert!(text.ends_with('\n'));
        assert!(!text.contains("\n  "));
    }

    #[test]
    fn eof_ends_the_loop_cleanly() {
        assert_eq!(serve_with(Cursor::new(""), &mut Vec::new(), echo), 0);
    }

    #[test]
    fn unparseable_input_is_reported_without_an_id() {
        let replies = run("not json\n");
        assert_eq!(replies[0]["error"]["code"], PARSE_ERROR);
        assert_eq!(replies[0]["id"], Value::Null);
        assert_eq!(replies[0]["jsonrpc"], "2.0");
    }

    #[test]
    fn a_notification_is_never_answered() {
        // No "id" key at all: the spec forbids a reply even on error.
        let replies = run("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n");
        assert!(replies.is_empty());
    }

    #[test]
    fn a_client_response_is_ignored_rather_than_answered() {
        let replies = run("{\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{}}\n");
        assert!(replies.is_empty());
    }

    #[test]
    fn a_batch_array_is_an_invalid_request() {
        // Batching was mandatory only in 2025-03-26, which we do not advertise.
        let replies = run("[{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}]\n");
        assert_eq!(replies[0]["error"]["code"], INVALID_REQUEST);
    }

    #[test]
    fn blank_lines_are_skipped_and_the_stream_continues() {
        let replies = run("\n\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"a\"}\n\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"b\"}\n");
        assert_eq!(replies.len(), 2);
        assert_eq!(replies[0]["result"]["method"], "a");
        assert_eq!(replies[1]["result"]["method"], "b");
    }

    #[test]
    fn a_swallowed_method_produces_no_frame() {
        let replies = run("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"swallow\"}\n");
        assert!(replies.is_empty());
    }
}
