//! Tool catalog and dispatch (spec §7).
//!
//! One place decides what an agent may call and what it is allowed to do:
//! every tool carries its scope, and `call` refuses a write tool before the
//! implementation is reached — no file is read and no commit is made for a
//! client that was never granted write access.

use crate::commands::chapters::{list_chapters_inner, ChapterRef};
use crate::commands::project::{self, ChapterMeta};
use crate::mcp::session::{Scope, Session};
use crate::mcp::{log, query, write};
use serde_json::{json, Map, Value};
use std::path::Path;
use std::sync::OnceLock;

/// Shared wording so every write tool documents the preview the same way.
pub const CONFIRM_DESC: &str =
    "Set true to apply the change. Omitted or false returns a diff preview and \
     changes nothing on disk.";

#[derive(Debug, Clone)]
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub scope: Scope,
    pub input_schema: Value,
    /// Removes content rather than adding to it — surfaced as an MCP annotation.
    pub destructive: bool,
}

#[derive(Debug, Clone)]
pub struct ToolOutput {
    pub text: String,
    pub structured: Option<Value>,
}

impl ToolOutput {
    pub fn text(text: impl Into<String>) -> Self {
        Self { text: text.into(), structured: None }
    }

    /// Pretty JSON as the text body, the same value as structured content, so a
    /// client that ignores `structuredContent` still sees everything.
    pub fn json(value: Value) -> Self {
        let value = as_object(value);
        let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string());
        Self { text, structured: Some(value) }
    }

    pub fn with(text: impl Into<String>, value: Value) -> Self {
        Self { text: text.into(), structured: Some(as_object(value)) }
    }
}

/// `structuredContent` must be a JSON object: 2025-11-25 documents it as one and
/// real clients reject anything else (Claude Code answers a bare array with
/// `expected: "record"`). A list-shaped result is wrapped rather than rejected,
/// and the text body is rendered from the wrapped value so both views agree.
fn as_object(value: Value) -> Value {
    if value.is_object() {
        value
    } else {
        json!({ "results": value })
    }
}

// ------------------------------------------------------------------ catalog

fn p(ty: &str, desc: &str) -> Value {
    json!({ "type": ty, "description": desc })
}

fn obj(props: Vec<(&str, Value)>, required: &[&str]) -> Value {
    let mut map = Map::new();
    for (key, schema) in props {
        map.insert(key.to_string(), schema);
    }
    json!({
        "type": "object",
        "properties": Value::Object(map),
        "required": required,
        "additionalProperties": false
    })
}

fn def(
    name: &'static str,
    description: &'static str,
    scope: Scope,
    input_schema: Value,
    destructive: bool,
) -> ToolDef {
    ToolDef { name, description, scope, input_schema, destructive }
}

fn confirm() -> (&'static str, Value) {
    ("confirm", p("boolean", CONFIRM_DESC))
}

