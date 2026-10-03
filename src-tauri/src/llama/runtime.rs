//! The engine: one thread that owns a model and runs one job at a time.
//!
//! ## Why a thread and not `spawn_blocking`
//!
//! `LlamaModel` is `Send + Sync`, but `LlamaContext<'a>` borrows it and is
//! neither, and `LlamaBatch` is neither. A context therefore cannot live in
//! Tauri's `State<T>` and cannot cross an await point. One owning thread fed by
//! a channel is the only shape that does not fight the borrow checker.
//!
//! ## Why "busy" and not a queue
//!
//! Spec §6.2: one heavy inference at a time. The codebase already solves this
//! exact shape for downloads — a `OnceLock<Mutex<Option<Active>>>` plus a
//! `download_busy` code — so this follows it rather than introducing a
//! semaphore and a direct `tokio` dependency the project does not have.
//!
//! ## Why the caller blocks but tokens still stream
//!
//! `agents::rewrite` returns `Result<String, String>`, so `generate` is
//! blocking and is called from `spawn_blocking` like the CLI harnesses already
//! are. Partial text lands in the shared `Active` as it is produced, and
//! `progress()` reads it — matching how a download reports bytes, since there
//! is not a single Tauri event anywhere in this codebase to imitate.

use super::fit;
use encoding_rs::UTF_8;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use serde::Serialize;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};

/// Error codes. Stable, no spaces — `errors.ts` keeps only the last word of a
/// message, so a code with a space in it silently loses most of itself.
pub const BUSY: &str = "llama_busy";
pub const LOAD_FAILED: &str = "llama_load_failed";
pub const CANCELLED: &str = "llama_cancelled";
pub const FAILED: &str = "llama_failed";

/// Set to keep ggml's own logging, which is the only place a backend that
/// failed to load explains itself.
pub const VERBOSE_ENV: &str = "VERSORIUM_LLAMA_VERBOSE";

/// Sampling. Deliberately middling: a rewrite must stay recognisably the
/// writer's sentence, and a high temperature turns editing into invention.
const TOP_K: i32 = 40;
const TOP_P: f32 = 0.95;
const TEMPERATURE: f32 = 0.7;

/// A rewrite is bounded by the passage plus a margin, not by the context.
pub const MAX_TOKENS: usize = 2048;

/// Leaves a core for the UI thread; llama.cpp's own default is 4 regardless of
/// the machine, which wastes most of an M-series and oversubscribes a dual-core.
fn threads() -> i32 {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    cores.saturating_sub(1).max(1) as i32
}

// --- the backend, initialized once, off the UI thread ---

static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();

/// Initialize llama.cpp once.
///
/// On Apple Silicon this costs about **15 seconds**, measured on an M4 Max:
/// `GGML_METAL_EMBED_LIBRARY` embeds the Metal shader *source* and 20 libraries
/// are compiled at first init. The CPU-only path is sub-millisecond. That is why
/// `warm_up` exists and why the UI has a "preparing" state — without it the
/// first rewrite of a session appears to hang.
pub fn backend() -> Result<&'static LlamaBackend, String> {
    match BACKEND.get_or_init(|| {
        LlamaBackend::init().map_err(|e| format!("{LOAD_FAILED} {e}")).map(|mut b| {
            // ggml logs a wall of device and kernel detail to stderr. A desktop
            // app has nowhere to put it, and it is not diagnostics anybody asked
            // for — but it is also where "failed to load the Vulkan backend"
            // would appear, so it stays reachable rather than being unavoidably
            // discarded.
            if std::env::var_os(VERBOSE_ENV).is_none() {
                b.void_logs();
            }
            b
        })
    }) {
        Ok(backend) => Ok(backend),
        Err(_) => Err(LOAD_FAILED.to_string()),
    }
}

/// Pay the initialization cost in the background, before anybody asks.
pub fn warm_up() {
    std::thread::spawn(|| {
        if backend().is_ok() {
            // Caching the device list here means `backend_info()` answers
            // instantly afterwards, and the wizard and the Ready badge read the
            // same value.
            let _ = device_info();
        }
    });
}

static DEVICE: OnceLock<Option<super::Backend>> = OnceLock::new();

/// The active device, or `None` while the backend is still starting.
pub fn device_info() -> Option<super::Backend> {
    // Probing before the backend exists would enumerate nothing and cache that
    // nothing forever.
    BACKEND.get()?;
    DEVICE.get_or_init(super::devices::probe).clone()
}

