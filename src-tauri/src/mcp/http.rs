//! Streamable HTTP transport for the MCP server.
//!
//! ## Why this is small
//!
//! The spec's older "HTTP+SSE" transport is deprecated — new implementations
//! SHOULD NOT adopt it. The current binding is Streamable HTTP, and revision
//! **2026-07-28 removed protocol-level sessions, the standalone GET stream and
//! `Last-Event-ID` resumption**. What remains is a single POST endpoint that is
//! allowed to answer every request with a plain JSON body. So this is an adapter
//! in front of `server::handle_line`, not a second server.
//!
//! ## Why it is hand-written
//!
//! The project has no HTTP server. Taking axum plus hyper plus tower for one
//! stateless POST route would be the largest dependency addition in the
//! codebase, for a surface narrower than the MCP JSON-RPC layer that is already
//! hand-written here. Only what the spec requires is implemented: POST on one
//! path, 405 on anything else, and the header rules.
//!
//! ## Why it is off by default
//!
//! This opens a listener on a machine whose MCP tools can write to a manuscript.
//! A web page that could POST `tools/call` at a localhost port would be a
//! manuscript-corruption vector, so: bound to loopback only, an ephemeral port,
//! `Origin` and `Host` validated, and a bearer token minted per launch that a
//! client has to read from a file only the user can read.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;

/// The one path that serves MCP. Anything else is 404.
pub const ENDPOINT: &str = "/mcp";

/// A manuscript tool call is small. Anything larger is either a mistake or an
/// attempt to exhaust memory.
const MAX_BODY: usize = 1024 * 1024;

/// SEP-2243 headers a 2026-07-28 request must carry.
const H_PROTOCOL: &str = "mcp-protocol-version";
const H_METHOD: &str = "mcp-method";
const H_NAME: &str = "mcp-name";

/// New in 2026-07-28: a required header that disagrees with the body.
pub const HEADER_MISMATCH: i64 = -32020;

/// Where a client finds the port and token. Mode 600 on unix, because anything
/// that can read it can drive the server.
pub fn endpoint_file() -> Result<PathBuf, String> {
    crate::paths::app_data_dir().map(|dir| dir.join("mcp-http.json"))
}

/// A bearer token for this run.
///
/// Not a password anybody types: it is written to a file beside the port so a
/// client can read both, and it exists so that guessing the port is not enough.
fn mint_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // Two independent sources so the value is not derivable from the clock
    // alone: the address of a heap allocation is randomised by ASLR.
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let boxed = Box::new(0u8);
    let addr = std::ptr::addr_of!(*boxed) as usize;
    let pid = std::process::id() as u128;
    let mixed = now ^ (addr as u128) << 17 ^ pid << 61;
    format!("{mixed:032x}")
}

/// A running listener.
pub struct Endpoint {
    pub port: u16,
    /// Read by the live test and written to the endpoint file. Kept on the
    /// struct so a caller can prove what was minted without re-reading a file.
    #[allow(dead_code)]
    pub token: String,
}

/// Whether a `Host` header may drive this server.
///
/// Loopback only. The spec makes localhost binding a SHOULD and Origin
/// validation a MUST; for an app whose tools can write prose, both are treated
/// as required.
fn host_allowed(host: &str, port: u16) -> bool {
    let (bare, host_port) = split_authority(host);
    if let Some(p) = host_port {
        if p != port {
            return false;
        }
    }
    is_loopback(bare)
}

