//! What this computer can do for local AI, from facts gathered elsewhere.
//!
//! Pure: plain data in, a `Readiness` out, so every case is tested on any
//! machine, CI's included. The probes (`probe.rs`, `adapters.rs`) only
//! gather facts; nothing here touches Vulkan or the OS.
//!
//! The rules mirror ggml-vulkan's own (llama-cpp-sys-2 0.1.157,
//! `ggml-vulkan.cpp`): a device takes layers only if it is a discrete or
//! integrated GPU, runs Vulkan 1.2, and has 16-bit storage buffers. A machine
//! whose Vulkan loader is present but has no such device runs on the CPU,
//! which ggml falls back to by itself. A machine with no loader cannot start
//! the engine at all: the build registers the Vulkan backend statically.

use super::vendor;
use serde::{Deserialize, Serialize};

/// `VK_MAKE_API_VERSION(0, 1, 2, 0)`.
pub const VULKAN_1_2: u32 = (1 << 22) | (2 << 12);

/// One Vulkan physical device, as the probe reports it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VkDevice {
    pub name: String,
    pub vendor_id: u32,
    pub device_id: u32,
    /// `discrete` | `integrated` | `virtual` | `cpu` | `other`.
    pub device_type: String,
    pub api_version: u32,
    /// The driver's own version string when it gives one (`"552.22"`).
    pub driver_info: String,
    pub storage_16bit: bool,
    pub memory_mb: u64,
}

/// What the probe saw once the loader opened.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VkFacts {
    pub loader_version: Option<u32>,
    /// `vkCreateInstance`'s result when it failed (no driver at all).
    pub instance_error: Option<i32>,
    pub devices: Vec<VkDevice>,
}

/// How the probe ended. The wire format between `versorium --gpu-probe` and
/// the app, hence the tags.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "probe", rename_all = "camelCase")]
pub enum ProbeOutcome {
    /// macOS (Metal), or a build without the Vulkan backend.
    NotApplicable,
    /// The Vulkan loader (`vulkan-1.dll`, `libvulkan.so.1`) could not be opened.
    LoaderMissing,
    Ran(VkFacts),
    /// The probe process died (a driver crashing inside Vulkan).
    Crashed { code: Option<i32> },
    TimedOut,
}

/// A display adapter the OS knows, whatever Vulkan thinks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
    pub name: String,
    pub vendor_id: u32,
    pub device_id: u32,
    /// The installed driver's version, when the OS says.
    pub driver: Option<String>,
}

/// Everything the classification reads.
#[derive(Debug, Clone, PartialEq)]
pub struct Facts {
    /// `windows` | `linux` | `macos`.
    pub platform: String,
    pub adapters: Vec<Adapter>,
    pub probe: ProbeOutcome,
    pub remote_session: bool,
}

/// One GPU as the status modal lists it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    /// `nvidia` | `amd` | `intel` | `microsoft` | `virtual` | `software` | `other`.
    pub vendor: String,
    pub driver: Option<String>,
    /// `1.3`, when Vulkan sees it.
    pub vulkan: Option<String>,
    pub device_type: Option<String>,
    pub memory_mb: Option<u64>,
    /// ggml will put layers on it.
    pub usable: bool,
}

/// What the app can do, and what the modal says about it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readiness {
    /// `ready` (a GPU runs the models), `cpu` (they run, slower, on the
    /// processor) or `unavailable` (the engine cannot start here).
    pub state: String,
    /// `vulkan` | `metal` | `cpu` | `none`.
    pub backend: String,
    pub platform: String,
    pub loader_present: bool,
    pub gpus: Vec<Gpu>,
    /// Stable codes the UI words: what stands between this computer and a GPU.
    pub missing: Vec<String>,
    /// Stable codes that explain without asking anything: a remote session,
    /// a virtual machine.
    pub hints: Vec<String>,
    /// The driver page for the GPU found, when one is the fix.
    pub driver: Option<vendor::DriverSource>,
}

impl Readiness {
    /// The engine may start: on a GPU, or on the processor.
    pub fn allows_engine(&self) -> bool {
        self.state != "unavailable"
    }
}

/// Whether ggml will put layers on a device (ggml-vulkan.cpp's own checks).
pub fn usable(device: &VkDevice) -> bool {
    matches!(device.device_type.as_str(), "discrete" | "integrated")
        && device.api_version >= VULKAN_1_2
        && device.storage_16bit
}