/// What the Ready badge shows.
///
/// `state` exists because initialization is slow enough to see: on Apple Silicon
/// the first call compiles Metal shaders for about fifteen seconds. Reporting
/// `warming` is the difference between "preparing GPU" and a badge that looks
/// broken.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendState {
    /// `warming` | `ready` | `failed`
    pub state: String,
    pub device: Option<super::Backend>,
    /// Whether llama.cpp was built with any GPU backend at all. False on the
    /// Windows and Linux builds today, which is why a writer there sees CPU
    /// speeds and should be told it is expected, not a fault.
    pub gpu_offload: bool,
}

pub fn backend_state() -> BackendState {
    match BACKEND.get() {
        None => BackendState { state: "warming".into(), device: None, gpu_offload: false },
        Some(Err(_)) => BackendState { state: "failed".into(), device: None, gpu_offload: false },
        Some(Ok(backend)) => BackendState {
            state: "ready".into(),
            device: device_info(),
            gpu_offload: backend.supports_gpu_offload(),
        },
    }
}

// --- what a caller can watch while a job runs ---

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// The catalog id of the model running.
    pub model: String,
    /// Text produced so far. The point of this whole struct: a 27B model on CPU
    /// takes long enough that silence reads as a freeze.
    pub text: String,
    pub tokens: u64,
    pub done: bool,
}

#[derive(Debug)]
struct Active {
    model: String,
    text: Arc<Mutex<String>>,
    tokens: Arc<AtomicU64>,
    cancel: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
}

fn active() -> &'static Mutex<Option<Active>> {
    static ACTIVE: OnceLock<Mutex<Option<Active>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(None))
}

/// What the frontend polls, the same way it polls a download.
pub fn progress() -> Option<Progress> {
    let guard = active().lock().ok()?;
    let a = guard.as_ref()?;
    let text = a.text.lock().map(|t| t.clone()).unwrap_or_default();
    Some(Progress {
        model: a.model.clone(),
        text,
        tokens: a.tokens.load(Ordering::Relaxed),
        done: a.done.load(Ordering::Relaxed),
    })
}

/// Stop the running job. Checked once per token, so closing the rewrite dialog
/// actually stops the GPU rather than letting it finish into a discarded
/// buffer.
pub fn cancel() {
    if let Ok(guard) = active().lock() {
        if let Some(a) = guard.as_ref() {
            a.cancel.store(true, Ordering::Relaxed);
        }
    }
}

/// Claim the single slot, or report who has it.
fn claim(model: &str) -> Result<Active, String> {
    let mut guard = active().lock().map_err(|_| FAILED.to_string())?;
    if let Some(current) = guard.as_ref() {
        if !current.done.load(Ordering::Relaxed) {
            return Err(BUSY.to_string());
        }
    }
    let fresh = Active {
        model: model.to_string(),
        text: Arc::new(Mutex::new(String::new())),
        tokens: Arc::new(AtomicU64::new(0)),
        cancel: Arc::new(AtomicBool::new(false)),
        done: Arc::new(AtomicBool::new(false)),
    };
    let handle = Active {
        model: fresh.model.clone(),
        text: Arc::clone(&fresh.text),
        tokens: Arc::clone(&fresh.tokens),
        cancel: Arc::clone(&fresh.cancel),
        done: Arc::clone(&fresh.done),
    };
    *guard = Some(fresh);
    Ok(handle)
}

/// Whether a job is running right now, for a caller that would rather do
/// nothing than wait — the continuity pass must never sit in front of a
/// writer's rewrite.
pub fn is_busy() -> bool {
    active()
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|a| !a.done.load(Ordering::Relaxed)))
        .unwrap_or(false)
}

// --- the worker thread ---

enum Job {
    Generate {
        model: PathBuf,
        id: String,
        catalog_ctx: u32,
        prompt: String,
        max_tokens: usize,
        handle: Active,
        reply: mpsc::Sender<Result<String, String>>,
    },
    Unload,
}

fn worker() -> &'static Mutex<mpsc::Sender<Job>> {
    static WORKER: OnceLock<Mutex<mpsc::Sender<Job>>> = OnceLock::new();
    WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("versorium-llama".into())
            .spawn(move || run(rx))
            .expect("spawn the llama thread");
        Mutex::new(tx)
    })
}