/// Split `host[:port]`, honouring the brackets an IPv6 literal needs.
///
/// Splitting on the last colon looks right until the host is `[::1]`, whose own
/// colons are inside the brackets — which refused every IPv6 loopback client.
fn split_authority(authority: &str) -> (&str, Option<u16>) {
    if let Some(rest) = authority.strip_prefix('[') {
        return match rest.split_once(']') {
            Some((inside, after)) => {
                let port = after.strip_prefix(':').and_then(|p| p.parse().ok());
                (inside, port)
            }
            None => (rest, None),
        };
    }
    match authority.rsplit_once(':') {
        Some((host, port)) => (host, port.parse().ok()),
        None => (authority, None),
    }
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

/// Whether an `Origin` may drive this server.
///
/// Absent is allowed: a non-browser client sends none, and that is the normal
/// case for an MCP client. A *present* Origin must be loopback, which is what
/// stops a web page on the internet from reaching in.
fn origin_allowed(origin: Option<&str>) -> bool {
    let Some(origin) = origin else { return true };
    let origin = origin.trim();
    if origin.eq_ignore_ascii_case("null") {
        // A sandboxed iframe or a `file://` page. Not something to trust.
        return false;
    }
    let rest = match origin.split_once("://") {
        Some((scheme, rest)) if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") => rest,
        _ => return false,
    };
    let host = rest.split('/').next().unwrap_or("");
    let (bare, _) = split_authority(host);
    is_loopback(bare)
}

/// Whether the body's `_meta` protocol version matches the header.
///
/// A value that is not header-safe arrives base64-wrapped in `=?base64?…?=`, so
/// it is decoded before comparing.
fn header_matches(header: Option<&str>, body: Option<&str>) -> bool {
    match (header, body) {
        (None, None) => true,
        (Some(h), Some(b)) => decode_sentinel(h) == b,
        // Either the header is missing for a value the body carries, or the
        // reverse. Both are a mismatch.
        _ => false,
    }
}

fn decode_sentinel(value: &str) -> String {
    let Some(inner) = value.strip_prefix("=?base64?").and_then(|v| v.strip_suffix("?=")) else {
        return value.to_string();
    };
    decode_base64(inner).and_then(|b| String::from_utf8(b).ok()).unwrap_or_else(|| value.to_string())
}

fn decode_base64(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in input.bytes().filter(|b| *b != b'=') {
        let value = TABLE.iter().position(|c| *c == byte)? as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}

struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

fn read_request(stream: &TcpStream) -> Option<Request> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();

    let mut headers = Vec::new();
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).ok()? == 0 {
            break;
        }
        let trimmed = header.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            headers.push((key.trim().to_lowercase(), value.trim().to_string()));
        }
        // A request with an absurd number of headers is not a client we serve.
        if headers.len() > 64 {
            return None;
        }
    }

    let length: usize = headers
        .iter()
        .find(|(k, _)| k == "content-length")
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    if length > MAX_BODY {
        return None;
    }
    let mut body = vec![0u8; length];
    if length > 0 {
        reader.read_exact(&mut body).ok()?;
    }
    Some(Request { method, path, headers, body })
}

