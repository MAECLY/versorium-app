//! Placeholder — replaced by the MCP method dispatch.

use serde_json::Value;

pub fn handle(
    _session: &mut super::session::Session,
    _method: &str,
    _params: Value,
    id: Value,
) -> Option<Value> {
    Some(super::server::error_response(
        id,
        super::server::METHOD_NOT_FOUND,
        "Method not found",
        None,
    ))
}
