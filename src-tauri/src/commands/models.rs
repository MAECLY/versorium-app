//! Settings → Tasks and Models: the built-in GGUF catalog, the Ollama daemon,
//! the OpenAI-compatible local server, and which of them serves each task.
//!
//! Nothing here ever starts a download on its own (spec §6.2: "Nunca
//! auto-descargar HIGH" — and in fact nothing at all). `models_view` only reads
//! what is already on disk, asks the two local daemons what they serve, and
//! asks the local server only once the writer saved it, so opening the page is
//! cheap and silent.

use crate::agents::{self, LocalServer};
use crate::commands::settings::{Settings, SettingsStore, SlotAssignment, Slots, SLOT_KINDS, SLOT_NAMES};
use crate::models::{catalog, download, hardware, store};
use serde::Serialize;
use std::future::Future;
use std::path::Path;

/// Headroom the spec asks for before calling a model a fit (§6.2).

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCard {
    pub id: String,
    pub family: String,
    pub label: String,
    pub task: String,
    pub tier: String,
    pub params: String,
    pub quant: String,
    pub size_bytes: u64,
    /// Spelled `ramHintGB` on the wire: camelCase would give `ramHintGb`,
    /// and the catalog file, the TypeScript types and the spec all say GB.
    #[serde(rename = "ramHintGB")]
    pub ram_hint_gb: f32,
    pub ctx: u32,
    pub speed: String,
    pub quality: String,
    pub badge: Option<String>,
    pub uncensored: bool,
    pub license: String,
    pub repo: String,
    /// `missing` | `partial` | `ready` | `corrupt`
    pub state: String,
    /// Bytes already fetched; 0 unless `partial`.
    pub received_bytes: u64,
    /// This machine can hold it with the spec's 20% margin.
    pub fits: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub name: String,
    pub size_bytes: u64,
    pub modified: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaView {
    pub running: bool,
    pub models: Vec<OllamaModel>,
    /// The binary is present even if the daemon is not answering.
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioView {
    pub host: String,
    pub port: u16,
    /// The writer saved this server; nothing else makes Versorium reach it.
    pub enabled: bool,
    /// It answered just now. Always false while not saved: it was not asked.
    pub running: bool,
    /// The model ids it serves, which a task may name. Empty unless running.
    pub models: Vec<String>,
}

/// The local server as Settings shows it, asking it what it serves only when
/// the writer saved it (`settings.studio_enabled`): a server typed in and not
/// saved is never contacted. `probe` is `agents::server_status` outside tests.
async fn studio_view<F, Fut>(settings: &Settings, probe: F) -> StudioView
where
    F: FnOnce(LocalServer) -> Fut,
    Fut: Future<Output = (bool, Vec<String>)>,
{
    let (running, models) = match agents::saved_server(settings) {
        Some(server) => probe(server).await,
        None => (false, Vec::new()),
    };
    StudioView {
        host: settings.studio_host.clone(),
        port: settings.studio_port,
        enabled: settings.studio_enabled,
        running,
        models: if running { models } else { Vec::new() },
    }
}

async fn probe_server(server: LocalServer) -> (bool, Vec<String>) {
    agents::server_status(&server).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiView {
    pub models: Vec<ModelCard>,
    pub hardware: hardware::Hardware,
    pub slots: Slots,
    pub progress: Option<download::Progress>,
    pub ollama: OllamaView,
    pub studio: StudioView,
    /// The UI hides or marks `uncensored` entries with this; filtering here
    /// would leave the user unable to see why a model vanished.
    pub censorship: bool,
    pub disk_used_bytes: u64,
    pub models_dir: String,
}

fn state_label(state: &store::ModelState) -> (&'static str, u64) {
    match state {
        store::ModelState::Missing => ("missing", 0),
        store::ModelState::Partial { received } => ("partial", *received),
        store::ModelState::Ready => ("ready", 0),
        store::ModelState::Corrupt => ("corrupt", 0),
    }
}

fn card(entry: &catalog::ModelEntry, state: store::ModelState, total_ram_gb: f32) -> ModelCard {
    let (label, received_bytes) = state_label(&state);
    ModelCard {
        id: entry.id.clone(),
        family: entry.family.clone(),
        label: entry.label.clone(),
        task: entry.task.clone(),
        tier: entry.tier.clone(),
        params: entry.params.clone(),
        quant: entry.quant.clone(),
        size_bytes: entry.size_bytes,
        ram_hint_gb: entry.ram_hint_gb,
        ctx: entry.ctx,
        speed: entry.speed.clone(),
        quality: entry.quality.clone(),
        badge: entry.badge.clone(),
        uncensored: entry.uncensored,
        license: entry.license.clone(),
        repo: entry.repo.clone(),
        state: label.to_string(),
        received_bytes,
        fits: hardware::fits(entry.ram_hint_gb, total_ram_gb),
    }
}

/// Cards for the given models, using `dir` as the model store. Entries are
/// passed in rather than read here so the presentation rules can be tested
/// against synthetic models instead of whatever the shipped catalog holds.
fn cards_in(dir: &Path, entries: &[catalog::ModelEntry], total_ram_gb: f32) -> Vec<ModelCard> {
    entries
        .iter()
        .map(|entry| card(entry, store::state_of_in(dir, entry), total_ram_gb))
        .collect()
}

#[tauri::command]
pub async fn models_view(state: tauri::State<'_, SettingsStore>) -> Result<LocalAiView, String> {
    let dir = store::models_dir()?;
    view_in(&dir, &state, ollama_view().await).await
}

/// What the Ollama daemon on this computer serves, asked over its local API.
async fn ollama_view() -> OllamaView {
    let (running, _) = crate::agents::ollama_status().await;
    let models = if running {
        crate::agents::ollama_models()
            .await
            .into_iter()
            .map(|(name, size_bytes, modified)| OllamaModel { name, size_bytes, modified })
            .collect()
    } else {
        Vec::new()
    };
    OllamaView { running, models, installed: crate::agents::find_binary("ollama").is_some() }
}

/// The view, given the settings and what Ollama said: the command without
/// `tauri::State`, so a test drives it with a store of its own and a fake
/// local server. The saved server is asked here, through the same probe the
/// tasks use.
async fn view_in(dir: &Path, state: &SettingsStore, ollama: OllamaView) -> Result<LocalAiView, String> {
    let settings = state.get();
    let machine = hardware::probe();
    Ok(LocalAiView {
        models: cards_in(dir, &catalog::catalog()?.models, machine.total_ram_gb),
        slots: settings.slots.clone(),
        progress: download::progress(),
        ollama,
        studio: studio_view(&settings, probe_server).await,
        censorship: settings.censorship,
        disk_used_bytes: store::disk_usage_in(dir).unwrap_or(0),
        models_dir: dir.to_string_lossy().into_owned(),
        hardware: machine,
    })
}

#[tauri::command]
pub async fn models_download(id: String) -> Result<(), String> {
    download::start(&id).await
}

#[tauri::command]
pub fn models_cancel(id: String) -> Result<(), String> {
    download::cancel(&id)
}

#[tauri::command]
pub fn models_delete(state: tauri::State<SettingsStore>, id: String) -> Result<(), String> {
    delete_in(&store::models_dir()?, &state, &id)
}

#[tauri::command]
pub fn models_progress() -> Option<download::Progress> {
    download::progress()
}

#[tauri::command]
pub async fn models_set_slot(
    state: tauri::State<'_, SettingsStore>,
    slot: String,
    kind: String,
    id: String,
) -> Result<Slots, String> {
    // Only ask the daemon when the answer can matter.
    let ollama_names: Vec<String> = if kind == "ollama" {
        crate::agents::ollama_models()
            .await
            .into_iter()
            .map(|(name, _, _)| name)
            .collect()
    } else {
        Vec::new()
    };
    set_slot_cmd(&store::models_dir()?, &state, &slot, &kind, &id, &ollama_names).await
}

/// The command without `tauri::State`: the saved local server is asked what
/// it serves (only for a `server` choice, and only once saved), then the
/// rules in `set_slot_in` decide.
async fn set_slot_cmd(
    dir: &Path,
    state: &SettingsStore,
    slot: &str,
    kind: &str,
    id: &str,
    ollama_names: &[String],
) -> Result<Slots, String> {
    let server_names: Option<Vec<String>> = match agents::saved_server(&state.get()) {
        Some(server) if kind == "server" => Some(agents::server_status(&server).await.1),
        _ => None,
    };
    set_slot_in(dir, state, slot, kind, id, ollama_names, server_names.as_deref(), |id| catalog::find(id).cloned())
}

#[tauri::command]
pub async fn ollama_pull(name: String) -> Result<(), String> {
    crate::agents::ollama_pull(&name).await
}

#[tauri::command]
pub async fn ollama_remove(state: tauri::State<'_, SettingsStore>, name: String) -> Result<(), String> {
    crate::agents::ollama_delete(&name).await?;
    // Same rule as a deleted GGUF: a slot must never point at something gone.
    clear_slots_matching(&state, "ollama", &name);
    Ok(())
}

#[tauri::command]
pub async fn studio_test(host: String, port: u16) -> Result<bool, String> {
    let host = host.trim();
    if host.is_empty() {
        return Err("bad_args".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|_| "network".to_string())?;
    // The OpenAI-compatible shape LM Studio and llama-server both serve.
    match client.get(format!("http://{host}:{port}/v1/models")).send().await {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}

/// Save the local server (`enabled`), or forget it. The answer says, once
/// saved, whether it answers and what it serves, so Settings can say so at once.
#[tauri::command]
pub async fn studio_save(
    state: tauri::State<'_, SettingsStore>,
    host: String,
    port: u16,
    enabled: bool,
) -> Result<StudioView, String> {
    studio_save_in(&state, &host, port, enabled)?;
    Ok(studio_view(&state.get(), probe_server).await)
}

// ------------------------------------------------------- testable internals
//
// The `_in` variants take the model directory and an explicit Ollama list so
// the rules can be tested without a real app-data dir or a live daemon —
// the same shape `store.rs` already uses.

/// Save or forget the local server. Forgetting it releases every task that
/// ran on it: a task never outlives the server it named, the same rule a
/// deleted model or a removed Ollama tag follows.
///
/// Saved again at another computer's address, it releases them too. A task
/// goes wherever the server is, so keeping it would send the next passage to
/// a computer the writer never chose for that task (a model of the same name
/// is all it would take). A new port on the same computer keeps them.
fn studio_save_in(state: &SettingsStore, host: &str, port: u16, saved: bool) -> Result<(), String> {
    let host = host.trim().to_string();
    if host.is_empty() || port == 0 {
        return Err("bad_args".into());
    }
    state.update(|s| {
        let elsewhere = !agents::is_loopback(&host) && !agents::same_host(&s.studio_host, &host);
        s.studio_host = host.clone();
        s.studio_port = port;
        s.studio_enabled = saved;
        if !saved || elsewhere {
            for slot in s.slots.iter_mut() {
                if slot.kind == "server" {
                    *slot = SlotAssignment::default();
                }
            }
        }
    });
    Ok(())
}

fn clear_slots_matching(state: &SettingsStore, kind: &str, id: &str) {
    state.update(|s| {
        for slot in s.slots.iter_mut() {
            if slot.kind == kind && slot.id == id {
                *slot = SlotAssignment::default();
            }
        }
    });
}

fn delete_in(dir: &Path, state: &SettingsStore, id: &str) -> Result<(), String> {
    store::delete_in(dir, id)?;
    clear_slots_matching(state, "builtin", id);
    Ok(())
}

/// `server_names` is what the saved local server serves, or None when no
/// server is saved.
#[allow(clippy::too_many_arguments)]
fn set_slot_in(
    dir: &Path,
    state: &SettingsStore,
    slot: &str,
    kind: &str,
    id: &str,
    ollama_names: &[String],
    server_names: Option<&[String]>,
    lookup: impl Fn(&str) -> Option<catalog::ModelEntry>,
) -> Result<Slots, String> {
    if !SLOT_NAMES.contains(&slot) || !SLOT_KINDS.contains(&kind) {
        return Err("bad_args".into());
    }
    let assignment = match kind {
        "none" => SlotAssignment::default(),
        "builtin" => {
            let entry = lookup(id).ok_or_else(|| "not_found".to_string())?;
            // Selecting a model we have not finished downloading would leave the
            // task pointing at nothing the moment it is used.
            if store::state_of_in(dir, &entry) != store::ModelState::Ready {
                return Err("not_ready".into());
            }
            SlotAssignment { kind: kind.into(), id: id.into() }
        }
        "ollama" => {
            if !ollama_names.iter().any(|name| name == id) {
                return Err("not_found".into());
            }
            SlotAssignment { kind: kind.into(), id: id.into() }
        }
        // A model the saved server serves right now: no server saved, or a
        // model it does not list, and the task would point at nothing.
        "server" => {
            if id.trim().is_empty() {
                return Err("bad_args".into());
            }
            let served = server_names.ok_or_else(|| "not_found".to_string())?;
            if !served.iter().any(|name| name == id) {
                return Err("not_found".into());
            }
            SlotAssignment { kind: kind.into(), id: id.into() }
        }
        // A CLI harness manages its own auth; presence was already established
        // by detection, so the id is taken as given.
        _ => {
            if id.trim().is_empty() {
                return Err("bad_args".into());
            }
            SlotAssignment { kind: kind.into(), id: id.into() }
        }
    };
    state.update(|s| {
        if let Some(target) = s.slots.get_mut(slot) {
            *target = assignment.clone();
        }
    });
    Ok(state.get().slots)
}

#[cfg(test)]
mod tests {

    /// The frontend reads these keys by name. serde's camelCase is not always
    /// what a human would write — `ram_hint_gb` becomes `ramHintGb`, not
    /// `ramHintGB` — and the E2E mock hides the mismatch because it is written
    /// by hand. Pin the wire names here so drift fails a test, not a user.
    #[test]
    fn the_wire_names_are_the_ones_the_frontend_declares() {
        let entry = catalog::ModelEntry {
            id: "m".into(), family: "F".into(), label: "L".into(), task: "writing".into(),
            tier: "mid".into(), params: "4B".into(), quant: "Q4_K_M".into(), size_bytes: 1,
            ram_hint_gb: 3.5, ctx: 32768, speed: "balanced".into(), quality: "good".into(),
            badge: None, uncensored: false, sha256: "0".repeat(64),
            url: "https://example.test/m.gguf".into(), license: "apache-2.0".into(),
            repo: "r".into(),
        };
        let card = serde_json::to_value(card(&entry, store::ModelState::Ready, 16.0)).unwrap();
        for key in ["id", "family", "label", "task", "tier", "params", "quant", "sizeBytes",
                    "ramHintGB", "ctx", "speed", "quality", "badge", "uncensored", "license",
                    "repo", "state", "receivedBytes", "fits"] {
            assert!(card.get(key).is_some(), "ModelCard is missing `{key}`");
        }
        assert_eq!(card.as_object().unwrap().len(), 19, "ModelCard gained or lost a field");

        let hardware = serde_json::to_value(crate::models::hardware::probe()).unwrap();
        for key in ["totalRamGb", "availableRamGb", "cpuCores", "arch", "os", "gpu",
                    "recommendedTier"] {
            assert!(hardware.get(key).is_some(), "Hardware is missing `{key}`");
        }

        let progress = serde_json::to_value(crate::models::download::Progress {
            id: "m".into(), received: 1, total: 2, done: false,
        })
        .unwrap();
        for key in ["id", "received", "total", "done"] {
            assert!(progress.get(key).is_some(), "Progress is missing `{key}`");
        }

        let studio = serde_json::to_value(StudioView {
            host: "127.0.0.1".into(), port: 1234, enabled: true, running: true, models: vec!["m".into()],
        })
        .unwrap();
        for key in ["host", "port", "enabled", "running", "models"] {
            assert!(studio.get(key).is_some(), "StudioView is missing `{key}`");
        }
        assert_eq!(studio.as_object().unwrap().len(), 5, "StudioView gained or lost a field");
    }
    use super::*;

    fn store_at(dir: &Path) -> SettingsStore {
        SettingsStore::load(dir.join("settings.json"))
    }

    /// A synthetic catalogue entry: these tests exercise the command rules, not
    /// whatever models happen to ship, so they stay green while the shipped
    /// catalogue changes underneath them.
    fn entry(id: &str, ram_hint_gb: f32) -> catalog::ModelEntry {
        catalog::ModelEntry {
            id: id.into(),
            family: "Qwen".into(),
            label: "Test Model".into(),
            task: "writing".into(),
            tier: "mid".into(),
            params: "4B".into(),
            quant: "Q4_K_M".into(),
            size_bytes: 8,
            ram_hint_gb,
            ctx: 32768,
            speed: "balanced".into(),
            quality: "good".into(),
            badge: Some("Balanced".into()),
            uncensored: false,
            sha256: "0".repeat(64),
            url: "https://example.invalid/model.gguf".into(),
            license: "apache-2.0".into(),
            repo: "test/repo".into(),
        }
    }

    /// Resolves only the entries a test knows about.
    fn lookup_of(known: Vec<catalog::ModelEntry>) -> impl Fn(&str) -> Option<catalog::ModelEntry> {
        move |id| known.iter().find(|e| e.id == id).cloned()
    }

    /// Downloaded and the right size, so `state_of_in` calls it Ready.
    fn make_ready(dir: &Path, entry: &catalog::ModelEntry) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            store::model_path_in(dir, &entry.id),
            vec![0u8; entry.size_bytes as usize],
        )
        .unwrap();
    }

    #[test]
    fn the_ram_margin_is_twenty_percent() {
        // 4 GB model needs 4.8 GB of machine.
        assert!(hardware::fits(4.0, 4.8));
        assert!(!hardware::fits(4.0, 4.79));
        assert!(hardware::fits(1.0, 8.0));
        assert!(!hardware::fits(48.0, 32.0));
    }

    #[test]
    fn a_card_reports_the_state_the_disk_is_in() {
        let entry = &entry("mid-model", 3.5);

        let missing = card(entry, store::ModelState::Missing, 64.0);
        assert_eq!(missing.state, "missing");
        assert_eq!(missing.received_bytes, 0);

        let partial = card(entry, store::ModelState::Partial { received: 1234 }, 64.0);
        assert_eq!(partial.state, "partial");
        assert_eq!(partial.received_bytes, 1234);

        assert_eq!(card(entry, store::ModelState::Ready, 64.0).state, "ready");
        assert_eq!(card(entry, store::ModelState::Corrupt, 64.0).state, "corrupt");
        // A tiny machine still sees the card, it just does not fit.
        assert!(!card(entry, store::ModelState::Missing, 0.5).fits);
    }

    #[test]
    fn every_model_gets_a_card_and_a_downloaded_one_reads_ready() {
        let dir = tempfile::tempdir().unwrap();
        let entries = vec![entry("a", 1.0), entry("b", 3.5)];
        let cards = cards_in(dir.path(), &entries, 64.0);
        assert_eq!(cards.len(), 2);
        assert!(cards.iter().all(|c| c.state == "missing"), "an empty dir has nothing ready");

        make_ready(dir.path(), &entries[0]);
        let cards = cards_in(dir.path(), &entries, 64.0);
        assert_eq!(cards[0].state, "ready");
        assert_eq!(cards[1].state, "missing");
    }

    #[test]
    fn an_unknown_slot_or_kind_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());
        let set = |slot: &str, kind: &str, id: &str| {
            set_slot_in(dir.path(), &state, slot, kind, id, &[], None, lookup_of(vec![]))
        };
        assert_eq!(set("rewriting", "none", "").unwrap_err(), "bad_args");
        assert_eq!(set("rewrite", "byok", "x").unwrap_err(), "bad_args");
        assert_eq!(set("", "", "").unwrap_err(), "bad_args");
        // A CLI harness still needs a name, and so does a server's model.
        assert_eq!(set("rewrite", "cli", "  ").unwrap_err(), "bad_args");
        assert_eq!(set("rewrite", "server", "").unwrap_err(), "bad_args");
    }

    #[test]
    fn a_server_slot_needs_a_saved_server_and_a_model_it_serves() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());
        let served = ["local-model".to_string(), "other-model".to_string()];
        let set = |id: &str, names: Option<&[String]>| {
            set_slot_in(dir.path(), &state, "rewrite", "server", id, &[], names, lookup_of(vec![]))
        };

        // No server saved: there is nothing for the task to run on.
        assert_eq!(set("local-model", None).unwrap_err(), "not_found");
        // Saved, but it does not serve that model (or did not answer: no names).
        assert_eq!(set("gone-model", Some(&served)).unwrap_err(), "not_found");
        assert_eq!(set("local-model", Some(&[])).unwrap_err(), "not_found");
        assert_eq!(state.get().slots.rewrite.kind, "none", "a refused set changes nothing");

        let slots = set("local-model", Some(&served)).unwrap();
        assert_eq!(slots.rewrite, SlotAssignment { kind: "server".into(), id: "local-model".into() });
        assert_eq!(slots.continuity.kind, "none", "only the named slot moved");
    }

    #[test]
    fn forgetting_the_server_releases_its_tasks() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());
        let served = ["local-model".to_string()];
        let pulled = ["qwen3:32b".to_string()];
        studio_save_in(&state, "127.0.0.1", 1234, true).unwrap();
        for slot in ["rewrite", "continuity"] {
            set_slot_in(dir.path(), &state, slot, "server", "local-model", &[], Some(&served), lookup_of(vec![])).unwrap();
        }
        set_slot_in(dir.path(), &state, "chat", "ollama", "qwen3:32b", &pulled, None, lookup_of(vec![])).unwrap();

        // Saving again (a new port, say) keeps them.
        studio_save_in(&state, "127.0.0.1", 1235, true).unwrap();
        assert_eq!(state.get().slots.rewrite.kind, "server");

        studio_save_in(&state, "127.0.0.1", 1235, false).unwrap();
        let s = state.get();
        assert!(!s.studio_enabled);
        assert_eq!(s.slots.rewrite.kind, "none", "a task must never outlive its server");
        assert_eq!(s.slots.continuity.kind, "none");
        assert_eq!(s.slots.chat.id, "qwen3:32b", "tasks elsewhere are left alone");
    }

    #[test]
    fn the_server_is_probed_only_once_saved() {
        let asked = std::cell::Cell::new(0);
        let probe = |_server: LocalServer| {
            asked.set(asked.get() + 1);
            std::future::ready((true, vec!["local-model".to_string()]))
        };
        let mut settings = Settings { studio_port: 8080, ..Default::default() };

        let view = tauri::async_runtime::block_on(studio_view(&settings, probe));
        assert_eq!(asked.get(), 0, "a server that is not saved is never contacted");
        assert!(!view.running);
        assert!(view.models.is_empty());
        assert_eq!(view.port, 8080);

        settings.studio_enabled = true;
        let view = tauri::async_runtime::block_on(studio_view(&settings, probe));
        assert_eq!(asked.get(), 1);
        assert!(view.enabled && view.running);
        assert_eq!(view.models, ["local-model"]);

        // Saved and silent: no models offered for a server that did not answer.
        let silent = |_server: LocalServer| std::future::ready((false, vec!["stale".to_string()]));
        let view = tauri::async_runtime::block_on(studio_view(&settings, silent));
        assert!(!view.running);
        assert!(view.models.is_empty());
    }

    /// Ollama as a computer without it sees it: the view tests never reach a
    /// daemon that happens to run on the machine running them.
    fn no_ollama() -> OllamaView {
        OllamaView { running: false, models: Vec::new(), installed: false }
    }

    /// A store whose local server is `server`, saved or only typed in.
    fn store_with_server(dir: &Path, server: &LocalServer, saved: bool) -> SettingsStore {
        let state = store_at(dir);
        state.update(|s| {
            s.studio_host = server.host.clone();
            s.studio_port = server.port;
            s.studio_enabled = saved;
        });
        state
    }

    #[test]
    fn the_view_asks_the_saved_server_what_it_serves_and_an_unsaved_one_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let fake = agents::tests::FakeServer::start(&["local-model", "other-model"], "unused");

        let state = store_with_server(dir.path(), &fake.server, false);
        let view = tauri::async_runtime::block_on(view_in(dir.path(), &state, no_ollama())).unwrap();
        assert!(!view.studio.enabled && !view.studio.running);
        assert!(view.studio.models.is_empty());
        assert!(fake.seen().is_empty(), "a server that is not saved is never contacted");

        state.update(|s| s.studio_enabled = true);
        let view = tauri::async_runtime::block_on(view_in(dir.path(), &state, no_ollama())).unwrap();
        assert!(view.studio.enabled && view.studio.running, "saved, it is asked, and it answers");
        assert_eq!(view.studio.models, ["local-model", "other-model"]);
        assert_eq!(fake.seen().iter().map(|(r, _)| r.as_str()).collect::<Vec<_>>(), ["GET /v1/models"]);
    }

    #[test]
    fn a_server_choice_is_checked_against_what_the_saved_server_serves() {
        let dir = tempfile::tempdir().unwrap();
        let fake = agents::tests::FakeServer::start(&["local-model"], "unused");
        let set = |state: &SettingsStore, id: &str| {
            tauri::async_runtime::block_on(set_slot_cmd(dir.path(), state, "rewrite", "server", id, &[]))
        };

        // Typed in, not saved: refused, and the server is not asked.
        let unsaved = store_with_server(dir.path(), &fake.server, false);
        assert_eq!(set(&unsaved, "local-model").unwrap_err(), "not_found");
        assert!(fake.seen().is_empty());

        let saved = store_with_server(dir.path(), &fake.server, true);
        assert_eq!(set(&saved, "gone-model").unwrap_err(), "not_found", "a model it does not list");
        let slots = set(&saved, "local-model").unwrap();
        assert_eq!(slots.rewrite, SlotAssignment { kind: "server".into(), id: "local-model".into() });
    }

    #[test]
    fn saving_the_server_at_another_computers_address_releases_its_tasks() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());
        let served = ["local-model".to_string()];
        let on_server = |state: &SettingsStore| {
            for slot in ["rewrite", "continuity"] {
                set_slot_in(dir.path(), state, slot, "server", "local-model", &[], Some(&served), lookup_of(vec![])).unwrap();
            }
        };
        let kinds = |state: &SettingsStore| {
            let s = state.get();
            (s.slots.rewrite.kind, s.slots.continuity.kind)
        };

        studio_save_in(&state, "127.0.0.1", 1234, true).unwrap();
        on_server(&state);
        // The same computer: another port, or another name for it, keeps them.
        studio_save_in(&state, "127.0.0.1", 8080, true).unwrap();
        studio_save_in(&state, "localhost", 8080, true).unwrap();
        assert_eq!(kinds(&state), ("server".to_string(), "server".to_string()));

        // Another computer: the next passage would go there unchosen.
        studio_save_in(&state, "192.168.1.20", 8080, true).unwrap();
        assert_eq!(kinds(&state), ("none".to_string(), "none".to_string()));
        assert!(state.get().studio_enabled, "the server itself stays saved");

        // Chosen again for that computer, a new port there keeps them; yet
        // another computer releases them again.
        on_server(&state);
        studio_save_in(&state, " 192.168.1.20 ", 1234, true).unwrap();
        assert_eq!(kinds(&state), ("server".to_string(), "server".to_string()));
        studio_save_in(&state, "192.168.1.21", 1234, true).unwrap();
        assert_eq!(kinds(&state), ("none".to_string(), "none".to_string()));

        // Coming back to this computer keeps what was chosen there.
        on_server(&state);
        studio_save_in(&state, "::1", 1234, true).unwrap();
        assert_eq!(kinds(&state), ("server".to_string(), "server".to_string()));
    }

    #[test]
    fn the_loopback_rule_matches_the_one_settings_shows() {
        for host in ["127.0.0.1", "127.8.9.10", "localhost", "LOCALHOST", "::1", "[::1]", " 127.0.0.1 "] {
            assert!(agents::is_loopback(host), "{host} is this computer");
        }
        for host in ["192.168.1.20", "10.0.0.2", "example.com", "::2", "0.0.0.0", "localhost.example.com"] {
            assert!(!agents::is_loopback(host), "{host} is not this computer");
        }
    }

    #[test]
    fn a_builtin_model_must_be_downloaded_before_it_can_be_selected() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());
        let model = entry("mid-model", 3.5);
        let known = || lookup_of(vec![model.clone()]);

        assert_eq!(
            set_slot_in(dir.path(), &state, "rewrite", "builtin", &model.id, &[], None, known())
                .unwrap_err(),
            "not_ready"
        );
        assert_eq!(
            set_slot_in(dir.path(), &state, "rewrite", "builtin", "no-such-model", &[], None, known())
                .unwrap_err(),
            "not_found"
        );
        assert_eq!(state.get().slots.rewrite.kind, "none", "a refused set changes nothing");

        make_ready(dir.path(), &model);
        let slots =
            set_slot_in(dir.path(), &state, "rewrite", "builtin", &model.id, &[], None, known()).unwrap();
        assert_eq!(slots.rewrite.kind, "builtin");
        assert_eq!(slots.rewrite.id, model.id);
        // Only the named slot moved.
        assert_eq!(slots.chat.kind, "none");
    }

    #[test]
    fn an_ollama_slot_must_name_a_model_the_daemon_actually_has() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());
        let pulled = ["qwen3:32b".to_string()];

        assert_eq!(
            set_slot_in(dir.path(), &state, "chat", "ollama", "gemma:2b", &pulled, None, lookup_of(vec![]))
                .unwrap_err(),
            "not_found"
        );
        let slots =
            set_slot_in(dir.path(), &state, "chat", "ollama", "qwen3:32b", &pulled, None, lookup_of(vec![]))
                .unwrap();
        assert_eq!(slots.chat, SlotAssignment { kind: "ollama".into(), id: "qwen3:32b".into() });
    }

    #[test]
    fn clearing_a_slot_restores_the_unassigned_state() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());
        let model = entry("mid-model", 3.5);
        make_ready(dir.path(), &model);
        let known = || lookup_of(vec![model.clone()]);

        set_slot_in(dir.path(), &state, "continuity", "builtin", &model.id, &[], None, known()).unwrap();
        let slots =
            set_slot_in(dir.path(), &state, "continuity", "none", "", &[], None, known()).unwrap();
        assert_eq!(slots.continuity, SlotAssignment::default());
        assert_eq!(slots.continuity.kind, "none");
        assert!(slots.continuity.id.is_empty());
    }

    #[test]
    fn deleting_a_model_releases_every_task_that_pointed_at_it() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());
        let model = entry("mid-model", 3.5);
        make_ready(dir.path(), &model);
        let known = || lookup_of(vec![model.clone()]);

        set_slot_in(dir.path(), &state, "rewrite", "builtin", &model.id, &[], None, known()).unwrap();
        set_slot_in(dir.path(), &state, "chat", "builtin", &model.id, &[], None, known()).unwrap();
        set_slot_in(dir.path(), &state, "continuity", "cli", "claude", &[], None, known()).unwrap();

        delete_in(dir.path(), &state, &model.id).unwrap();

        let slots = state.get().slots;
        assert_eq!(slots.rewrite.kind, "none", "a slot must never outlive its file");
        assert_eq!(slots.chat.kind, "none");
        // Unrelated assignments survive.
        assert_eq!(slots.continuity.id, "claude");
        assert!(!store::model_path_in(dir.path(), &model.id).exists());
    }

    #[test]
    fn removing_an_ollama_model_releases_its_slots_too() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());
        let pulled = ["qwen3:32b".to_string()];
        set_slot_in(dir.path(), &state, "chat", "ollama", "qwen3:32b", &pulled, None, lookup_of(vec![]))
            .unwrap();

        clear_slots_matching(&state, "ollama", "qwen3:32b");
        assert_eq!(state.get().slots.chat.kind, "none");
    }

    #[test]
    fn studio_settings_round_trip_and_reject_nonsense() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());

        assert_eq!(studio_save_in(&state, "", 1234, true).unwrap_err(), "bad_args");
        assert_eq!(studio_save_in(&state, "127.0.0.1", 0, true).unwrap_err(), "bad_args");
        assert!(!state.get().studio_enabled, "a refused save changes nothing");
        studio_save_in(&state, " 127.0.0.1 ", 8080, true).unwrap();
        let s = state.get();
        assert_eq!(s.studio_host, "127.0.0.1", "whitespace is trimmed before storing");
        assert_eq!(s.studio_port, 8080);
        assert!(s.studio_enabled);
    }

    #[test]
    fn opening_the_panel_never_starts_a_download() {
        let dir = tempfile::tempdir().unwrap();
        cards_in(dir.path(), &[entry("a", 1.0)], 64.0);
        assert!(download::progress().is_none());
        // And nothing was written into the model directory.
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