fn build_catalog() -> Vec<ToolDef> {
    let none = || obj(vec![], &[]);
    let doc = || ("document", p("string", "Chapter file path or chapter id."));
    let file = || ("file", p("string", "Chapter file, relative to the project root."));
    let limit = || ("limit", p("integer", "Maximum entries to return."));
    let offset = |what: &'static str| p("integer", what);

    vec![
        // ---- read ----
        def("get_app_state", "Versorium version, the calling client, the open project and whether this client may write.", Scope::Read, none(), false),
        def("list_projects", "Projects found in the Versorium folder.", Scope::Read, none(), false),
        def("open_project", "Point this session at a project on disk.", Scope::Read,
            obj(vec![("path", p("string", "Absolute path to the project folder."))], &["path"]), false),
        def("list_documents", "Chapters of the open project.", Scope::Read, none(), false),
        def("read_document", "Frontmatter and body of one chapter.", Scope::Read,
            obj(vec![file()], &["file"]), false),
        def("search", "Case-insensitive search across manuscript, codex, plot, research and style.", Scope::Read,
            obj(vec![("query", p("string", "Text to look for.")), limit()], &["query"]), false),
        def("assemble_context", "The chapter, the codex entries named in it, and the project voice.", Scope::Read,
            obj(vec![("document", p("string", "Chapter file path. Omit for project-wide context only."))], &[]), false),
        def("history_list", "Recent character-level operations for a chapter.", Scope::Read,
            obj(vec![doc(), limit()], &["document"]), false),
        def("history_blame", "Who wrote each span of a chapter: the writer or an agent.", Scope::Read,
            obj(vec![doc(), limit()], &["document"]), false),
        def("diff", "Uncommitted changes in the project.", Scope::Read, none(), false),
        def("git_status", "Branch, dirty files and ahead/behind counts.", Scope::Read, none(), false),
        def("git_log", "Recent commits.", Scope::Read, obj(vec![limit()], &[]), false),
        def("get_style", "The project's voice guide (style/voice.md).", Scope::Read, none(), false),
        def("codex_search", "Codex entries, optionally filtered by text or kind.", Scope::Read,
            obj(vec![("query", p("string", "Text to look for in names and bodies.")),
                     ("kind", p("string", "characters | factions | items | locations"))], &[]), false),
        def("codex_get", "One codex entry by id.", Scope::Read,
            obj(vec![("id", p("string", "Entry slug, e.g. bruno-vela."))], &["id"]), false),
        // ---- write (refused unless Settings → MCP grants this client) ----
        def("write_document", "Replace a chapter body.", Scope::Write,
            obj(vec![file(), ("content", p("string", "New body, frontmatter excluded.")), confirm()],
                &["file", "content"]), true),
        def("insert_text", "Insert text at a UTF-16 offset in a chapter body.", Scope::Write,
            obj(vec![file(), ("at", offset("UTF-16 offset into the body.")),
                     ("text", p("string", "Text to insert.")), confirm()],
                &["file", "at", "text"]), false),
        def("delete_text", "Delete a UTF-16 range from a chapter body.", Scope::Write,
            obj(vec![file(), ("from", offset("Start UTF-16 offset.")),
                     ("to", offset("End UTF-16 offset, exclusive.")), confirm()],
                &["file", "from", "to"]), true),
        def("replace_text", "Replace a UTF-16 range in a chapter body.", Scope::Write,
            obj(vec![file(), ("from", offset("Start UTF-16 offset.")),
                     ("to", offset("End UTF-16 offset, exclusive.")),
                     ("text", p("string", "Replacement text.")), confirm()],
                &["file", "from", "to", "text"]), true),
        def("create_document", "Add a chapter to the project.", Scope::Write,
            obj(vec![("title", p("string", "Chapter title.")), confirm()], &["title"]), false),
        def("codex_upsert", "Create or replace a codex entry.", Scope::Write,
            obj(vec![("kind", p("string", "characters | factions | items | locations")),
                     ("id", p("string", "Entry slug.")),
                     ("body", p("string", "Markdown body of the entry.")), confirm()],
                &["kind", "id", "body"]), true),
        def("git_commit", "Commit the project's current changes.", Scope::Write,
            obj(vec![("message", p("string", "Commit message.")), confirm()], &["message"]), false),
        def("delete_document", "Delete a chapter file.", Scope::Write,
            obj(vec![file(), confirm(),
                     ("acknowledge_delete", p("boolean", "Must also be true: deleting a chapter is not undone by a preview."))],
                &["file"]), true),
    ]
}

fn all() -> &'static Vec<ToolDef> {
    static CATALOG: OnceLock<Vec<ToolDef>> = OnceLock::new();
    CATALOG.get_or_init(build_catalog)
}

pub fn catalog() -> Vec<ToolDef> {
    all().clone()
}

pub fn find(name: &str) -> Option<&'static ToolDef> {
    all().iter().find(|tool| tool.name == name)
}

// ------------------------------------------------------------- argument help

pub fn arg_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "bad_args".to_string())
}

pub fn arg_str_opt(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).map(str::to_string)
}

pub fn arg_usize(args: &Value, key: &str) -> Result<usize, String> {
    args.get(key)
        .and_then(Value::as_u64)
        .map(|n| n as usize)
        .ok_or_else(|| "bad_args".to_string())
}

pub fn arg_usize_or(args: &Value, key: &str, fallback: usize) -> usize {
    args.get(key).and_then(Value::as_u64).map(|n| n as usize).unwrap_or(fallback)
}