/// The thread body. It owns the loaded model for as long as the same one keeps
/// being asked for, so a second rewrite does not re-read gigabytes from disk.
fn run(rx: mpsc::Receiver<Job>) {
    let mut loaded: Option<(String, LlamaModel)> = None;
    while let Ok(job) = rx.recv() {
        match job {
            Job::Unload => loaded = None,
            Job::Generate { model, id, catalog_ctx, prompt, max_tokens, handle, reply } => {
                // Swapping models frees the old one first: holding two 17 GB
                // models is the one thing that would certainly exhaust memory.
                if loaded.as_ref().is_none_or(|(current, _)| current != &id) {
                    loaded = None;
                    loaded = match load(&model) {
                        Ok(m) => Some((id.clone(), m)),
                        Err(e) => {
                            handle.done.store(true, Ordering::Relaxed);
                            let _ = reply.send(Err(e));
                            continue;
                        }
                    };
                }
                let result = match loaded.as_ref() {
                    Some((_, m)) => generate_with(m, catalog_ctx, &prompt, max_tokens, &handle),
                    None => Err(LOAD_FAILED.to_string()),
                };
                handle.done.store(true, Ordering::Relaxed);
                let _ = reply.send(result);
            }
        }
    }
}

fn load(path: &Path) -> Result<LlamaModel, String> {
    let backend = backend()?;
    // `load_from_file` has a `debug_assert!` on the path existing, so a missing
    // model would panic in a dev build rather than return an error.
    if !path.is_file() {
        return Err(LOAD_FAILED.to_string());
    }
    // `LlamaModelParams::default()` already sets n_gpu_layers = -1, meaning
    // offload every layer. There is nothing to opt into.
    LlamaModel::load_from_file(backend, path, &LlamaModelParams::default())
        .map_err(|_| LOAD_FAILED.to_string())
}

fn generate_with(
    model: &LlamaModel,
    catalog_ctx: u32,
    prompt: &str,
    max_tokens: usize,
    handle: &Active,
) -> Result<String, String> {
    let backend = backend()?;
    let n_ctx = fit::context_for(catalog_ctx, model.n_ctx_train());
    // Both of llama.cpp's defaults are wrong for a desktop app: 512 tokens of
    // context would cut a selected passage in half, and 4 threads ignores the
    // machine.
    let params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(n_ctx))
        .with_n_threads(threads())
        .with_n_threads_batch(threads());
    let mut ctx = model.new_context(backend, params).map_err(|_| FAILED.to_string())?;

    // The template has to be applied here, not by the caller: it comes from the
    // GGUF, and the model only exists on this thread. Skipping it would hand an
    // instruction-tuned model raw text, which it continues rather than answers.
    let templated = chat_prompt(model, prompt);
    // `apply_chat_template` already emits the model's BOS, so adding another
    // would prepend a duplicate token the model never sees in training.
    let tokens = model
        .str_to_token(&templated, AddBos::Never)
        .map_err(|_| FAILED.to_string())?;
    if tokens.is_empty() {
        return Err(FAILED.to_string());
    }
    // Leave room for the answer; a prompt that fills the window has nowhere to
    // put a rewrite.
    if tokens.len() >= n_ctx as usize {
        return Err(FAILED.to_string());
    }

    let mut batch = LlamaBatch::new(tokens.len(), 1);
    let last = tokens.len() - 1;
    for (i, token) in tokens.iter().enumerate() {
        batch
            .add(*token, i as i32, &[0], i == last)
            .map_err(|_| FAILED.to_string())?;
    }
    ctx.decode(&mut batch).map_err(|_| FAILED.to_string())?;

    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::top_k(TOP_K),
        LlamaSampler::top_p(TOP_P, 1),
        LlamaSampler::temp(TEMPERATURE),
        LlamaSampler::dist(seed()),
    ]);

    // One decoder for the whole loop, not one per token. A token can end
    // mid-UTF-8, and this is what carries the incomplete sequence across to the
    // next one — which is the entire reason `token_to_str` is unusable here:
    // it builds a fresh decoder per call and drops the accent.
    let mut decoder = UTF_8.new_decoder();
    let mut out = String::new();
    let mut pos = tokens.len() as i32;

    for _ in 0..max_tokens {
        if handle.cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.to_string());
        }
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        // No `sampler.accept(token)` here on purpose: llama.cpp's
        // `llama_sampler_sample` already accepts internally. The upstream
        // example accepts again, which is harmless for `dist` but corrupts
        // state the moment a penalty or grammar sampler is added.
        if model.is_eog_token(token) {
            break;
        }
        let piece = model
            .token_to_piece(token, &mut decoder, false, None)
            .map_err(|_| FAILED.to_string())?;
        out.push_str(&piece);
        if let Ok(mut shared) = handle.text.lock() {
            shared.push_str(&piece);
        }
        handle.tokens.fetch_add(1, Ordering::Relaxed);

        batch.clear();
        batch
            .add(token, pos, &[0], true)
            .map_err(|_| FAILED.to_string())?;
        pos += 1;
        if pos >= n_ctx as i32 {
            break;
        }
        ctx.decode(&mut batch).map_err(|_| FAILED.to_string())?;
    }

    Ok(out)
}

