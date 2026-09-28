//! Which compute device llama.cpp will actually use, in words a writer reads.
//!
//! Spec §6.2 asks for the backend to be shown on Ready. The crate enumerates
//! ggml's devices as a first-class API, so nothing here touches FFI; the work
//! is turning `"MTL0"` into something meaningful and deciding which of several
//! devices to name.
//!
//! The pure half — `label_for`, `kind_of`, `pick` — takes plain data so it can
//! be tested on any machine, including CI runners with no GPU at all. Only
//! `probe()` calls into llama.cpp.

use llama_cpp_2::{LlamaBackendDevice, LlamaBackendDeviceType};
use serde::Serialize;

/// What the UI shows about the active device.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backend {
    /// Ready for a reader: `Metal (Apple M4 Max)`, `CPU`.
    pub label: String,
    /// `gpu` | `igpu` | `cpu` | `accelerator` | `unknown`.
    pub device_type: String,
    pub mem_free_mb: u64,
    pub mem_total_mb: u64,
}

/// ggml's registry name for Metal. `ggml-metal.cpp` defines it as the literal
/// three letters, and the device `name` is that plus an index (`MTL0`), so
/// neither string is presentable on its own.
const METAL_REGISTRY_NAME: &str = "MTL";

/// The name a reader should see for a ggml backend.
///
/// Every backend but Metal already reads as itself — `CUDA`, `Vulkan`, `CPU` —
/// so an unknown backend passes through rather than being flattened to
/// "unknown": a future ggml backend is better named wrongly-cased than hidden.
pub fn label_for(backend: &str, description: &str) -> String {
    let family = if backend == METAL_REGISTRY_NAME { "Metal" } else { backend };
    let described = description.trim();
    if described.is_empty() || described == family {
        family.to_string()
    } else {
        format!("{family} ({described})")
    }
}

/// A stable string for the device class, for the UI to branch on without
/// parsing the label.
pub fn kind_of(device_type: LlamaBackendDeviceType) -> &'static str {
    match device_type {
        LlamaBackendDeviceType::Gpu => "gpu",
        // Apple Silicon is unified memory but ggml reports it as a plain GPU,
        // so this arm is for discrete-vendor iGPUs, not for Macs.
        LlamaBackendDeviceType::IntegratedGpu => "igpu",
        LlamaBackendDeviceType::Accelerator => "accelerator",
        LlamaBackendDeviceType::Cpu => "cpu",
        LlamaBackendDeviceType::Unknown => "unknown",
    }
}

/// Rank for choosing which device to name when several are registered.
///
/// A CPU device is always present alongside any GPU, so picking the first would
/// report "CPU" on a machine that is about to run entirely on Metal.
fn rank(device_type: LlamaBackendDeviceType) -> u8 {
    match device_type {
        LlamaBackendDeviceType::Gpu => 4,
        LlamaBackendDeviceType::IntegratedGpu => 3,
        LlamaBackendDeviceType::Accelerator => 2,
        LlamaBackendDeviceType::Cpu => 1,
        LlamaBackendDeviceType::Unknown => 0,
    }
}

const BYTES_PER_MB: u64 = 1024 * 1024;

/// The device worth telling the writer about: the most capable one, and among
/// equals the one with the most free memory.
pub fn pick(devices: &[LlamaBackendDevice]) -> Option<Backend> {
    let best = devices
        .iter()
        .max_by_key(|d| (rank(d.device_type), d.memory_free))?;
    Some(Backend {
        label: label_for(&best.backend, &best.description),
        device_type: kind_of(best.device_type).to_string(),
        mem_free_mb: best.memory_free as u64 / BYTES_PER_MB,
        mem_total_mb: best.memory_total as u64 / BYTES_PER_MB,
    })
}