pub fn arg_bool(args: &Value, key: &str) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// Agents refer to a chapter by file path or by id; accept either.
pub fn resolve_chapter(root: &Path, document: &str) -> Result<ChapterMeta, String> {
    let chapters = list_chapters_inner(root)?;
    chapters
        .into_iter()
        .find(|c| c.file == document || c.id == document)
        .ok_or_else(|| "not_found".to_string())
}

// ---------------------------------------------------------------- dispatch

/// Run one tool, logging the attempt whatever the outcome.
pub fn call(session: &mut Session, name: &str, args: &Value) -> Result<ToolOutput, String> {
    let Some(tool) = find(name) else {
        record(session, name, "read", "error", "unknown tool".into());
        return Err("unknown_tool".into());
    };

    // Permission first: a client without a grant never reaches the file system.
    if tool.scope == Scope::Write {
        if let Err(denied) = session.require_write() {
            record(session, tool.name, tool.scope.as_str(), "denied", subject(args));
            return Err(denied);
        }
    }

    let result = if tool.scope == Scope::Write {
        write::call(session, tool, args)
    } else {
        read_call(session, tool, args)
    };

    match &result {
        Ok(out) => record(session, tool.name, tool.scope.as_str(), "ok", detail(args, out)),
        Err(code) => record(session, tool.name, tool.scope.as_str(), "error", format!("{} {code}", subject(args))),
    }
    result
}

/// Identifiers only — never the query, the body or the commit message, any of
/// which can carry manuscript prose.
fn subject(args: &Value) -> String {
    ["file", "document", "path", "id", "kind", "title"]
        .iter()
        .filter_map(|key| args.get(*key).and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" ")
}

fn detail(args: &Value, out: &ToolOutput) -> String {
    let subject = subject(args);
    let size = format!("{} chars", out.text.chars().count());
    if subject.is_empty() { size } else { format!("{subject} · {size}") }
}

fn record(session: &Session, tool: &str, scope: &str, outcome: &str, detail: String) {
    log::append(&session.log_path(), &log::entry(session.client(), tool, scope, outcome, detail));
}