/// A different seed per call, so asking twice offers a different sentence
/// rather than repeating a rejected one.
fn seed() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0)
}

/// Run a prompt through a local model. Blocking: call it from `spawn_blocking`.
pub fn generate(
    id: &str,
    model: &Path,
    catalog_ctx: u32,
    prompt: &str,
    max_tokens: usize,
) -> Result<String, String> {
    let handle = claim(id)?;
    let (reply, answer) = mpsc::channel();
    let job = Job::Generate {
        model: model.to_path_buf(),
        id: id.to_string(),
        catalog_ctx,
        prompt: prompt.to_string(),
        max_tokens,
        handle,
        reply,
    };
    worker()
        .lock()
        .map_err(|_| FAILED.to_string())?
        .send(job)
        .map_err(|_| FAILED.to_string())?;
    answer.recv().map_err(|_| FAILED.to_string())?
}

/// Drop the resident model, freeing its memory without quitting the app.
pub fn unload() -> Result<(), String> {
    worker()
        .lock()
        .map_err(|_| FAILED.to_string())?
        .send(Job::Unload)
        .map_err(|_| FAILED.to_string())
}

/// Build the prompt a chat-tuned model expects, using the template the GGUF
/// itself ships.
///
/// The fallback is ChatML because that is what the catalogue's Qwen and Gemma
/// entries use; a model with no template at all would otherwise be sent raw
/// text and answer with a continuation rather than an edit.
pub fn chat_prompt(model: &LlamaModel, user: &str) -> String {
    let message = LlamaChatMessage::new("user".to_string(), user.to_string());
    match (model.chat_template(None), message) {
        (Ok(template), Ok(msg)) => match model.apply_chat_template(&template, &[msg], true) {
            Ok(prompt) => prompt,
            Err(_) => chatml(user),
        },
        _ => chatml(user),
    }
}

fn chatml(user: &str) -> String {
    format!("<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n")
}