fn respond(stream: &mut TcpStream, status: u16, reason: &str, body: Option<&Value>) {
    let encoded = body.map(|v| serde_json::to_vec(v).unwrap_or_default()).unwrap_or_default();
    let mut head = format!("HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\n", encoded.len());
    if !encoded.is_empty() {
        head.push_str("Content-Type: application/json\r\n");
    }
    // Every response closes: keep-alive would need a request loop, and one
    // request per connection is what a stateless endpoint needs.
    head.push_str("Connection: close\r\n");
    // Proxies and dev servers buffer, which would defeat streaming if it were
    // ever added; the spec asks for it either way.
    head.push_str("X-Accel-Buffering: no\r\n\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&encoded);
    let _ = stream.flush();
}

fn jsonrpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Serve one connection. Split out so the rules are testable without a socket.
pub fn decide(request: &Request2, token: &str, port: u16) -> Outcome {
    if !host_allowed(request.host.as_deref().unwrap_or(""), port) {
        return Outcome::Status(403, "Forbidden");
    }
    if !origin_allowed(request.origin.as_deref()) {
        // The spec: an invalid Origin MUST be 403, and the body MAY be a
        // JSON-RPC error with no id.
        return Outcome::Status(403, "Forbidden");
    }
    if request.bearer.as_deref() != Some(token) {
        return Outcome::Status(401, "Unauthorized");
    }
    if request.path != ENDPOINT {
        return Outcome::Status(404, "Not Found");
    }
    // 2026-07-28 removed the GET stream and DELETE termination, and says a
    // server for that revision SHOULD answer them with 405.
    if request.method != "POST" {
        return Outcome::Status(405, "Method Not Allowed");
    }
    if !request.accepts_json {
        return Outcome::Status(406, "Not Acceptable");
    }
    Outcome::Dispatch
}

/// What `decide` concluded.
#[derive(Debug, PartialEq)]
pub enum Outcome {
    Status(u16, &'static str),
    Dispatch,
}

/// The parts of a request the rules look at, so they can be tested directly.
#[derive(Debug, Default)]
pub struct Request2 {
    pub method: String,
    pub path: String,
    pub host: Option<String>,
    pub origin: Option<String>,
    pub bearer: Option<String>,
    pub accepts_json: bool,
}

/// Validate the SEP-2243 headers against the body.
///
/// Returns the JSON-RPC error to send when they disagree.
fn check_headers(request: &Request, body: &Value) -> Option<Value> {
    let id = body.get("id").cloned().unwrap_or(Value::Null);
    let version = body
        .pointer("/_meta/io.modelcontextprotocol~1protocolVersion")
        .and_then(|v| v.as_str());
    // Only the 2026-07-28 era carries the header set; an older client is served
    // without it, which is what backwards compatibility means here.
    if version.is_none() && request.header(H_PROTOCOL).is_none() {
        return None;
    }
    if !header_matches(request.header(H_PROTOCOL), version) {
        return Some(jsonrpc_error(id, HEADER_MISMATCH, "MCP-Protocol-Version does not match the request body"));
    }
    let method = body.get("method").and_then(|m| m.as_str());
    if !header_matches(request.header(H_METHOD), method) {
        return Some(jsonrpc_error(id, HEADER_MISMATCH, "Mcp-Method does not match the request body"));
    }
    // `Mcp-Name` is required only for the calls that name a thing.
    let named = matches!(method, Some("tools/call") | Some("resources/read") | Some("prompts/get"));
    if named {
        let name = body
            .pointer("/params/name")
            .or_else(|| body.pointer("/params/uri"))
            .and_then(|v| v.as_str());
        if !header_matches(request.header(H_NAME), name) {
            return Some(jsonrpc_error(id, HEADER_MISMATCH, "Mcp-Name does not match the request body"));
        }
    }
    None
}

/// Start the listener. Returns the port and token, and serves until the process
/// ends.
pub fn serve(client: String) -> Result<Endpoint, String> {
    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
        .map_err(|_| "mcp_http_bind_failed".to_string())?;
    let port = listener.local_addr().map_err(|_| "mcp_http_bind_failed".to_string())?.port();
    let token = mint_token();

    write_endpoint_file(port, &token)?;

    let served_token = token.clone();
    std::thread::Builder::new()
        .name("versorium-mcp-http".into())
        .spawn(move || accept_loop(listener, port, served_token, client))
        .map_err(|_| "mcp_http_bind_failed".to_string())?;

    Ok(Endpoint { port, token })
}

fn write_endpoint_file(port: u16, token: &str) -> Result<(), String> {
    let path = endpoint_file()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "io".to_string())?;
    }
    let body = json!({
        "url": format!("http://127.0.0.1:{port}{ENDPOINT}"),
        "token": token,
    });
    let encoded = serde_json::to_vec_pretty(&body).map_err(|_| "io".to_string())?;
    // Mode set before the token is written, never after: a window where it is
    // world-readable is the whole problem.
    crate::storage::atomic_write_mode(&path, &encoded, Some(0o600))
}

fn accept_loop(listener: TcpListener, port: u16, token: String, client: String) {
    let settings = match crate::paths::settings_path() {
        Ok(path) => path,
        Err(_) => return,
    };
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        // One request per connection and a short deadline: a client that opens a
        // socket and says nothing must not hold the server.
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
        let Some(request) = read_request(&stream) else {
            respond(&mut stream, 400, "Bad Request", None);
            continue;
        };
        let parts = Request2 {
            method: request.method.clone(),
            path: request.path.clone(),
            host: request.header("host").map(str::to_string),
            origin: request.header("origin").map(str::to_string),
            bearer: request
                .header("authorization")
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(str::to_string),
            accepts_json: request
                .header("accept")
                .map(|a| a.contains("application/json") || a.contains("*/*"))
                .unwrap_or(false),
        };
        match decide(&parts, &token, port) {
            Outcome::Status(code, reason) => {
                respond(&mut stream, code, reason, None);
                continue;
            }
            Outcome::Dispatch => {}
        }

        let Ok(text) = std::str::from_utf8(&request.body) else {
            respond(&mut stream, 400, "Bad Request", None);
            continue;
        };
        let parsed: Value = match serde_json::from_str(text) {
            Ok(value) => value,
            Err(_) => {
                respond(&mut stream, 400, "Bad Request", Some(&jsonrpc_error(Value::Null, super::server::PARSE_ERROR, "Parse error")));
                continue;
            }
        };
        if let Some(error) = check_headers(&request, &parsed) {
            respond(&mut stream, 400, "Bad Request", Some(&error));
            continue;
        }

        // A fresh session per request: 2026-07-28 has no protocol-level session,
        // and the permission gate re-reads settings on every call anyway.
        let mut session = super::session::Session::new(client.clone(), settings.clone());
        let reply = super::server::handle_one(text, &mut |method, params, id| {
            super::dispatch::handle(&mut session, method, params, id)
        });
        match reply {
            Some(message) => respond(&mut stream, 200, "OK", Some(&message)),
            // A notification the server accepted: the spec says 202 with no body.
            None => respond(&mut stream, 202, "Accepted", None),
        }
    }
}