fn read_call(session: &mut Session, tool: &ToolDef, args: &Value) -> Result<ToolOutput, String> {
    match tool.name {
        "get_app_state" => {
            let project = session.project().ok();
            Ok(ToolOutput::json(json!({
                "version": env!("CARGO_PKG_VERSION"),
                "client": session.client(),
                "project": project.as_ref().map(|p| p.to_string_lossy().into_owned()),
                "mayWrite": session.may_write(),
            })))
        }
        "list_projects" => {
            let dir = project::default_projects_dir()?;
            let projects = project::list_projects(dir)?;
            Ok(ToolOutput::json(serde_json::to_value(projects).map_err(|_| "io".to_string())?))
        }
        "open_project" => {
            let path = arg_str(args, "path")?;
            let root = session.open(Path::new(&path))?;
            let opened = project::open_project(root)?;
            Ok(ToolOutput::json(serde_json::to_value(opened).map_err(|_| "io".to_string())?))
        }
        "list_documents" => {
            let chapters = list_chapters_inner(&session.project()?)?;
            Ok(ToolOutput::json(serde_json::to_value(chapters).map_err(|_| "io".to_string())?))
        }
        "read_document" => {
            let root = session.project()?;
            let file = arg_str(args, "file")?;
            let doc = crate::commands::chapters::read_chapter(ChapterRef { path: root, file })?;
            let body = doc.get("body").and_then(Value::as_str).unwrap_or_default().to_string();
            Ok(ToolOutput::with(body, doc))
        }
        "search" => {
            let root = session.project()?;
            let hits = query::search(&root, &arg_str(args, "query")?, arg_usize_or(args, "limit", 50))?;
            Ok(ToolOutput::json(serde_json::to_value(hits).map_err(|_| "io".to_string())?))
        }
        "assemble_context" => {
            let root = session.project()?;
            let document = arg_str_opt(args, "document");
            let context = query::assemble_context(&root, document.as_deref())?;
            Ok(ToolOutput::json(serde_json::to_value(context).map_err(|_| "io".to_string())?))
        }
        "history_list" => {
            let root = session.project()?;
            let chapter = resolve_chapter(&root, &arg_str(args, "document")?)?;
            let ops = crate::ops::recent_ops(&root, &chapter.id, arg_usize_or(args, "limit", 100))?;
            Ok(ToolOutput::json(serde_json::to_value(ops).map_err(|_| "io".to_string())?))
        }
        "history_blame" => {
            let root = session.project()?;
            let chapter = resolve_chapter(&root, &arg_str(args, "document")?)?;
            let spans = query::history_blame(&root, &chapter.id, arg_usize_or(args, "limit", 5000))?;
            Ok(ToolOutput::json(serde_json::to_value(spans).map_err(|_| "io".to_string())?))
        }
        "diff" => Ok(ToolOutput::text(crate::git::repo::diff(&session.project()?)?)),
        "git_status" => {
            let status = crate::git::repo::status(&session.project()?)?;
            Ok(ToolOutput::json(serde_json::to_value(status).map_err(|_| "io".to_string())?))
        }
        "git_log" => {
            let commits = crate::git::repo::log(&session.project()?, arg_usize_or(args, "limit", 20))?;
            Ok(ToolOutput::json(serde_json::to_value(commits).map_err(|_| "io".to_string())?))
        }
        "get_style" => Ok(ToolOutput::text(query::get_style(&session.project()?)?)),
        "codex_search" => {
            let root = session.project()?;
            let entries = query::codex_list(&root, arg_str_opt(args, "kind").as_deref())?;
            let entries = match arg_str_opt(args, "query") {
                Some(q) => {
                    let needle = q.to_lowercase();
                    entries
                        .into_iter()
                        .filter(|e| {
                            e.name.to_lowercase().contains(&needle)
                                || e.body.to_lowercase().contains(&needle)
                        })
                        .collect()
                }
                None => entries,
            };
            Ok(ToolOutput::json(serde_json::to_value(entries).map_err(|_| "io".to_string())?))
        }
        "codex_get" => {
            let root = session.project()?;
            let entry = query::codex_get(&root, &arg_str(args, "id")?)?;
            Ok(ToolOutput::json(serde_json::to_value(entry).map_err(|_| "io".to_string())?))
        }
        _ => Err("unknown_tool".into()),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::commands::project::{create_project, CreateProjectArgs};
    use crate::commands::settings::SettingsStore;
    use std::fs;
    use std::path::PathBuf;

    pub(crate) struct Fixture {
        /// Held, not read: dropping it deletes the project the test is using.
        pub dir: tempfile::TempDir,
        pub root: PathBuf,
        pub chapter: ChapterMeta,
    }

    /// A project whose first chapter holds a sentence we can hunt for in logs.
    pub(crate) const SECRET: &str = "La aguja tembló sobre el mapa mojado.";

    pub(crate) fn fixture(client: &str, may_write: bool) -> (Fixture, Session) {
        let dir = tempfile::tempdir().unwrap();
        let project = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "Tool Fixture".into(),
            language: "es".into(),
        })
        .unwrap();
        let root = PathBuf::from(&project.path);
        let chapter = project.chapters[0].clone();
        fs::write(
            root.join(&chapter.file),
            format!("---\nid: {}\ntitle: Uno\n---\n{SECRET}", chapter.id),
        )
        .unwrap();

        let settings = dir.path().join("settings.json");
        let store = SettingsStore::load(settings.clone());
        store.update(|s| {
            s.mcp_active_project = Some(root.to_string_lossy().into_owned());
            if may_write {
                s.mcp_write_clients = vec![client.to_string()];
            }
        });
        let session = Session::new(client.into(), settings);
        (Fixture { dir, root, chapter }, session)
    }

    pub(crate) fn body_of(root: &Path, file: &str) -> String {
        let raw = fs::read_to_string(root.join(file)).unwrap();
        project::split_frontmatter(&raw).1
    }

    pub(crate) fn commit_count(root: &Path) -> usize {
        crate::git::repo::log(root, 100).map(|l| l.len()).unwrap_or(0)
    }

    #[test]
    fn catalog_entries_are_well_formed_and_uniquely_named() {
        let catalog = catalog();
        let mut names: Vec<&str> = catalog.iter().map(|t| t.name).collect();
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), total, "tool names must be unique");

        for tool in &catalog {
            assert!(!tool.description.is_empty(), "{} has no description", tool.name);
            assert_eq!(tool.input_schema["type"], "object", "{} schema", tool.name);
            let props = tool.input_schema["properties"].as_object().unwrap();
            for required in tool.input_schema["required"].as_array().unwrap() {
                let key = required.as_str().unwrap();
                assert!(props.contains_key(key), "{} requires unknown {key}", tool.name);
            }
            for (key, schema) in props {
                assert!(
                    schema.get("description").and_then(Value::as_str).is_some_and(|d| !d.is_empty()),
                    "{}.{key} has no description",
                    tool.name
                );
            }
        }
    }

    #[test]
    fn exactly_the_eight_write_tools_carry_the_write_scope() {
        let write: Vec<&str> = catalog()
            .iter()
            .filter(|t| t.scope == Scope::Write)
            .map(|t| t.name)
            .collect();
        assert_eq!(
            write,
            vec![
                "write_document", "insert_text", "delete_text", "replace_text",
                "create_document", "codex_upsert", "git_commit", "delete_document",
            ]
        );
        // Every write tool must document its preview flag.
        for tool in catalog().iter().filter(|t| t.scope == Scope::Write) {
            assert!(
                tool.input_schema["properties"].get("confirm").is_some(),
                "{} has no confirm flag",
                tool.name
            );
        }
    }

    #[test]
    fn read_tools_work_without_any_grant() {
        let (fx, mut session) = fixture("codex", false);
        assert!(!session.may_write());

        let state = call(&mut session, "get_app_state", &json!({})).unwrap();
        assert_eq!(state.structured.unwrap()["mayWrite"], false);

        let doc = call(&mut session, "read_document", &json!({ "file": fx.chapter.file })).unwrap();
        assert_eq!(doc.text, SECRET);

        // List-shaped results are wrapped: structuredContent must be an object.
        let hits = call(&mut session, "search", &json!({ "query": "aguja" })).unwrap();
        assert_eq!(hits.structured.unwrap()["results"].as_array().unwrap().len(), 1);

        let docs = call(&mut session, "list_documents", &json!({})).unwrap();
        assert_eq!(docs.structured.unwrap()["results"].as_array().unwrap().len(), 1);

        assert!(call(&mut session, "git_status", &json!({})).is_ok());
        assert!(call(&mut session, "history_list", &json!({ "document": fx.chapter.id })).is_ok());
    }

    #[test]
    fn a_chapter_resolves_by_file_or_by_id() {
        let (fx, _s) = fixture("codex", false);
        assert_eq!(resolve_chapter(&fx.root, &fx.chapter.file).unwrap().id, fx.chapter.id);
        assert_eq!(resolve_chapter(&fx.root, &fx.chapter.id).unwrap().file, fx.chapter.file);
        assert_eq!(resolve_chapter(&fx.root, "manuscript/nope.md").unwrap_err(), "not_found");
    }

    #[test]
    fn a_list_result_is_wrapped_so_structured_content_stays_an_object() {
        assert!(ToolOutput::json(json!([1, 2])).structured.unwrap().is_object());
        assert_eq!(ToolOutput::json(json!([1, 2])).structured.unwrap()["results"], json!([1, 2]));
        // An object passes through untouched.
        assert_eq!(ToolOutput::json(json!({ "a": 1 })).structured.unwrap(), json!({ "a": 1 }));
        // The text body is rendered from the wrapped value, so both agree.
        let wrapped = ToolOutput::json(json!(["x"]));
        assert_eq!(
            serde_json::from_str::<Value>(&wrapped.text).unwrap(),
            wrapped.structured.unwrap()
        );
    }

    #[test]
    fn an_unknown_tool_is_refused() {
        let (_fx, mut session) = fixture("codex", false);
        assert_eq!(call(&mut session, "rm_rf", &json!({})).unwrap_err(), "unknown_tool");
    }

    #[test]
    fn the_subject_of_a_call_never_includes_prose_arguments() {
        // query / content / body / message can all carry manuscript text.
        let args = json!({
            "file": "manuscript/ch-01.md",
            "query": SECRET,
            "content": SECRET,
            "body": SECRET,
            "message": SECRET,
        });
        let line = subject(&args);
        assert_eq!(line, "manuscript/ch-01.md");
        assert!(!line.contains("aguja"));
    }
}