/// Remove a reasoning block from a model's answer.
///
/// Qwen3.x emits `<think>…</think>` before its reply. Without this the rewrite
/// pipeline would splice the reasoning — or, when the budget runs out mid-think,
/// an empty string — straight into a chapter. Equivalent to llama.cpp's
/// `--reasoning-budget 0`.
pub fn strip_reasoning(answer: &str) -> String {
    const OPEN: &str = "<think>";
    const CLOSE: &str = "</think>";
    let mut rest = answer;
    let mut out = String::new();
    while let Some(start) = rest.find(OPEN) {
        out.push_str(&rest[..start]);
        match rest[start..].find(CLOSE) {
            Some(end) => rest = &rest[start + end + CLOSE.len()..],
            // Unterminated: the model ran out of budget while thinking, so
            // everything after the tag is reasoning, not prose.
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reasoning_block_never_reaches_the_chapter() {
        assert_eq!(
            strip_reasoning("<think>The user wants shorter.</think>La noche cayó."),
            "La noche cayó."
        );
        // Whitespace around the block is the model's, not the writer's.
        assert_eq!(strip_reasoning("  <think>x</think>\n\nTexto.  "), "Texto.");
    }

    #[test]
    fn an_unterminated_reasoning_block_yields_nothing_rather_than_reasoning() {
        // This is the dangerous case: a truncated think tag used to mean the
        // whole reply was reasoning, and splicing it would replace a paragraph
        // with the model's notes about the paragraph.
        assert_eq!(strip_reasoning("<think>I should shorten this and"), "");
        assert_eq!(strip_reasoning("Antes.<think>unterminated"), "Antes.");
    }

    #[test]
    fn an_answer_with_no_reasoning_is_left_alone() {
        assert_eq!(strip_reasoning("La niña esperó."), "La niña esperó.");
        assert_eq!(strip_reasoning(""), "");
        // A stray closing tag is not an opening one; nothing is stripped.
        assert_eq!(strip_reasoning("Texto</think>más"), "Texto</think>más");
    }

    #[test]
    fn more_than_one_reasoning_block_is_all_removed() {
        assert_eq!(strip_reasoning("<think>a</think>Uno.<think>b</think>Dos."), "Uno.Dos.");
    }

    #[test]
    fn the_chatml_fallback_asks_for_an_answer_not_a_continuation() {
        let prompt = chatml("Rewrite this.");
        assert!(prompt.contains("Rewrite this."));
        assert!(prompt.ends_with("<|im_start|>assistant\n"), "the model must know it is its turn");
    }

    #[test]
    fn thread_count_leaves_something_for_the_interface() {
        let t = threads();
        assert!(t >= 1, "never zero threads");
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) as i32;
        assert!(t <= cores, "never oversubscribes");
        if cores > 1 {
            assert_eq!(t, cores - 1, "one core stays free for the editor");
        }
    }

    #[test]
    fn nothing_is_claimed_twice_at_once() {
        // Spec §6.2's "one heavy inference at a time". The second caller is told
        // so rather than being queued behind an unknown wait.
        let first = claim("model-a").expect("the first caller gets the slot");
        assert_eq!(claim("model-b").unwrap_err(), BUSY);
        assert!(is_busy());

        // Finishing releases it, and the next caller can be a different model.
        first.done.store(true, Ordering::Relaxed);
        assert!(!is_busy());
        let second = claim("model-b").expect("the slot is free again");
        assert_eq!(second.model, "model-b");
        second.done.store(true, Ordering::Relaxed);
    }

    #[test]
    fn cancelling_is_visible_to_the_job_that_is_running() {
        let handle = claim("model-c").expect("slot");
        assert!(!handle.cancel.load(Ordering::Relaxed));
        cancel();
        assert!(handle.cancel.load(Ordering::Relaxed), "the decode loop must see it");
        handle.done.store(true, Ordering::Relaxed);
    }

    #[test]
    fn progress_reports_what_has_been_produced_so_far() {
        let handle = claim("model-d").expect("slot");
        handle.text.lock().unwrap().push_str("La noche");
        handle.tokens.store(3, Ordering::Relaxed);
        let p = progress().expect("a running job reports");
        assert_eq!(p.model, "model-d");
        assert_eq!(p.text, "La noche");
        assert_eq!(p.tokens, 3);
        assert!(!p.done);
        handle.done.store(true, Ordering::Relaxed);
        assert!(progress().expect("still readable once finished").done);
    }

    #[test]
    fn a_device_is_never_claimed_before_the_backend_is_ready() {
        // Reporting "Metal" while shaders are still compiling would be a label
        // the badge shows, wrongly, for about fifteen seconds.
        let state = backend_state();
        if state.state != "ready" {
            assert!(state.device.is_none());
            assert!(!state.gpu_offload);
        }
    }

    /// Needs a real GGUF: `VERSORIUM_TEST_GGUF=/path/to/model.gguf cargo test -- --ignored live_`
    #[test]
    #[ignore = "loads a real GGUF and runs inference on this machine"]
    fn live_a_real_model_answers_and_serializes() {
        let Some(path) = std::env::var_os("VERSORIUM_TEST_GGUF").map(PathBuf::from) else {
            eprintln!("VERSORIUM_TEST_GGUF not set: skipped");
            return;
        };
        assert!(path.is_file(), "VERSORIUM_TEST_GGUF must point at a file");

        let prompt = chatml("Reply with exactly the word: listo");
        let out = generate("live", &path, 4096, &prompt, 32).expect("generation");
        eprintln!("model said: {out:?}");
        assert!(!out.trim().is_empty(), "a model that loads must produce something");

        // The gate: a second call while the first runs is refused, not queued.
        // Waiting on `is_busy` rather than sleeping a fixed span — a fast model
        // on a warm cache can finish a short generation inside any sleep short
        // enough to keep the test quick.
        let busy_path = path.clone();
        let handle = std::thread::spawn(move || {
            generate("live", &busy_path, 4096, &chatml("Escribe un párrafo largo sobre el mar."), 512)
        });
        let mut observed_busy = false;
        for _ in 0..200 {
            if is_busy() {
                observed_busy = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(observed_busy, "the first generation never reported itself as running");
        let second = generate("live", &path, 4096, &chatml("hola"), 8);
        assert_eq!(
            second.unwrap_err(),
            BUSY,
            "a call arriving while one runs must be refused, not queued"
        );
        let first = handle.join().expect("thread");
        let text = first.expect("the first generation finishes after the refusal");
        eprintln!("first call produced {} chars", text.len());
        assert!(!text.trim().is_empty());

        // Progress reported something while it ran, which is what the UI polls.
        assert!(progress().is_some_and(|p| p.done), "the finished job stays readable");
        unload().expect("unload");
    }
}