fn api_text(version: u32) -> String {
    format!("{}.{}", (version >> 22) & 0x7f, (version >> 12) & 0x3ff)
}

/// Real GPUs the OS sees: not software rasterizers, not a VM's display.
fn hardware(adapters: &[Adapter]) -> impl Iterator<Item = &Adapter> {
    adapters.iter().filter(|a| !vendor::is_software(a.vendor_id) && !vendor::is_virtual(a.vendor_id))
}

/// The list the modal shows: every Vulkan device, then every adapter the OS
/// knows that Vulkan did not report (a GPU with no driver shows up only there).
fn gpus(facts: &Facts) -> Vec<Gpu> {
    let devices: &[VkDevice] = match &facts.probe {
        ProbeOutcome::Ran(vk) => &vk.devices,
        _ => &[],
    };
    let mut list: Vec<Gpu> = devices
        .iter()
        .map(|d| Gpu {
            name: d.name.clone(),
            vendor: vendor::slug(d.vendor_id).to_string(),
            driver: (!d.driver_info.trim().is_empty()).then(|| d.driver_info.trim().to_string()),
            vulkan: Some(api_text(d.api_version)),
            device_type: Some(d.device_type.clone()),
            memory_mb: (d.memory_mb > 0).then_some(d.memory_mb),
            usable: usable(d),
        })
        .collect();
    for adapter in &facts.adapters {
        let known = devices.iter().any(|d| d.vendor_id == adapter.vendor_id && d.device_id == adapter.device_id);
        if !known {
            list.push(Gpu {
                name: adapter.name.clone(),
                vendor: vendor::slug(adapter.vendor_id).to_string(),
                driver: adapter.driver.clone(),
                vulkan: None,
                device_type: None,
                memory_mb: None,
                usable: false,
            });
        }
    }
    list
}

/// The first real GPU's vendor, for the driver link.
fn driver_for(facts: &Facts) -> Option<vendor::DriverSource> {
    let from_vulkan = match &facts.probe {
        ProbeOutcome::Ran(vk) => vk.devices.iter().find_map(|d| vendor::driver_source(d.vendor_id)),
        _ => None,
    };
    from_vulkan.or_else(|| hardware(&facts.adapters).find_map(|a| vendor::driver_source(a.vendor_id)))
}

