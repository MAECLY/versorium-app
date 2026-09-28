//! Settings → Local AI: the built-in GGUF catalog, the Ollama daemon, an
//! OpenAI-compatible local server, and which of them serves each task.
//!
//! Nothing here ever starts a download on its own (spec §6.2: "Nunca
//! auto-descargar HIGH" — and in fact nothing at all). `models_view` only reads
//! what is already on disk, so opening the panel is cheap and silent.

use crate::commands::settings::{SettingsStore, SlotAssignment, Slots, SLOT_KINDS, SLOT_NAMES};
use crate::models::{catalog, download, hardware, store};
use serde::Serialize;
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
    pub enabled: bool,
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
    let settings = state.get();
    let machine = hardware::probe();
    let dir = store::models_dir()?;
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
    Ok(LocalAiView {
        models: cards_in(&dir, &catalog::catalog()?.models, machine.total_ram_gb),
        slots: settings.slots.clone(),
        progress: download::progress(),
        ollama: OllamaView {
            running,
            models,
            installed: crate::agents::find_binary("ollama").is_some(),
        },
        studio: StudioView {
            host: settings.studio_host.clone(),
            port: settings.studio_port,
            enabled: settings.studio_enabled,
        },
        censorship: settings.censorship,
        disk_used_bytes: store::disk_usage_in(&dir).unwrap_or(0),
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
    set_slot_in(
        &store::models_dir()?,
        &state,
        &slot,
        &kind,
        &id,
        &ollama_names,
        |id| catalog::find(id).cloned(),
    )
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

#[tauri::command]
pub fn studio_save(
    state: tauri::State<SettingsStore>,
    host: String,
    port: u16,
    enabled: bool,
) -> Result<StudioView, String> {
    let host = host.trim().to_string();
    if host.is_empty() || port == 0 {
        return Err("bad_args".into());
    }
    state.update(|s| {
        s.studio_host = host.clone();
        s.studio_port = port;
        s.studio_enabled = enabled;
    });
    let settings = state.get();
    Ok(StudioView {
        host: settings.studio_host,
        port: settings.studio_port,
        enabled: settings.studio_enabled,
    })
}

// ------------------------------------------------------- testable internals
//
// The `_in` variants take the model directory and an explicit Ollama list so
// the rules can be tested without a real app-data dir or a live daemon —
// the same shape `store.rs` already uses.

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

fn set_slot_in(
    dir: &Path,
    state: &SettingsStore,
    slot: &str,
    kind: &str,
    id: &str,
    ollama_names: &[String],
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
            set_slot_in(dir.path(), &state, slot, kind, id, &[], lookup_of(vec![]))
        };
        assert_eq!(set("rewriting", "none", "").unwrap_err(), "bad_args");
        assert_eq!(set("rewrite", "byok", "x").unwrap_err(), "bad_args");
        assert_eq!(set("", "", "").unwrap_err(), "bad_args");
        // A CLI harness still needs a name.
        assert_eq!(set("rewrite", "cli", "  ").unwrap_err(), "bad_args");
    }

    #[test]
    fn a_builtin_model_must_be_downloaded_before_it_can_be_selected() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());
        let model = entry("mid-model", 3.5);
        let known = || lookup_of(vec![model.clone()]);

        assert_eq!(
            set_slot_in(dir.path(), &state, "rewrite", "builtin", &model.id, &[], known())
                .unwrap_err(),
            "not_ready"
        );
        assert_eq!(
            set_slot_in(dir.path(), &state, "rewrite", "builtin", "no-such-model", &[], known())
                .unwrap_err(),
            "not_found"
        );
        assert_eq!(state.get().slots.rewrite.kind, "none", "a refused set changes nothing");

        make_ready(dir.path(), &model);
        let slots =
            set_slot_in(dir.path(), &state, "rewrite", "builtin", &model.id, &[], known()).unwrap();
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
            set_slot_in(dir.path(), &state, "chat", "ollama", "gemma:2b", &pulled, lookup_of(vec![]))
                .unwrap_err(),
            "not_found"
        );
        let slots =
            set_slot_in(dir.path(), &state, "chat", "ollama", "qwen3:32b", &pulled, lookup_of(vec![]))
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

        set_slot_in(dir.path(), &state, "continuity", "builtin", &model.id, &[], known()).unwrap();
        let slots =
            set_slot_in(dir.path(), &state, "continuity", "none", "", &[], known()).unwrap();
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

        set_slot_in(dir.path(), &state, "rewrite", "builtin", &model.id, &[], known()).unwrap();
        set_slot_in(dir.path(), &state, "chat", "builtin", &model.id, &[], known()).unwrap();
        set_slot_in(dir.path(), &state, "continuity", "cli", "claude", &[], known()).unwrap();

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
        set_slot_in(dir.path(), &state, "chat", "ollama", "qwen3:32b", &pulled, lookup_of(vec![]))
            .unwrap();

        clear_slots_matching(&state, "ollama", "qwen3:32b");
        assert_eq!(state.get().slots.chat.kind, "none");
    }

    #[test]
    fn studio_settings_round_trip_and_reject_nonsense() {
        let dir = tempfile::tempdir().unwrap();
        let state = store_at(dir.path());

        let save = |host: &str, port: u16, enabled: bool| -> Result<StudioView, String> {
            let host = host.trim().to_string();
            if host.is_empty() || port == 0 {
                return Err("bad_args".into());
            }
            state.update(|s| {
                s.studio_host = host.clone();
                s.studio_port = port;
                s.studio_enabled = enabled;
            });
            let settings = state.get();
            Ok(StudioView {
                host: settings.studio_host,
                port: settings.studio_port,
                enabled: settings.studio_enabled,
            })
        };

        assert_eq!(save("", 1234, true).unwrap_err(), "bad_args");
        assert_eq!(save("127.0.0.1", 0, true).unwrap_err(), "bad_args");
        let view = save(" 127.0.0.1 ", 8080, true).unwrap();
        assert_eq!(view.host, "127.0.0.1", "whitespace is trimmed before storing");
        assert_eq!(view.port, 8080);
        assert!(view.enabled);
        assert_eq!(state.get().studio_port, 8080);
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