/// Ask llama.cpp what it has. Requires the backend to be initialized first.
pub fn probe() -> Option<Backend> {
    pick(&llama_cpp_2::list_llama_ggml_backend_devices())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(
        backend: &str,
        description: &str,
        device_type: LlamaBackendDeviceType,
        free_mb: usize,
    ) -> LlamaBackendDevice {
        LlamaBackendDevice {
            index: 0,
            name: format!("{backend}0"),
            description: description.to_string(),
            backend: backend.to_string(),
            memory_total: free_mb * 1024 * 1024,
            memory_free: free_mb * 1024 * 1024,
            device_type,
        }
    }

    #[test]
    fn metal_is_named_metal_and_everything_else_keeps_its_own_name() {
        // "MTL" is ggml's registry name, not a word anybody should be shown.
        assert_eq!(label_for("MTL", "Apple M4 Max"), "Metal (Apple M4 Max)");
        assert_eq!(label_for("CUDA", "NVIDIA GeForce RTX 3080"), "CUDA (NVIDIA GeForce RTX 3080)");
        assert_eq!(label_for("Vulkan", "AMD Radeon"), "Vulkan (AMD Radeon)");
        // A backend ggml gains later should still be named, not hidden.
        assert_eq!(label_for("WebGPU", "Some Adapter"), "WebGPU (Some Adapter)");
    }

    #[test]
    fn a_missing_or_redundant_description_does_not_produce_empty_parentheses() {
        assert_eq!(label_for("CPU", ""), "CPU");
        assert_eq!(label_for("CPU", "   "), "CPU");
        // ggml sometimes describes a device with its own family name.
        assert_eq!(label_for("CPU", "CPU"), "CPU");
        assert_eq!(label_for("MTL", "Metal"), "Metal");
    }

    #[test]
    fn every_device_type_has_its_own_stable_string() {
        // The UI branches on these, so a silent collapse into "unknown" would
        // make a real GPU indistinguishable from an unrecognised device.
        let all = [
            (LlamaBackendDeviceType::Gpu, "gpu"),
            (LlamaBackendDeviceType::IntegratedGpu, "igpu"),
            (LlamaBackendDeviceType::Accelerator, "accelerator"),
            (LlamaBackendDeviceType::Cpu, "cpu"),
            (LlamaBackendDeviceType::Unknown, "unknown"),
        ];
        for (variant, expected) in all {
            assert_eq!(kind_of(variant), expected);
        }
        let names: Vec<&str> = all.iter().map(|(_, n)| *n).collect();
        let mut unique = names.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), names.len(), "two device types share a string");
    }

    #[test]
    fn a_gpu_is_reported_even_though_a_cpu_device_is_always_registered_too() {
        // This is the whole reason `pick` exists: ggml always registers a CPU
        // device, so naming the first one would tell a Mac owner "CPU" while
        // every layer runs on Metal.
        let devices = vec![
            device("MTL", "Apple M4 Max", LlamaBackendDeviceType::Gpu, 53_083),
            device("CPU", "Apple M4 Max", LlamaBackendDeviceType::Cpu, 8_192),
        ];
        let picked = pick(&devices).unwrap();
        assert_eq!(picked.label, "Metal (Apple M4 Max)");
        assert_eq!(picked.device_type, "gpu");
        assert_eq!(picked.mem_free_mb, 53_083);
    }

    #[test]
    fn order_does_not_decide_which_device_is_reported() {
        let cpu = device("CPU", "", LlamaBackendDeviceType::Cpu, 8_192);
        let gpu = device("CUDA", "RTX 3080", LlamaBackendDeviceType::Gpu, 10_240);
        assert_eq!(pick(&[cpu.clone(), gpu.clone()]).unwrap().device_type, "gpu");
        assert_eq!(pick(&[gpu, cpu]).unwrap().device_type, "gpu");
    }

    #[test]
    fn between_two_gpus_the_one_with_more_free_memory_wins() {
        let small = device("CUDA", "RTX 3060", LlamaBackendDeviceType::Gpu, 6_144);
        let large = device("CUDA", "RTX 3090", LlamaBackendDeviceType::Gpu, 24_576);
        assert_eq!(pick(&[small, large]).unwrap().label, "CUDA (RTX 3090)");
    }

    #[test]
    fn a_cpu_only_machine_reports_cpu_rather_than_nothing() {
        // Windows and Linux ship CPU-only today, so this is the common case
        // there, not an edge case.
        let picked = pick(&[device("CPU", "", LlamaBackendDeviceType::Cpu, 16_384)]).unwrap();
        assert_eq!(picked.label, "CPU");
        assert_eq!(picked.device_type, "cpu");
    }

    #[test]
    fn no_devices_is_none_rather_than_a_fabricated_label() {
        assert_eq!(pick(&[]), None);
    }

    #[test]
    fn memory_is_reported_in_whole_megabytes() {
        let mut d = device("CPU", "", LlamaBackendDeviceType::Cpu, 0);
        d.memory_free = 1024 * 1024 * 3 / 2; // 1.5 MB
        d.memory_total = 1024 * 1024 * 2;
        let picked = pick(&[d]).unwrap();
        assert_eq!(picked.mem_free_mb, 1, "truncates rather than rounding up");
        assert_eq!(picked.mem_total_mb, 2);
    }

    /// Real devices on this machine: `cargo test -- --ignored live_`.
    #[test]
    #[ignore = "initializes llama.cpp and enumerates this machine's devices"]
    fn live_this_machine_reports_a_backend() {
        let backend = llama_cpp_2::llama_backend::LlamaBackend::init().expect("init backend");
        eprintln!("gpu offload supported: {}", backend.supports_gpu_offload());
        let devices = llama_cpp_2::list_llama_ggml_backend_devices();
        for d in &devices {
            eprintln!(
                "{:<10} {:<10} {:?} free={}MB total={}MB",
                d.name,
                d.backend,
                d.device_type,
                d.memory_free / (1024 * 1024),
                d.memory_total / (1024 * 1024)
            );
        }
        assert!(!devices.is_empty(), "ggml always registers at least a CPU device");
        let picked = pick(&devices).expect("a device to report");
        eprintln!("picked: {picked:?}");
        assert!(!picked.label.is_empty());
        assert!(!picked.label.contains("MTL"), "MTL must never reach the UI");
    }
}