pub fn classify(facts: &Facts) -> Readiness {
    let mut missing: Vec<&str> = Vec::new();
    let mut hints: Vec<&str> = Vec::new();
    if facts.remote_session {
        hints.push("remote_session");
    }
    if facts.adapters.iter().any(|a| vendor::is_virtual(a.vendor_id)) {
        hints.push("virtual_machine");
    }
    let has_hardware = hardware(&facts.adapters).next().is_some();
    // A GPU the OS only knows through Microsoft's basic driver has no vendor
    // driver installed: the adapter list names Microsoft, the PCI id the maker.
    let basic_driver_only = !facts.adapters.is_empty()
        && facts.adapters.iter().all(|a| vendor::is_software(a.vendor_id) || vendor::is_virtual(a.vendor_id));

    let (state, backend, loader_present) = match &facts.probe {
        ProbeOutcome::NotApplicable => {
            let backend = if facts.platform == "macos" { "metal" } else { "cpu" };
            ("ready", backend, true)
        }
        ProbeOutcome::LoaderMissing => {
            missing.push("vulkan_loader");
            if !has_hardware || basic_driver_only {
                missing.push(if facts.adapters.is_empty() { "no_gpu" } else { "gpu_driver" });
            }
            ("unavailable", "none", false)
        }
        ProbeOutcome::Crashed { .. } => {
            // Whatever crashed the probe would crash the engine, in the app.
            missing.push("probe_crashed");
            ("unavailable", "none", true)
        }
        ProbeOutcome::TimedOut => {
            missing.push("probe_timeout");
            ("unavailable", "none", true)
        }
        ProbeOutcome::Ran(vk) => {
            if vk.devices.iter().any(usable) {
                ("ready", "vulkan", true)
            } else {
                // ggml runs on the processor; say what keeps it off the GPU.
                if vk.loader_version.is_some_and(|v| v < VULKAN_1_2) {
                    missing.push("loader_outdated");
                } else if vk.instance_error.is_some() || vk.devices.iter().all(|d| d.device_type == "cpu") {
                    missing.push(if has_hardware && !basic_driver_only { "vulkan_driver" } else if facts.adapters.is_empty() || !has_hardware { "no_gpu" } else { "gpu_driver" });
                } else if vk.devices.iter().any(|d| d.api_version < VULKAN_1_2) {
                    missing.push("vulkan_1_2");
                } else if vk.devices.iter().any(|d| !d.storage_16bit) {
                    missing.push("feature_16bit_storage");
                } else {
                    missing.push("no_gpu");
                }
                ("cpu", "cpu", true)
            }
        }
    };
    let driver = if missing.iter().any(|m| matches!(*m, "vulkan_loader" | "gpu_driver" | "vulkan_driver" | "loader_outdated" | "vulkan_1_2")) {
        driver_for(facts)
    } else {
        None
    };
    Readiness {
        state: state.to_string(),
        backend: backend.to_string(),
        platform: facts.platform.clone(),
        loader_present,
        gpus: gpus(facts),
        missing: missing.into_iter().map(String::from).collect(),
        hints: hints.into_iter().map(String::from).collect(),
        driver,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpu(name: &str, vendor_id: u32, kind: &str) -> VkDevice {
        VkDevice {
            name: name.into(),
            vendor_id,
            device_id: 0x2504,
            device_type: kind.into(),
            api_version: (1 << 22) | (3 << 12),
            driver_info: "552.22".into(),
            storage_16bit: true,
            memory_mb: 12288,
        }
    }

    fn adapter(name: &str, vendor_id: u32) -> Adapter {
        Adapter { name: name.into(), vendor_id, device_id: 0x2504, driver: Some("32.0.15.5222".into()) }
    }

    fn facts(platform: &str, adapters: Vec<Adapter>, probe: ProbeOutcome) -> Facts {
        Facts { platform: platform.into(), adapters, probe, remote_session: false }
    }

    #[test]
    fn a_mac_is_ready_on_metal_without_probing() {
        let r = classify(&facts("macos", vec![], ProbeOutcome::NotApplicable));
        assert_eq!((r.state.as_str(), r.backend.as_str()), ("ready", "metal"));
        assert!(r.allows_engine() && r.missing.is_empty() && r.driver.is_none());
    }

    #[test]
    fn a_working_gpu_is_ready_on_vulkan() {
        let vk = VkFacts { loader_version: Some(VULKAN_1_2 | (3 << 12)), instance_error: None, devices: vec![gpu("NVIDIA GeForce RTX 3060", vendor::NVIDIA, "discrete")] };
        let r = classify(&facts("windows", vec![adapter("NVIDIA GeForce RTX 3060", vendor::NVIDIA)], ProbeOutcome::Ran(vk)));
        assert_eq!((r.state.as_str(), r.backend.as_str()), ("ready", "vulkan"));
        assert_eq!(r.gpus.len(), 1, "the adapter and its Vulkan device are one GPU");
        assert!(r.gpus[0].usable);
        assert_eq!(r.gpus[0].vulkan.as_deref(), Some("1.3"));
        assert!(r.missing.is_empty() && r.driver.is_none());
    }

    #[test]
    fn no_loader_with_a_gpu_on_the_basic_driver_asks_for_the_vendor_driver() {
        // Windows names the card "Microsoft Basic Display Adapter" until the
        // vendor's driver is in; the PCI id still says NVIDIA.
        let adapters = vec![Adapter { name: "Microsoft Basic Display Adapter".into(), vendor_id: vendor::MICROSOFT, device_id: 0, driver: None }];
        let r = classify(&facts("windows", adapters, ProbeOutcome::LoaderMissing));
        assert_eq!(r.state, "unavailable");
        assert!(!r.allows_engine());
        assert_eq!(r.missing, ["vulkan_loader", "gpu_driver"]);
    }

    #[test]
    fn no_loader_with_a_named_gpu_points_at_its_vendor() {
        let r = classify(&facts("windows", vec![adapter("NVIDIA GeForce RTX 3060", vendor::NVIDIA)], ProbeOutcome::LoaderMissing));
        assert_eq!(r.missing, ["vulkan_loader"]);
        assert_eq!(r.driver.as_ref().map(|d| d.vendor), Some("nvidia"));
        assert_eq!(r.gpus[0].vulkan, None, "listed though Vulkan never saw it");
    }

    #[test]
    fn a_loader_without_a_gpu_runs_on_the_processor_and_says_why() {
        // Linux with only llvmpipe: Vulkan answers with a CPU device.
        let vk = VkFacts { loader_version: Some(VULKAN_1_2 | (3 << 12)), instance_error: None, devices: vec![gpu("llvmpipe", vendor::MESA_SOFTWARE, "cpu")] };
        let r = classify(&facts("linux", vec![adapter("Intel UHD 620", vendor::INTEL)], ProbeOutcome::Ran(vk)));
        assert_eq!((r.state.as_str(), r.backend.as_str()), ("cpu", "cpu"));
        assert!(r.allows_engine());
        assert_eq!(r.missing, ["vulkan_driver"]);
        assert_eq!(r.driver.as_ref().map(|d| d.vendor), Some("intel"));
        assert!(r.gpus.iter().all(|g| !g.usable));
    }

    #[test]
    fn a_gpu_too_old_for_ggml_runs_on_the_processor() {
        let mut old = gpu("Intel HD 4000", vendor::INTEL, "integrated");
        old.api_version = (1 << 22) | (1 << 12);
        let vk = VkFacts { loader_version: Some(VULKAN_1_2), instance_error: None, devices: vec![old] };
        let r = classify(&facts("windows", vec![], ProbeOutcome::Ran(vk)));
        assert_eq!(r.state, "cpu");
        assert_eq!(r.missing, ["vulkan_1_2"]);

        let mut no16 = gpu("Some GPU", vendor::AMD, "discrete");
        no16.storage_16bit = false;
        let vk = VkFacts { loader_version: Some(VULKAN_1_2), instance_error: None, devices: vec![no16] };
        assert_eq!(classify(&facts("linux", vec![], ProbeOutcome::Ran(vk))).missing, ["feature_16bit_storage"]);
    }

    #[test]
    fn an_old_loader_and_a_failed_instance_are_named() {
        let vk = VkFacts { loader_version: Some((1 << 22) | (1 << 12)), instance_error: None, devices: vec![] };
        assert_eq!(classify(&facts("windows", vec![], ProbeOutcome::Ran(vk))).missing, ["loader_outdated"]);
        let vk = VkFacts { loader_version: Some(VULKAN_1_2), instance_error: Some(-9), devices: vec![] };
        let r = classify(&facts("windows", vec![adapter("AMD Radeon RX 6600", vendor::AMD)], ProbeOutcome::Ran(vk)));
        assert_eq!((r.state.as_str(), r.missing[0].as_str()), ("cpu", "vulkan_driver"));
    }

    #[test]
    fn a_probe_that_crashed_or_hung_keeps_the_engine_off() {
        for probe in [ProbeOutcome::Crashed { code: Some(-1073741819) }, ProbeOutcome::TimedOut] {
            let r = classify(&facts("windows", vec![adapter("NVIDIA GeForce RTX 3060", vendor::NVIDIA)], probe));
            assert_eq!(r.state, "unavailable");
            assert!(r.missing[0] == "probe_crashed" || r.missing[0] == "probe_timeout");
            assert!(r.driver.is_none(), "a crash is not a missing driver");
        }
    }

    #[test]
    fn a_virtual_machine_and_a_remote_session_are_hints_not_missing_parts() {
        let mut f = facts("windows", vec![Adapter { name: "VMware SVGA 3D".into(), vendor_id: 0x15AD, device_id: 0x405, driver: None }], ProbeOutcome::LoaderMissing);
        f.remote_session = true;
        let r = classify(&f);
        assert_eq!(r.hints, ["remote_session", "virtual_machine"]);
        assert_eq!(r.missing, ["vulkan_loader", "gpu_driver"]);
    }

    #[test]
    fn the_wire_format_round_trips() {
        let outcome = ProbeOutcome::Ran(VkFacts { loader_version: Some(VULKAN_1_2), instance_error: None, devices: vec![gpu("X", vendor::AMD, "discrete")] });
        let text = serde_json::to_string(&outcome).unwrap();
        assert!(text.contains("\"probe\":\"ran\""));
        assert_eq!(serde_json::from_str::<ProbeOutcome>(&text).unwrap(), outcome);
        assert_eq!(serde_json::to_string(&ProbeOutcome::LoaderMissing).unwrap(), r#"{"probe":"loaderMissing"}"#);
    }
}