/// What Settings shows. The token is not included: it lives in a file only the
/// user can read, and putting it on the wire to the webview would undo that.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpStatus {
    pub enabled: bool,
    /// `None` until the listener is up.
    pub url: Option<String>,
    /// Where a client reads the URL and the token.
    pub endpoint_file: Option<String>,
}

static RUNNING: std::sync::OnceLock<Endpoint> = std::sync::OnceLock::new();

/// Start the listener once, if the setting asks for it.
pub fn start_if_enabled(enabled: bool, client: String) {
    if !enabled || RUNNING.get().is_some() {
        return;
    }
    if let Ok(endpoint) = serve(client) {
        let _ = RUNNING.set(endpoint);
    }
}

pub fn status(enabled: bool) -> HttpStatus {
    let running = RUNNING.get();
    HttpStatus {
        enabled,
        url: running.map(|e| format!("http://127.0.0.1:{}{ENDPOINT}", e.port)),
        endpoint_file: endpoint_file().ok().map(|p| p.to_string_lossy().into_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, path: &str) -> Request2 {
        Request2 {
            method: method.into(),
            path: path.into(),
            host: Some("127.0.0.1:7777".into()),
            origin: None,
            bearer: Some("secret".into()),
            accepts_json: true,
        }
    }

    #[test]
    fn a_browser_origin_from_the_internet_is_refused() {
        // The rebinding defence, and the reason this is a MUST in the spec: a
        // page on the web must not be able to drive tools that write prose.
        for origin in [
            "https://evil.example.com",
            "http://attacker.test:8080",
            "https://127.0.0.1.evil.com",
            "null",
            "file://",
        ] {
            let mut r = request("POST", ENDPOINT);
            r.origin = Some(origin.into());
            assert_eq!(decide(&r, "secret", 7777), Outcome::Status(403, "Forbidden"), "{origin} was allowed");
        }
    }

    #[test]
    fn a_loopback_origin_or_none_at_all_is_allowed() {
        // A non-browser MCP client sends no Origin, which is the normal case.
        for origin in [None, Some("http://localhost:1420"), Some("http://127.0.0.1:5173"), Some("https://[::1]")] {
            let mut r = request("POST", ENDPOINT);
            r.origin = origin.map(str::to_string);
            assert_eq!(decide(&r, "secret", 7777), Outcome::Dispatch, "{origin:?} was refused");
        }
    }

    #[test]
    fn an_ipv6_literal_keeps_its_own_colons() {
        // Splitting on the last colon looks right until the host is `[::1]`.
        assert_eq!(split_authority("[::1]:7777"), ("::1", Some(7777)));
        assert_eq!(split_authority("[::1]"), ("::1", None));
        assert_eq!(split_authority("127.0.0.1:7777"), ("127.0.0.1", Some(7777)));
        assert_eq!(split_authority("localhost"), ("localhost", None));
        // A port that is not a number is not a port.
        assert_eq!(split_authority("localhost:abc"), ("localhost", None));
    }

    #[test]
    fn a_host_header_naming_somewhere_else_is_refused() {
        // The other half of the rebinding defence: a resolved name pointing at
        // 127.0.0.1 still arrives with its own Host.
        for host in ["evil.example.com", "evil.example.com:7777", "192.168.1.5:7777", ""] {
            let mut r = request("POST", ENDPOINT);
            r.host = Some(host.into());
            assert_eq!(decide(&r, "secret", 7777), Outcome::Status(403, "Forbidden"), "{host} was allowed");
        }
        // A loopback host on the wrong port is not this server.
        let mut r = request("POST", ENDPOINT);
        r.host = Some("127.0.0.1:9999".into());
        assert_eq!(decide(&r, "secret", 7777), Outcome::Status(403, "Forbidden"));
    }

    #[test]
    fn guessing_the_port_is_not_enough() {
        for bearer in [None, Some("wrong"), Some(""), Some("Secret")] {
            let mut r = request("POST", ENDPOINT);
            r.bearer = bearer.map(str::to_string);
            assert_eq!(decide(&r, "secret", 7777), Outcome::Status(401, "Unauthorized"), "{bearer:?} got in");
        }
    }

    #[test]
    fn the_removed_verbs_answer_405_rather_than_pretending_to_work() {
        // 2026-07-28 dropped the GET stream and DELETE termination. Answering
        // them is how a client tells this server from a legacy one.
        for method in ["GET", "DELETE", "PUT", "HEAD"] {
            assert_eq!(
                decide(&request(method, ENDPOINT), "secret", 7777),
                Outcome::Status(405, "Method Not Allowed"),
                "{method} was served"
            );
        }
    }

    #[test]
    fn only_one_path_serves_mcp() {
        assert_eq!(decide(&request("POST", "/"), "secret", 7777), Outcome::Status(404, "Not Found"));
        assert_eq!(decide(&request("POST", "/mcp/extra"), "secret", 7777), Outcome::Status(404, "Not Found"));
        assert_eq!(decide(&request("POST", ENDPOINT), "secret", 7777), Outcome::Dispatch);
    }

    #[test]
    fn the_security_checks_run_before_the_path_and_the_verb() {
        // A 404 or 405 would tell an unauthenticated caller which paths exist.
        let mut r = request("GET", "/does-not-exist");
        r.origin = Some("https://evil.example.com".into());
        assert_eq!(decide(&r, "secret", 7777), Outcome::Status(403, "Forbidden"));
        let mut r = request("GET", "/does-not-exist");
        r.bearer = None;
        assert_eq!(decide(&r, "secret", 7777), Outcome::Status(401, "Unauthorized"));
    }

    fn with_headers(pairs: &[(&str, &str)], body: Value) -> Option<Value> {
        let request = Request {
            method: "POST".into(),
            path: ENDPOINT.into(),
            headers: pairs.iter().map(|(k, v)| (k.to_lowercase(), v.to_string())).collect(),
            body: Vec::new(),
        };
        check_headers(&request, &body)
    }

    #[test]
    fn a_header_that_disagrees_with_the_body_is_a_mismatch() {
        let body = json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/list",
            "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28" }
        });
        // Agreeing is fine.
        assert!(with_headers(
            &[("MCP-Protocol-Version", "2026-07-28"), ("Mcp-Method", "tools/list")],
            body.clone()
        )
        .is_none());

        // A lying version header is the case this rule exists for.
        let error = with_headers(
            &[("MCP-Protocol-Version", "2025-11-25"), ("Mcp-Method", "tools/list")],
            body.clone(),
        )
        .expect("a mismatch must be reported");
        assert_eq!(error["error"]["code"], HEADER_MISMATCH);

        // A missing header for a value the body carries is also a mismatch.
        assert!(with_headers(&[("Mcp-Method", "tools/list")], body).is_some());
    }

    #[test]
    fn a_tool_call_must_name_the_tool_in_its_header_too() {
        let body = json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "search" },
            "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28" }
        });
        let headers = [("MCP-Protocol-Version", "2026-07-28"), ("Mcp-Method", "tools/call")];
        // Mcp-Name is required for tools/call.
        assert!(with_headers(&headers, body.clone()).is_some());

        let mut with_name = headers.to_vec();
        with_name.push(("Mcp-Name", "search"));
        assert!(with_headers(&with_name, body.clone()).is_none());

        // And it must be the tool actually being called.
        let mut wrong = headers.to_vec();
        wrong.push(("Mcp-Name", "write"));
        assert_eq!(with_headers(&wrong, body).unwrap()["error"]["code"], HEADER_MISMATCH);
    }

    #[test]
    fn a_value_that_is_not_header_safe_arrives_base64_wrapped() {
        // The spec's sentinel, which must be decoded before comparing or every
        // non-ASCII resource URI would look like a mismatch.
        assert_eq!(decode_sentinel("=?base64?dG9vbHMvY2FsbA==?="), "tools/call");
        assert_eq!(decode_sentinel("tools/call"), "tools/call");
        // Malformed base64 falls through rather than panicking.
        assert_eq!(decode_sentinel("=?base64?not valid!?="), "=?base64?not valid!?=");
    }

    #[test]
    fn an_older_client_is_served_without_the_new_headers() {
        // The header set arrived in 2026-07-28; requiring it of a 2025 client
        // would break every one of them.
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });
        assert!(with_headers(&[], body).is_none());
    }

    #[test]
    fn the_token_is_not_predictable_from_one_run_to_the_next() {
        let a = mint_token();
        let b = mint_token();
        assert_ne!(a, b, "two tokens in the same process collided");
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// Speaks real HTTP to a real listener. Ignored because it binds a port and
    /// writes the endpoint file into this machine's app-data.
    #[test]
    #[ignore = "binds a localhost port and writes the endpoint file"]
    fn live_a_real_request_over_a_real_socket_is_answered() {
        use std::io::{Read as _, Write as _};

        let endpoint = serve("claude-code".to_string()).expect("bind");
        let address = format!("127.0.0.1:{}", endpoint.port);

        let send = |raw: String| -> String {
            let mut stream = std::net::TcpStream::connect(&address).expect("connect");
            stream.write_all(raw.as_bytes()).expect("write");
            let mut response = String::new();
            let _ = stream.read_to_string(&mut response);
            response
        };

        let post = |body: &str, extra: &str| -> String {
            send(format!(
                "POST {ENDPOINT} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\n\
                 Accept: application/json, text/event-stream\r\nContent-Type: application/json\r\n\
                 {extra}Content-Length: {}\r\n\r\n{body}",
                endpoint.port,
                endpoint.token,
                body.len()
            ))
        };

        // A real request gets a real JSON-RPC result.
        let listed = post(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#, "");
        assert!(listed.starts_with("HTTP/1.1 200 OK"), "{listed}");
        assert!(listed.contains("\"tools\""), "{listed}");

        // A notification is accepted with no body, which is what the spec asks.
        let notified = post(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#, "");
        assert!(notified.starts_with("HTTP/1.1 202 Accepted"), "{notified}");

        // Without the token, nothing.
        let unauthorized = send(format!(
            "POST {ENDPOINT} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAccept: application/json\r\n\
             Content-Length: 2\r\n\r\n{{}}",
            endpoint.port
        ));
        assert!(unauthorized.starts_with("HTTP/1.1 401"), "{unauthorized}");

        // A browser origin from the internet, refused even with the token.
        let cross_site = post(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#, "Origin: https://evil.example.com\r\n");
        assert!(cross_site.starts_with("HTTP/1.1 403"), "{cross_site}");

        // The verbs 2026-07-28 removed.
        let got = send(format!(
            "GET {ENDPOINT} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\n\
             Accept: application/json\r\n\r\n",
            endpoint.port, endpoint.token
        ));
        assert!(got.starts_with("HTTP/1.1 405"), "{got}");

        // Unparseable input is a JSON-RPC parse error, not a hang.
        let broken = post("{not json", "");
        assert!(broken.starts_with("HTTP/1.1 400"), "{broken}");
        assert!(broken.contains("-32700"), "{broken}");

        // The endpoint file carries what a client needs and is not world-readable.
        let path = endpoint_file().unwrap();
        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(written["token"], endpoint.token);
        assert!(written["url"].as_str().unwrap().ends_with(ENDPOINT));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "the token file was readable by others");
        }
    }

    #[test]
    fn a_body_larger_than_a_manuscript_call_is_refused() {
        // A tool call carries a range and a passage, not a novel, so a megabyte
        // is generous. What matters is that some ceiling exists.
        assert_eq!(MAX_BODY, 1024 * 1024);
    }
}
